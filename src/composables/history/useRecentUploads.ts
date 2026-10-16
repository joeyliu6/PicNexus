// 最近几条上传记录（首页「最近上传 · 更早」、命令面板空输入时的「最近上传」）
// 模块级单例：读历史库最新几条，图库有新增 / 变动（history-updated）时刷新。

import { shallowRef } from 'vue';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { HistoryItem } from '@/config/types';
import { historyDB } from '@/services/database';
import { onCacheEventType } from '@/events/cacheEvents';
import { createLogger } from '@/utils/logger';

const log = createLogger('RecentUploads');

const RECENT_LIMIT = 8;
/** 首页「更早」要去掉的那些（这次打开应用后传的，已经在上面列着）：多取这么多条，「更早」才不会被挤空 */
let reserved = 0;

const recent = shallowRef<HistoryItem[]>([]);
/** 图库里一共有几张（判断「第一次使用」：一张记录都没有） */
const total = shallowRef<number | null>(null);
let unlisten: UnlistenFn | null = null;

async function refresh(): Promise<void> {
  try {
    const page = await historyDB.getPage({ page: 1, pageSize: RECENT_LIMIT + reserved });
    recent.value = page.items;
    total.value = page.total;
  } catch (error) {
    log.warn('读取最近上传失败', error);
  }
}

export function useRecentUploads() {
  async function install(): Promise<UnlistenFn> {
    await refresh();
    if (!unlisten) unlisten = await onCacheEventType('history-updated', () => { void refresh(); });
    return () => {
      unlisten?.();
      unlisten = null;
    };
  }

  /** 这次会话已经列出了 count 条记录：往前多读这么多 */
  async function reserve(count: number): Promise<void> {
    if (count === reserved) return;
    reserved = count;
    await refresh();
  }

  return { recent, total, refresh, install, reserve };
}
