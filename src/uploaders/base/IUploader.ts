// src/uploaders/base/IUploader.ts
// 上传器核心接口定义

import {
  UploadResult,
  ValidationResult,
  UploadOptions,
  ConnectionTestResult,
  ProgressCallback
} from './types';

/**
 * 上传器接口
 * 所有图床上传器必须实现此接口
 *
 * 实现说明：
 * - serviceId: 使用小写英文标识，如 'weibo', 'r2', 'nami'
 * - serviceName: 用户友好的中文名称，如 '新浪微博', 'Cloudflare R2'
 * - validateConfig: 在上传前验证配置完整性，避免运行时错误
 * - upload: 核心上传方法，应该调用 Rust 后端实现真正的上传
 * - getPublicUrl: 根据上传结果生成可访问的公开URL
 * - testConnection: 可选方法，用于测试服务连接性
 */
export interface IUploader {
  /**
   * 图床服务唯一标识符
   * 示例: 'weibo', 'r2', 'nami', 'jd', 'nowcoder'
   */
  readonly serviceId: string;

  /**
   * 图床服务显示名称（用于 UI 显示）
   * 示例: '新浪微博', 'Cloudflare R2', '纳米图床'
   */
  readonly serviceName: string;

  /**
   * 验证配置完整性
   * 在上传前调用此方法，确保所有必填配置项都已填写
   *
   * @param config 图床特定的配置对象
   * @returns 验证结果，包含是否有效、缺失字段、错误信息
   *
   * @example
   * const result = await uploader.validateConfig(config);
   * if (!result.valid) {
   *   console.error('配置无效:', result.errors);
   *   return;
   * }
   */
  validateConfig(config: any): Promise<ValidationResult>;

  /**
   * 上传文件到图床
   * 核心方法：负责调用 Rust 后端执行真正的上传操作
   *
   * @param filePath 文件的绝对路径
   * @param options 上传选项（包含配置、超时、重试等）
   * @param onProgress 进度回调函数（可选），接收 0-100 的百分比
   * @returns 上传结果，包含 URL、文件标识、尺寸等信息
   *
   * @throws {Error} 上传失败时抛出错误（如网络错误、认证失败等）
   *
   * @example
   * const result = await uploader.upload(
   *   '/path/to/image.jpg',
   *   { config: weiboConfig },
   *   (percent) => console.log(`上传进度: ${percent}%`)
   * );
   * console.log('上传成功:', result.url);
   */
  upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult>;

  /**
   * 根据上传结果生成公开访问 URL
   * 某些图床可能需要特殊的 URL 构建逻辑
   *
   * @param result 上传结果对象
   * @returns 可公开访问的 URL
   *
   * @example
   * const url = uploader.getPublicUrl(uploadResult);
   * // 对于微博: https://tvax1.sinaimg.cn/large/006xxx.jpg
   * // 对于 R2: https://example.com/images/file.jpg
   */
  getPublicUrl(result: UploadResult): string;

  /**
   * 测试与图床服务的连接性（可选方法）
   * 用于在设置页面验证配置是否正确
   *
   * @param config 可选的服务配置，用于验证凭证
   * @returns 测试结果，包含成功状态、延迟、错误信息
   *
   * @example
   * const test = await uploader.testConnection?.(config);
   * if (test?.success) {
   *   console.log(`连接成功，延迟: ${test.latency}ms`);
   * } else {
   *   console.error('连接失败:', test?.error);
   * }
   */
  testConnection?(config?: any): Promise<ConnectionTestResult>;
}
