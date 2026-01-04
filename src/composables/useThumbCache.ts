/**
 * 缩略图缓存 composable
 * 用于两个视图（表格/瀑布流）共享缩略图 URL 缓存
 */
import { watch } from 'vue';
import type { HistoryItem } from '../config/types';
import { getActivePrefix } from '../config/types';
import { useConfigManager } from './useConfig';
import { useHistoryManager } from './useHistory';

// 缓存上限
const THUMB_CACHE_MAX_SIZE = 500;

// 单例缩略图缓存（模块级别）
const thumbUrlCache = new Map<string, string | undefined>();

/**
 * 根据图床类型生成缩略图 URL
 * 供上传队列等非 composable 场景使用
 */
export function generateThumbnailUrl(
  serviceId: string,
  url: string,
  fileKey?: string,
  config?: any
): string {
  let thumbUrl: string;

  switch (serviceId) {
    case 'weibo':
      // 微博：使用 thumb150 获取 150x150 缩略图
      if (fileKey) {
        thumbUrl = `https://tvax1.sinaimg.cn/thumb150/${fileKey}.jpg`;
        // 应用链接前缀（如果启用）
        if (config) {
          const activePrefix = getActivePrefix(config);
          if (activePrefix) {
            thumbUrl = `${activePrefix}${thumbUrl}`;
          }
        }
      } else {
        thumbUrl = url;
      }
      break;

    case 'r2':
      // R2：使用 wsrv.nl 图片代理
      // 将原图 URL 编码后作为参数传递
      thumbUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=75&h=75&fit=cover&a=center&q=75&output=webp`;
      break;

    case 'jd':
      // 京东：在 /jfs/ 后添加 s76x76_ 前缀
      thumbUrl = url.replace('/jfs/', '/s76x76_jfs/');
      break;

    case 'zhihu':
      // 知乎：在扩展名前添加 _xs 后缀
      thumbUrl = url.replace(/\.(\w+)$/, '_xs.$1');
      break;

    case 'qiyu':
      // 七鱼：使用 NOS 图片处理参数
      thumbUrl = `${url}?imageView&thumbnail=50x0`;
      break;

    case 'nami':
      // 纳米：使用火山引擎 TOS 图片处理参数
      thumbUrl = `${url}?x-tos-process=image/resize,l_75/quality,q_70/format,jpg`;
      break;

    case 'nowcoder':
      // 牛客：使用阿里云 OSS 图片处理参数
      thumbUrl = `${url}?x-oss-process=image%2Fresize%2Cw_75%2Ch_75%2Cm_mfit%2Fformat%2Cpng`;
      break;

    case 'bilibili':
      // B站：使用 @宽w_高h 格式的缩略图，75x75 裁剪，80质量 WebP
      thumbUrl = `${url}@75w_75h_1c_80q.webp`;
      break;

    case 'chaoxing': {
      // 超星：替换域名 + 替换文件名
      // 原图: https://p.cldisk.com/star4/{hash}/origin.jpg
      // 缩略: https://p.ananas.chaoxing.com/star4/{hash}/75_0cQ80.webp
      let cxUrl = url;
      if (cxUrl.includes('p.cldisk.com')) {
        cxUrl = cxUrl.replace('p.cldisk.com', 'p.ananas.chaoxing.com');
      }
      thumbUrl = cxUrl.replace(/\/origin\.[a-zA-Z0-9]+(\?.*)?$/, '/75_0cQ80.webp');
      break;
    }

    default:
      // 其他图床：直接使用原图
      thumbUrl = url;
  }

  return thumbUrl;
}

/**
 * 根据图床类型生成中等尺寸缩略图 URL（~400-800px）
 * 用于悬浮预览和时间线视图
 */
export function generateMediumThumbnailUrl(
  serviceId: string,
  url: string,
  fileKey?: string,
  config?: any
): string {
  switch (serviceId) {
    case 'weibo':
      // 微博：mw690 约 690px 宽
      if (fileKey) {
        let thumbUrl = `https://tvax1.sinaimg.cn/mw690/${fileKey}.jpg`;
        if (config) {
          const activePrefix = getActivePrefix(config);
          if (activePrefix) {
            thumbUrl = `${activePrefix}${thumbUrl}`;
          }
        }
        return thumbUrl;
      }
      return url;

    case 'r2':
      // R2：wsrv.nl 代理，宽度 800px
      return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=800&q=80&output=webp`;

    case 'jd':
      // 京东：s500x0 约 500px 宽
      return url.replace('/jfs/', '/s500x0_jfs/');

    case 'zhihu':
      // 知乎：_qhd 后缀（高清缩略图）
      return url.replace(/\.(\w+)$/, '_qhd.$1');

    case 'qiyu':
      // 七鱼：thumbnail=400x0
      return `${url}?imageView&thumbnail=400x0`;

    case 'nami':
      // 纳米：l_500 宽度 500px
      return `${url}?x-tos-process=image/resize,l_500/quality,q_80/format,jpg`;

    case 'nowcoder':
      // 牛客：w_400
      return `${url}?x-oss-process=image%2Fresize%2Cw_400%2Cm_mfit%2Fformat%2Cpng`;

    case 'bilibili':
      // B站：800宽，80质量 WebP
      return `${url}@800w_80q.webp`;

    case 'chaoxing': {
      // 超星：替换域名 + 替换文件名为中等尺寸
      // 原图: https://p.cldisk.com/star4/{hash}/origin.jpg
      // 中图: https://p.ananas.chaoxing.com/star4/{hash}/800_0cQ80.webp
      let cxMediumUrl = url;
      if (cxMediumUrl.includes('p.cldisk.com')) {
        cxMediumUrl = cxMediumUrl.replace('p.cldisk.com', 'p.ananas.chaoxing.com');
      }
      return cxMediumUrl.replace(/\/origin\.[a-zA-Z0-9]+(\?.*)?$/, '/800_0cQ80.webp');
    }

    default:
      return url;
  }
}

// 缩略图候选列表缓存
const thumbnailCandidatesCache = new Map<string, string[]>();

/**
 * 获取缩略图候选列表（带缓存优化）
 * 支持 HistoryItem 和 QueueItem
 */
export function getThumbnailCandidates(
  item: HistoryItem | any,
  config: any
): string[] {
  // 判断是 QueueItem 还是 HistoryItem
  // QueueItem 有 serviceProgress 且无 results，状态会动态变化，不应缓存
  // HistoryItem 有 results，状态稳定，可以缓存
  const isQueueItem = item.serviceProgress && !item.results;

  // 使用 item.id 作为缓存键
  const cacheKey = item.id;

  // 只对 HistoryItem 使用缓存（QueueItem 状态会动态变化）
  if (!isQueueItem && thumbnailCandidatesCache.has(cacheKey)) {
    return thumbnailCandidatesCache.get(cacheKey)!;
  }

  const candidates: string[] = [];

  // 1. 处理 HistoryItem
  if (item.results && Array.isArray(item.results)) {
    // 优先添加主力图床
    if (item.primaryService) {
      const primary = item.results.find((r: any) => r.serviceId === item.primaryService && r.status === 'success');
      if (primary && primary.result?.url) {
        candidates.push(generateThumbnailUrl(primary.serviceId, primary.result.url, primary.result.fileKey, config));
      }
    }

    // 添加其他成功上传的图床
    item.results.forEach((r: any) => {
      if (r.status === 'success' && r.result?.url && r.serviceId !== item.primaryService) {
        candidates.push(generateThumbnailUrl(r.serviceId, r.result.url, r.result.fileKey, config));
      }
    });
  }
  // 2. 处理 QueueItem
  else if (item.serviceProgress) {
    // 优先使用 enabledServices 以保持确定的顺序
    const services = item.enabledServices || [];

    services.forEach((serviceId: string) => {
      const progress = item.serviceProgress[serviceId];
      // 检查状态 (兼容新旧状态文本)
      const isSuccess = progress?.status === 'success' ||
        progress?.status?.includes('完成') ||
        progress?.status?.includes('✓') ||
        !!progress?.link;

      if (progress && isSuccess && progress.link) {
        let fileKey = undefined;
        if (serviceId === 'weibo') {
          // 尝试从元数据或根属性获取 PID
          fileKey = progress.metadata?.pid || item.weiboPid;
        }
        candidates.push(generateThumbnailUrl(serviceId, progress.link, fileKey, config));
      }
    });
  }

  // 去重
  const uniqueCandidates = [...new Set(candidates)];

  // 只对 HistoryItem 缓存结果（QueueItem 状态动态变化，不缓存）
  if (!isQueueItem) {
    thumbnailCandidatesCache.set(cacheKey, uniqueCandidates);
  }

  return uniqueCandidates;
}



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
  thumbnailCandidatesCache.clear(); // 同时清空候选列表缓存
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
 * 获取中等尺寸缩略图 URL（用于悬浮预览和时间线视图）
 * 所有图床都使用中等尺寸缩略图（~400-800px）
 */
function getMediumImageUrl(item: HistoryItem, config: ReturnType<typeof useConfigManager>['config']['value']): string {
  // 优先使用主力图床
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  ) || item.results.find(r => r.status === 'success');

  if (!result?.result?.url) return '';

  // 使用中等尺寸缩略图生成函数
  return generateMediumThumbnailUrl(
    result.serviceId,
    result.result.url,
    result.result.fileKey,
    config
  );
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
        thumbnailCandidatesCache.delete(id); // 同时清理候选列表缓存
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
