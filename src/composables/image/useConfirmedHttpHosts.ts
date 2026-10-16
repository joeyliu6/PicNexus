// 已确认可走明文 HTTP 的图床域名，交给 ThumbnailImage 的 confirmedHttpHosts。
// 名单内容不变时沿用同一个 Set：配置保存很频繁，每次换新引用会让加载失败的缩略图白重试一轮（见 confirmedHttpHostsKey）。

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { confirmedHttpHostsKey, getConfirmedHttpHosts } from '@/security/networkPolicy';

type HostSource = Parameters<typeof getConfirmedHttpHosts>[0];

export function useConfirmedHttpHosts(config: MaybeRefOrGetter<HostSource>): ComputedRef<ReadonlySet<string>> {
  let current: Set<string> | null = null;
  return computed(() => {
    const next = getConfirmedHttpHosts(toValue(config));
    if (!current || confirmedHttpHostsKey(next) !== confirmedHttpHostsKey(current)) current = next;
    return current;
  });
}
