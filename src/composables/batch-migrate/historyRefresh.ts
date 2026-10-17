/**
 * 批量迁移 · 落库后的视图刷新广播
 *
 * 不变量（见 docs/flows/mirror-fallback-flow.md）：**先写 DB，再经 emitHistoryUpdated
 * 让视图重查**。迁移链路原来只写库不广播，历史表格「备份数」、灯箱链接菜单、
 * 时间轴候选都要等重启才看得到新备份。正确范例：`src/services/RetryService.ts`。
 *
 * 粒度按批而不是按条：`useTimelineDayPagination` 收到 history-updated 会无条件
 * `reloadAll()`（无防抖），逐条广播等于把整棵时间轴重刷 N 次。
 */
import { invalidateCache } from '@/composables/history/useHistory';
import { emitHistoryUpdated } from '@/events/cacheEvents';

/**
 * 广播「这批历史记录已更新」
 *
 * @param ids 已成功落库的 historyId；空数组直接返回，不发空事件
 */
export async function notifyMigrationPersisted(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  invalidateCache();
  // emitCacheEvent 内部已吞异常，广播失败不会中断迁移
  await emitHistoryUpdated(ids);
}
