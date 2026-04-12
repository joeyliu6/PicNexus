// UserConfig 主接口及其依赖的小型接口

import type {
  WeiboServiceConfig,
  R2ServiceConfig,
  JDServiceConfig,
  NowcoderServiceConfig,
  QiyuServiceConfig,
  ZhihuServiceConfig,
  NamiServiceConfig,
  BilibiliServiceConfig,
  ChaoxingServiceConfig,
  SmmsServiceConfig,
  GithubServiceConfig,
  ImgurServiceConfig,
  TencentServiceConfig,
  AliyunServiceConfig,
  QiniuServiceConfig,
  UpyunServiceConfig,
  CustomS3Profile,
  WebDAVConfig,
} from './serviceTypes';
import type { ImageCompressionConfig } from './compressionTypes';

/**
 * 主题模式类型
 */
export type ThemeMode = 'light' | 'dark' | 'auto';

/**
 * 主题配置接口
 */
export interface ThemeConfig {
  /** 当前主题模式 */
  mode: ThemeMode;

  /** 是否启用主题过渡动画 */
  enableTransitions: boolean;

  /** 过渡动画持续时间（毫秒） */
  transitionDuration: number;
}

/**
 * Google Analytics 配置接口
 */
export interface AnalyticsConfig {
  /** 是否启用 Analytics 追踪 */
  enabled: boolean;
}

/**
 * 微博代理模式
 * - direct: 直接返回原始链接
 * - baidu-proxy: 使用百度代理（仅微博支持）
 */
export type WeiboProxyMode = 'direct' | 'baidu-proxy';

/** @deprecated 使用 WeiboProxyMode 代替 */
export type OutputFormat = WeiboProxyMode;

/**
 * 链接前缀单项
 * name 为 UI 显示名称，template 为 URL 模板（可含占位符）。
 * 支持的占位符：{url} / {url_no_scheme} / {path} / {url_encoded}。
 * 若 template 不含任何占位符，将自动在末尾追加 {url}（兼容旧纯前缀写法）。
 */
export interface LinkPrefixItem {
  name: string;
  template: string;
}

/**
 * 链接前缀配置
 * 用于微博图床的代理前缀管理
 */
export interface LinkPrefixConfig {
  /** 是否启用代理前缀 */
  enabled: boolean;
  /** 当前选中的前缀索引 */
  selectedIndex: number;
  /** 前缀列表 */
  prefixList: LinkPrefixItem[];
}

/**
 * 默认前缀列表
 * 顺序：搜狗 → cdnjson → Jetpack → IPFS Scan（搜狗为默认选中）
 */
export const DEFAULT_LINK_PREFIXES: LinkPrefixItem[] = [
  {
    name: '搜狗图片',
    template: 'https://img01.sogoucdn.com/net/a/04/link?appid=100520031&w=4096&url={url_encoded}',
  },
  {
    name: 'CDN JSON',
    template: 'https://cdn.cdnjson.com/pic.html?url=',
  },
  {
    name: 'Jetpack',
    template: 'https://i0.wp.com/{url_no_scheme}',
  },
  {
    name: 'IPFS Scan',
    template: 'https://cdn.ipfsscan.io/weibo/{path}',
  },
];

/** 返回默认前缀列表的浅拷贝（避免 Vue 响应式代理污染常量） */
export function cloneDefaultPrefixes(): LinkPrefixItem[] {
  return DEFAULT_LINK_PREFIXES.map(item => ({ ...item }));
}

/**
 * 应用行为配置
 */
export interface AutoUpdateConfig {
  enabled: boolean;
}

export interface AppBehaviorConfig {
  /** 开机自启动 */
  autoStart: boolean;
  /** 启动时最小化到托盘 */
  minimizeToTrayOnStart: boolean;
  /** 关闭按钮最小化到托盘（false = 直接退出） */
  closeToTray: boolean;
}

/**
 * 全局快捷键配置
 * 控制在任何应用中通过快捷键触发上传
 */
export interface GlobalShortcutConfig {
  /** 是否启用全局快捷键 */
  enabled: boolean;
  /** 上传剪贴板图片的快捷键（Tauri 格式，如 'CommandOrControl+Shift+C'） */
  uploadClipboard: string;
  /** 选择文件上传的快捷键 */
  uploadFromFile: string;
}

/**
 * 链接输出配置
 * 控制上传完成后链接的复制格式和行为
 */
export interface LinkOutputConfig {
  /** 默认复制格式 */
  defaultFormat: import('../utils/linkFormatter').LinkFormat;
  /** 自定义模板（defaultFormat 为 'custom' 时使用） */
  customTemplate: string;
  /** 上传完成后是否自动复制到剪贴板 */
  autoCopy: boolean;
}

/**
 * 编辑器兼容 Server 支持的图床类型（简化子集）
 * 与 Rust 侧 ServerUploadConfig 枚举保持一致（serde tag = "type"）
 */
export type ServerServiceType = string;

/**
 * 编辑器兼容 Server 配置
 * 独立于主界面的多服务选择，为 Typora/Obsidian 提供专用图床
 */
export interface EditorServerConfig {
  /** 是否启用 HTTP Server（Obsidian 集成） */
  enabled: boolean;
  /** 是否启用 Typora 集成 */
  typoraEnabled: boolean;
  /** 监听端口（默认 36799，避免与 PicGo/PicList 36677 冲突） */
  port: number;
  /** Typora 专用图床（null = 未配置） */
  typoraService: ServerServiceType | null;
  /** Obsidian 专用图床（null = 未配置） */
  obsidianService: ServerServiceType | null;
}

/**
 * 用户配置（新架构）
 * 支持多图床并行上传
 */
export interface UserConfig {
  /** 用户启用的图床服务列表（上传窗口勾选的图床，支持复合 ID 如 custom_s3:xxx） */
  enabledServices: string[];

  /** 全局可用的图床列表（设置中配置，控制上传界面显示哪些图床，支持复合 ID） */
  availableServices?: string[];

  /** 各图床服务的配置 */
  services: {
    weibo?: WeiboServiceConfig;
    r2?: R2ServiceConfig;
    jd?: JDServiceConfig;

    nowcoder?: NowcoderServiceConfig;
    qiyu?: QiyuServiceConfig;
    zhihu?: ZhihuServiceConfig;
    nami?: NamiServiceConfig;
    bilibili?: BilibiliServiceConfig;
    chaoxing?: ChaoxingServiceConfig;
    smms?: SmmsServiceConfig;
    github?: GithubServiceConfig;
    imgur?: ImgurServiceConfig;
    tencent?: TencentServiceConfig;
    aliyun?: AliyunServiceConfig;
    qiniu?: QiniuServiceConfig;
    upyun?: UpyunServiceConfig;
  };

  /** 自定义 S3 存储 profiles（多实例） */
  custom_s3_profiles?: CustomS3Profile[];

  /** 微博代理模式 */
  weiboProxyMode: WeiboProxyMode;

  /** 链接输出配置 */
  linkOutput?: LinkOutputConfig;

  /** 链接前缀配置（用于微博图床代理） */
  linkPrefixConfig?: LinkPrefixConfig;

  /** WebDAV 配置（用于历史记录同步） */
  webdav?: WebDAVConfig;

  /** 浏览视图偏好设置 */
  galleryViewPreferences?: {
    viewMode: 'table' | 'grid';
    selectedImageBed?: string | 'all';
    gridColumnWidth: number;
  };

  /** 主题配置 */
  theme?: ThemeConfig;

  /** Google Analytics 配置 */
  analytics?: AnalyticsConfig;

  /** 应用行为配置 */
  appBehavior?: AppBehaviorConfig;

  /** 全局快捷键配置 */
  globalShortcut?: GlobalShortcutConfig;

  /** 自动更新配置 */
  autoUpdate?: AutoUpdateConfig;

  /** 是否已完成首次使用引导 */
  onboardingCompleted?: boolean;

  /** 图片压缩配置 */
  imageCompression?: ImageCompressionConfig;

  /** 编辑器兼容 Server（Typora/Obsidian 集成） */
  editorServer?: EditorServerConfig;

  /** MD 文档救援图床优先级（serviceId 列表，空数组 = 不限） */
  mdRescueHostPreference?: string[];
}
