// 图床详情的「使用情况」（HostsScreen.dc.html）：换图床、历史记录变化（上传、补充备份、检测）时重读。

import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { onCacheEvent } from '@/events/cacheEvents';
import { historyDB } from '@/services/database';
import type { HostUsage } from '@/services/database/HostUsageQuery';
import { createLogger } from '@/utils/logger';

const log = createLogger('HostUsage');

/** 历史事件一阵一阵来时合并成一次查询 */
const REFRESH_DELAY_MS = 500;

export function useHostUsage(hostId: Ref<string | null>) {
  const usage = ref<HostUsage | null>(null);
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function load(): Promise<void> {
    const id = hostId.value;
    const mine = ++seq;
    if (!id) {
      usage.value = null;
      return;
    }
    try {
      const next = await historyDB.getHostUsage(id);
      if (mine === seq) usage.value = next;
    } catch (error) {
      log.warn(`读取 ${id} 的使用情况失败`, error);
    }
  }

  watch(hostId, (id, previous) => {
    // 换了图床先清空，免得短暂显示上一个图床的数字
    if (id !== previous) usage.value = null;
    void load();
  }, { immediate: true });

  let unlisten: (() => void) | undefined;
  let disposed = false;
  onCacheEvent((event) => {
    if (event.type !== 'history-updated' && event.type !== 'history-deleted' && event.type !== 'history-cleared') return;
    clearTimeout(timer);
    timer = setTimeout(() => void load(), REFRESH_DELAY_MS);
  }).then((fn) => { if (disposed) fn(); else unlisten = fn; }).catch((error) => log.warn('历史事件监听失败', error));

  onScopeDispose(() => {
    disposed = true;
    unlisten?.();
    clearTimeout(timer);
  });

  return { usage, reload: load };
}
