/**
 * useGatedImageUrls — 历史相关视图取「图片地址」的统一入口
 *
 * 这里只做一件事：把从 `HistoryItem` 推导出来的地址过一遍 {@link safeImageUrl}，
 * 拦下的返回空串。
 *
 * ## 为什么需要它
 *
 * CSP 的 `img-src` 放开 `http:` 之前（见 2ab296af），应用里所有加载图片的路径都有
 * CSP 这道兜底：私网地址、云元数据地址（`169.254.169.254`）、未经确认的明文 HTTP
 * 域名，一律在发请求之前就被浏览器挡掉。为了让又拍云和局域网 WebDAV 图床能显示，
 * 那道网被整体撤掉了——**只有走过 `safeImageUrl` 的路径还有闸**。
 *
 * 撤网当时补的是缩略图（`ThumbnailImage` / `useThumbnailFallbackChain`），
 * 但灯箱大图、表格悬停预览、±1 预热这三条路各自直接消费原始 URL，一道闸都不剩。
 * 后果不止于安全：同一个未确认的 HTTP 域名，在收藏页缩略图上裂图、在历史页悬停
 * 却看得见，用户只会以为某个页面坏了。判据必须同源。
 *
 * ## 为什么返回空串而不是抛错
 *
 * 空串是下游各处**早就在处理**的「没有地址」：`warmImage` 直接 return、
 * 悬停预览收起、`resolveAdjacentUrl` 当没有相邻图、`openPswp` 不开灯箱。
 * 换成抛错反而要求每个调用点新写一个 catch 分支。
 *
 * 需要把「被拦下」和「本来就没有」区分开的调用方（比如灯箱要弹一句解释），
 * 自己留一份未过闸的原值对比即可，见 `HistoryLightbox.vue` 的 `rawImageSrc`。
 */
import { computed } from 'vue';
import type { HistoryItem } from '../../config/types';
import { getPrimaryImageUrl } from '../../utils/imageUrl';
import { getConfirmedHttpHosts, safeImageUrl } from '../../security/networkPolicy';
import { useConfigManager } from '../useConfig';
import { useThumbCache } from '../useThumbCache';

export function useGatedImageUrls() {
  const configManager = useConfigManager();
  const thumbCache = useThumbCache();

  /**
   * 已确认可走明文 HTTP 的主机名
   *
   * 与视图传给 `ThumbnailImage` 的 `confirmedHttpHosts` prop 同源（同一个
   * `getConfirmedHttpHosts`），所以缩略图与悬停 / 灯箱 / 预热永远给出一致的结论。
   */
  const confirmedHttpHosts = computed(() => getConfirmedHttpHosts(configManager.config.value));

  /** 过安全闸；被拦下返回空串 */
  function gateImageUrl(url: string | null | undefined): string {
    return safeImageUrl(url, confirmedHttpHosts.value) ?? '';
  }

  /** 原图地址（按主图床解析），已过闸 */
  function getItemImageUrl(item: HistoryItem): string {
    return gateImageUrl(getPrimaryImageUrl(item, configManager.config.value));
  }

  /** 中图（LQIP）地址，已过闸；悬停预览与模糊占位共用 */
  function getItemMediumUrl(item: HistoryItem): string {
    return gateImageUrl(thumbCache.getMediumImageUrl(item));
  }

  return { confirmedHttpHosts, gateImageUrl, getItemImageUrl, getItemMediumUrl };
}
