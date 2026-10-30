// 图床页的页面模型（交接说明 8.4）：选中哪个、右侧是详情 / 目录 / 连接表单；启用停用、逐项即存并自动测试、
// 连接 / 移除（带撤销）、明文 HTTP 确认（P12）、Cookie 登录。单例，放在独立 effect scope 里。
// 「已添加」与启用状态读 useUploadController.hosts（与首页「上传到」、托盘同一份设置）。

import { computed, effectScope, ref, type EffectScope } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { DEFAULT_CONFIG, isCustomS3Id, isWebDAVId, type UserConfig } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { useConfirm } from '@/composables/useConfirm';
import { useCookieLogin } from '@/composables/useCookieLogin';
import { usePublicRiskConfirm } from '@/composables/usePublicRiskConfirm';
import { useToast } from '@/composables/useToast';
import { useUploadController } from '@/composables/upload/useUploadController';
import { needsHttpDomainConsent } from './s3ConfigValidation';
import { syncProfileUploaders } from './profileServiceSync';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { secureStorage } from '@/security/crypto';
import { isIpv4Address, normalizeHost } from '@/security/networkPolicy';
import { readFreshConfig } from '@/store/instances';
import { joinCjk } from '@/utils/cjkSpacing';
import { createLogger } from '@/utils/logger';
import { TOAST_MESSAGES } from '@/constants/toastMessages';
import { describeHost, type HostDescriptor } from './hostCatalog';
import {
  addProfile, blankProfile, connectHost, disconnectHost, firstMissingField, hostRecord, migrateLegacyCustomS3, readHostValues, renameProfile,
  restoreHost, snapshotHost, writeHostValues, type HostValues,
} from './hostConfig';
import { buildHostRows } from './hostList';
import { LanHttpConsentNeeded, useHostTest } from './useHostTest';

const log = createLogger('Hosts');

/** 右侧显示什么：已添加图床的详情 / 添加图床目录 / 未连接图床的连接表单 */
type HostsPane = 'detail' | 'catalog' | 'connect';

/** 连接表单的草稿（还没写进配置） */
interface ConnectDraft {
  /** 目录里点的那一种（内置图床 id，或 webdav / s3） */
  descriptorId: string;
  /** 测试时用的 id：内置图床就是它自己；多份图床是新 profile 的复合 id */
  hostId: string;
  name: string;
  values: HostValues;
}

/** P12 的文案（HostsScreen.dc.html dialog=http） */
const HTTP_CONSENT_COPY = {
  header: '允许通过 HTTP 访问此地址？',
  message: 'HTTP 不加密，图片与凭证将以明文传输。此设置仅对以下地址生效，适用于局域网环境。',
  acceptLabel: '允许 HTTP',
  rejectLabel: '取消',
} as const;

function newProfileId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function originOf(url: string): string {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return url.trim();
  }
}

/**
 * WebDAV 要放行的地址（P12 代码框）：明文 HTTP、写的是主机名的那几个。写成 IP 的局域网地址后端直接放行，
 * 要确认的只有判不出在不在局域网的主机名。一次确认对这份配置的两个地址都生效，所以都列出来。
 */
function lanConsentOrigins(record: Record<string, unknown>): string {
  const origins = [record.url, record.publicDomain].flatMap((value) => {
    if (typeof value !== 'string' || !/^http:\/\//i.test(value.trim())) return [];
    try {
      const { hostname, origin } = new URL(value.trim());
      return isIpv4Address(hostname) || hostname.startsWith('[') ? [] : [origin];
    } catch {
      return [];
    }
  });
  return [...new Set(origins)].join('\n') || originOf(String(record.url));
}

function create() {
  const upload = useUploadController();
  const configManager = useConfigManager();
  const { confirm } = useConfirm();
  const risk = usePublicRiskConfirm();
  const cookie = useCookieLogin();
  const toast = useToast();
  const tester = useHostTest();

  const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));
  const pane = ref<HostsPane>('detail');
  const selectedId = ref<string | null>(null);
  const draft = ref<ConnectDraft | null>(null);
  /** 窄窗口第二级（详情 / 目录 / 连接表单整页显示） */
  const narrowDetail = ref(false);

  const rows = computed(() => buildHostRows(upload.hosts.value.map((h) => ({ id: h.id, name: h.name, selected: h.selected, warning: h.warning })), tester.testing.value));
  const addedIds = computed(() => new Set(upload.hosts.value.map((h) => h.id)));
  const selected = computed(() => (selectedId.value ? rows.value.find((r) => r.id === selectedId.value) ?? null : null));

  function hostName(hostId: string): string {
    return getServiceDisplayName(hostId, config.value);
  }

  async function reload(): Promise<void> {
    config.value = (await readFreshConfig()) ?? structuredClone(DEFAULT_CONFIG);
    const migrated = migrateLegacyCustomS3(config.value, newProfileId());
    if (migrated) await patchConfig((c) => migrateLegacyCustomS3(c, newProfileId()) ?? c);
    await upload.refreshHosts();
    // 选中的图床被别处删了（托盘、云同步）：退回第一个；一个都没有时右侧直接是目录
    if (pane.value === 'detail' && (!selectedId.value || !addedIds.value.has(selectedId.value))) {
      selectedId.value = rows.value[0]?.id ?? null;
      if (!selectedId.value) pane.value = 'catalog';
    }
  }

  /** 读最新配置 → 改 → 保存 → 刷新「已添加」（多份图床改了还要重建上传器） */
  async function patchConfig(patch: (c: UserConfig) => UserConfig): Promise<boolean> {
    const latest = (await readFreshConfig()) ?? config.value;
    const next = patch(latest);
    try {
      await configManager.saveConfig(next, true);
    } catch (error) {
      log.warn('保存图床配置失败', error);
      // 红 = 刚才的操作失败了：改动没写进去，界面不能装作已保存
      const message = TOAST_MESSAGES.config.notSaved(error);
      toast.error(message.summary, message.detail);
      return false;
    }
    config.value = next;
    syncProfileUploaders({ custom_s3_profiles: next.custom_s3_profiles ?? [], webdav_profiles: next.webdav_profiles ?? [] });
    await upload.refreshHosts();
    return true;
  }

  // ---- 导航 ----

  function select(hostId: string): void {
    selectedId.value = hostId;
    pane.value = 'detail';
    draft.value = null;
    narrowDetail.value = true;
  }

  function openCatalog(): void {
    pane.value = 'catalog';
    draft.value = null;
    narrowDetail.value = true;
  }

  /** 关目录 / 关连接表单：回到选中的图床（没有就留在目录） */
  function closeCatalog(): void {
    draft.value = null;
    if (selectedId.value && addedIds.value.has(selectedId.value)) {
      pane.value = 'detail';
    } else {
      pane.value = 'catalog';
    }
    narrowDetail.value = false;
  }

  /** 窄窗口返回清单（‹ 图床 / Esc / Alt+←） */
  function back(): void {
    if (pane.value === 'connect') {
      pane.value = 'catalog';
      draft.value = null;
      return;
    }
    narrowDetail.value = false;
    if (pane.value === 'catalog') closeCatalog();
  }

  /** 目录里点一张卡片：进连接表单（多份图床起一份新草稿；内置图床带上配置里原有的值） */
  function openConnect(descriptorId: string): void {
    const descriptor = describeHost(descriptorId);
    if (!descriptor) return;
    if (descriptor.kind === 'webdav' || descriptor.kind === 's3') {
      const id = newProfileId();
      const names = descriptor.kind === 'webdav'
        ? (config.value.webdav_profiles ?? []).map((p) => p.name)
        : (config.value.custom_s3_profiles ?? []).map((p) => p.name);
      const profile = blankProfile(descriptor.kind, id, names);
      const hostId = descriptor.kind === 'webdav' ? `webdav:${id}` : `custom_s3:${id}`;
      const values: HostValues = {};
      for (const field of descriptor.fields) values[field.key] = String((profile as unknown as Record<string, unknown>)[field.key] ?? '');
      values.passwordEncrypted = '';
      draft.value = { descriptorId, hostId, name: profile.name, values };
    } else {
      draft.value = { descriptorId, hostId: descriptorId, name: hostName(descriptorId), values: readHostValues(config.value, descriptorId) };
    }
    tester.forget(draft.value.hostId);
    pane.value = 'connect';
    narrowDetail.value = true;
  }

  // ---- 启用 / 停用 ----

  async function toggleEnabled(hostId: string): Promise<void> {
    await upload.toggleHost(hostId);
  }

  // ---- 测试 ----

  /** 交给后端的那一份：已添加的读配置（WebDAV 密码解密），草稿读表单 */
  async function testRecord(hostId: string, values?: HostValues): Promise<Record<string, unknown>> {
    const base = values ? { ...hostRecord(config.value, hostId), ...values } : { ...hostRecord(config.value, hostId) };
    if (hostId === 'github' && values?.repo !== undefined) {
      const [owner = '', ...rest] = values.repo.split('/');
      base.owner = owner.trim();
      base.repo = rest.join('/').trim();
    }
    if (isWebDAVId(hostId)) {
      const stored = hostRecord(config.value, hostId).passwordEncrypted;
      const typed = values?.passwordEncrypted;
      base.password = typed !== undefined && typed !== ''
        ? typed
        : typeof stored === 'string' && stored ? await secureStorage.decrypt(stored).catch(() => '') : '';
    }
    return base;
  }

  /**
   * 明文 HTTP 的公开地址（S3 系）要先确认（P12），确认只对这个主机名生效。
   * 返回 false = 用户取消，这次不测。
   */
  async function ensureHttpConsent(hostId: string, record: Record<string, unknown>): Promise<boolean> {
    const descriptor = describeHost(hostId);
    if (!descriptor || (descriptor.kind !== 'object' && descriptor.kind !== 's3')) return true;
    if (!needsHttpDomainConsent(record)) return true;
    const ok = await confirm(HTTP_CONSENT_COPY.message, {
      header: HTTP_CONSENT_COPY.header, acceptLabel: HTTP_CONSENT_COPY.acceptLabel, rejectLabel: HTTP_CONSENT_COPY.rejectLabel,
      tone: 'warning', code: originOf(String(record.publicDomain)),
    });
    if (!ok) return false;
    const host = normalizeHost(new URL(String(record.publicDomain).trim()).hostname);
    record.httpDomainConfirmedFor = host;
    if (addedIds.value.has(hostId)) await patchConfig((c) => writeHostValues(c, hostId, { httpDomainConfirmedFor: host }));
    else if (draft.value?.hostId === hostId) draft.value.values.httpDomainConfirmedFor = host;
    return true;
  }

  /** WebDAV 判不出在不在局域网（fake-ip）：P12 确认后只对这个地址放行 */
  async function confirmLanHttp(hostId: string, record: Record<string, unknown>): Promise<boolean> {
    const ok = await confirm(HTTP_CONSENT_COPY.message, {
      header: HTTP_CONSENT_COPY.header, acceptLabel: HTTP_CONSENT_COPY.acceptLabel, rejectLabel: HTTP_CONSENT_COPY.rejectLabel,
      tone: 'warning', code: lanConsentOrigins(record),
    });
    if (!ok) return false;
    record.lanHttpConfirmed = true;
    if (addedIds.value.has(hostId)) await patchConfig((c) => ({ ...c, webdav_profiles: (c.webdav_profiles ?? []).map((p) => (`webdav:${p.id}` === hostId ? { ...p, lanHttpConfirmed: true } : p)) }));
    else if (draft.value?.hostId === hostId) draft.value.values.lanHttpConfirmed = 'true';
    return true;
  }

  /** 缺必填项：这一格标红「X 未填写 / 请填写后再试」，返回 true。测试、连接之前都先看这一步，不拿空值去测（空 Token 会被说成「Token 无效」） */
  function markMissing(hostId: string, values: HostValues): boolean {
    const missing = firstMissingField(hostId, values);
    if (!missing) return false;
    const label = describeHost(hostId)?.fields.find((f) => f.key === missing)?.label ?? missing;
    tester.markFailed(hostId, { phase: 'fail', step: 'credentials', field: missing, reason: joinCjk('请填写', label), passed: [], missing: true });
    return true;
  }

  async function test(hostId: string, values?: HostValues) {
    if (markMissing(hostId, values ?? readHostValues(config.value, hostId))) return null;
    const record = await testRecord(hostId, values);
    if (values?.lanHttpConfirmed === 'true') record.lanHttpConfirmed = true;
    if (!(await ensureHttpConsent(hostId, record))) return null;
    const draftTest = !addedIds.value.has(hostId);
    try {
      return await tester.run({ hostId, record, draft: draftTest });
    } catch (error) {
      if (!(error instanceof LanHttpConsentNeeded) || !(await confirmLanHttp(hostId, record))) return null;
      return tester.run({ hostId, record, draft: draftTest });
    }
  }

  // ---- 逐项即存 ----

  /** 已连接图床的一格：有改动就保存，再自动测一次（交接说明 8.4「离开即保存并自动测试」） */
  async function saveField(hostId: string, key: string, value: string): Promise<void> {
    const current = readHostValues(config.value, hostId)[key] ?? '';
    if (key !== 'passwordEncrypted' && value === current) return;
    tester.clearField(hostId, key);
    const stored = key === 'passwordEncrypted' && value ? await secureStorage.encrypt(value) : value;
    if (!(await patchConfig((c) => writeHostValues(c, hostId, { [key]: stored })))) return;
    await test(hostId);
  }

  /** 不触发测试的设置（开关、模板） */
  async function saveSetting(patch: (c: UserConfig) => UserConfig): Promise<void> {
    await patchConfig(patch);
  }

  async function rename(hostId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || trimmed === hostName(hostId)) return;
    await patchConfig((c) => renameProfile(c, hostId, trimmed));
  }

  // ---- 连接 ----

  function setDraftValue(key: string, value: string): void {
    if (!draft.value) return;
    draft.value.values[key] = value;
    tester.clearField(draft.value.hostId, key);
  }

  /** 写进配置并连上（加进已添加、启用），选中它 */
  async function commitConnect(descriptor: HostDescriptor, current: ConnectDraft): Promise<void> {
    const values = { ...current.values };
    delete values.lanHttpConfirmed;
    if (values.passwordEncrypted) values.passwordEncrypted = await secureStorage.encrypt(values.passwordEncrypted);
    const lanConfirmed = current.values.lanHttpConfirmed === 'true';
    const ok = await patchConfig((c) => {
      let next = c;
      let hostId = current.hostId;
      if (descriptor.kind === 'webdav' || descriptor.kind === 's3') {
        const id = hostId.slice(hostId.indexOf(':') + 1);
        const added = addProfile(next, { ...blankProfile(descriptor.kind, id, []), name: current.name }, descriptor.kind);
        next = added.config;
        hostId = added.hostId;
      }
      next = writeHostValues(next, hostId, values);
      if (lanConfirmed && isWebDAVId(hostId)) next = { ...next, webdav_profiles: (next.webdav_profiles ?? []).map((p) => (`webdav:${p.id}` === hostId ? { ...p, lanHttpConfirmed: true } : p)) };
      return connectHost(next, hostId);
    });
    if (!ok) return;
    draft.value = null;
    selectedId.value = current.hostId;
    pane.value = 'detail';
    narrowDetail.value = true;
  }

  /** 「测试并连接」/「连接」：缺必填项标红；公共图床先过 P11；测通过才连上 */
  async function connect(): Promise<void> {
    const current = draft.value;
    if (!current) return;
    const descriptor = describeHost(current.descriptorId);
    if (!descriptor) return;
    if (markMissing(current.hostId, current.values)) return;
    if (descriptor.publicRisk && !(await risk.ensureAccepted())) return;
    if (descriptor.kind !== 'builtin') {
      const state = await test(current.hostId, current.values);
      if (state?.phase !== 'ok') return;
    }
    await commitConnect(descriptor, current);
  }

  /** Cookie 图床：打开登录小窗；登录成功后（没连上的先连上）自动检测一次 */
  async function login(hostId: string): Promise<void> {
    const descriptor = describeHost(hostId);
    if (descriptor?.publicRisk && !addedIds.value.has(hostId) && !(await risk.ensureAccepted())) return;
    await cookie.login(hostId, async () => {
      config.value = (await readFreshConfig()) ?? config.value;
      if (!addedIds.value.has(hostId)) {
        await patchConfig((c) => connectHost(c, hostId));
        if (draft.value?.hostId === hostId) draft.value = null;
        selectedId.value = hostId;
        pane.value = 'detail';
      }
      await test(hostId);
    });
  }

  // ---- 移除 ----

  /** 移除图床 / 删除这份：不弹确认（按钮没有「…」），通知带「撤销」原样放回 */
  async function disconnect(hostId: string): Promise<void> {
    const latest = (await readFreshConfig()) ?? config.value;
    const name = hostName(hostId);
    const snap = snapshotHost(latest, hostId);
    const ok = await patchConfig((c) => disconnectHost(c, hostId));
    if (!ok) return;
    tester.forget(hostId);
    selectedId.value = rows.value[0]?.id ?? null;
    pane.value = selectedId.value ? 'detail' : 'catalog';
    narrowDetail.value = false;
    const multi = isWebDAVId(hostId) || isCustomS3Id(hostId);
    toast.withAction('success', joinCjk(multi ? '已删除' : '已移除', name), '已传的图片和链接不受影响', {
      label: '撤销',
      run: () => {
        void patchConfig((c) => restoreHost(c, snap)).then((restored) => {
          if (restored) select(hostId);
        });
      },
    }, { countdown: true });
  }

  // ---- 生命周期 ----

  let unlisten: UnlistenFn | null = null;
  async function enter(): Promise<void> {
    await reload();
    if (!unlisten) unlisten = await listen('config-updated', () => { void reload(); });
  }

  return {
    config, pane, selectedId, draft, narrowDetail, rows, addedIds, selected,
    tester,
    hostName, reload, enter, select, openCatalog, closeCatalog, back, openConnect,
    toggleEnabled, test, saveField, saveSetting, rename, setDraftValue, connect, login, disconnect,
  };
}

let singleton: ReturnType<typeof create> | null = null;
let scope: EffectScope | null = null;

export function useHosts() {
  if (!singleton) {
    scope = effectScope(true);
    singleton = scope.run(create)!;
  }
  return singleton;
}

/** 测试用 */
export function __resetHostsForTests(): void {
  scope?.stop();
  scope = null;
  singleton = null;
}
