// src/core/LinkGenerator.ts
// 链接生成逻辑

import { UploadResult } from '../uploaders/base/types';
import { UserConfig, getActivePrefix, DEFAULT_PREFIXES } from '../config/types';

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
        console.log('[LinkGenerator] 前缀功能已禁用，使用直接链接:', result.url);
        return result.url;
      }

      const proxyLink = `${activePrefix}${result.url}`;
      console.log('[LinkGenerator] 生成代理链接:', proxyLink);
      return proxyLink;
    }

    // 其他情况直接返回原始 URL
    console.log('[LinkGenerator] 使用直接链接:', result.url);
    return result.url;
  }

  /**
   * 验证链接格式
   *
   * @param link 链接
   * @returns 是否为有效链接
   */
  static isValidLink(link: string): boolean {
    try {
      const url = new URL(link);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * 获取原始链接（去除代理前缀）
   *
   * @param generatedLink 生成的链接
   * @param config 用户配置（可选，用于获取自定义前缀列表）
   * @returns 原始链接
   */
  static getOriginalLink(generatedLink: string, config?: UserConfig): string {
    // 获取所有可能的前缀
    const allPrefixes = config?.linkPrefixConfig?.prefixList || DEFAULT_PREFIXES;

    // 也检查旧的 baiduPrefix
    if (config?.baiduPrefix && !allPrefixes.includes(config.baiduPrefix)) {
      allPrefixes.push(config.baiduPrefix);
    }

    // 检查链接是否以任何已知前缀开头
    for (const prefix of allPrefixes) {
      if (generatedLink.startsWith(prefix)) {
        return generatedLink.substring(prefix.length);
      }
    }

    return generatedLink;
  }
}
