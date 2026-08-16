// 备份 WebDAV 多配置（profile）的编辑逻辑
//
// 从 WebDAVConfigCollapsible.vue 抽出来的：那个组件已经 452 行，逼近 500 行硬门禁，
// 再往里加东西之前必须先腾地方（同 `composables/md-rescue/useFlatBrokenRows.ts` 的做法）。
//
// 抽出来的附带收益比省行数更值钱：profile 的增删改和状态判定不用挂载组件就能单测。
// 这条路径正是 a322dba 出事的地方——当时单测把两个 Rust 侧从未存在的命令 mock 成存在的，
// 测试全绿而生产每次保存都静默清空备份密码。逻辑摆到能直接测的地方，是对那次事故的正面回应。
//
// ⚠️ 只服务于备份/同步的 `config.webdav`。WebDAV 图床（`config.webdav_profiles`）是另一套。

import { computed, type ComputedRef } from 'vue';
import type { WebDAVConfig, WebDAVProfile } from '../../config/types';
import { nextProfileName } from './profileNaming';

/** 改动后需要作废「已连接」状态的字段——连接参数变了，上次的验证结果就不算数了 */
const CONNECTION_FIELDS: (keyof WebDAVProfile)[] = ['url', 'username', 'password', 'remotePath'];

const LOOPBACK_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/;

export interface WebDAVProfileEditorOptions {
  /** 当前配置。用取值函数而非直接传值，才能跟上父组件的响应式更新 */
  config: () => WebDAVConfig;
  testing: () => boolean;
  onUpdate: (config: WebDAVConfig) => void;
  onSave: () => void;
  confirmDelete: (message: string, onConfirm: () => void) => void;
}

export interface WebDAVProfileEditor {
  activeProfile: ComputedRef<WebDAVProfile | null>;
  hasValidConfig: ComputedRef<boolean>;
  shouldAutoExpand: ComputedRef<boolean>;
  statusLabel: ComputedRef<string>;
  statusClass: ComputedRef<string>;
  securityHint: ComputedRef<string>;
  updateActiveProfileField: (field: keyof WebDAVProfile, value: string) => void;
  /** 写密文并清掉残留明文，两件事必须在同一次更新里完成。返回目标 profile 还在不在 */
  setProfilePassword: (profileId: string, passwordEncrypted: string) => boolean;
  switchProfile: (id: string) => void;
  addProfile: () => void;
  deleteProfile: (id: string) => void;
}

export function useWebDAVProfileEditor(
  options: WebDAVProfileEditorOptions,
): WebDAVProfileEditor {
  const activeProfile = computed<WebDAVProfile | null>(() => {
    const config = options.config();
    return config.profiles.find(p => p.id === config.activeId) || null;
  });

  const hasValidConfig = computed(() => {
    const p = activeProfile.value;
    if (!p) return false;
    // 密码可能以明文或密文形式存在，任一即可视为已填
    return !!(p.url && p.username && (p.password || p.passwordEncrypted));
  });

  const shouldAutoExpand = computed(() => {
    const config = options.config();
    if (config.profiles.length === 0) return true;
    if (!config.activeId) return true;
    if (activeProfile.value && !hasValidConfig.value) return true;
    return false;
  });

  const statusLabel = computed(() => {
    if (options.testing()) return '验证中...';
    if (!activeProfile.value) return '未启用';
    if (!hasValidConfig.value) return '需配置';
    if (activeProfile.value.connectionStatus === 'success') return '已连接';
    if (activeProfile.value.connectionStatus === 'failed') return '连接失败';
    return '待验证';
  });

  const statusClass = computed(() => {
    if (options.testing()) return 'status-testing';
    if (!activeProfile.value) return 'status-disabled';
    if (!hasValidConfig.value) return 'status-warning';
    if (activeProfile.value.connectionStatus === 'success') return 'status-success';
    if (activeProfile.value.connectionStatus === 'failed') return 'status-error';
    return 'status-warning';
  });

  const securityHint = computed(() => {
    const url = activeProfile.value?.url?.trim() || '';
    if (url.startsWith('http://') && !LOOPBACK_HTTP.test(url)) {
      return '外部 WebDAV 请使用 HTTPS；HTTP 仅保留给本机回环服务。';
    }
    return '外部 WebDAV 请使用 HTTPS；本机服务可使用 localhost / 127.0.0.1。';
  });

  function updateActiveProfileField(field: keyof WebDAVProfile, value: string): void {
    if (!activeProfile.value) return;
    const config = options.config();

    const updatedProfiles = config.profiles.map(p => {
      if (p.id !== config.activeId) return p;

      const updated = { ...p, [field]: value };
      if (CONNECTION_FIELDS.includes(field) && p.connectionStatus === 'success') {
        updated.connectionStatus = undefined;
      }
      return updated;
    });

    options.onUpdate({ ...config, profiles: updatedProfiles });
  }

  /**
   * 写入**指定** profile 的密码密文，同时清掉可能残留的明文
   *
   * ⚠️ Why 收 `profileId` 而不是直接用 `activeProfile`：加密走 IPC，是异步的；
   * 而 blur 早于 click 触发。「在配置 A 改完密码，顺手点到配置 B 的 tab」这个再自然
   * 不过的动作里，密文算完时 activeId 已经指向 B——写给谁全看谁先跑完。
   * 目标由调用方在**开始编辑的那一刻**定死，这条竞态就从结构上不存在了。
   *
   * Why 必须一起清明文：`encryptBackupProfiles` 保存时只要看到 `password` 非空就会拿它
   * 重新加密。老配置里遗留的明文如果不清掉，就会在保存时把刚写进去的新密文顶掉——
   * 用户改了密码，存下来的还是旧的。
   *
   * Why 不复用 updateActiveProfileField：那个一次只能改一个字段，分两次调用要依赖
   * 父组件同步回流 props，不可靠。
   *
   * @returns 目标 profile 还在不在——加密期间被删掉的话什么也不写
   */
  function setProfilePassword(profileId: string, passwordEncrypted: string): boolean {
    const config = options.config();
    if (!config.profiles.some(p => p.id === profileId)) return false;

    const updatedProfiles = config.profiles.map(p => {
      if (p.id !== profileId) return p;

      const updated: WebDAVProfile = { ...p, password: '', passwordEncrypted };
      // 密码属于连接参数，改了就作废上次的验证结果
      if (p.connectionStatus === 'success') {
        updated.connectionStatus = undefined;
      }
      return updated;
    });

    options.onUpdate({ ...config, profiles: updatedProfiles });
    return true;
  }

  function switchProfile(id: string): void {
    options.onUpdate({ ...options.config(), activeId: id });
    options.onSave();
  }

  function addProfile(): void {
    const config = options.config();
    const newProfile: WebDAVProfile = {
      id: crypto.randomUUID(),
      name: nextProfileName(config.profiles.map(p => p.name), '新配置'),
      url: '',
      username: '',
      password: '',
      remotePath: '/PicNexus/',
    };

    options.onUpdate({
      ...config,
      profiles: [...config.profiles, newProfile],
      activeId: newProfile.id,
    });
    options.onSave();
  }

  function deleteProfile(id: string): void {
    const config = options.config();
    const profileName = config.profiles.find(p => p.id === id)?.name || '此配置';

    options.confirmDelete(`确定要删除「${profileName}」吗？此操作不可撤销。`, () => {
      const latest = options.config();
      const newProfiles = latest.profiles.filter(p => p.id !== id);
      const newActiveId = latest.activeId === id
        ? (newProfiles.length > 0 ? newProfiles[0].id : '')
        : latest.activeId;

      options.onUpdate({ ...latest, profiles: newProfiles, activeId: newActiveId });
      options.onSave();
    });
  }

  return {
    activeProfile,
    hasValidConfig,
    shouldAutoExpand,
    statusLabel,
    statusClass,
    securityHint,
    updateActiveProfileField,
    setProfilePassword,
    switchProfile,
    addProfile,
    deleteProfile,
  };
}
