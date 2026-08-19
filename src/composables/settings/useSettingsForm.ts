// 设置表单状态管理 - 从 SettingsView.vue 提取
// 负责 formData 定义、配置加载/保存、防抖保存机制、服务配置状态

import { ref, computed, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { configStore } from '../../store/instances';
import { useToast } from '../useToast';
import { useConfigManager } from '../useConfig';
import { useServiceHealth } from '../useServiceHealth';
import { TOAST_MESSAGES } from '../../constants';
import { SERVICE_DISPLAY_NAMES } from '../../constants/serviceNames';
import { filterOrphanProfileServices, syncProfileUploaders } from './profileServiceSync';
import { encryptBackupProfiles } from './webdavBackupSecrets';
import { useStorageProfiles } from './useStorageProfiles';
import { useConfirm } from '../useConfirm';
import { createLogger } from '../../utils/logger';
import { isAnyEncryptedData } from '../../security/crypto';
import { extractNamiAuthToken } from '../../utils/namiAuthToken';
import { extractErrorMessage } from '../../utils/serviceHealthMessage';
import type {
  UserConfig,
  ServiceType,
  WebDAVProfile,
  ImageCompressionConfig,
  EditorServerConfig,
  CustomS3Profile,
  WebDAVStorageProfile,
  LinkPrefixItem,
} from '../../config/types';
import { DEFAULT_CONFIG, cloneDefaultPrefixes, makeCustomS3Id, makeWebDAVId } from '../../config/types';
import { applyConfigToForm } from './settingsFormSnapshot';
import type { SettingsFormData } from './settingsFormTypes';
import { validateS3Config } from './s3ConfigValidation';

// ---- 类型定义 ----

export type SaveFeedbackStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveFeedbackState {
  status: SaveFeedbackStatus;
  message?: string;
  updatedAt?: number;
}

// ---- composable ----

const log = createLogger('Settings');

/**
 * 按 id 对齐，把磁盘上带加密魔数前缀的字段搬进表单里的同一条 profile，其余字段一律不动
 *
 * Why 认"魔数前缀"而不是列一张字段名清单：跟 `security/fieldSecrets` 用同一套判定。
 * 新增一个字段级密文时不用回来这里登记——漏登记是静默的，用户看到的只是密码莫名其妙没了。
 */
function mergeRekeyedSecrets<T extends { id: string }>(target: T[], fresh: T[] | undefined): void {
  if (!fresh?.length) return;
  const freshById = new Map(fresh.map(profile => [profile.id, profile]));

  for (const profile of target) {
    const source = freshById.get(profile.id);
    if (!source) continue;   // 表单里刚新建、还没落盘的 profile，磁盘上没有对应项

    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string' && isAnyEncryptedData(value)) {
        (profile as Record<string, unknown>)[key] = value;
      }
    }
  }
}

export function useSettingsForm() {
  const toast = useToast();
  const { confirm: confirmDialog } = useConfirm();
  const configManager = useConfigManager();
  const serviceHealth = useServiceHealth();

  // ---- 表单数据 ----

  const formData = ref<SettingsFormData>({
    weiboCookie: '',
    // thumbnailProxyEnabled 初始值必须与 DEFAULT_CONFIG 一致（true）：loadSettings 是
    // 「表单初始值 ← 展开旧配置」，老配置里没有这个字段时展开覆盖不到，会原样保留这里的初始值。
    // 写 false 的话老用户打开设置页看到的是「关」，一保存就把代理真的关掉了——静默降级。
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '', thumbnailProxyEnabled: true },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '', s3AccessKey: '', s3SecretKey: '' },
    custom_s3_profiles: [] as CustomS3Profile[],
    webdav_profiles: [] as WebDAVStorageProfile[],
    nowcoder: { cookie: '' },
    zhihu: { cookie: '', sourceParamEnabled: true, sourceParamValue: '172ae18b' },
    nami: { cookie: '', authToken: '' },
    bilibili: { cookie: '' },
    chaoxing: { cookie: '' },
    smms: { token: '' },
    github: { token: '', owner: '', repo: '', branch: 'main', path: 'images/' } as import('../../config/types').GithubServiceConfig,
    imgur: { clientId: '', clientSecret: '' },
    webdav: { profiles: [] as WebDAVProfile[], activeId: null as string | null },
    linkPrefixEnabled: true,
    selectedPrefixIndex: 0,
    linkPrefixList: cloneDefaultPrefixes() as LinkPrefixItem[],
    analyticsEnabled: true,
    appBehavior: { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true },
    linkOutput: {
      defaultFormat: 'url' as import('../../utils/linkFormatter').LinkFormat,
      customTemplate: '{url}',
      autoCopy: true,
    },
    globalShortcut: {
      enabled: true,
      uploadClipboard: 'CommandOrControl+Shift+C',
      uploadFromFile: 'CommandOrControl+Shift+O',
    },
    autoUpdateEnabled: true,
    publicServiceRiskAccepted: false,
    imageCompression: { ...DEFAULT_CONFIG.imageCompression! } as ImageCompressionConfig,
    editorServer: { ...DEFAULT_CONFIG.editorServer! } as EditorServerConfig,
  });

  const isSettingsReady = ref(false);

  // ---- 可用服务列表 ----

  const availableServices = ref<string[]>([]);

  // 图床名称映射
  const serviceNames: Record<ServiceType, string> = {
    ...SERVICE_DISPLAY_NAMES,
  };

  // ---- 服务配置状态 ----

  const serviceConfigStatus = computed<Record<string, boolean>>(() => {
    const fd = formData.value;
    const result: Record<string, boolean> = {
      r2: !!(fd.r2.accountId && fd.r2.accessKeyId && fd.r2.secretAccessKey && fd.r2.bucketName && fd.r2.publicDomain),
      tencent: !!(fd.tencent.secretId && fd.tencent.secretKey && fd.tencent.region && fd.tencent.bucket),
      aliyun: !!(fd.aliyun.accessKeyId && fd.aliyun.accessKeySecret && fd.aliyun.region && fd.aliyun.bucket && fd.aliyun.publicDomain),
      qiniu: !!(fd.qiniu.accessKey && fd.qiniu.secretKey && fd.qiniu.region && fd.qiniu.bucket && fd.qiniu.publicDomain),
      upyun: !!(fd.upyun.operator && fd.upyun.password && fd.upyun.bucket && fd.upyun.publicDomain),
      weibo: !!fd.weiboCookie?.trim(),
      zhihu: !!fd.zhihu.cookie?.trim(),
      nowcoder: !!fd.nowcoder.cookie?.trim(),
      nami: !!fd.nami.cookie?.trim(),
      bilibili: !!fd.bilibili.cookie?.trim(),
      chaoxing: !!fd.chaoxing.cookie?.trim(),
      smms: !!fd.smms.token?.trim(),
      github: !!(fd.github.token?.trim() && fd.github.owner?.trim() && fd.github.repo?.trim()),
      imgur: !!fd.imgur.clientId?.trim(),
      jd: true,
      qiyu: true,
    };
    for (const profile of fd.custom_s3_profiles || []) {
      result[makeCustomS3Id(profile.id)] = !!(profile.endpoint && profile.accessKeyId && profile.secretAccessKey && profile.region && profile.bucket);
    }
    for (const profile of fd.webdav_profiles || []) {
      result[makeWebDAVId(profile.id)] = !!(
        profile.url && profile.username && profile.passwordEncrypted && profile.publicDomain
      );
    }
    return result;
  });

  // ---- 保存反馈状态 ----

  const advancedSaveState = ref<SaveFeedbackState>({ status: 'idle' });
  let _advancedSavedResetTimer: ReturnType<typeof setTimeout> | null = null;

  function setAdvancedSaveState(status: SaveFeedbackStatus, message?: string) {
    advancedSaveState.value = { status, message, updatedAt: Date.now() };
    if (_advancedSavedResetTimer) {
      clearTimeout(_advancedSavedResetTimer);
      _advancedSavedResetTimer = null;
    }
    if (status === 'saved') {
      _advancedSavedResetTimer = setTimeout(() => {
        if (advancedSaveState.value.status === 'saved') {
          advancedSaveState.value = { status: 'idle' };
        }
        _advancedSavedResetTimer = null;
      }, 1800);
    }
  }

  // ---- 防抖保存 ----

  let _debouncedSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let _pendingSaveTrackStatus = false;
  let isApplyingConfigSnapshot = false;

  function scheduleSave(trackAdvancedStatus = false) {
    _pendingSaveTrackStatus = _pendingSaveTrackStatus || trackAdvancedStatus;
    if (_debouncedSaveTimer !== null) clearTimeout(_debouncedSaveTimer);
    _debouncedSaveTimer = setTimeout(() => {
      _debouncedSaveTimer = null;
      const trackStatus = _pendingSaveTrackStatus;
      _pendingSaveTrackStatus = false;
      void saveSettings({ trackAdvancedStatus: trackStatus });
    }, 500);
  }

  function debouncedSaveSettings() {
    scheduleSave(false);
  }

  function debouncedSaveSettingsWithStatus() {
    scheduleSave(true);
  }

  function cancelDebouncedSave() {
    if (_debouncedSaveTimer !== null) {
      clearTimeout(_debouncedSaveTimer);
      _debouncedSaveTimer = null;
    }
    _pendingSaveTrackStatus = false;
  }

  // ---- 配置变化自动同步可用服务 ----

  // Why: 只保留"配置变空 → 自动移除"，不再"自动添加"。旧实现会在用户主动取消勾选后
  //   又重新填了 cookie 时把服务悄悄加回 availableServices，违反禁用意图；要重新启用请去芯片手动勾。
  watch(serviceConfigStatus, (newStatus, oldStatus) => {
    if (isApplyingConfigSnapshot) return;
    if (!oldStatus) return;
    const toRemove: string[] = [];
    for (const [svc, configured] of Object.entries(newStatus)) {
      const sid = svc;
      if (!configured && oldStatus[sid] && availableServices.value.includes(sid)) toRemove.push(sid);
    }
    if (!toRemove.length) return;
    // Why: 防止变空被 saveConfig 的"至少一个图床"校验拒绝；但 stale 服务会让芯片显示启用、上传时却凭证缺失——必须显式告知用户原因，否则就是静默 UX 陷阱。
    if (availableServices.value.length - toRemove.length <= 0) {
      const names = toRemove.map((sid) => SERVICE_DISPLAY_NAMES[sid as ServiceType] ?? sid).join('、');
      toast.showConfig('warn', { summary: '保留最后一个图床', detail: `「${names}」凭证已清空但仍处于启用状态。请补全凭证或先启用其他图床后再禁用。`, life: 4000 });
      return;
    }
    availableServices.value = availableServices.value.filter(s => !toRemove.includes(s));
    debouncedSaveSettings();
  });

  // ---- 工具函数 ----

  function errorToString(error: unknown): string {
    const message = extractErrorMessage(error, '');
    if (message) return message;
    if (error && typeof error === 'object') {
      try { return JSON.stringify(error); } catch { /* fallthrough */ }
    }
    return String(error);
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
  }

  // ---- 加载设置 ----

  async function loadSettings() {
    try {
      const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

      formData.value.weiboCookie = config.services?.weibo?.cookie || '';
      formData.value.r2 = {
        ...formData.value.r2,
        ...(config.services?.r2 || {}),
        // 显式兜底而不是只靠上面的展开：这个缺省值在三处各有一份（DEFAULT_CONFIG、
        // 本文件的表单初始值、useThumbCache 的 `!== false` 判据），任一处漂移都会让
        // 「运行时按开跑、设置页显示关、用户一保存就真被关掉」重现。
        thumbnailProxyEnabled: config.services?.r2?.thumbnailProxyEnabled ?? true,
      };
      formData.value.tencent = { ...formData.value.tencent, ...(config.services?.tencent || {}) };
      formData.value.aliyun = { ...formData.value.aliyun, ...(config.services?.aliyun || {}) };
      formData.value.qiniu = { ...formData.value.qiniu, ...(config.services?.qiniu || {}) };
      formData.value.upyun = { ...formData.value.upyun, ...(config.services?.upyun || {}) };
      formData.value.nowcoder = { ...formData.value.nowcoder, ...(config.services?.nowcoder || {}) };
      formData.value.zhihu = { ...formData.value.zhihu, ...(config.services?.zhihu || {}) };
      formData.value.nami = { ...formData.value.nami, ...(config.services?.nami || {}) };
      formData.value.bilibili = { ...formData.value.bilibili, ...(config.services?.bilibili || {}) };
      formData.value.chaoxing = { ...formData.value.chaoxing, ...(config.services?.chaoxing || {}) };
      formData.value.smms = { ...formData.value.smms, ...(config.services?.smms || {}) };
      formData.value.github = { ...formData.value.github, ...(config.services?.github || {}) };
      formData.value.imgur = { ...formData.value.imgur, ...(config.services?.imgur || {}) };

      // 迁移旧的单实例 custom_s3 配置到 profiles
      // 历史遗留：旧版的 services.custom_s3 单实例结构，新版已改为 custom_s3_profiles 数组
      // 只在读取/迁移时访问一次，新保存不会再写入，因此允许局部 cast 到 Record
      const legacyServices = config.services as unknown as Record<string, unknown> | undefined;
      const oldCustomS3 = legacyServices?.custom_s3 as
        | { endpoint?: string; accessKeyId?: string; secretAccessKey?: string; region?: string; bucket?: string; path?: string; publicDomain?: string }
        | undefined;
      if (oldCustomS3 && (!config.custom_s3_profiles || config.custom_s3_profiles.length === 0)) {
        if (oldCustomS3.endpoint || oldCustomS3.accessKeyId) {
          const profileId = generateId();
          config.custom_s3_profiles = [{
            id: profileId,
            name: '自定义 S3',
            endpoint: oldCustomS3.endpoint || '',
            accessKeyId: oldCustomS3.accessKeyId || '',
            secretAccessKey: oldCustomS3.secretAccessKey || '',
            region: oldCustomS3.region || '',
            bucket: oldCustomS3.bucket || '',
            path: oldCustomS3.path || '',
            publicDomain: oldCustomS3.publicDomain || '',
          }];
          const oldId = 'custom_s3';
          const newId = makeCustomS3Id(profileId);
          if (config.enabledServices?.includes(oldId)) {
            config.enabledServices = config.enabledServices.filter((s: string) => s !== oldId).concat(newId);
          }
          if (config.availableServices?.includes(oldId)) {
            config.availableServices = config.availableServices.filter((s: string) => s !== oldId).concat(newId);
          }
        }
        if (legacyServices) {
          delete legacyServices.custom_s3;
        }
      }

      formData.value.custom_s3_profiles = config.custom_s3_profiles || [];
      // WebDAV 图床 profiles：密码保持密文，解密只在上传/测试时按需进行
      formData.value.webdav_profiles = config.webdav_profiles || [];
      syncProfileUploaders(formData.value);

      // WebDAV 备份配置：密码保持密文，解密只在查看/同步/测试时按需进行
      //
      // 必须拷一份再进 formData。以前这份拷贝是 decryptBackupProfiles 顺手做掉的
      // （它返回 map 出来的新数组），去掉那一步后如果直接引用 config 的数组，
      // 表单里的编辑会就地改到 store 读出来的配置对象上，绕开保存路径。
      if (config.webdav) {
        formData.value.webdav = {
          profiles: (config.webdav.profiles || []).map(p => ({ ...p })),
          activeId: config.webdav.activeId || null,
        };
      }

      // 链接前缀
      if (config.linkPrefixConfig) {
        formData.value.linkPrefixEnabled = config.linkPrefixConfig.enabled ?? true;
        formData.value.selectedPrefixIndex = config.linkPrefixConfig.selectedIndex ?? 0;
        const savedList = config.linkPrefixConfig.prefixList;
        formData.value.linkPrefixList = savedList?.length ? savedList.map(item => ({ ...item })) : cloneDefaultPrefixes();
      }

      // 链接输出配置
      if (config.linkOutput) {
        formData.value.linkOutput = { ...formData.value.linkOutput, ...config.linkOutput };
      }

      formData.value.analyticsEnabled = config.analytics?.enabled ?? true;
      formData.value.appBehavior = config.appBehavior ?? { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true };
      if (formData.value.appBehavior.closeToTray === undefined) {
        formData.value.appBehavior.closeToTray = true;
      }
      formData.value.autoUpdateEnabled = config.autoUpdate?.enabled ?? true;
      formData.value.publicServiceRiskAccepted = config.publicServiceRiskAccepted ?? false;
      formData.value.imageCompression = config.imageCompression ?? { ...DEFAULT_CONFIG.imageCompression! };
      formData.value.editorServer = { ...DEFAULT_CONFIG.editorServer!, ...(config.editorServer ?? {}) };
      formData.value.globalShortcut = config.globalShortcut ?? {
        enabled: true,
        uploadClipboard: 'CommandOrControl+Shift+C',
        uploadFromFile: 'CommandOrControl+Shift+O',
      };
      availableServices.value = filterOrphanProfileServices(
        config.availableServices || DEFAULT_CONFIG.availableServices || [],
        formData.value,
      );

      // 从 OS 同步自启动真实状态
      try {
        const isEnabled = await invoke<boolean>('plugin:autostart|is_enabled');
        formData.value.appBehavior.autoStart = isEnabled;
      } catch { /* 忽略：插件不可用时保持配置值 */ }

      // 初始化图床健康状态
      await serviceHealth.loadHealthStatus();
      serviceHealth.evaluateConfig(config);

    } catch (e) {
      log.error('加载失败', e);
    }
  }

  /**
   * 换钥匙之后把 formData 里的字段级密文换成新的
   *
   * `swapKeyAndReencrypt` 把新密文写进了磁盘和 store 缓存，但 formData 里那份是
   * `loadSettings` 时拷贝的**旧**密文。不换掉的话有两处后果，第二处更严重：
   *
   * 1. 点眼睛拿 formData 里的旧密文去解，用新钥匙解不开 → 「解密失败」
   * 2. 下一次保存把 formData 原样写回磁盘，**刚搬好的新密文被旧的覆盖** → 前功尽弃
   *
   * Why 不直接 `loadSettings()`：那会把用户还没保存的编辑一起冲掉。
   *
   * ⚠️ 同理，这里也**不能整数组替换**。躲开 loadSettings 却把 `webdav_profiles` /
   * `webdav.profiles` 整个换成磁盘那份，等于在自己这儿犯同一个错：用户正在填的 URL、
   * 用户名、刚改的配置名全被旧值冲回去（换备份密码时设置页是开着的，边上就是这些框）。
   * 按 profile id 对齐、只搬密文字段。
   */
  async function reloadFieldSecrets(): Promise<void> {
    try {
      const config = await configStore.get<UserConfig>('config');
      if (!config) return;

      mergeRekeyedSecrets(formData.value.webdav_profiles, config.webdav_profiles);
      mergeRekeyedSecrets(formData.value.webdav.profiles, config.webdav?.profiles);
    } catch (e) {
      log.error('换钥匙后刷新字段级密文失败', e);
    }
  }

  // ---- 保存设置 ----

  async function saveSettings(options: { trackAdvancedStatus?: boolean } = {}): Promise<boolean> {
    const { trackAdvancedStatus = false } = options;
    if (trackAdvancedStatus) setAdvancedSaveState('saving', '保存中…');

    try {
      const config = await configStore.get<UserConfig>('config') || { ...DEFAULT_CONFIG };

      config.services = {
        ...config.services,
        weibo: { enabled: true, cookie: formData.value.weiboCookie },
        r2: { ...formData.value.r2, enabled: true },
        tencent: { ...formData.value.tencent, enabled: true },
        aliyun: { ...formData.value.aliyun, enabled: true },
        qiniu: { ...formData.value.qiniu, enabled: true },
        upyun: { ...formData.value.upyun, enabled: true },
        nowcoder: { ...formData.value.nowcoder, enabled: true },
        zhihu: { ...formData.value.zhihu, enabled: true },
        bilibili: { ...formData.value.bilibili, enabled: true },
        chaoxing: { ...formData.value.chaoxing, enabled: true },
        smms: { ...formData.value.smms, enabled: true },
        github: { ...formData.value.github, enabled: true },
        imgur: { ...formData.value.imgur, enabled: true },
      };

      config.custom_s3_profiles = formData.value.custom_s3_profiles;
      config.webdav_profiles = formData.value.webdav_profiles;

      // Nami Token 提取（统一走 extractNamiAuthToken，避免大小写错位的旧正则误命中其他 *_token= 字段）
      const namiCookie = formData.value.nami.cookie;
      const extractedToken = extractNamiAuthToken(namiCookie);
      const namiAuthToken = extractedToken || formData.value.nami.authToken || '';
      config.services.nami = { enabled: true, cookie: namiCookie, authToken: namiAuthToken };

      // WebDAV 备份密码加密（图床 profile 的密码全程密文，不走这条）
      const encryptedProfiles = await encryptBackupProfiles(formData.value.webdav.profiles);
      config.webdav = { profiles: encryptedProfiles, activeId: formData.value.webdav.activeId };

      config.linkPrefixConfig = {
        enabled: formData.value.linkPrefixEnabled,
        selectedIndex: formData.value.selectedPrefixIndex,
        prefixList: JSON.parse(JSON.stringify(formData.value.linkPrefixList))
      };

      config.linkOutput = { ...formData.value.linkOutput };
      config.analytics = { enabled: formData.value.analyticsEnabled };
      config.appBehavior = { ...formData.value.appBehavior };
      config.globalShortcut = { ...formData.value.globalShortcut };
      config.autoUpdate = { enabled: formData.value.autoUpdateEnabled };
      config.publicServiceRiskAccepted = formData.value.publicServiceRiskAccepted;
      config.imageCompression = { ...formData.value.imageCompression };
      config.editorServer = { ...formData.value.editorServer };
      const syncedAvailableServices = filterOrphanProfileServices(
        availableServices.value,
        formData.value,
      );
      config.availableServices = syncedAvailableServices;
      availableServices.value = [...syncedAvailableServices];
      config.enabledServices = (config.enabledServices ?? []).filter(
        serviceId => syncedAvailableServices.includes(serviceId),
      );

      await configManager.saveConfig(config, true);
      syncProfileUploaders(formData.value);
      serviceHealth.evaluateConfig(config);

      if (trackAdvancedStatus) setAdvancedSaveState('saved', '已保存');
      return true;
    } catch (e) {
      log.error('保存失败', e);
      const msg = errorToString(e);
      // saveConfig 已对该 validation 错误 toast，跳过避免重复刷屏
      if (!msg.includes('至少需要启用一个图床')) {
        toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(msg));
      }
      if (trackAdvancedStatus) setAdvancedSaveState('error', `保存失败：${msg}`);
      // 失败时把 in-memory 表单回滚到磁盘真值，避免 UI 与磁盘脱节（例如删最后一个 profile 被拒后让它重新出现）
      try { await loadSettings(); } catch (reloadErr) { log.error('回滚加载失败', reloadErr); }
      return false;
    }
  }

  async function resetToDefaultSettings(config: UserConfig = structuredClone(DEFAULT_CONFIG)): Promise<boolean> {
    const resetConfig = structuredClone(config);
    resetConfig.onboardingCompleted = false;

    try {
      await configManager.saveConfig(resetConfig, true);
      await applyConfigToForm(resetConfig, { formData, availableServices, setApplyingConfigSnapshot: (value) => { isApplyingConfigSnapshot = value; } });
      serviceHealth.evaluateConfig(resetConfig);
      setAdvancedSaveState('saved', '已恢复默认设置');
      return true;
    } catch (e) {
      log.error('恢复默认设置失败', e);
      const msg = errorToString(e);
      toast.showConfig('error', { summary: '恢复默认设置失败', detail: msg });
      try { await loadSettings(); } catch (reloadErr) { log.error('恢复默认失败后重新加载配置失败', reloadErr); }
      return false;
    }
  }

  // ---- 链接前缀管理 ----
  function addPrefix(item: LinkPrefixItem) {
    formData.value.linkPrefixList.push({ ...item });
    saveSettings();
  }
  function updatePrefix(index: number, item: LinkPrefixItem) {
    if (index < 0 || index >= formData.value.linkPrefixList.length) return;
    formData.value.linkPrefixList[index] = { ...item };
    // 不在此处调用 saveSettings()：编辑名称/模板时每次按键都会触发 updatePrefix，
    // 持久化由 InputText 的 @blur → emit('save') 统一处理，避免逐字保存
  }
  // Why: 旧实现遗漏 index === selectedIndex 分支，splice 后后继元素顶上原位，
  //   selectedIndex 静默指向另一个前缀，用户上传链接格式突变还不知道为啥。
  function removePrefix(index: number) {
    if (formData.value.linkPrefixList.length <= 1) return;
    const prevSelected = formData.value.selectedPrefixIndex;
    formData.value.linkPrefixList.splice(index, 1);
    if (index < prevSelected) {
      formData.value.selectedPrefixIndex = prevSelected - 1;
    } else if (index === prevSelected) {
      formData.value.selectedPrefixIndex = Math.min(prevSelected, formData.value.linkPrefixList.length - 1);
      const next = formData.value.linkPrefixList[formData.value.selectedPrefixIndex];
      if (next) toast.showConfig('info', { summary: '已切换链接前缀', detail: `当前前缀已删除，自动切换到「${next.name || '未命名'}」`, life: 3000 });
    }
    saveSettings();
  }
  function resetToDefaultPrefixes() {
    formData.value.linkPrefixList = cloneDefaultPrefixes();
    formData.value.selectedPrefixIndex = 0;
    saveSettings();
  }

  // ---- 多实例图床 profile 管理（自定义 S3 / WebDAV 图床）----

  const {
    addCustomS3Profile,
    deleteCustomS3Profile,
    updateCustomS3Profile,
    addWebdavProfile,
    deleteWebdavProfile,
    updateWebdavProfile,
  } = useStorageProfiles({
    formData,
    availableServices,
    saveSettings,
    toast,
    confirmDialog,
    generateId,
  });

  // ---- WebDAV 备份配置管理 ----

  function addWebDAVProfile() {
    const newProfile: WebDAVProfile = {
      id: generateId(),
      name: `配置 ${formData.value.webdav.profiles.length + 1}`,
      url: '', username: '', password: '', remotePath: '/PicNexus/'
    };
    formData.value.webdav.profiles.push(newProfile);
    formData.value.webdav.activeId = newProfile.id;
    saveSettings();
  }

  async function deleteWebDAVProfile(id: string) {
    const confirmed = await confirmDialog('确定要删除此 WebDAV 配置吗？', '删除配置');
    if (!confirmed) return;
    formData.value.webdav.profiles = formData.value.webdav.profiles.filter((p: WebDAVProfile) => p.id !== id);
    if (formData.value.webdav.activeId === id) {
      formData.value.webdav.activeId = formData.value.webdav.profiles[0]?.id || null;
    }
    saveSettings();
  }

  function switchWebDAVProfile(id: string) {
    formData.value.webdav.activeId = id;
    saveSettings();
  }

  // ---- 清理定时器 ----

  function clearTimers() {
    if (_advancedSavedResetTimer) { clearTimeout(_advancedSavedResetTimer); _advancedSavedResetTimer = null; }
    if (_debouncedSaveTimer) { clearTimeout(_debouncedSaveTimer); _debouncedSaveTimer = null; }
  }

  return {
    formData,
    isSettingsReady,
    availableServices,
    serviceNames,
    serviceConfigStatus,
    advancedSaveState,
    loadSettings,
    reloadFieldSecrets,
    saveSettings,
    resetToDefaultSettings,
    debouncedSaveSettings,
    debouncedSaveSettingsWithStatus,
    cancelDebouncedSave,
    setAdvancedSaveState,
    errorToString,
    generateId,
    validateS3Config,
    clearTimers,
    // 链接前缀
    addPrefix,
    updatePrefix,
    removePrefix,
    resetToDefaultPrefixes,
    // 多实例图床 profile
    addCustomS3Profile,
    deleteCustomS3Profile,
    updateCustomS3Profile,
    addWebdavProfile,
    deleteWebdavProfile,
    updateWebdavProfile,
    // WebDAV 备份
    addWebDAVProfile,
    deleteWebDAVProfile,
    switchWebDAVProfile,
  };
}
