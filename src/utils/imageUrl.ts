import type { HistoryItem, UserConfig } from '../config/types';
import { getActivePrefix } from '../config/types';

/**
 * 根据 HistoryItem 获取主服务的图片 URL（大图）
 * 微博图床会使用 large 尺寸并拼接前缀
 */
export function getPrimaryImageUrl(item: HistoryItem, config: UserConfig): string {
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  );
  if (!result?.result?.url) return '';

  if (result.serviceId === 'weibo' && result.result.fileKey) {
    let url = `https://tvax1.sinaimg.cn/large/${result.result.fileKey}.jpg`;
    const prefix = getActivePrefix(config);
    if (prefix) url = `${prefix}${url}`;
    return url;
  }

  return result.result.url;
}
