// 状态栏那一行：每种状态的标题与说明照 HealthScreen.dc.html 的 SB 表
import { describe, expect, it } from 'vitest';
import { statusText, type StatusInput } from '@/views/health/healthStatus';
import type { HealthSummary } from '@/views/health/healthModel';

const summary: HealthSummary = { total: 12_483, dead: 21, fixable: 15, unfixable: 6, limited: 13, singleCopy: 0, lostForGood: 4, everChecked: true, lastCheckedAt: Date.now() - 3 * 86_400_000, links: 25_714 };
const base: StatusInput = {
  state: 'problems',
  summary,
  dead: [],
  progress: { checked: 1024, total: 3500, waitingHost: 'weibo' },
  repair: { done: 9, total: 15, docCount: 3, fixedThisSession: 0 },
  hostName: (id) => ({ weibo: '微博', r2: 'Cloudflare R2' } as Record<string, string>)[id] ?? id,
};

describe('statusText', () => {
  it('尚未检测：共 N 张 · 只读操作，约需 N 分钟', () => {
    expect(statusText({ ...base, state: 'never' })).toEqual({ title: '尚未检测', sub: '共 12,483 张图片 · 只读操作，约需 15 分钟' });
    expect(statusText({ ...base, state: 'never', summary: { ...summary, links: 10 } }).sub).toBe('共 12,483 张图片 · 只读操作，不到 1 分钟');
  });

  it('正在检测：已查 / 总数 · 等待 X 响应 · 已发现 N 张失效（图床名是英文时补空格）', () => {
    expect(statusText({ ...base, state: 'checking', summary: { ...summary, dead: 3 } }).sub).toBe('1,024 / 3,500 · 等待微博响应 · 已发现 3 张失效');
    expect(statusText({ ...base, state: 'checking', progress: { checked: 0, total: 9, waitingHost: 'r2' }, summary: { ...summary, dead: 0 } }).sub)
      .toBe('0 / 9 · 等待 Cloudflare R2 响应');
  });

  it('已暂停：继续后将从中断处检测', () => {
    expect(statusText({ ...base, state: 'paused', summary: { ...summary, dead: 3 } }))
      .toEqual({ title: '检测已暂停', sub: '1,024 / 3,500 · 已发现 3 张失效 · 继续后将从中断处检测' });
  });

  it('正在修复：9 / 15 · 同时更新 3 个文档中的旧链接；没有文档时只写进度', () => {
    expect(statusText({ ...base, state: 'fixing' }).sub).toBe('9 / 15 · 同时更新 3 个文档中的旧链接');
    expect(statusText({ ...base, state: 'fixing', repair: { ...base.repair, docCount: 0 } }).sub).toBe('9 / 15');
  });

  it('有失效 / 全部正常', () => {
    expect(statusText(base).title).toBe('21 张图片失效');
    expect(statusText({ ...base, state: 'good' })).toEqual({ title: '全部正常', sub: '12,483 张图片均可访问 · 上次检测：3 天前' });
  });
});
