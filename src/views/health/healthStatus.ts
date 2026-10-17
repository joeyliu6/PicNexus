// 状态栏那一行（HealthScreen.dc.html SB 表）：每种状态写什么标题、什么说明。纯函数。

import { joinCjk as cat } from '@/utils/cjkSpacing';
import { formatCalendarDate, formatCount } from '@/utils/formatters';
import { CHECK_SECONDS_PER_LINK, minutesText, problemSubline, type HealthImage, type HealthSummary } from './healthModel';
import type { CheckProgressView, HealthPageState } from './useLinkHealth';

export interface StatusInput {
  state: HealthPageState;
  summary: HealthSummary;
  dead: readonly HealthImage[];
  progress: CheckProgressView;
  repair: { done: number; total: number; docCount: number; fixedThisSession: number };
  hostName: (id: string) => string;
}

/** 「刚刚」「3 小时前」「3 天前」；一周以上写日期（「10月9日」，与全页日期写法一致） */
export function checkedAgo(at: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} 天前` : formatCalendarDate(at, now);
}

/** 「约需 15 分钟」；很快的写「不到 1 分钟」 */
function checkDuration(links: number): string {
  const seconds = links * CHECK_SECONDS_PER_LINK;
  return seconds < 60 ? '不到 1 分钟' : `约需 ${minutesText(seconds)}`;
}

export function statusText(input: StatusInput): { title: string; sub: string } {
  const { state, summary, progress, repair, hostName } = input;
  const found = summary.dead > 0 ? `已发现 ${formatCount(summary.dead)} 张失效` : '';
  const counted = `${formatCount(progress.checked)} / ${formatCount(progress.total)}`;
  switch (state) {
    case 'loading':
      return { title: '', sub: '' };
    case 'error':
      return { title: '未能读取检测记录', sub: '请稍后重试' };
    case 'never':
      return { title: '尚未检测', sub: `共 ${formatCount(summary.total)} 张图片 · 只读操作，${checkDuration(summary.links)}` };
    case 'checking':
      return {
        title: '正在检测',
        sub: [counted, progress.waitingHost ? cat('等待', hostName(progress.waitingHost), '响应') : '', found].filter(Boolean).join(' · '),
      };
    case 'paused':
      return { title: '检测已暂停', sub: [counted, found, '继续后将从中断处检测'].filter(Boolean).join(' · ') };
    case 'fixing':
      return {
        title: '正在修复',
        sub: [`${formatCount(repair.done)} / ${formatCount(repair.total)}`, repair.docCount ? `同时更新 ${formatCount(repair.docCount)} 个文档中的旧链接` : '']
          .filter(Boolean).join(' · '),
      };
    case 'problems':
      return { title: `${formatCount(summary.dead)} 张图片失效`, sub: problemSubline(summary, input.dead, repair.fixedThisSession, hostName) };
    case 'good':
      return {
        title: '全部正常',
        // 可能受限的不算失效，但单独说一句（交接说明 13.4「单独计数」）
        sub: [
          `${formatCount(summary.total)} 张图片均可访问`,
          summary.limited > 0 ? `另有 ${formatCount(summary.limited)} 张可能受限` : '',
          summary.lastFullCheckAt ? `上次检测：${checkedAgo(summary.lastFullCheckAt)}` : '',
        ]
          .filter(Boolean).join(' · '),
      };
  }
}
