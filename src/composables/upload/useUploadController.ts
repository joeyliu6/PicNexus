// 应用级上传控制器（单例，交接说明 8.1）
// 拖入 / 粘贴 / 选择文件 / 从 URL 下载 / 托盘 / 命令面板，在任何页面发起的上传都走这里；
// 首页只负责展示。第一次调用必须在组件 setup 里（应用外壳），之后任何地方都拿同一份。

import { computed, reactive, ref, watch, type ComputedRef, type Ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ImageCompressionConfig, LinkOutputConfig, UserConfig } from '@/config/types';
import { DEFAULT_CONFIG, isPublicRiskService } from '@/config/types';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { COOKIE_BASED_SERVICES } from '@/constants/serviceRequiredFields';
import { UploadQueueManager, type QueueItem, type ServiceProgress } from '@/core/UploadQueue';
import { pickPrimaryService } from '@/core/primaryService';
import { RetryService } from '@/services/RetryService';
import { configStore, readFreshConfig } from '@/store/instances';
import { useConfigManager } from '@/composables/useConfig';
import { useCookieLogin } from '@/composables/useCookieLogin';
import { useCopyLink, type CopyLinkItem, type CopyLinkResult } from '@/composables/useCopyLink';
import { usePublicRiskConfirm } from '@/composables/usePublicRiskConfirm';
import { useToast } from '@/composables/useToast';
import { useServiceHealth } from '@/composables/service/useServiceHealth';
import { resolveActivePreset } from '@/composables/image/useImageCompress';
import type { LinkFormat } from '@/utils/linkFormatter';
import { createLogger } from '@/utils/logger';
import { TOAST_MESSAGES } from '@/constants/toastMessages';
import { isStatusSuccess } from '@/utils/uploadStatus';
import { useUploadManager, type UploadRequestOptions } from './useUpload';
import { useClipboardImage } from './useClipboardImage';
import { useUrlDownload } from './useUrlDownload';
import { useQueueState } from './useQueueState';
import { isUploading } from './uploadState';
import { hasLink, itemPhase, type UploadSession } from './uploadSessions';

const log = createLogger('UploadController');

/** 「上传到」面板里的一个图床：只列已添加且已填好配置的 */
export interface UploadHost {
  id: string;
  name: string;
  selected: boolean;
  /** 需要留意的原因（如「登录已失效」）；正常时为空 */
  warning: string | null;
  /** Cookie 登录的图床：出问题时给「重新登录」 */
  cookieLogin: boolean;
}

/** 状态固定词（交接说明第 9 节）：Cookie 图床出问题一律说「登录已失效」，其余用检测给出的原因 */
export function hostWarningText(hostId: string, lastError: string | null): string {
  return (COOKIE_BASED_SERVICES as readonly string[]).includes(hostId) ? '登录已失效' : (lastError ?? '需要处理');
}

const HINT_STORAGE_KEY = 'picnexus-hint-fast-upload';

function readHintShown(): boolean {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function createController() {
  const toast = useToast();
  const { copyLinks } = useCopyLink();
  const configManager = useConfigManager();
  const health = useServiceHealth();
  const cookieLogin = useCookieLogin();
  const risk = usePublicRiskConfirm();
  const { queueItems, removeItem } = useQueueState();

  const sessions = reactive<UploadSession[]>([]);
  let current: UploadSession | null = null;
  let homeVisible: () => boolean = () => false;

  const queueManager = new UploadQueueManager({ onItemAdded: (itemId) => { current?.itemIds.push(itemId); } });
  const uploadManager = useUploadManager(queueManager, {
    onCopied: (result) => { if (current) current.copied = { count: result.copiedCount, format: result.format }; },
    resultsOnScreen: () => homeVisible(),
  });
  // 首页在屏时卡片上已经画出重试的结果，重试服务的通知只在别的页面弹（交接说明：不做双重反馈）
  const whenOffHome = <A extends unknown[]>(show: (...args: A) => void) => (...args: A) => { if (!homeVisible()) show(...args); };
  const retryService = new RetryService({
    configStore,
    queueManager,
    toast: { success: whenOffHome(toast.success), error: whenOffHome(toast.error), warn: whenOffHome(toast.warn), info: whenOffHome(toast.info) },
    saveHistoryItem: async (filePath, result, customId) => {
      await uploadManager.saveHistoryItem(filePath, result, customId);
    },
  });
  const clipboard = useClipboardImage();
  const urlDownload = useUrlDownload();

  const config = ref<UserConfig>(DEFAULT_CONFIG);
  const compression = computed<ImageCompressionConfig>(() => config.value.imageCompression ?? DEFAULT_CONFIG.imageCompression!);
  const linkOutput = computed<LinkOutputConfig>(() => ({ ...DEFAULT_CONFIG.linkOutput!, ...(config.value.linkOutput ?? {}) }));
  const showFastUploadHint = ref(false);
  /** 图床状态与配置读完之前，首页不急着判断「第一次使用 / 没有图床」，免得启动时闪一下 */
  const ready = ref(false);
  /** 上次「清空」最近上传的时间：「更早」只列这之后的记录 */
  const recentClearedAt = ref(0);

  const itemById = computed(() => new Map(queueItems.value.map((item) => [item.id, item])));

  function itemsOf(session: UploadSession): QueueItem[] {
    return session.itemIds.map((id) => itemById.value.get(id)).filter((item): item is QueueItem => !!item);
  }

  const hosts: ComputedRef<UploadHost[]> = computed(() =>
    uploadManager.availableServices.value
      .filter((id) => uploadManager.isServiceAvailable.value(id))
      .map((id) => {
        const record = health.healthMap.value[id];
        return {
          id,
          name: getServiceDisplayName(id, config.value),
          selected: uploadManager.isServiceSelected.value(id),
          warning: record?.status === 'error' ? hostWarningText(id, record.lastError) : null,
          cookieLogin: (COOKIE_BASED_SERVICES as readonly string[]).includes(id),
        };
      }),
  );

  const busy = computed(() => isUploading.value || sessions.some((s) => !s.finished)
    || queueItems.value.some((item) => item.status === 'pending' || item.status === 'uploading'));

  async function refreshConfig(): Promise<void> {
    const latest = await readFreshConfig();
    if (!latest) return;
    // 旧版本或手改过的配置可能缺字段（如整个 services），补上默认值再用
    const merged: UserConfig = { ...DEFAULT_CONFIG, ...latest, services: { ...DEFAULT_CONFIG.services, ...(latest.services ?? {}) } };
    config.value = merged;
    health.evaluateConfig(merged);
  }

  async function saveConfigPatch(patch: (config: UserConfig) => UserConfig): Promise<void> {
    const latest = (await readFreshConfig()) ?? config.value;
    const next = patch(latest);
    await configManager.saveConfig(next, true);
    config.value = next;
  }

  /** 首页与托盘改「复制为 / 压缩 / 固定复制」：写不进去时说出来（与设置页同一句），返回是否写进去了 */
  async function saveOption(patch: (config: UserConfig) => UserConfig): Promise<boolean> {
    try {
      await saveConfigPatch(patch);
      return true;
    } catch (error) {
      log.warn('保存首页选项失败', error);
      const message = TOAST_MESSAGES.config.notSaved(error);
      toast.error(message.summary, message.detail);
      return false;
    }
  }

  // ---- 发起上传 ----

  async function uploadFiles(filePaths: string[], request: UploadRequestOptions = {}): Promise<void> {
    if (filePaths.length === 0) return;
    const session = reactive<UploadSession>({ id: crypto.randomUUID(), startedAt: Date.now(), itemIds: [], finished: false, copied: null });
    sessions.unshift(session);
    current = session;
    try {
      await uploadManager.handleFilesUpload(filePaths, request);
    } finally {
      session.finished = true;
      if (current === session) current = null;
      // 一张都没进队列（不是图片 / 正在上传被拒）：这次操作不留在列表里
      if (session.itemIds.length === 0) sessions.splice(sessions.indexOf(session), 1);
    }
  }

  /** showHint：从首页按钮选文件时才出「更快的方法」提示；托盘、全局快捷键不出 */
  async function pickAndUpload({ showHint = true }: { showHint?: boolean } = {}): Promise<void> {
    const filePaths = await uploadManager.selectFiles();
    if (!filePaths?.length) return;
    // 渐进提示：第一次用了慢的方法（点按钮选文件）之后，轻轻告诉他更快的路，只出现一次
    if (showHint && !readHintShown()) showFastUploadHint.value = true;
    await uploadFiles(filePaths);
  }

  function dismissFastUploadHint(): void {
    showFastUploadHint.value = false;
    try {
      localStorage.setItem(HINT_STORAGE_KEY, '1');
    } catch (error) {
      log.warn('记录提示已出现失败', error);
    }
  }

  async function pasteClipboard(): Promise<void> {
    await clipboard.pasteAndUpload((paths) => uploadFiles(paths));
  }

  async function downloadUrls(input: string): Promise<boolean> {
    return urlDownload.downloadAndUpload(input, (paths) => uploadFiles(paths));
  }

  // ---- 「上传到 / 复制为 / 压缩」 ----

  async function toggleHost(hostId: string): Promise<void> {
    const enabling = !uploadManager.isServiceSelected.value(hostId);
    if (enabling && isPublicRiskService(hostId) && !(await risk.ensureAccepted())) return;
    uploadManager.toggleServiceSelection(hostId);
  }

  /**
   * 第一次使用 / 没有可用图床时一键加上免配置图床（京东、七鱼）：加进「已添加」并启用。
   * 公共图床第一次启用要确认风险（确认一次不再问）。
   */
  async function enableNoConfigHost(hostId: string): Promise<void> {
    if (isPublicRiskService(hostId) && !(await risk.ensureAccepted())) return;
    const add = (list: string[] | undefined) => [...new Set([...(list ?? []), hostId])];
    await saveConfigPatch((c) => ({ ...c, availableServices: add(c.availableServices), enabledServices: add(c.enabledServices) }));
    await uploadManager.loadServiceButtonStates();
  }

  /**
   * 一次改好几处配置（新手引导「开始使用」）：在最新配置上改、只保存一次，随后重算「上传到」，
   * 首页与托盘立即看到同一份结果。公共图床风险由调用方负责（引导里勾选即视为已确认）。
   */
  async function applyConfigPatch(patch: (config: UserConfig) => UserConfig): Promise<void> {
    await saveConfigPatch(patch);
    await uploadManager.loadServiceButtonStates();
  }

  /** 图床页改完配置后：重算「已添加」与启用状态（与首页「上传到」同一份） */
  async function refreshHosts(): Promise<void> {
    await uploadManager.loadServiceButtonStates();
    await refreshConfig();
  }

  async function setCopyFrom(hostId: string | undefined): Promise<void> {
    await saveOption((c) => ({ ...c, linkOutput: { ...DEFAULT_CONFIG.linkOutput!, ...(c.linkOutput ?? {}), copyFromService: hostId } }));
  }

  /**
   * 选中 = 改默认格式，并按新格式重新复制焦点卡的链接（交接说明 8.1「复制为」）。
   * 多张还没传完时只改格式：整批结束前不动剪贴板，结束时会按新格式一次复制。
   * recopy = false 只改格式（托盘：下一次上传才按新格式复制，不动剪贴板里现有的内容，T04）。
   */
  async function setFormat(format: LinkFormat, { recopy = true }: { recopy?: boolean } = {}): Promise<void> {
    const saved = await saveOption((c) => ({ ...c, linkOutput: { ...DEFAULT_CONFIG.linkOutput!, ...(c.linkOutput ?? {}), defaultFormat: format } }));
    if (!saved || !recopy) return;
    const focus = sessions[0];
    if (!focus || (!focus.finished && focus.itemIds.length > 1)) return;
    await copySession(focus.id, true);
  }

  /** presetId = null 表示「关」（原图上传） */
  async function setCompression(presetId: string | null): Promise<void> {
    await saveOption((c) => {
      const current = c.imageCompression ?? DEFAULT_CONFIG.imageCompression!;
      return { ...c, imageCompression: presetId === null ? { ...current, enabled: false } : { ...current, enabled: true, activePresetId: presetId } };
    });
  }

  // ---- 复制 ----

  /** 这张图「复制时使用」的图床：传完后是收口时选定的那个；还在传时按同一规则（固定的 / 最先完成的）现算 */
  function copySourceOf(item: QueueItem): string | undefined {
    if (item.primaryUrl) {
      const settled = item.enabledServices.find((id) => item.serviceProgress[id]?.link === item.primaryUrl);
      if (settled) return settled;
    }
    const successes = item.enabledServices
      .map((id) => item.serviceProgress[id])
      .filter((progress): progress is ServiceProgress => !!progress && isStatusSuccess(progress.status) && !!progress.link)
      .sort((a, b) => (a.succeededAt ?? Number.POSITIVE_INFINITY) - (b.succeededAt ?? Number.POSITIVE_INFINITY));
    return pickPrimaryService(successes.map((progress) => progress.serviceId), linkOutput.value.copyFromService);
  }

  function linkOf(item: QueueItem, hostId?: string): CopyLinkItem | null {
    const serviceId = hostId ?? copySourceOf(item);
    const url = serviceId ? item.serviceProgress[serviceId]?.link : undefined;
    return serviceId && url ? { url, fileName: item.fileName, serviceId } : null;
  }

  async function copyItem(itemId: string, hostId?: string): Promise<CopyLinkResult | null> {
    const item = itemById.value.get(itemId);
    const link = item ? linkOf(item, hostId) : null;
    if (!link) return null;
    return copyLinks([link], { showSuccessToast: false });
  }

  /** 焦点卡「+N」里的「复制全部 N 条」：这张图在每个已完成图床上的链接，每行一条，按图床顺序 */
  async function copyAllHosts(itemId: string): Promise<CopyLinkResult | null> {
    const item = itemById.value.get(itemId);
    if (!item) return null;
    const links = item.enabledServices.map((hostId) => linkOf(item, hostId)).filter((link): link is CopyLinkItem => !!link);
    return links.length ? copyLinks(links, { showSuccessToast: false }) : null;
  }

  /** 整批复制：每行一个，按拖入顺序；只复制有链接的 */
  async function copySession(sessionId: string, quiet = false): Promise<CopyLinkResult | null> {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    const links = itemsOf(session).filter(hasLink).map((item) => linkOf(item)).filter((link): link is CopyLinkItem => !!link);
    if (links.length === 0) return null;
    const result = await copyLinks(links, { showSuccessToast: false, showErrorToast: !quiet });
    if (result.ok) session.copied = { count: result.copiedCount, format: result.format };
    return result;
  }

  // ---- 重试 / 换个图床 / 重新登录 ----

  async function retryHost(itemId: string, hostId: string): Promise<void> {
    await retryService.retrySingleService(itemId, hostId, (await readFreshConfig()) ?? config.value);
  }

  /**
   * 单张的「重试」与首次上传一样：第一个图床传完就复制，其余图床后台继续（交接说明 4.9）。
   * 返回停止监听的函数；不是单张或关了自动复制时什么也不做。
   */
  function copyWhenFirstLinkArrives(itemId: string): () => void {
    const owner = sessions.find((s) => s.itemIds.includes(itemId));
    if (!owner || owner.itemIds.length !== 1 || linkOutput.value.autoCopy === false) return () => {};
    const stop = watch(() => {
      const item = itemById.value.get(itemId);
      return !!item && hasLink(item);
    }, (linked) => {
      if (!linked) return;
      stop();
      void copySession(owner.id, true);
    });
    return stop;
  }

  async function retryItem(itemId: string): Promise<void> {
    const stopCopy = copyWhenFirstLinkArrives(itemId);
    try {
      await retryService.retryAll(itemId, (await readFreshConfig()) ?? config.value);
    } finally {
      stopCopy();
    }
  }

  /** 只重传整张失败的（「重试这 2 张」/ 最近上传「重试失败的」）；只缺某个图床的交给「重新登录后补传」或「重试此图床」 */
  async function retryFailed(sessionId?: string): Promise<void> {
    const pool = sessionId ? sessions.filter((s) => s.id === sessionId) : [...sessions];
    const failedIds = pool.flatMap(itemsOf).filter((item) => itemPhase(item) === 'failed').map((item) => item.id);
    if (failedIds.length === 0) return;
    await retryService.retryAllFailed(failedIds, (await readFreshConfig()) ?? config.value);
  }

  /** 全部失败时「换个图床」：只对这一张生效，不改「上传到」的勾选 */
  async function uploadAgainWith(itemId: string, hostIds: string[]): Promise<void> {
    const item = itemById.value.get(itemId);
    if (!item || hostIds.length === 0) return;
    const owner = sessions.find((s) => s.itemIds.includes(itemId));
    if (owner && owner.itemIds.length === 1) sessions.splice(sessions.indexOf(owner), 1);
    else if (owner) owner.itemIds.splice(owner.itemIds.indexOf(itemId), 1);
    await uploadFiles([item.filePath], { services: hostIds });
  }

  /** 「重新登录」：打开 Cookie 登录小窗，登录成功后自动重试这张在这个图床的上传 */
  async function relogin(itemId: string, hostId: string): Promise<void> {
    await cookieLogin.login(hostId, async () => {
      await refreshConfig();
      await retryHost(itemId, hostId);
    });
  }

  /** 批量卡的「补传」：把这批里所有没传上这个图床的图逐张补传 */
  async function retryHostForSession(sessionId: string, hostId: string): Promise<void> {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const missed = itemsOf(session).filter((item) => item.enabledServices.includes(hostId) && !isStatusSuccess(item.serviceProgress[hostId]?.status));
    const latest = (await readFreshConfig()) ?? config.value;
    await Promise.allSettled(missed.map((item) => retryService.retrySingleService(item.id, hostId, latest, { silentToast: true })));
  }

  /** 批量卡的「重新登录 / 重新登录后补传」：登录一次，再给整批补传这个图床 */
  async function reloginSession(sessionId: string, hostId: string): Promise<void> {
    await cookieLogin.login(hostId, async () => {
      await refreshConfig();
      await retryHostForSession(sessionId, hostId);
    });
  }

  /** 「上传到」面板里图床登录失效时的「重新登录」：只登录，不针对某一张 */
  async function loginHost(hostId: string): Promise<void> {
    await cookieLogin.login(hostId, refreshConfig);
  }

  /**
   * 清空「最近上传」：只清这个列表，不影响图库记录，上传中不可清空。
   * 焦点卡（最新一次）不在列表里，保留；「更早」从此只显示清空之后的记录（recentClearedAt）。
   */
  function clearSessions(): void {
    if (busy.value) return;
    const [focus, ...rest] = sessions;
    for (const session of rest) for (const id of session.itemIds) removeItem(id);
    sessions.splice(focus ? 1 : 0);
    recentClearedAt.value = Date.now();
  }

  // ---- 生命周期 ----

  async function init(): Promise<UnlistenFn> {
    const unlisteners: UnlistenFn[] = [];
    await uploadManager.loadServiceButtonStates();
    await health.loadHealthStatus();
    await refreshConfig();
    ready.value = true;
    unlisteners.push(await uploadManager.setupConfigListener());
    unlisteners.push(await listen('config-updated', () => { void refreshConfig(); }));
    unlisteners.push(await cookieLogin.install());
    return () => unlisteners.splice(0).forEach((unlisten) => unlisten());
  }

  return {
    // 状态
    config: config as Readonly<Ref<UserConfig>>,
    sessions: sessions as readonly UploadSession[],
    queueItems,
    itemsOf,
    copySourceOf,
    hosts,
    busy,
    isUploading: isUploading as Readonly<Ref<boolean>>,
    isPasting: clipboard.isProcessing,
    isDownloading: urlDownload.isDownloading,
    compression,
    activePreset: computed(() => resolveActivePreset(compression.value)),
    linkOutput,
    showFastUploadHint,
    // 动作
    init,
    setHomeVisible: (getter: () => boolean) => { homeVisible = getter; },
    uploadFiles,
    pickAndUpload,
    pasteClipboard,
    downloadUrls,
    dismissFastUploadHint,
    toggleHost,
    enableNoConfigHost,
    applyConfigPatch,
    refreshHosts,
    setCopyFrom,
    setFormat,
    setCompression,
    copyItem,
    copySession,
    copyAllHosts,
    retryHost,
    retryItem,
    retryFailed,
    uploadAgainWith,
    relogin,
    reloginSession,
    retryHostForSession,
    loginHost,
    clearSessions,
    recentClearedAt,
    ready,
  };
}

export type UploadController = ReturnType<typeof createController>;

let controller: UploadController | null = null;

export function useUploadController(): UploadController {
  if (!controller) controller = createController();
  return controller;
}

export function __resetUploadControllerForTests(): void {
  controller = null;
}
