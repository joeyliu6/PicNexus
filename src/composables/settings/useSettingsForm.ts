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
import { SERVICE_REQUIRED_FIELDS } from '../../constants/serviceRequiredFields';
import { syncCustomS3Uploaders } from '../../uploaders';
import { useConfirm } from '../useConfirm';
import { createLogger } from '../../utils/logger';
import { extractNamiAuthToken } from '../../utils/namiAuthToken';
import type {
  UserConfig,
  ServiceType,
  WebDAVProfile,
  ImageCompressionConfig,
  EditorServerConfig,
  ServerServiceType,
  CustomS3Profile,
  LinkPrefixItem,
} from '../../config/types';
import { DEFAULT_CONFIG, cloneDefaultPrefixes, makeCustomS3Id } from '../../config/types';

// ---- 类型定义 ----

export type SaveFeedbackStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveFeedbackState {
  status: SaveFeedbackStatus;
  message?: string;
  updatedAt?: number;
}

/**
 * 设置页 formData 中 useConnectionTest / 其他子 composable 会读取的字段的最小子集。
 * 只列出跨模块消费的字段，其他字段是 SettingsView 自己内部使用。
 */
export interface SettingsFormShape {
  weiboCookie: string;
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; path: string; publicDomain: string };
  tencent: { secretId: string; secretKey: string; region: string; bucket: string; path: string; publicDomain: string };
  aliyun: { accessKeyId: string; accessKeySecret: string; region: string; bucket: string; path: string; publicDomain: string };
  qiniu: { accessKey: string; secretKey: string; region: string; bucket: string; publicDomain: string; path: string };
  upyun: { operator: string; password: string; bucket: string; publicDomain: string; path: string };
  custom_s3_profiles: CustomS3Profile[];
  nowcoder: { cookie: string };
  zhihu: { cookie: string; sourceParamEnabled?: boolean; sourceParamValue?: string };
  nami: { cookie: string; authToken: string };
  bilibili: { cookie: string };
  chaoxing: { cookie: string };
  smms: { token: string };
  github: import('../../config/types').GithubServiceConfig;
  imgur: { clientId: string; clientSecret?: string };
  editorServer: EditorServerConfig;
}

// ---- composable ----

const log = createLogger('Settings');

export function useSettingsForm() {
  const toast = useToast();
  const { confirm: confirmDialog } = useConfirm();
  const configManager = useConfigManager();
  const serviceHealth = useServiceHealth();

  // ---- 表单数据 ----

  const formData = ref({
    weiboCookie: '',
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '' },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '' },
    custom_s3_profiles: [] as CustomS3Profile[],
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
      tencent: !!(fd.tencent.secretId && fd.tencent.secretKey && fd.tencent.region && fd.tencent.bucket && fd.tencent.publicDomain),
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
    if (!oldStatus) return;
    const toRemove: ServiceType[] = [];
    for (const [svc, configured] of Object.entries(newStatus)) {
      const sid = svc as ServiceType;
      if (!configured && oldStatus[sid] && availableServices.value.includes(sid)) toRemove.push(sid);
    }
    if (!toRemove.length) return;
    // Why: 防止变空被 saveConfig 的"至少一个图床"校验拒绝；但 stale 服务会让芯片显示启用、上传时却凭证缺失——必须显式告知用户原因，否则就是静默 UX 陷阱。
    if (availableServices.value.length - toRemove.length <= 0) {
      const names = toRemove.map((sid) => SERVICE_DISPLAY_NAMES[sid] ?? sid).join('、');
      toast.showConfig('warn', { summary: '保留最后一个图床', detail: `「${names}」凭证已清空但仍处于启用状态。请补全凭证或先启用其他图床后再禁用。`, life: 4000 });
      return;
    }
    availableServices.value = availableServices.value.filter(s => !toRemove.includes(s as ServiceType));
    debouncedSaveSettings();
  });

  // ---- 工具函数 ----

  function errorToString(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
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
      formData.value.r2 = { ...formData.value.r2, ...(config.services?.r2 || {}) };
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
      syncCustomS3Uploaders(formData.value.custom_s3_profiles);

      // WebDAV 配置（密码解密）
      if (config.webdav) {
        const profiles = await Promise.all(
          (config.webdav.profiles || []).map(async (p: WebDAVProfile) => {
            if (p.passwordEncrypted && !p.password) {
              try {
                p.password = await invoke<string>('decrypt_webdav_password', { encrypted: p.passwordEncrypted });
              } catch (e) {
                log.error('WebDAV 解密失败', e);
                p.password = '';
              }
            }
            return p;
          })
        );
        formData.value.webdav = { profiles, activeId: config.webdav.activeId || null };
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
      formData.value.imageCompression = config.imageCompression ?? { ...DEFAULT_CONFIG.imageCompression! };
      formData.value.editorServer = { ...DEFAULT_CONFIG.editorServer!, ...(config.editorServer ?? {}) };
      formData.value.globalShortcut = config.globalShortcut ?? {
        enabled: true,
        uploadClipboard: 'CommandOrControl+Shift+C',
        uploadFromFile: 'CommandOrControl+Shift+O',
      };
      availableServices.value = config.availableServices || ['jd', 'qiyu'];

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

  // ---- 保存设置 ----

  async function saveSettings(options: { trackAdvancedStatus?: boolean } = {}): Promise<boolean> {
    const { trackAdvancedStatus = false } = options;
    if (trackAdvancedStatus) {
      setAdvancedSaveState('saving', '保存中…');
    }

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

      // Nami Token 提取（统一走 extractNamiAuthToken，避免大小写错位的旧正则误命中其他 *_token= 字段）
      const namiCookie = formData.value.nami.cookie;
      const extractedToken = extractNamiAuthToken(namiCookie);
      const namiAuthToken = extractedToken || formData.value.nami.authToken || '';
      config.services.nami = { enabled: true, cookie: namiCookie, authToken: namiAuthToken };

      // WebDAV 密码加密
      // Why: 旧条件 `p.password && !passwordEncrypted` 在"已加载过的 profile 用户改密码"时永远为 false——
      //   loadSettings 解密后 password / passwordEncrypted 都填了，UI 改 password 时也没清 passwordEncrypted，
      //   导致跳过加密、旧密文被回写。改成"只要 password 非空就重新加密"，密文每次都按当前明文重算，
      //   多算一次 IPC 但避免静默丢失改动。空 password 视作"保持已加密值不变"。
      const encryptedProfiles = await Promise.all(
        formData.value.webdav.profiles.map(async (p) => {
          let passwordEncrypted = p.passwordEncrypted;
          if (p.password) {
            try {
              passwordEncrypted = await invoke<string>('encrypt_webdav_password', { password: p.password });
            } catch (e) {
              log.error('WebDAV 加密失败', e);
            }
          }
          return { ...p, password: '', passwordEncrypted };
        })
      );
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
      config.imageCompression = { ...formData.value.imageCompression };
      config.editorServer = { ...formData.value.editorServer };
      config.availableServices = [...availableServices.value];

      await configManager.saveConfig(config, true);
      syncCustomS3Uploaders(formData.value.custom_s3_profiles);
      serviceHealth.evaluateConfig(config);

      if (trackAdvancedStatus) {
        setAdvancedSaveState('saved', '已保存');
      }
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

  // ---- S3 配置验证 ----

  function validateS3Config(serviceId: ServiceType, config: Record<string, unknown>): string | null {
    const fields = SERVICE_REQUIRED_FIELDS[serviceId] || [];
    for (const field of fields) {
      const val = config[field];
      if (!val || String(val).trim().length < 2) {
        return `${field} 格式无效（至少 2 个字符）`;
      }
    }
    if (serviceId === 'r2' && config.accountId && !/^[a-f0-9]{32}$/.test(String(config.accountId))) {
      return 'Account ID 格式不正确（应为 32 位十六进制字符串）';
    }
    if (config.publicDomain && !/^https?:\/\/.+/.test(String(config.publicDomain))) {
      return '公开访问域名应以 http:// 或 https:// 开头';
    }
    return null;
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

  // ---- 自定义 S3 管理 ----

  // Why: 用"现存最大序号 + 1"命名，避免旧 length+1 在删中间项后撞名
  function addCustomS3Profile() {
    const usedIndices = formData.value.custom_s3_profiles
      .map((p: CustomS3Profile) => parseInt(p.name?.match(/^自定义 S3 (\d+)$/)?.[1] ?? '', 10))
      .filter((n) => Number.isFinite(n));
    const nextIndex = usedIndices.length ? Math.max(...usedIndices) + 1 : 1;
    formData.value.custom_s3_profiles.push({
      id: generateId(),
      name: `自定义 S3 ${nextIndex}`,
      endpoint: '', accessKeyId: '', secretAccessKey: '',
      region: '', bucket: '', path: '', publicDomain: ''
    });
    saveSettings();
  }

  async function deleteCustomS3Profile(profileId: string) {
    const profile = formData.value.custom_s3_profiles.find((p: CustomS3Profile) => p.id === profileId);
    const profileName = profile?.name || '自定义 S3';
    const compositeId = makeCustomS3Id(profileId);

    // 预校验：删后 availableServices 不能空，否则 saveConfig 会拒绝→走回滚，体验奇怪
    if (availableServices.value.filter(s => s !== compositeId).length === 0) {
      toast.showConfig('warn', { summary: '至少保留一个图床', detail: `「${profileName}」是当前唯一启用的图床，请先启用其他图床后再删除。`, life: 3500 });
      return;
    }
    const confirmed = await confirmDialog(`确定要删除「${profileName}」配置吗？删除后相关的编辑器服务绑定也会一并清除。`, '删除配置');
    if (!confirmed) return;
    formData.value.custom_s3_profiles = formData.value.custom_s3_profiles.filter((p: CustomS3Profile) => p.id !== profileId);
    availableServices.value = availableServices.value.filter(s => s !== compositeId);
    const editor = formData.value.editorServer;
    if (editor.typoraService === compositeId) editor.typoraService = '' as ServerServiceType;
    if (editor.obsidianService === compositeId) editor.obsidianService = '' as ServerServiceType;
    saveSettings();
  }

  function updateCustomS3Profile(profile: CustomS3Profile) {
    const idx = formData.value.custom_s3_profiles.findIndex((p: CustomS3Profile) => p.id === profile.id);
    if (idx !== -1) {
      formData.value.custom_s3_profiles[idx] = { ...profile };
    }
    saveSettings();
  }

  // ---- WebDAV 管理 ----

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
    saveSettings,
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
    // 自定义 S3
    addCustomS3Profile,
    deleteCustomS3Profile,
    updateCustomS3Profile,
    // WebDAV
    addWebDAVProfile,
    deleteWebDAVProfile,
    switchWebDAVProfile,
  };
}
