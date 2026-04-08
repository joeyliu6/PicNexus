// 默认配置常量

import type { UserConfig } from './configInterface';
import { DEFAULT_PREFIXES } from './configInterface';
import { DEFAULT_GITHUB_CDN_LIST } from './serviceTypes';
import { DEFAULT_COMPRESSION_PRESET } from './compressionTypes';

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: UserConfig = {
  enabledServices: ['jd'],  // 默认启用 JD 图床（开箱即用）
  availableServices: ['weibo', 'r2', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami', 'bilibili', 'chaoxing', 'smms', 'github', 'imgur', 'tencent', 'aliyun', 'qiniu', 'upyun'],  // 默认所有图床都可用
  services: {
    weibo: {
      enabled: true,
      cookie: ''
    },
    r2: {
      enabled: false,
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucketName: '',
      path: '',
      publicDomain: ''
    },

    jd: {
      enabled: true  // 京东图床默认启用，无需额外配置
    },
    nowcoder: {
      enabled: false,  // 牛客图床需要 Cookie，默认不启用
      cookie: ''
    },
    qiyu: {
      enabled: false  // 七鱼图床需要 Chrome/Edge 浏览器，默认不启用
    },
    zhihu: {
      enabled: false,  // 知乎图床需要 Cookie，默认不启用
      cookie: ''
    },
    nami: {
      enabled: false,  // 纳米图床需要 Cookie，默认不启用
      cookie: '',
      authToken: ''
    },
    bilibili: {
      enabled: false,  // 哔哩哔哩图床需要 Cookie，默认不启用
      cookie: ''
    },
    chaoxing: {
      enabled: false,  // 超星图床需要 Cookie，默认不启用
      cookie: ''
    },
    smms: {
      enabled: false,  // SM.MS 需要 Token，默认不启用
      token: ''
    },
    github: {
      enabled: false,  // GitHub 需要配置，默认不启用
      token: '',
      owner: '',
      repo: '',
      branch: 'main',
      path: 'images/',
      cdnConfig: {
        enabled: false,
        selectedIndex: 0,
        cdnList: [...DEFAULT_GITHUB_CDN_LIST]
      }
    },
    imgur: {
      enabled: false,  // Imgur 需要配置，默认不启用
      clientId: '',
      clientSecret: ''
    },
    tencent: {
      enabled: false,  // 腾讯云需要配置，默认不启用
      secretId: '',
      secretKey: '',
      region: '',
      bucket: '',
      path: 'images/',
      publicDomain: ''
    },
    aliyun: {
      enabled: false,  // 阿里云需要配置，默认不启用
      accessKeyId: '',
      accessKeySecret: '',
      region: '',
      bucket: '',
      path: 'images/',
      publicDomain: ''
    },
    qiniu: {
      enabled: false,  // 七牛云需要配置，默认不启用
      accessKey: '',
      secretKey: '',
      region: '',
      bucket: '',
      publicDomain: '',
      path: 'images/'
    },
    upyun: {
      enabled: false,  // 又拍云需要配置，默认不启用
      operator: '',
      password: '',
      bucket: '',
      publicDomain: '',
      path: 'images/'
    }
  },
  custom_s3_profiles: [],
  weiboProxyMode: 'baidu-proxy',
  linkOutput: {
    defaultFormat: 'url',
    customTemplate: '{url}',
    autoCopy: true,
  },
  linkPrefixConfig: {
    enabled: true,
    selectedIndex: 0,
    prefixList: [...DEFAULT_PREFIXES]
  },
  webdav: {
    profiles: [],
    activeId: null
  },
  theme: {
    mode: 'auto',
    enableTransitions: true,
    transitionDuration: 300
  },
  analytics: {
    enabled: true
  },
  appBehavior: {
    autoStart: false,
    minimizeToTrayOnStart: false,
    closeToTray: true
  },
  globalShortcut: {
    enabled: true,
    uploadClipboard: 'CommandOrControl+Shift+C',
    uploadFromFile: 'CommandOrControl+Shift+O',
  },
  autoUpdate: {
    enabled: true,
  },
  onboardingCompleted: false,
  editorServer: {
    enabled: false,
    typoraEnabled: false,
    port: 36799,
    typoraService: null,
    obsidianService: null,
  },
  imageCompression: {
    enabled: false,
    activePresetId: 'default',
    presets: [{ ...DEFAULT_COMPRESSION_PRESET }],
  }
};

/**
 * 获取当前激活的前缀
 * 如果前缀功能禁用，返回 null
 *
 * @param config 用户配置
 * @returns 当前激活的前缀，或 null（如果禁用）
 */
export function getActivePrefix(config: UserConfig): string | null {
  // 如果没有 linkPrefixConfig，尝试使用旧的 baiduPrefix
  if (!config.linkPrefixConfig) {
    return config.baiduPrefix || DEFAULT_PREFIXES[0];
  }

  // 如果功能禁用，返回 null
  if (!config.linkPrefixConfig.enabled) {
    return null;
  }

  const { selectedIndex, prefixList } = config.linkPrefixConfig;

  // 如果列表为空，返回默认前缀
  if (!prefixList || prefixList.length === 0) {
    return DEFAULT_PREFIXES[0];
  }

  // 确保索引有效
  if (selectedIndex >= 0 && selectedIndex < prefixList.length) {
    return prefixList[selectedIndex];
  }

  // 索引无效，返回第一个
  return prefixList[0];
}
