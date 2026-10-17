// 侧栏「链接健康」的琥珀点（HealthScreen.dc.html 图标栏，交接说明 8.3「发现失效时在侧栏提示」）：
// 复制时使用的那份失效的图片数 > 0。与图库「失效」筛选同一条 SQL，不用先读全部检测行。
// 启动时、历史记录变了、每次检测结束后刷新。

import { ref, watch } from 'vue';
import { onCacheEvent } from '@/events/cacheEvents';
import { useLinkCheckManager } from '@/composables/link-check/useLinkCheck';
import { historyDB } from '@/services/database';
import { createLogger } from '@/utils/logger';

const log = createLogger('HealthBadge');

const deadCount = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined;

async function refresh(): Promise<void> {
  try {
    deadCount.value = (await historyDB.getIdsByFilter({ statusFilter: ['dead'] })).length;
  } catch (error) {
    log.warn('读取失效图片数失败', error);
  }
}

/** 历史事件可能一阵一阵来（补充备份每 20 张一次）：合并成一次查询 */
function refreshSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), 500);
}

export function useHealthBadge() {
  return { deadCount };
}

/** 在外壳里装一次；返回卸载函数 */
export function installHealthBadge(): () => void {
  const linkCheck = useLinkCheckManager();
  void refresh();
  const stopWatch = watch(linkCheck.isChecking, (checking) => { if (!checking) refreshSoon(); });
  let unlisten: (() => void) | undefined;
  let disposed = false;
  onCacheEvent((event) => {
    if (event.type === 'history-updated' || event.type === 'history-deleted' || event.type === 'history-cleared') refreshSoon();
  }).then((fn) => { if (disposed) fn(); else unlisten = fn; }).catch((error) => log.warn('历史事件监听失败', error));
  return () => {
    disposed = true;
    stopWatch();
    unlisten?.();
    clearTimeout(timer);
  };
}
