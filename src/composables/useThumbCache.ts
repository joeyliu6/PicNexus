/**
 * 缩略图缓存 composable
 * 用于两个视图（表格/瀑布流）共享缩略图 URL 缓存
 */
import { watch, effectScope } from 'vue';
import type { HistoryItem, UserConfig } from '../config/types';
import type { ImageMeta } from '../types/image-meta';
import type { QueueItem } from '../uploadQueue';
import { getActivePrefix } from '../config/types';
import { applyPrefixTemplate } from '../utils/linkPrefixTemplate';
import { useConfigManager } from './useConfig';
import { useHistoryManager } from './useHistory';

/** 缩略图生成相关函数接受的 config 类型：UserConfig 或 null（未加载） */
type ThumbConfig = UserConfig | null | undefined;

/** HistoryItem.results 数组的单个元素类型 */
type HistoryResultEntry = HistoryItem['results'][number];

/** 缩略图候选列表支持的两种 item 类型 */
type HistoryOrQueueItem = HistoryItem | QueueItem;

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
  config?: ThumbConfig
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
            thumbUrl = applyPrefixTemplate(activePrefix.template, thumbUrl);
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

/** 从 ImageMeta 生成中等缩略图 URL（便捷方法） */
export function getMetaThumbnailUrl(meta: ImageMeta, config: ThumbConfig): string {
  return generateMediumThumbnailUrl(meta.primaryService, meta.primaryUrl, meta.primaryFileKey, config);
}

/**
 * 根据图床类型生成中等尺寸缩略图 URL（~400-800px）
 * 用于悬浮预览和时间线视图
 */
export function generateMediumThumbnailUrl(
  serviceId: string,
  url: string,
  fileKey?: string,
  config?: ThumbConfig
): string {
  switch (serviceId) {
    case 'weibo':
      // 微博：mw690 约 690px 宽
      if (fileKey) {
        let thumbUrl = `https://tvax1.sinaimg.cn/mw690/${fileKey}.jpg`;
        if (config) {
          const activePrefix = getActivePrefix(config);
          if (activePrefix) {
            thumbUrl = applyPrefixTemplate(activePrefix.template, thumbUrl);
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
  item: HistoryOrQueueItem,
  config: ThumbConfig
): string[] {
  // 判断是 QueueItem 还是 HistoryItem
  // QueueItem 有 serviceProgress 且无 results，状态会动态变化，不应缓存
  // HistoryItem 有 results，状态稳定，可以缓存
  const isHistoryItem = 'results' in item && Array.isArray(item.results);
  const isQueueItem = !isHistoryItem && 'serviceProgress' in item;

  // 使用 item.id 作为缓存键
  const cacheKey = item.id;

  // 只对 HistoryItem 使用缓存（QueueItem 状态会动态变化）
  if (!isQueueItem && thumbnailCandidatesCache.has(cacheKey)) {
    const cached = thumbnailCandidatesCache.get(cacheKey)!;
    // 命中时移到末尾，维持真 LRU 顺序（Map 按插入顺序迭代）
    thumbnailCandidatesCache.delete(cacheKey);
    thumbnailCandidatesCache.set(cacheKey, cached);
    return cached;
  }

  const candidates: string[] = [];

  // 1. 处理 HistoryItem
  if (isHistoryItem) {
    const historyItem = item as HistoryItem;
    // 优先添加主力图床
    if (historyItem.primaryService) {
      const primary = historyItem.results.find(
        (r: HistoryResultEntry) => r.serviceId === historyItem.primaryService && r.status === 'success'
      );
      if (primary && primary.result?.url) {
        candidates.push(generateThumbnailUrl(primary.serviceId, primary.result.url, primary.result.fileKey, config));
      }
    }

    // 添加其他成功上传的图床
    historyItem.results.forEach((r: HistoryResultEntry) => {
      if (r.status === 'success' && r.result?.url && r.serviceId !== historyItem.primaryService) {
        candidates.push(generateThumbnailUrl(r.serviceId, r.result.url, r.result.fileKey, config));
      }
    });
  }
  // 2. 处理 QueueItem
  else if (isQueueItem) {
    const queueItem = item as QueueItem;
    // 优先使用 enabledServices 以保持确定的顺序
    const services = queueItem.enabledServices || [];

    services.forEach((serviceId: string) => {
      const progress = queueItem.serviceProgress[serviceId];
      // 检查状态 (兼容新旧状态文本)
      const isSuccess = progress?.status === 'success' ||
        progress?.status?.includes('完成') ||
        progress?.status?.includes('✓') ||
        !!progress?.link;

      if (progress && isSuccess && progress.link) {
        let fileKey: string | undefined = undefined;
        if (serviceId === 'weibo') {
          // 尝试从元数据或根属性获取 PID
          const pidFromMeta = progress.metadata?.pid;
          if (typeof pidFromMeta === 'string') {
            fileKey = pidFromMeta;
          } else if (queueItem.weiboPid) {
            fileKey = queueItem.weiboPid;
          }
        }
        candidates.push(generateThumbnailUrl(serviceId, progress.link, fileKey, config));
      }
    });
  }

  // 去重
  const uniqueCandidates = [...new Set(candidates)];

  // 只对 HistoryItem 缓存结果（QueueItem 状态动态变化，不缓存）
  if (!isQueueItem) {
    if (thumbnailCandidatesCache.size >= THUMB_CACHE_MAX_SIZE && !thumbnailCandidatesCache.has(cacheKey)) {
      const firstKey = thumbnailCandidatesCache.keys().next().value;
      if (firstKey) thumbnailCandidatesCache.delete(firstKey);
    }
    thumbnailCandidatesCache.set(cacheKey, uniqueCandidates);
  }

  return uniqueCandidates;
}



/**
 * 设置缩略图缓存（写入末尾；超限时淘汰头部最久未访问项，实现真 LRU）
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
  // 检查缓存（命中时移到末尾，维持真 LRU 顺序）
  if (thumbUrlCache.has(item.id)) {
    const cached = thumbUrlCache.get(item.id);
    thumbUrlCache.delete(item.id);
    thumbUrlCache.set(item.id, cached);
    return cached;
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
      thumbUrl = applyPrefixTemplate(activePrefix.template, thumbUrl);
    }

    setThumbCache(item.id, thumbUrl);
    return thumbUrl;
  }

  // 非微博图床：直接使用原图 URL（写入缓存避免重复查找）
  const resultUrl = targetResult.result.url;
  setThumbCache(item.id, resultUrl);
  return resultUrl;
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
      largeUrl = applyPrefixTemplate(activePrefix.template, largeUrl);
    }

    return largeUrl;
  }

  return result.result.url;
}

/** 模块级 watcher 是否已初始化（只注册一次，避免多实例重复注册） */
let watchersInitialized = false;

/**
 * 使用 effectScope(true) 注册模块级 watcher。
 * effectScope(true) = 脱离组件生命周期的独立 scope，watcher 随应用存活而持续运行。
 * 只在首次调用 useThumbCache() 时执行一次，解决多组件同时使用时重复注册的问题。
 */
function initModuleWatchers(
  configManager: ReturnType<typeof useConfigManager>,
  historyManager: ReturnType<typeof useHistoryManager>,
): void {
  if (watchersInitialized) return;
  watchersInitialized = true;

  const scope = effectScope(true);
  scope.run(() => {
    // 数据变化时增量清理（只删除已移除项的缓存）
    watch(() => historyManager.imageMetas.value, (newMetas) => {
      const newIds = new Set(newMetas.map(m => m.id));
      for (const id of thumbUrlCache.keys()) {
        if (!newIds.has(id)) {
          thumbUrlCache.delete(id);
          thumbnailCandidatesCache.delete(id);
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
  });
}

/**
 * 缩略图缓存 composable
 */
export function useThumbCache() {
  const configManager = useConfigManager();
  const historyManager = useHistoryManager();

  initModuleWatchers(configManager, historyManager);

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
