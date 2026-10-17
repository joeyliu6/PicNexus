// 设置表单状态管理 - 从 SettingsView.vue 提取
// 负责 formData 定义、配置加载/保存、防抖保存机制。
// 图床的凭证、启用状态、多份图床、微博链接前缀都归图床页（src/views/hosts）读写，这里不加载也不保存，
// 免得设置页开着时用旧值把图床页刚改的凭证盖掉。

import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { configStore } from '@/store/instances';
import { useToast } from '@/composables/useToast';
import { useConfigManager } from '@/composables/useConfig';
import { TOAST_MESSAGES } from '@/constants';
import { encryptBackupProfiles } from './webdavBackupSecrets';
import { useConfirm } from '@/composables/useConfirm';
import { createLogger } from '@/utils/logger';
import { isAnyEncryptedData } from '@/security/crypto';
import { extractErrorMessage } from '@/utils/serviceHealthMessage';
import type {
  UserConfig,
  WebDAVProfile,
  ImageCompressionConfig,
  EditorServerConfig,
} from '@/config/types';
import { DEFAULT_CONFIG } from '@/config/types';
import { syncCustomS3Uploaders, syncWebDAVUploaders } from '@/uploaders';
import { applyConfigToForm } from './settingsFormSnapshot';
import type { SettingsFormData } from './settingsFormTypes';

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

  // ---- 表单数据 ----

  const formData = ref<SettingsFormData>({
    webdav: { profiles: [] as WebDAVProfile[], activeId: null as string | null },
    analyticsEnabled: true,
    appBehavior: { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true },
    linkOutput: {
      defaultFormat: 'url' as import('@/utils/linkFormatter').LinkFormat,
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

      // 从 OS 同步自启动真实状态
      try {
        const isEnabled = await invoke<boolean>('plugin:autostart|is_enabled');
        formData.value.appBehavior.autoStart = isEnabled;
      } catch { /* 忽略：插件不可用时保持配置值 */ }

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

      // WebDAV 备份密码加密（图床 profile 的密码全程密文，不走这条）
      const encryptedProfiles = await encryptBackupProfiles(formData.value.webdav.profiles);
      config.webdav = { profiles: encryptedProfiles, activeId: formData.value.webdav.activeId };

      config.linkOutput = { ...formData.value.linkOutput };
      config.analytics = { enabled: formData.value.analyticsEnabled };
      config.appBehavior = { ...formData.value.appBehavior };
      config.globalShortcut = { ...formData.value.globalShortcut };
      config.autoUpdate = { enabled: formData.value.autoUpdateEnabled };
      config.imageCompression = { ...formData.value.imageCompression };
      config.editorServer = { ...formData.value.editorServer };
      await configManager.saveConfig(config, true);

      if (trackAdvancedStatus) setAdvancedSaveState('saved', '已保存');
      return true;
    } catch (e) {
      log.error('保存失败', e);
      const msg = errorToString(e);
      toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(msg));
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
      await applyConfigToForm(resetConfig, { formData });
      // 多份图床（WebDAV / 自定义 S3）随默认设置清空了：上传器跟着重建，免得还留着指向旧配置的
      syncCustomS3Uploaders(resetConfig.custom_s3_profiles ?? []);
      syncWebDAVUploaders(resetConfig.webdav_profiles ?? []);
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
    clearTimers,
    // WebDAV 备份
    addWebDAVProfile,
    deleteWebDAVProfile,
    switchWebDAVProfile,
  };
}
