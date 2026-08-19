/**
 * 缩略图候选链消费逻辑（时间轴 / 收藏页共用）
 *
 * 候选链由 useThumbCache 产出（主服务在前、镜像在后；R2 开代理时还会在代理后面
 * 垫一条原图）。本 composable 负责「怎么消费」：先过 safeImageUrl 这道安全闸，
 * 再按顺序试、失败往后翻、翻到底才算失败，并把结果回报给 useThumbCache 用于会话级降级。
 *
 * Why 抽出来：时间轴和收藏页此前各写了一份逐字相同的 currentSrcIndex + handleImgError，
 * 结果超时兜底只补进了时间轴那份，收藏页在代理卡死时会一直停在骨架屏。同一套判据
 * 散在两个组件里，修一处漏一处是必然的。
 */
import { ref, computed, watch, watchEffect, onMounted, onUnmounted, type Ref } from 'vue';
import { safeImageUrl } from '../security/networkPolicy';
import { reportThumbnailUrlFailed, reportThumbnailUrlLoaded } from './useThumbCache';

/**
 * 单条候选的加载超时（毫秒）
 *
 * Why 光靠 onerror 不够：候选链是靠 `<img>` 的 error 事件往后翻的，但「连不上」和
 * 「报错」不是一回事。R2 开着第三方代理时首选指向 wsrv.nl，那条链路卡死的表现是
 * TCP 连接迟迟不返回——浏览器可能几十秒才放弃，这期间格子里一直是骨架屏。
 * 到点主动翻下一条，让垫底的原图尽快顶上。
 */
export const THUMB_LOAD_TIMEOUT_MS = 5000;

interface UseThumbnailFallbackChainOptions {
  /** 候选 URL 列表（响应式 getter，通常是 `() => props.thumbnailUrls`） */
  urls: () => string[];
  /**
   * 当前 `<img>` 是否已渲染且仍在等加载
   *
   * 用来决定要不要计时。各视图的判据不同（时间轴要排除 fast 滚动模式下不渲染的图、
   * 收藏页看 imageState），所以由调用方给。判断错的代价是：对根本没在加载的图计时，
   * 会把整屏候选误翻一遍。
   */
  isWaiting: () => boolean;
  /** 候选全部试完仍失败时回调，由调用方决定怎么向上报 */
  onExhausted: (event?: Event) => void;
  /**
   * 承载 `<img>` 的元素，用于视口判定（可选）
   *
   * **只要 `<img>` 带 `loading="lazy"` 就必须传。** 懒加载的图在视口外浏览器压根不发
   * 请求，对它计时等于凭空判超时：收藏页一次渲染 80 格、无虚拟化，不传这个引用会让
   * 视口外那 60 多张在 5 秒后集体「失败」，把明明通着的代理判死。
   * 不传则视为「总在视口内」——适用于虚拟列表这类只渲染窗口内元素且不用 lazy 的场景。
   */
  elementRef?: Ref<HTMLElement | null>;
  /**
   * 已被用户显式确认过可走明文 HTTP 的主机名集合（响应式 getter，可选）
   *
   * 由调用方用 `getConfirmedHttpHosts(config)` 从配置里取（见 FavoritesView / TimelineView），
   * 与 ThumbnailImage 的 `confirmedHttpHosts` prop 同一份数据、同一个去处：
   * 交给 {@link safeImageUrl} 判断某个明文 HTTP 地址算不算「用户担保过」。
   *
   * 不传等于「一个都没确认」——公网明文 HTTP 候选会被过滤掉，这是安全的默认值。
   *
   * 名单变大（用户在设置页刚确认完域名）时，本 composable 只负责重新纳入候选、回到第 0 条；
   * **调用方已经记下的「失败」状态得由调用方自己撤销**——那状态属于父组件（收藏页的
   * `imageStates`、时间轴的 `failedImages`），composable 够不着。两个视图都已接上：
   * 它们 watch `confirmedHttpHostsKey(...)`，名单内容真变了才清失败态。
   * 新增消费方若也记失败状态，照着接一条，否则确认完域名那一屏要等重启才恢复。
   */
  confirmedHttpHosts?: () => ReadonlySet<string> | undefined;
}

/**
 * 候选列表是否真的换了内容
 *
 * Why 不能只比引用：QueueItem 的候选每次都是现算的新数组（状态会变，getThumbnailCandidates
 * 明确不缓存），上传进度每 tick 一次就产出一份内容完全相同的新数组。只比引用会把这些 tick
 * 全当成「换图了」，把已经加载好的图重新拽回候选 0。
 *
 * 提到模块顶层导出，供 ThumbnailImage.vue 复用：它自持 loading/error 状态、"是否在等加载"
 * 由自己的 IntersectionObserver 决定（而非父组件传），没法直接用整个 composable；
 * 但「候选算不算换了」这条判据必须是同一份——此前两边各写一遍，文档只能靠一句
 * 「必须同步」维系，正是下次只改一边的隐患。
 */
export function hasUrlListChanged(next: string[], prev?: string[]): boolean {
  if (!prev || next.length !== prev.length) return true;
  return next.some((url, index) => url !== prev[index]);
}

export function useThumbnailFallbackChain(options: UseThumbnailFallbackChainOptions) {
  const currentSrcIndex = ref(0);

  /**
   * 过掉不该进 `<img>` 的候选
   *
   * Why 这里必须过一遍：2026-08-19 为支持只有 HTTP 域名的图床（又拍云免费测试域名
   * 给不出 HTTPS，要 HTTPS 得绑备案域名），CSP 的 `img-src` 放开了 `http:`。
   * 放开之前 CSP 是收藏页 / 时间轴唯一的图片闸门——这两个视图不像 ThumbnailImage
   * 那样过 `safeImageUrl`；放开之后它们**一道闸都没有**，链路本地 / 云元数据
   * （169.254.169.254 那一类）能被直接塞进 `<img>`。见
   * `docs/audits/http-image-host-2026-08-19.md`。
   *
   * Why 不担心「返回新数组把候选拽回第 0 条」：下面的 watch 用 hasUrlListChanged
   * **逐项比内容、不比引用**（正因为队列项的候选本来就每次现算新数组）。代价只是
   * watch 的 getter 多返回几个新引用、回调多跑几次，真正的重置仍由内容判据挡着。
   * 引用稳定性契约是上游 useThumbCache.getMetaThumbnailCandidates 的事，与这里无关，
   * **不要为此建记忆化机制**。
   *
   * 被过滤掉的候选是直接从链上剔除、而不是「翻到它再跳过」：它压根没发出过请求，
   * 不能进 pendingFailure 当失败证据，否则会把无辜的服务判死、整个会话降级成原图直连。
   */
  const safeUrls = computed(() => {
    const confirmed = options.confirmedHttpHosts?.();
    const result: string[] = [];
    for (const url of options.urls()) {
      const safe = safeImageUrl(url, confirmed);
      if (safe) result.push(safe);
    }
    return result;
  });

  const currentSrc = computed(() => safeUrls.value[currentSrcIndex.value] ?? '');

  /** 元素是否已进入过视口（没传 elementRef 时恒为 true，见该选项说明） */
  const hasEnteredViewport = ref(!options.elementRef);
  let observer: IntersectionObserver | null = null;

  /**
   * 上一条刚失败、但还没定性的候选
   *
   * Why 不当场上报：`reportThumbnailUrlFailed` 会把整个会话降级成原图直连，而单看
   * 一条失败根本分不清是「代理不通」还是「代理背后那张图被删了」——用户在桶里删对象
   * 是常规操作，wsrv.nl 对失效上游同样返回错误。一张死图就把全会话的代理关掉，
   * 等于路上有辆抛锚的车就宣布整条高速封闭。
   *
   * 候选链天然提供了区分手段：**前一条失败、后一条成功**，才说明问题出在前一条那个
   * 服务上；如果后面全都失败，那就是这张图本身没了，与代理无关。
   */
  let pendingFailure: string | null = null;

  /**
   * 候选被安全过滤清空时立刻收尾
   *
   * 不收尾的话格子会永远停在骨架屏：currentSrc 为空，`<img>` 压根不渲染，
   * 也就永远不会有 error 事件把状态推到「失败」，用户看到的是一格转不完的加载。
   *
   * 只在**原始候选非空**时才算数：原始就是空，说明上游还没算出候选（或这条记录本来
   * 就没有可用链接），那是本次改动之前就有的行为，贸然报失败会把还没轮到的格子提前判死。
   */
  function reportIfAllFiltered(): void {
    if (safeUrls.value.length === 0 && options.urls().length > 0) options.onExhausted();
  }

  // 候选列表换了内容才回到第 0 条：上游对同一份数据返回的是稳定引用，
  // 但降级重算后会产出新数组，这时必须从头试。
  // 比的是**过滤后**的列表：被过滤掉的候选进不了 `<img>`，它变没变对这条链毫无意义。
  watch(safeUrls, (next, prev) => {
    if (hasUrlListChanged(next, prev)) {
      currentSrcIndex.value = 0;
      pendingFailure = null;
      reportIfAllFiltered();
    }
  });

  /** 翻到下一条候选；返回 false 表示已经翻到底了 */
  function advance(): boolean {
    const next = currentSrcIndex.value + 1;
    if (next >= safeUrls.value.length) return false;
    currentSrcIndex.value = next;
    return true;
  }

  /** 当前候选失败：记下它，翻下一条；翻不动了就交给调用方收尾 */
  function failCurrent(event?: Event): void {
    const failed = currentSrc.value;
    if (advance()) {
      // 还有后路，等后路的结果再决定这条算不算「服务不可用」
      if (failed) pendingFailure = failed;
      return;
    }
    // 候选全试完了 = 这张图本身没了，不能赖到代理头上
    pendingFailure = null;
    options.onExhausted(event);
  }

  function handleError(event?: Event): void {
    failCurrent(event);
  }

  function handleLoad(): void {
    if (pendingFailure) {
      // 前一条挂、这一条通 → 问题确实出在前一条那个服务（若它是代理，会话就此降级）
      reportThumbnailUrlFailed(pendingFailure);
      pendingFailure = null;
    }
    reportThumbnailUrlLoaded(currentSrc.value);
  }

  onMounted(() => {
    // 放在挂载后而非 setup 期间：onExhausted 会往父组件 emit，setup 阶段父组件还在
    // patch 自己的子树，这时改父组件状态容易引出「渲染中改渲染依赖」那类连锁更新。
    reportIfAllFiltered();

    const el = options.elementRef?.value;
    if (!el) return;
    // 环境没有 IntersectionObserver（如 jsdom 单测）时退化成「立即视为可见」：
    // 超时兜底照常工作，只是失去了「视口外不计时」这层守卫。
    if (typeof IntersectionObserver === 'undefined') {
      hasEnteredViewport.value = true;
      return;
    }
    observer = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      hasEnteredViewport.value = true;
      observer?.disconnect();
      observer = null;
    });
    observer.observe(el);
  });

  onUnmounted(() => {
    observer?.disconnect();
    observer = null;
  });

  // 超时兜底。三个前提缺一不可（用 watchEffect 而非 watch：任一前提变化都要重新
  // 评估并清掉旧计时）：
  // 1. **已进入视口**——见 elementRef 的说明，懒加载图在视口外根本没发请求；
  // 2. **确实在等加载**——见 isWaiting 的说明；
  // 3. **后面还有候选**——最后一条翻不动，掐断只会把「慢但最终能成」变成「直接失败」。
  watchEffect((onCleanup) => {
    const hasNext = currentSrcIndex.value < safeUrls.value.length - 1;
    if (!hasEnteredViewport.value || !options.isWaiting() || !currentSrc.value || !hasNext) return;

    const timer = setTimeout(() => failCurrent(), THUMB_LOAD_TIMEOUT_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return { currentSrc, handleError, handleLoad };
}
