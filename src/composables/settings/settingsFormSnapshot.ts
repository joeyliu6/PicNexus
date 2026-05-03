import { nextTick, type Ref } from 'vue';
import { DEFAULT_CONFIG, cloneDefaultPrefixes } from '../../config/types';
import { syncCustomS3Uploaders } from '../../uploaders';
import type { SettingsFormData } from './settingsFormTypes';
import type { UserConfig } from '../../config/types';

interface ApplyConfigToFormOptions {
  formData: Ref<SettingsFormData>;
  availableServices: Ref<string[]>;
  setApplyingConfigSnapshot: (isApplying: boolean) => void;
}

function mergeServiceConfig<T extends object>(defaults: T, overrides?: Partial<T>): T {
  return {
    ...structuredClone(defaults),
    ...(overrides ? structuredClone(overrides) : {}),
  };
}

export async function applyConfigToForm(
  config: UserConfig,
  options: ApplyConfigToFormOptions,
): Promise<void> {
  const { formData, availableServices, setApplyingConfigSnapshot } = options;
  const services = config.services || {};

  setApplyingConfigSnapshot(true);
  try {
    formData.value.weiboCookie = services.weibo?.cookie || '';
    formData.value.r2 = mergeServiceConfig(DEFAULT_CONFIG.services.r2!, services.r2);
    formData.value.tencent = mergeServiceConfig(DEFAULT_CONFIG.services.tencent!, services.tencent);
    formData.value.aliyun = mergeServiceConfig(DEFAULT_CONFIG.services.aliyun!, services.aliyun);
    formData.value.qiniu = mergeServiceConfig(DEFAULT_CONFIG.services.qiniu!, services.qiniu);
    formData.value.upyun = mergeServiceConfig(DEFAULT_CONFIG.services.upyun!, services.upyun);
    formData.value.nowcoder = mergeServiceConfig(DEFAULT_CONFIG.services.nowcoder!, services.nowcoder);
    const zhihuConfig = mergeServiceConfig(DEFAULT_CONFIG.services.zhihu!, services.zhihu);
    formData.value.zhihu = {
      cookie: zhihuConfig.cookie,
      sourceParamEnabled: zhihuConfig.sourceParamEnabled ?? DEFAULT_CONFIG.services.zhihu?.sourceParamEnabled ?? true,
      sourceParamValue: zhihuConfig.sourceParamValue ?? DEFAULT_CONFIG.services.zhihu?.sourceParamValue ?? '172ae18b',
    };
    formData.value.nami = mergeServiceConfig(DEFAULT_CONFIG.services.nami!, services.nami);
    formData.value.bilibili = mergeServiceConfig(DEFAULT_CONFIG.services.bilibili!, services.bilibili);
    formData.value.chaoxing = mergeServiceConfig(DEFAULT_CONFIG.services.chaoxing!, services.chaoxing);
    formData.value.smms = mergeServiceConfig(DEFAULT_CONFIG.services.smms!, services.smms);
    formData.value.github = mergeServiceConfig(DEFAULT_CONFIG.services.github!, services.github);
    const imgurConfig = mergeServiceConfig(DEFAULT_CONFIG.services.imgur!, services.imgur);
    formData.value.imgur = {
      clientId: imgurConfig.clientId,
      clientSecret: imgurConfig.clientSecret ?? '',
    };

    formData.value.custom_s3_profiles = structuredClone(config.custom_s3_profiles || []);
    syncCustomS3Uploaders(formData.value.custom_s3_profiles);

    formData.value.webdav = structuredClone(config.webdav || { profiles: [], activeId: null });

    const linkPrefixConfig = config.linkPrefixConfig || DEFAULT_CONFIG.linkPrefixConfig;
    formData.value.linkPrefixEnabled = linkPrefixConfig?.enabled ?? true;
    formData.value.selectedPrefixIndex = linkPrefixConfig?.selectedIndex ?? 0;
    const prefixList = linkPrefixConfig?.prefixList;
    formData.value.linkPrefixList = prefixList?.length ? structuredClone(prefixList) : cloneDefaultPrefixes();

    formData.value.linkOutput = {
      ...DEFAULT_CONFIG.linkOutput!,
      ...(config.linkOutput || {}),
    };
    formData.value.analyticsEnabled = config.analytics?.enabled ?? DEFAULT_CONFIG.analytics?.enabled ?? true;
    formData.value.appBehavior = {
      ...(DEFAULT_CONFIG.appBehavior ?? { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true }),
      ...(config.appBehavior || {}),
    };
    if (formData.value.appBehavior.closeToTray === undefined) formData.value.appBehavior.closeToTray = true;
    formData.value.autoUpdateEnabled = config.autoUpdate?.enabled ?? DEFAULT_CONFIG.autoUpdate?.enabled ?? true;
    formData.value.imageCompression = structuredClone(config.imageCompression ?? DEFAULT_CONFIG.imageCompression!);
    formData.value.editorServer = {
      ...structuredClone(DEFAULT_CONFIG.editorServer!),
      ...(config.editorServer || {}),
    };
    formData.value.globalShortcut = {
      ...structuredClone(DEFAULT_CONFIG.globalShortcut!),
      ...(config.globalShortcut || {}),
    };
    availableServices.value = [...(config.availableServices || DEFAULT_CONFIG.availableServices || ['jd', 'qiyu'])];
    await nextTick();
  } finally {
    setApplyingConfigSnapshot(false);
  }
}
