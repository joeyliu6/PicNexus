/**
 * 缩略图缓存 composable
 * 用于两个视图（表格/瀑布流）共享缩略图 URL 缓存
 */
import { watch, effectScope, shallowRef } from 'vue';
import type { HistoryItem, UserConfig } from '../config/types';
import type { ImageMeta } from '../types/image-meta';
import type { QueueItem } from '../core/UploadQueue';
import { getActivePrefix } from '../config/types';
import { applyPrefixTemplate } from '../utils/linkPrefixTemplate';
import { applyZhihuSourceFromConfig, ZHIHU_SOURCE_DEFAULT_VALUE } from '../utils/zhihuSource';
import { useConfigManager } from './useConfig';
import { onCacheEventType } from '../events/cacheEvents';
import type { HistoryEventData } from '../events/cacheEvents';
import { createLogger } from '../utils/logger';

const log = createLogger('ThumbCache');

/** 缩略图生成相关函数接受的 config 类型：UserConfig 或 null（未加载） */
type ThumbConfig = UserConfig | null | undefined;

/** HistoryItem.results 数组的单个元素类型 */
type HistoryResultEntry = HistoryItem['results'][number];

/** 缩略图候选列表支持的两种 item 类型 */
type HistoryOrQueueItem = HistoryItem | QueueItem;

/**
 * R2 缩略图是否走第三方代理（wsrv.nl）
 *
 * 默认开：R2 自身没有图片处理参数，不走代理就得在 75px 的格子里加载整张原图，
 * 时间轴那种一屏几十张的场景会明显拖慢。开着能省下绝大部分流量。
 *
 * 代价是把图片地址交给第三方，且那条链路不通时（境内网络、服务故障）缩略图会裂
 * ——issue #4 症状②。所以候选链里代理只排第一位，原图垫在后面兜底
 * （见 {@link generateThumbnailUrls}），裂不了；在意隐私的用户可以关掉开关。
 *
 * 判据写 `!== false` 而非 `=== true`：老配置里没有这个字段，缺省要落到「开」，
 * 与该字段引入前的历史行为保持一致。
 */
function isR2ThumbnailProxyOn(config: ThumbConfig): boolean {
  return config?.services?.r2?.thumbnailProxyEnabled !== false;
}

/** 代理服务的域名，用于识别「失败的是不是代理那条候选」 */
const THUMB_PROXY_HOST = 'wsrv.nl';

/**
 * 本次会话里代理是否可达（null = 还没试过）
 *
 * Why 必须记住：wsrv.nl 在境内直连不通。若每张缩略图都老实先试代理、再等满超时才降级，
 * 滚动列表时每翻一屏都要空等 5 秒，比压根不用代理还难受。所以第一张图试出不通，
 * 就把整个会话降级成原图直连，后续candidates 直接不再产出代理条目。
 *
 * 只记在内存、不落配置：网络环境随时会变（换网、开关代理），重启应用重新探一次即可。
 * 误判的代价也小——最坏情况是本可用代理却退回原图，图照样看得见。
 *
 * ⚠️ **必须是 ref，不能写成普通 `let`**：候选列表是在渲染期算的（历史表格一页 50 行、
 * 时间轴每行模板都会调 `getThumbnailCandidates` / `getMetaThumbnailCandidates`）。
 * 用普通变量的话 Vue 收集不到依赖——第一张图探测失败后，**已经渲染出来的其余几十行
 * 仍持有旧的「代理在前」候选**，滚下去每张照样空等一轮超时，等于这个优化白做。
 * 用 shallowRef 才能让那些 computed / 渲染函数在降级时自动失效重算。
 */
const proxyReachable = shallowRef<boolean | null>(null);

/** 该 URL 是否指向第三方缩略图代理 */
function isProxyUrl(url: string): boolean {
  return url.includes(THUMB_PROXY_HOST);
}

/**
 * 组件报告某条候选加载失败（含超时）——由候选链消费方在翻页时调用
 *
 * 只处理一件事：失败的若是代理那条，把整个会话标记为「代理不可用」并清掉候选缓存，
 * 让后续列表直接生成原图 URL，省掉每张图那 5 秒空等。
 */
export function reportThumbnailUrlFailed(url: string): void {
  if (proxyReachable.value === false || !isProxyUrl(url)) return;
  proxyReachable.value = false;
  log.info('缩略图代理不可达，本次会话改用原图直连');
  clearThumbCache();
}

/** 组件报告某条候选加载成功：代理确实通，维持现状 */
export function reportThumbnailUrlLoaded(url: string): void {
  if (proxyReachable.value === null && isProxyUrl(url)) proxyReachable.value = true;
}

/**
 * 重置会话级探测结果，让下一张图重新试代理
 *
 * 用户手动把开关关掉再打开，语义就是「我想再试试代理」；不重置的话本会话会一直
 * 停在降级状态，直到重启应用——开关看着是开的、实际一直走原图，很难自证。
 */
function resetProxyReachability(): void {
  proxyReachable.value = null;
  clearThumbCache();
}

/** 仅供测试：重置会话级代理可达性探测结果 */
export function resetProxyReachabilityForTest(): void {
  resetProxyReachability();
}

// 缓存上限
const THUMB_CACHE_MAX_SIZE = 500;

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
      // R2 自身没有图片处理参数：缺省走 wsrv.nl 代理缩图，关掉开关才直连原图
      // （代理不通时由候选链里垫底的原图兜住，见 generateThumbnailUrls）
      thumbUrl = isR2ThumbnailProxyOn(config)
        ? `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=75&h=75&fit=cover&a=center&q=75&output=webp`
        : url;
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

  // 知乎 source 参数（仅对 *.zhimg.com 生效，其他 URL 原样返回）
  return applyZhihuSourceFromConfig(thumbUrl, config);
}

/**
 * 从 ImageMeta 生成中等缩略图 URL（便捷方法）
 *
 * 取的是**候选链首条**而不是直接调 generateMediumThumbnailUrl：后者不看会话降级状态，
 * 探测到代理不通后仍会吐出代理地址。时间轴预加载器就走这里，拿到死链会把整条记录
 * 标进 failedImages，组件随后走占位分支，候选链里垫底的原图永远没机会顶上。
 */
export function getMetaThumbnailUrl(meta: ImageMeta, config: ThumbConfig): string {
  return generateMediumThumbnailUrls(meta.primaryService, meta.primaryUrl, meta.primaryFileKey, config)[0] ?? '';
}

/**
 * ImageMeta 候选列表缓存。
 *
 * **键是 meta 对象本身，不是 meta.id** —— 这是失效策略的全部：
 * 镜像列表的任何变化（切主图床 / 移除链接 / 重试补齐）都要先写 DB，
 * 再经 emitHistoryUpdated 让视图重查，`rowToImageMeta` 于是产出一个
 * **新的 ImageMeta 对象** → WeakMap 天然未命中 → 自动重算。
 * 所以这个缓存**不需要、也不应该**接进 clearThumbCache() 或三个 cacheEvent 监听。
 *
 * 为什么不照抄下面 thumbnailCandidatesCache 的 `id` 键 + watch 失效：
 * 那套 watch 挂在 initModuleWatchers 上，只有 `useThumbCache()` 被调用时才注册，
 * 而全库唯一调用点是 useTableInteractions（历史表格视图）。时间轴/收藏页
 * 走的是本函数且从不调用 useThumbCache()，照抄会得到一个改配置、
 * 切主图床都不失效的脏缓存。
 *
 * 配置维度由 entry 里的 fingerprint 兜底，与 watch 是否注册无关。
 */
const metaCandidatesCache = new WeakMap<ImageMeta, { fingerprint: string; urls: string[] }>();

/**
 * 影响候选 URL 内容的配置指纹
 *
 * 穷举了 generateMediumThumbnailUrl 读取的全部配置维度：链接前缀模板（仅微博分支用到）、
 * 知乎 source 参数（对所有 *.zhimg.com URL 生效）与 R2 缩略图代理开关（仅 r2 分支用到）。
 * `enabledServices` 不在其中——它只决定下次上传投递哪些图床，对既有记录的候选无影响。
 *
 * 注意取的是前缀的 **template 本身**而非 enabled/selectedIndex：用户编辑当前选中前缀的
 * URL 模板时那两项都不变，只比对它们会让缩略图 URL 永久陈旧。
 *
 * ⚠️ 时间轴/收藏页只靠这个指纹失效（它们从不调用 useThumbCache()，拿不到下面那批 watch），
 * 所以**新增任何被 generate*ThumbnailUrl 读到的配置项都必须同步加进来**，漏一个就是
 * 「改了设置但那两个页面的缩略图永远不变」。这条对非配置来源的输入同样成立——
 * 会话级的 `proxyReachable` 也在指纹里，原因见下方注释。
 *
 * 分隔符用 `\0`：它不可能出现在 URL 模板或参数值里，拼接时不会与内容混淆。
 */
function candidatesConfigFingerprint(config: ThumbConfig): string {
  const template = config ? getActivePrefix(config)?.template ?? '' : '';
  const zhihu = config?.services?.zhihu;
  const zhihuEnabled = zhihu?.sourceParamEnabled ?? true;
  const zhihuValue = zhihu?.sourceParamValue?.trim() || ZHIHU_SOURCE_DEFAULT_VALUE;
  const r2Proxy = isR2ThumbnailProxyOn(config);
  // 代理可达性也要进指纹：探测到不通时候选链会少掉代理那条，
  // 时间轴/收藏页只认指纹，不带上它这两个页面会一直停在旧的「代理在前」候选上
  return `${template}\0${zhihuEnabled ? '1' : '0'}\0${zhihuValue}\0${r2Proxy ? '1' : '0'}\0${proxyReachable.value === false ? '0' : '1'}`;
}

/** 实际生成候选列表（无缓存），仅供 getMetaThumbnailCandidates 内部调用 */
function buildMetaThumbnailCandidates(meta: ImageMeta, config: ThumbConfig): string[] {
  if (meta.mirrorServices && meta.mirrorServices.length > 0) {
    const urls = meta.mirrorServices
      .flatMap(m => generateMediumThumbnailUrls(m.serviceId, m.url, m.fileKey, config))
      .filter(u => !!u);
    return [...new Set(urls)];
  }
  const single = generateMediumThumbnailUrls(meta.primaryService, meta.primaryUrl, meta.primaryFileKey, config)
    .filter(u => !!u);
  return [...new Set(single)];
}

/**
 * 从 ImageMeta 生成中等缩略图候选列表（按镜像 fallback 顺序）
 *
 * 主服务排第 0 位，其余镜像按 results 原顺序。主图失效时浏览器 onerror 会自动试下一条。
 * 无 mirrorServices 数据时降级到 [primaryUrl]，保持向后兼容。
 *
 * **引用稳定性契约**（时间轴/收藏页在模板里逐行调用本函数，每行每帧一次）：
 * - 同一个 meta 对象 + 同一份配置 → 永远返回**同一个数组引用**；
 * - meta 对象变了（DB 重查，即镜像可能已变）或配置指纹变了 → 返回新数组；
 * - 返回的数组是共享的，调用方**不得原地修改**。
 */
export function getMetaThumbnailCandidates(meta: ImageMeta, config: ThumbConfig): string[] {
  const fingerprint = candidatesConfigFingerprint(config);
  const cached = metaCandidatesCache.get(meta);
  if (cached && cached.fingerprint === fingerprint) return cached.urls;

  const urls = buildMetaThumbnailCandidates(meta, config);
  metaCandidatesCache.set(meta, { fingerprint, urls });
  return urls;
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
  let mediumUrl: string;

  switch (serviceId) {
    case 'weibo':
      // 微博：mw690 约 690px 宽
      if (fileKey) {
        mediumUrl = `https://tvax1.sinaimg.cn/mw690/${fileKey}.jpg`;
        if (config) {
          const activePrefix = getActivePrefix(config);
          if (activePrefix) {
            mediumUrl = applyPrefixTemplate(activePrefix.template, mediumUrl);
          }
        }
      } else {
        mediumUrl = url;
      }
      break;

    case 'r2':
      // 同 generateThumbnailUrl：缺省走 wsrv.nl 的 800px 版本，关掉开关才直连原图
      mediumUrl = isR2ThumbnailProxyOn(config)
        ? `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=800&q=80&output=webp`
        : url;
      break;

    case 'jd':
      // 京东：s500x0 约 500px 宽
      mediumUrl = url.replace('/jfs/', '/s500x0_jfs/');
      break;

    case 'zhihu':
      // 知乎：_qhd 后缀（高清缩略图）
      mediumUrl = url.replace(/\.(\w+)$/, '_qhd.$1');
      break;

    case 'qiyu':
      // 七鱼：thumbnail=400x0
      mediumUrl = `${url}?imageView&thumbnail=400x0`;
      break;

    case 'nami':
      // 纳米：l_500 宽度 500px
      mediumUrl = `${url}?x-tos-process=image/resize,l_500/quality,q_80/format,jpg`;
      break;

    case 'nowcoder':
      // 牛客：w_400
      mediumUrl = `${url}?x-oss-process=image%2Fresize%2Cw_400%2Cm_mfit%2Fformat%2Cpng`;
      break;

    case 'bilibili':
      // B站：800宽，80质量 WebP
      mediumUrl = `${url}@800w_80q.webp`;
      break;

    case 'chaoxing': {
      // 超星：替换域名 + 替换文件名为中等尺寸
      let cxMediumUrl = url;
      if (cxMediumUrl.includes('p.cldisk.com')) {
        cxMediumUrl = cxMediumUrl.replace('p.cldisk.com', 'p.ananas.chaoxing.com');
      }
      mediumUrl = cxMediumUrl.replace(/\/origin\.[a-zA-Z0-9]+(\?.*)?$/, '/800_0cQ80.webp');
      break;
    }

    default:
      mediumUrl = url;
  }

  return applyZhihuSourceFromConfig(mediumUrl, config);
}

/**
 * 把一条上传结果展开成缩略图候选链：首选在前，兜底在后
 *
 * Why 只有 R2 走代理时才有第二条：其余图床的缩略图与原图同域同源
 * （`?x-oss-process=` 之类的参数化 URL，或干脆就是原图），首选加载不出来时
 * 原图多半也一样加载不出来，多塞一条只会让失败路径多等一轮超时。
 *
 * R2 开代理时不同——首选指向 **第三方** wsrv.nl，它不通不代表用户自己的桶不通。
 * 把原图垫在第二位，组件的 onerror / 超时会自动落过去：代理通就享受小图省流量，
 * 代理挂了退化成加载原图（慢一点但看得见），不会像 issue #4 那样整片裂开。
 *
 * @see ThumbnailImage.vue / TimelinePhotoItem.vue 中的候选链消费逻辑
 */
function generateThumbnailUrls(
  serviceId: string,
  url: string,
  fileKey?: string,
  config?: ThumbConfig
): string[] {
  // 已经探明代理不通就别再产出代理条目了，否则每张图都要白等一轮超时
  if (proxyReachable.value === false && serviceId === 'r2') return [url];

  const primary = generateThumbnailUrl(serviceId, url, fileKey, config);
  if (serviceId === 'r2' && isR2ThumbnailProxyOn(config) && primary !== url) {
    return [primary, url];
  }
  return [primary];
}

/** 同 {@link generateThumbnailUrls}，中等尺寸（时间轴/收藏页/悬浮预览）版本 */
function generateMediumThumbnailUrls(
  serviceId: string,
  url: string,
  fileKey?: string,
  config?: ThumbConfig
): string[] {
  if (proxyReachable.value === false && serviceId === 'r2') return [url];

  const primary = generateMediumThumbnailUrl(serviceId, url, fileKey, config);
  if (serviceId === 'r2' && isR2ThumbnailProxyOn(config) && primary !== url) {
    return [primary, url];
  }
  return [primary];
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
        candidates.push(...generateThumbnailUrls(primary.serviceId, primary.result.url, primary.result.fileKey, config));
      }
    }

    // 添加其他成功上传的图床
    historyItem.results.forEach((r: HistoryResultEntry) => {
      if (r.status === 'success' && r.result?.url && r.serviceId !== historyItem.primaryService) {
        candidates.push(...generateThumbnailUrls(r.serviceId, r.result.url, r.result.fileKey, config));
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
        candidates.push(...generateThumbnailUrls(serviceId, progress.link, fileKey, config));
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
 * 清空缩略图缓存
 */
function clearThumbCache(): void {
  thumbnailCandidatesCache.clear();
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

  // 同 getMetaThumbnailUrl：取候选链首条，让悬浮预览/灯箱预热也跟随会话降级状态，
  // 否则代理不通后悬停 R2 那几行仍会拿到代理地址，预览加载失败直接隐藏
  return generateMediumThumbnailUrls(
    result.serviceId,
    result.result.url,
    result.result.fileKey,
    config
  )[0] ?? '';
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

  return applyZhihuSourceFromConfig(result.result.url, config);
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
): void {
  if (watchersInitialized) return;
  watchersInitialized = true;

  const scope = effectScope(true);
  scope.run(() => {
    onCacheEventType<HistoryEventData>('history-updated', (data) => {
      const ids = data?.ids;
      if (!ids || ids.length === 0) {
        clearThumbCache();
        return;
      }
      for (const id of ids) {
        thumbnailCandidatesCache.delete(id);
      }
    }).catch(e => log.warn('history-updated listener registration failed; updated thumb cache entries will rely on LRU fallback:', e));

    // 事件驱动的增量清理：删除/清空事件定向移除缓存。
    // 监听注册失败时，滞留条目靠 thumbnailCandidatesCache 的 LRU 上限（THUMB_CACHE_MAX_SIZE）自动淘汰兜底
    onCacheEventType<HistoryEventData>('history-deleted', (data) => {
      const ids = data?.ids;
      if (!ids || ids.length === 0) return;
      for (const id of ids) {
        thumbnailCandidatesCache.delete(id);
      }
    }).catch(e => log.warn('history-deleted 监听注册失败，已删除项将依赖 LRU 淘汰兜底:', e));

    onCacheEventType('history-cleared', () => {
      thumbnailCandidatesCache.clear();
    }).catch(e => log.warn('history-cleared 监听注册失败，清空后旧缓存将依赖 LRU 淘汰兜底:', e));

    // 监听影响 URL 的前缀配置项变化
    watch(
      () => configManager.config.value?.linkPrefixConfig?.enabled,
      clearThumbCache
    );

    watch(
      () => configManager.config.value?.linkPrefixConfig?.selectedIndex,
      clearThumbCache
    );

    // 知乎 source 参数开关/值变化时清缓存，确保缩略图 URL 立即更新
    // 注意：用多源写法让 Vue 对每个原始值单独比对；若用单 getter 返回数组，
    // 每次执行都生成新数组引用会导致任意配置保存都误触发清缓存。
    watch(
      [
        () => configManager.config.value?.services?.zhihu?.sourceParamEnabled,
        () => configManager.config.value?.services?.zhihu?.sourceParamValue,
      ],
      clearThumbCache
    );

    // R2 缩略图代理开关：直连原图 ↔ wsrv.nl 代理，两者 URL 完全不同，必须立即失效。
    // 用 resetProxyReachability 而非 clearThumbCache：用户手动拨这个开关就是「我要重新试」，
    // 只清缓存的话会话仍停在降级态，开关看着开着、实际一直走原图。
    watch(
      () => configManager.config.value?.services?.r2?.thumbnailProxyEnabled,
      resetProxyReachability
    );
  });
}

/**
 * 缩略图缓存 composable
 */
export function useThumbCache() {
  const configManager = useConfigManager();

  initModuleWatchers(configManager);

  return {
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
