// 通用云存储管理器接口定义

import { StorageObject, ListResult } from '../../components/views/CloudStorageView/types';
import { ConnectionTestResult } from '../../uploaders/base/types';

// 重新导出类型，方便其他模块使用
export type { StorageObject, ListResult, ConnectionTestResult };

/**
 * 列表选项
 */
export interface ListOptions {
  /** 前缀（路径） */
  prefix?: string;
  /** 分隔符（通常为 '/'） */
  delimiter?: string;
  /** 最大返回数量 */
  maxKeys?: number;
  /** 分页续传 Token */
  continuationToken?: string;
}

/**
 * 存储管理器接口
 * 所有云存储管理器必须实现此接口
 */
export interface IStorageManager {
  /** 服务标识符 */
  readonly serviceId: string;
  /** 服务显示名称 */
  readonly serviceName: string;

  /**
   * 测试连接
   */
  testConnection(): Promise<ConnectionTestResult>;

  /**
   * 列出对象
   * @param options 列表选项
   */
  listObjects(options: ListOptions): Promise<ListResult>;

  /**
   * 上传文件
   * @param localPath 本地文件路径
   * @param remotePath 远程路径
   * @param onProgress 上传进度回调
   */
  uploadFile(
    localPath: string,
    remotePath: string,
    onProgress?: (percent: number) => void
  ): Promise<string>;

  /**
   * 下载文件
   * @param remotePath 远程路径
   * @param localPath 本地保存路径
   * @param onProgress 下载进度回调
   */
  downloadFile(
    remotePath: string,
    localPath: string,
    onProgress?: (percent: number) => void
  ): Promise<void>;

  /**
   * 删除单个文件
   * @param remotePath 远程路径
   */
  deleteFile(remotePath: string): Promise<void>;

  /**
   * 批量删除文件
   * @param remotePaths 远程路径列表
   */
  deleteFiles(remotePaths: string[]): Promise<{
    /** 成功删除的路径列表 */
    success: string[];
    /** 删除失败的路径列表 */
    failed: { path: string; error: string }[];
  }>;

  /**
   * 获取预签名 URL（可选方法）
   * 用于私有存储桶的临时分享
   * @param remotePath 远程路径
   * @param expiresIn 过期时间（秒）
   */
  getPresignedUrl?(remotePath: string, expiresIn?: number): Promise<string>;

  /**
   * 获取对象信息（可选方法）
   * @param remotePath 远程路径
   */
  getObjectInfo?(remotePath: string): Promise<StorageObject>;

  /**
   * 创建文件夹
   * 对象存储通过创建以 / 结尾的空对象来模拟文件夹
   * @param folderPath 文件夹路径（必须以 / 结尾）
   */
  createFolder(folderPath: string): Promise<void>;

  /**
   * 初始化管理器
   * @param config 服务配置
   */
  init(config: any): void;
}
