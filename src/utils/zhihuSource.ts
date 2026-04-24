// 知乎图片 source 参数处理
// 知乎图床 (*.zhimg.com) 通过 Referer 做防盗链，同时对 URL 上的 source 参数有白名单校验。
// 附加合法 source 值（默认 172ae18b，来自社区抓包验证的网页端渠道标识）可以在
// 没有 Referer 的场景（直接打开链接、外链嵌入）下依然通过 CDN 鉴权。
//
// 此值非永久保证——若某天失效，用户可在「图床设置 → 知乎」里自行填入新值。

import type { UserConfig } from '../config/types';

export const ZHIHU_SOURCE_DEFAULT_VALUE = '172ae18b';

const ZHIMG_HOST_PATTERN = /(^|\.)zhimg\.com$/i;

/** 判断 URL 是否指向知乎图床（*.zhimg.com） */
export function isZhimgUrl(url: string): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return ZHIMG_HOST_PATTERN.test(host);
  } catch {
    return false;
  }
}

/**
 * 给知乎图床 URL 追加 source 参数。
 * - 非 zhimg.com 域名原样返回
 * - URL 已有 source 参数时不覆盖（尊重原值）
 * - 空 value 视为禁用
 */
export function applyZhihuSource(url: string, enabled: boolean, value: string): string {
  if (!enabled || !url || !value) return url;
  if (!isZhimgUrl(url)) return url;

  try {
    const u = new URL(url);
    if (u.searchParams.has('source')) return url;
    u.searchParams.set('source', value);
    return u.toString();
  } catch {
    return url;
  }
}

/** 从 config.services.zhihu 读取开关和值并应用（默认启用 + 默认值） */
export function applyZhihuSourceFromConfig(url: string, config: UserConfig | null | undefined): string {
  const zhihu = config?.services?.zhihu;
  const enabled = zhihu?.sourceParamEnabled ?? true;
  const value = zhihu?.sourceParamValue?.trim() || ZHIHU_SOURCE_DEFAULT_VALUE;
  return applyZhihuSource(url, enabled, value);
}
