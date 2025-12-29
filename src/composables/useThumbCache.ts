/**
 * 缩略图缓存 composable
 * 用于两个视图（表格/瀑布流）共享缩略图 URL 缓存
 */
import { watch } from 'vue';
import type { HistoryItem, ServiceType } from '../config/types';
import { getActivePrefix } from '../config/types';
import { useConfigManager } from './useConfig';
import { useHistoryManager } from './useHistory';

// 缓存上限
const THUMB_CACHE_MAX_SIZE = 500;

// 单例缩略图缓存（模块级别）
const thumbUrlCache = new Map<string, string | undefined>();

/**
 * 设置缩略图缓存（带 LRU 淘汰）
 */
function setThumbCache(id: string, url: string | undefined): void {
  // 如果超过上限，删除最早的条目（Map 保持插入顺序）
  if (thumbUrlCache.size >= THUMB_CACHE_MAX_SIZE && !thumbUrlCache.has(id)) {
    const firstKey = thumbUrlCache.keys().next().value;
    if (firstKey) thumbUrlCache.delete(firstKey);
  }
  thumbUrlCache.set(id, url);
}

/**
 * 清空缩略图缓存
 */
function clearThumbCache(): void {
  thumbUrlCache.clear();
}

/**
 * 获取缩略图 URL
 * 微博图床：直接返回服务端缩略图 URL
 * 其他图床：直接返回原图 URL
 */
function getThumbUrl(item: HistoryItem, config: ReturnType<typeof useConfigManager>['config']['value']): string | undefined {
  // 检查缓存
  if (thumbUrlCache.has(item.id)) {
    return thumbUrlCache.get(item.id);
  }

  if (!item.results || item.results.length === 0) {
    setThumbCache(item.id, undefined);
    return undefined;
  }

  // 优先使用主力图床的结果
  const primaryResult = item.results.find(r => r.serviceId === item.primaryService && r.status === 'success');
  const targetResult = primaryResult || item.results.find(r => r.status === 'success' && r.result?.url);

  if (!targetResult?.result?.url) {
    setThumbCache(item.id, undefined);
    return undefined;
  }

  // 微博图床：使用服务端缩略图
  if (targetResult.serviceId === 'weibo' && targetResult.result.fileKey) {
    let thumbUrl = `https://tvax1.sinaimg.cn/bmiddle/${targetResult.result.fileKey}.jpg`;

    // 应用链接前缀（如果启用）
    const activePrefix = getActivePrefix(config);
    if (activePrefix) {
      thumbUrl = `${activePrefix}${thumbUrl}`;
    }

    setThumbCache(item.id, thumbUrl);
    return thumbUrl;
  }

  // 非微博图床：直接使用原图 URL
  return targetResult.result.url;
}

/**
 * 获取中等尺寸图 URL（用于悬浮预览）
 * 微博使用 bmiddle 约 440px
 */
function getMediumImageUrl(item: HistoryItem, config: ReturnType<typeof useConfigManager>['config']['value']): string {
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  );

  if (!result?.result?.url) return '';

  // 微博图床：使用 bmiddle 尺寸
  if (result.serviceId === 'weibo' && result.result.fileKey) {
    let mediumUrl = `https://tvax1.sinaimg.cn/bmiddle/${result.result.fileKey}.jpg`;

    const activePrefix = getActivePrefix(config);
    if (activePrefix) {
      mediumUrl = `${activePrefix}${mediumUrl}`;
    }

    return mediumUrl;
  }

  // 非微博图床：使用原始 URL
  return result.result.url;
}

/**
 * 获取大图 URL
 * 微博使用 large 尺寸
 */
function getLargeImageUrl(item: HistoryItem, config: ReturnType<typeof useConfigManager>['config']['value']): string {
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  );

  if (!result?.result?.url) return '';

  // 微博图床：使用 large 尺寸
  if (result.serviceId === 'weibo' && result.result.fileKey) {
    let largeUrl = `https://tvax1.sinaimg.cn/large/${result.result.fileKey}.jpg`;

    const activePrefix = getActivePrefix(config);
    if (activePrefix) {
      largeUrl = `${activePrefix}${largeUrl}`;
    }

    return largeUrl;
  }

  return result.result.url;
}

/**
 * 缩略图缓存 composable
 */
export function useThumbCache() {
  const configManager = useConfigManager();
  const historyManager = useHistoryManager();

  // 数据变化时增量清理（只删除已移除项的缓存）
  watch(() => historyManager.allHistoryItems.value, (newItems) => {
    const newIds = new Set(newItems.map(i => i.id));
    for (const id of thumbUrlCache.keys()) {
      if (!newIds.has(id)) {
        thumbUrlCache.delete(id);
      }
    }
  }, { deep: false });

  // 监听影响 URL 的前缀配置项变化
  watch(
    () => configManager.config.value?.linkPrefixConfig?.enabled,
    clearThumbCache
  );

  watch(
    () => configManager.config.value?.linkPrefixConfig?.selectedIndex,
    clearThumbCache
  );

  return {
    /**
     * 获取缩略图 URL
     */
    getThumbUrl: (item: HistoryItem) => getThumbUrl(item, configManager.config.value),

    /**
     * 获取中等尺寸图 URL（用于悬浮预览）
     */
    getMediumImageUrl: (item: HistoryItem) => getMediumImageUrl(item, configManager.config.value),

    /**
     * 获取大图 URL
     */
    getLargeImageUrl: (item: HistoryItem) => getLargeImageUrl(item, configManager.config.value),

    /**
     * 清空缩略图缓存
     */
    clearThumbCache,
  };
}
