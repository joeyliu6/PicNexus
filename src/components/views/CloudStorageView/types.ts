// src/components/views/CloudStorageView/types.ts
// 云存储管理视图类型定义

/** 支持的存储服务类型 */
export type CloudServiceType = 'r2' | 'tencent' | 'aliyun' | 'qiniu' | 'upyun';

/** 存储服务ID到名称的映射 */
export const SERVICE_NAMES: Record<CloudServiceType, string> = {
  r2: 'Cloudflare R2',
  tencent: '腾讯云',
  aliyun: '阿里云',
  qiniu: '七牛云',
  upyun: '又拍云',
};

/** 支持的服务列表 */
export const SUPPORTED_SERVICES: CloudServiceType[] = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'];

/** 连接状态 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error' | 'unconfigured';

/** 服务状态 */
export interface ServiceStatus {
  serviceId: CloudServiceType;
  serviceName: string;
  status: ConnectionStatus;
  error?: string;
  lastChecked?: Date;
}

/** 存储对象（完整定义，包含 UI 需要的字段） */
export interface StorageObject {
  /** 文件/对象唯一标识符（路径或Key） */
  key: string;
  /** 文件名 */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间 */
  lastModified: Date;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 公开访问 URL（如果可用） */
  url?: string;
  /** ETag（对象哈希） */
  etag?: string;
  /** 对象类型：文件或文件夹 */
  type: 'file' | 'folder';
  /** 缩略图 URL（懒加载后填充） */
  thumbnailUrl?: string;
  /** 是否正在加载缩略图 */
  thumbnailLoading?: boolean;
}

/** 列表结果 */
export interface ListResult {
  /** 对象列表 */
  objects: StorageObject[];
  /** 子目录前缀列表 */
  prefixes: string[];
  /** 是否有更多数据 */
  isTruncated: boolean;
  /** 分页续传 Token */
  continuationToken?: string;
  /** 总数量（如果支持） */
  totalCount?: number;
}

/** 存储统计信息 */
export interface StorageStats {
  /** 对象总数 */
  objectCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 存储桶/空间名称 */
  bucketName?: string;
  /** 存储区域 */
  region?: string;
}

/** 链接格式类型 */
export type LinkFormat = 'url' | 'markdown' | 'html' | 'bbcode';

/** 链接格式配置 */
export interface LinkFormatConfig {
  format: LinkFormat;
  label: string;
  icon: string;
  template: (url: string, name: string) => string;
}

/** 预定义的链接格式 */
export const LINK_FORMATS: LinkFormatConfig[] = [
  {
    format: 'url',
    label: 'URL',
    icon: 'pi-link',
    template: (url) => url,
  },
  {
    format: 'markdown',
    label: 'Markdown',
    icon: 'pi-file-edit',
    template: (url, name) => `![${name}](${url})`,
  },
  {
    format: 'html',
    label: 'HTML',
    icon: 'pi-code',
    template: (url, name) => `<img src="${url}" alt="${name}" />`,
  },
  {
    format: 'bbcode',
    label: 'BBCode',
    icon: 'pi-comment',
    template: (url) => `[img]${url}[/img]`,
  },
];

/** 文件操作类型 */
export type FileOperation = 'upload' | 'delete' | 'rename' | 'move' | 'copy';

/** 操作进度 */
export interface OperationProgress {
  /** 操作类型 */
  operation: FileOperation;
  /** 当前进度 */
  current: number;
  /** 总数 */
  total: number;
  /** 当前处理的文件名 */
  currentFile?: string;
}

/** 虚拟滚动配置 */
export interface VirtualGridConfig {
  /** 项目宽度（像素） */
  itemWidth: number;
  /** 项目高度（像素） */
  itemHeight: number;
  /** 间距（像素） */
  gap: number;
  /** 预渲染行数 */
  overscan: number;
}

/** 虚拟滚动默认配置 */
export const DEFAULT_VIRTUAL_GRID_CONFIG: VirtualGridConfig = {
  itemWidth: 180,
  itemHeight: 200,
  gap: 16,
  overscan: 3,
};

/** 排序字段 */
export type SortField = 'name' | 'size' | 'lastModified';

/** 排序方向 */
export type SortDirection = 'asc' | 'desc';

/** 排序配置 */
export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

/** 视图模式 */
export type ViewMode = 'grid' | 'list';

/** 右键菜单项 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}
