import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

function cloneConfig(config: UserConfig): UserConfig {
  return JSON.parse(JSON.stringify(config)) as UserConfig;
}

function mergeOptional<T extends object>(
  base: T | undefined,
  overrides: Partial<T> | undefined,
): T | undefined {
  if (!base && !overrides) return undefined;
  return {
    ...(base ?? {}),
    ...(overrides ?? {}),
  } as T;
}

export function createConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  const base = cloneConfig(DEFAULT_CONFIG);

  return {
    ...base,
    ...overrides,
    enabledServices: overrides.enabledServices
      ? [...overrides.enabledServices]
      : [...base.enabledServices],
    availableServices: overrides.availableServices
      ? [...overrides.availableServices]
      : base.availableServices ? [...base.availableServices] : undefined,
    services: {
      ...base.services,
      ...overrides.services,
    },
    custom_s3_profiles: overrides.custom_s3_profiles
      ? [...overrides.custom_s3_profiles]
      : [...(base.custom_s3_profiles ?? [])],
    linkOutput: mergeOptional(base.linkOutput, overrides.linkOutput),
    linkPrefixConfig: overrides.linkPrefixConfig
      ? {
          ...base.linkPrefixConfig,
          ...overrides.linkPrefixConfig,
          prefixList: overrides.linkPrefixConfig.prefixList
            ? [...overrides.linkPrefixConfig.prefixList]
            : [...(base.linkPrefixConfig?.prefixList ?? [])],
        }
      : base.linkPrefixConfig,
    webdav: overrides.webdav
      ? {
          ...base.webdav,
          ...overrides.webdav,
          profiles: overrides.webdav.profiles
            ? [...overrides.webdav.profiles]
            : [...(base.webdav?.profiles ?? [])],
        }
      : base.webdav,
    theme: mergeOptional(base.theme, overrides.theme),
    analytics: mergeOptional(base.analytics, overrides.analytics),
    appBehavior: mergeOptional(base.appBehavior, overrides.appBehavior),
    globalShortcut: mergeOptional(base.globalShortcut, overrides.globalShortcut),
    autoUpdate: mergeOptional(base.autoUpdate, overrides.autoUpdate),
    editorServer: mergeOptional(base.editorServer, overrides.editorServer),
    imageCompression: overrides.imageCompression
      ? {
          ...base.imageCompression,
          ...overrides.imageCompression,
          presets: overrides.imageCompression.presets
            ? [...overrides.imageCompression.presets]
            : [...(base.imageCompression?.presets ?? [])],
        } as UserConfig['imageCompression']
      : base.imageCompression,
  };
}
