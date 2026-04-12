// 链接生成逻辑

import { UploadResult } from '../uploaders/base/types';
import { UserConfig, getActivePrefix } from '../config/types';
import { applyPrefixTemplate } from '../utils/linkPrefixTemplate';

/**
 * 链接生成器
 * 负责根据配置生成最终的图片链接
 */
export class LinkGenerator {
  /**
   * 生成最终链接
   * 微博 + baidu-proxy 模式下会应用链接前缀模板
   *
   * @param result 上传结果
   * @param config 用户配置
   * @returns 最终生成的链接
   */
  static generate(result: UploadResult, config: UserConfig): string {
    if (
      result.serviceId === 'weibo' &&
      config.weiboProxyMode === 'baidu-proxy'
    ) {
      const activePrefix = getActivePrefix(config);
      if (!activePrefix) {
        return result.url;
      }
      return applyPrefixTemplate(activePrefix.template, result.url);
    }

    return result.url;
  }

}
