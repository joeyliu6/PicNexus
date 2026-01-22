// src/core/LinkGenerator.ts
// 链接生成逻辑

import { UploadResult } from '../uploaders/base/types';
import { UserConfig, getActivePrefix } from '../config/types';

/**
 * 链接生成器
 * 负责根据配置生成最终的图片链接
 */
export class LinkGenerator {
  /**
   * 生成最终链接
   * 处理百度前缀等特殊逻辑
   *
   * @param result 上传结果
   * @param config 用户配置
   * @returns 最终生成的链接
   */
  static generate(result: UploadResult, config: UserConfig): string {
    // 只有微博 + baidu-proxy 模式才加代理前缀
    if (
      result.serviceId === 'weibo' &&
      config.outputFormat === 'baidu-proxy'
    ) {
      const activePrefix = getActivePrefix(config);

      // 如果前缀功能被禁用，返回原始链接
      if (!activePrefix) {
        return result.url;
      }

      return `${activePrefix}${result.url}`;
    }

    // 其他情况直接返回原始 URL
    return result.url;
  }

}
