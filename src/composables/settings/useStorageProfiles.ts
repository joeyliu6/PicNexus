// 多实例图床 profile 的增删改（自定义 S3 / WebDAV）
//
// 两类图床的管理动作形状一致：新建时给个不撞名的默认名、删除前确认并清理关联引用、
// 更新时按 id 就地替换。收敛到一处，避免每加一种 profile 图床就把 useSettingsForm 撑大一圈。

import type { Ref } from 'vue';
import type { CustomS3Profile, WebDAVStorageProfile, ServerServiceType } from '../../config/types';
import { makeCustomS3Id, makeWebDAVId, DEFAULT_WEBDAV_URL_TEMPLATE } from '../../config/types';
import type { SettingsFormData } from './settingsFormTypes';
import type { ToastMessageConfig } from '../../constants/toastMessages';
import { nextProfileName } from './profileNaming';

interface ToastLike {
  showConfig: (severity: 'success' | 'info' | 'warn' | 'error', config: ToastMessageConfig) => void;
}

export interface UseStorageProfilesDeps {
  formData: Ref<SettingsFormData>;
  availableServices: Ref<string[]>;
  saveSettings: () => void;
  toast: ToastLike;
  confirmDialog: (message: string, header?: string) => Promise<boolean>;
  generateId: () => string;
}

export function useStorageProfiles(deps: UseStorageProfilesDeps) {
  const { formData, availableServices, saveSettings, toast, confirmDialog, generateId } = deps;

  /**
   * 删除前的共用前置检查
   *
   * 预校验"至少保留一个图床"：直接删会让 saveConfig 拒绝并回滚，用户看到的是
   * 一次莫名其妙的失败，不如提前说清楚。
   */
  async function confirmProfileDeletion(compositeId: string, profileName: string): Promise<boolean> {
    if (availableServices.value.filter(s => s !== compositeId).length === 0) {
      toast.showConfig('warn', {
        summary: '至少保留一个图床',
        detail: `「${profileName}」是当前唯一启用的图床，请先启用其他图床后再删除。`,
        life: 3500,
      });
      return false;
    }
    return confirmDialog(
      `确定要删除「${profileName}」配置吗？删除后相关的编辑器服务绑定也会一并清除。`,
      '删除配置',
    );
  }

  /**
   * 新建 profile 后写入 availableServices
   *
   * Why: 删除路径会把复合 ID 从 availableServices 摘掉，新建路径必须对称写入，否则用户
   * 建好配置、凭证也填全了，上传界面依然看不到这个图床，还得回设置页手动点亮芯片。
   *
   * 此刻凭证还是空的，但不会漏到上传页——UploadView 的 filterVisibleServices 和
   * MultiServiceUploader.filterConfiguredServices 都会挡住 unconfigured 状态的服务；
   * 而 useSettingsForm 里"配置变空就移除"的 watch 要求 oldStatus[id] 为真才摘，
   * 这里是全新的键（oldStatus 为 undefined），所以不会被它反手摘掉。
   */
  function enableNewProfile(compositeId: string) {
    if (availableServices.value.includes(compositeId)) return;
    availableServices.value = [...availableServices.value, compositeId];
  }

  /** 清理指向已删除 profile 的编辑器绑定，避免留下打不开的服务引用 */
  function detachEditorBindings(compositeId: string) {
    const editor = formData.value.editorServer;
    if (editor.typoraService === compositeId) editor.typoraService = '' as ServerServiceType;
    if (editor.obsidianService === compositeId) editor.obsidianService = '' as ServerServiceType;
  }

  // ---- 自定义 S3 ----

  function addCustomS3Profile(): string {
    const profileId = generateId();
    const compositeId = makeCustomS3Id(profileId);
    formData.value.custom_s3_profiles.push({
      id: profileId,
      name: nextProfileName(formData.value.custom_s3_profiles.map(p => p.name), '自定义 S3'),
      endpoint: '', accessKeyId: '', secretAccessKey: '', region: '', bucket: '', path: '', publicDomain: '',
    });
    enableNewProfile(compositeId);
    saveSettings();
    return compositeId;
  }

  async function deleteCustomS3Profile(profileId: string) {
    const profile = formData.value.custom_s3_profiles.find((p: CustomS3Profile) => p.id === profileId);
    const compositeId = makeCustomS3Id(profileId);

    if (!(await confirmProfileDeletion(compositeId, profile?.name || '自定义 S3'))) return;

    formData.value.custom_s3_profiles = formData.value.custom_s3_profiles.filter(
      (p: CustomS3Profile) => p.id !== profileId,
    );
    availableServices.value = availableServices.value.filter(s => s !== compositeId);
    detachEditorBindings(compositeId);
    saveSettings();
  }

  function updateCustomS3Profile(profile: CustomS3Profile) {
    const idx = formData.value.custom_s3_profiles.findIndex((p: CustomS3Profile) => p.id === profile.id);
    if (idx !== -1) {
      formData.value.custom_s3_profiles[idx] = { ...profile };
    }
    saveSettings();
  }

  // ---- WebDAV 图床 ----

  function addWebdavProfile(): string {
    const profileId = generateId();
    const compositeId = makeWebDAVId(profileId);
    formData.value.webdav_profiles.push({
      id: profileId,
      name: nextProfileName(formData.value.webdav_profiles.map(p => p.name), 'WebDAV'),
      url: '',
      username: '',
      passwordEncrypted: '',
      remotePath: 'images/',
      publicDomain: '',
      publicUrlTemplate: DEFAULT_WEBDAV_URL_TEMPLATE,
    });
    enableNewProfile(compositeId);
    saveSettings();
    return compositeId;
  }

  async function deleteWebdavProfile(profileId: string) {
    const profile = formData.value.webdav_profiles.find((p: WebDAVStorageProfile) => p.id === profileId);
    const compositeId = makeWebDAVId(profileId);

    if (!(await confirmProfileDeletion(compositeId, profile?.name || 'WebDAV'))) return;

    formData.value.webdav_profiles = formData.value.webdav_profiles.filter(
      (p: WebDAVStorageProfile) => p.id !== profileId,
    );
    availableServices.value = availableServices.value.filter(s => s !== compositeId);
    detachEditorBindings(compositeId);
    saveSettings();
  }

  function updateWebdavProfile(profile: WebDAVStorageProfile) {
    const idx = formData.value.webdav_profiles.findIndex((p: WebDAVStorageProfile) => p.id === profile.id);
    if (idx !== -1) {
      formData.value.webdav_profiles[idx] = { ...profile };
    }
    saveSettings();
  }

  return {
    addCustomS3Profile,
    deleteCustomS3Profile,
    updateCustomS3Profile,
    addWebdavProfile,
    deleteWebdavProfile,
    updateWebdavProfile,
  };
}
