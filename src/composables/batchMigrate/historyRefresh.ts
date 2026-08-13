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
import { invalidateCache } from '../useHistory';
import { emitHistoryUpdated } from '../../events/cacheEvents';

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

/**
 * 攒 id 的缓冲区：迁移主循环每条成功就 add，一个 chunk 处理完（以及收尾）flush 一次。
 * 把「什么时候发」和「发给谁」留在调用方，「发多少次」的节流责任收在这里。
 */
export function createMigrationRefreshBuffer() {
  const pending = new Set<string>();
  return {
    add(id: string): void { pending.add(id); },
    /** 发出并清空；不 await——广播不该拖慢下一个 chunk 的处理 */
    flush(): void {
      if (pending.size === 0) return;
      const ids = [...pending];
      pending.clear();
      void notifyMigrationPersisted(ids);
    },
  };
}
