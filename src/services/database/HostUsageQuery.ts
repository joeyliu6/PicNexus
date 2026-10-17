// 图床页「使用情况」（HostsScreen.dc.html）：传到这里几张、最先完成几张、失效几张、近 14 天每天几张。
// 「最先完成」= 复制时使用的链接来自这个图床（primary_service）；「失效」与图库「失效」筛选同一口径（COPY_LINK_HEALTH_SQL）。

import type Database from '@tauri-apps/plugin-sql';
import { COPY_LINK_HEALTH_SQL } from './TimelineQueryService';

export interface HostUsage {
  uploaded: number;
  firstDone: number;
  dead: number;
  /** 近 14 天每天上传到这个图床的张数，最后一个是今天（按本机时区分天） */
  last14: number[];
}

const DAYS = 14;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function getHostUsageQuery(db: Database, hostId: string, now: number = Date.now()): Promise<HostUsage> {
  const onHost = 'EXISTS (SELECT 1 FROM json_each(successful_service_ids) WHERE value = $1)';
  const [counts] = await db.select<Array<{ uploaded: number; first_done: number; dead: number }>>(
    `SELECT
       COUNT(CASE WHEN ${onHost} THEN 1 END) AS uploaded,
       COUNT(CASE WHEN primary_service = $1 THEN 1 END) AS first_done,
       COUNT(CASE WHEN primary_service = $1 AND (${COPY_LINK_HEALTH_SQL}) = 'dead' THEN 1 END) AS dead
     FROM history_items`,
    [hostId],
  );

  // 每天的起点逐天推（不按 24 小时算，夏令时那天也分得对）
  const starts: number[] = [];
  let day = startOfLocalDay(now);
  for (let i = 0; i < DAYS; i++) {
    starts.unshift(day);
    const prev = new Date(day);
    prev.setDate(prev.getDate() - 1);
    day = prev.getTime();
  }
  const recent = await db.select<Array<{ timestamp: number }>>(
    `SELECT timestamp FROM history_items WHERE timestamp >= $2 AND ${onHost}`,
    [hostId, starts[0]],
  );
  const last14 = new Array<number>(DAYS).fill(0);
  for (const { timestamp } of recent) {
    let index = DAYS - 1;
    while (index > 0 && timestamp < starts[index]) index--;
    last14[index]++;
  }

  return { uploaded: counts?.uploaded ?? 0, firstDone: counts?.first_done ?? 0, dead: counts?.dead ?? 0, last14 };
}
