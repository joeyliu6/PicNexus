import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCheckVerdict } from '@/composables/link-check/checkVerdict';
import type { ImageKind, ImageSummary } from '@/composables/link-check/imageHealth';

const NOW = new Date(2026, 9, 14, 12, 0, 0).getTime();
const DAY = 86_400_000;

function summary(overrides: Partial<Omit<ImageSummary, 'kinds'>> & { kinds?: Partial<Record<ImageKind, number>> } = {}): ImageSummary {
  const kinds = { unchecked: 0, ok: 0, fixable: 0, broken: 0, limited: 0, 'backup-broken': 0, ...overrides.kinds };
  const images = overrides.images ?? Object.values(kinds).reduce((a, b) => a + b, 0);
  return {
    images,
    links: overrides.links ?? images,
    uncheckedLinks: overrides.uncheckedLinks ?? 0,
    lostForGood: overrides.lostForGood ?? 0,
    singleCopy: overrides.singleCopy ?? 0,
    lastCheckedAt: overrides.lastCheckedAt === undefined ? NOW - 3 * DAY : overrides.lastCheckedAt,
    kinds,
  };
}

const idle = (s: ImageSummary) => buildCheckVerdict({ summary: s, running: null, loadingRest: false });

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { vi.restoreAllMocks(); });

describe('buildCheckVerdict', () => {
  it('一张图都没有：说明情况，不给按钮', () => {
    const v = idle(summary({ images: 0, links: 0, lastCheckedAt: null }));
    expect(v).toMatchObject({ hero: true, title: '还没有图片可以检查', primary: null, secondary: null });
  });

  it('从没检查过：大号引导，一个「开始检查」，说清会做什么、不会改东西', () => {
    const v = idle(summary({ images: 12, links: 17, uncheckedLinks: 17, kinds: { unchecked: 12 }, lastCheckedAt: null }));
    expect(v.hero).toBe(true);
    expect(v.title).toBe('检查图片还能不能打开');
    expect(v.subtitle).toBe('逐个访问你上传过的 12 张图片（17 个链接），只读取，不改动任何东西');
    expect(v.primary).toEqual({ action: 'check-all', label: '开始检查' });
    expect(v.secondary).toBeNull();
  });

  it('有打不开的、其中有能改用备份的：主按钮一键改用，次按钮重新检查', () => {
    const v = idle(summary({ kinds: { fixable: 2, broken: 1, limited: 1, ok: 8 } }));
    expect(v.tone).toBe('error');
    expect(v.hero).toBe(false);
    expect(v.title).toBe('3 张图片打不开');
    // 副标题只说和决定有关的：几张能修、几张没救、什么时候查的；受限 / 没查完由列表分段和按钮交代
    expect(v.subtitle).toBe('2 张可以改用备份 · 1 张没有能用的备份 · 3 天前检查');
    expect(v.primary).toEqual({ action: 'promote-all', label: '把 2 张改用备份' });
    expect(v.secondary).toEqual({ action: 'check-all', label: '重新检查' });
  });

  it('打不开的全都能改用备份：语气是提醒，不是报错', () => {
    expect(idle(summary({ kinds: { fixable: 1, ok: 3 } })).tone).toBe('warning');
  });

  it('打不开的都没备份：主按钮退成重新检查；还有没查的就先查剩下的', () => {
    expect(idle(summary({ kinds: { broken: 2, ok: 3 } }))).toMatchObject({
      primary: { action: 'check-all', label: '重新检查' },
      secondary: null,
    });

    const partial = idle(summary({ links: 9, uncheckedLinks: 4, kinds: { broken: 2, ok: 3, unchecked: 2 } }));
    expect(partial.subtitle).toBe('2 张没有能用的备份 · 3 天前检查');
    expect(partial.primary).toEqual({ action: 'check-unchecked', label: '检查剩下的 4 个' });
    expect(partial.secondary).toEqual({ action: 'check-all', label: '全部重新检查' });
  });

  it('全部正常：只留一个不抢眼的「重新检查」', () => {
    const v = idle(summary({ kinds: { ok: 12 } }));
    expect(v).toMatchObject({
      tone: 'ok',
      title: '全部正常',
      subtitle: '12 张图片都能打开 · 3 天前检查',
      primary: null,
      secondary: { action: 'check-all', label: '重新检查' },
    });
  });

  it('没有打不开的，但有受限或备份失效：标题不说「全部正常」，副标题点出来', () => {
    const v = idle(summary({ kinds: { ok: 10, limited: 1, 'backup-broken': 2 } }));
    expect(v.title).toBe('没有打不开的图片');
    expect(v.subtitle).toBe('1 张可能受限 · 2 张的备份失效了 · 3 天前检查');
  });

  it('已检查的都正常、但有新图没查：主按钮查剩下的', () => {
    const v = idle(summary({ links: 14, uncheckedLinks: 2, kinds: { ok: 10, unchecked: 2 } }));
    expect(v.title).toBe('已检查的图片都能打开');
    expect(v.primary).toEqual({ action: 'check-unchecked', label: '检查剩下的 2 个' });
    expect(v.secondary).toEqual({ action: 'check-all', label: '全部重新检查' });
  });

  it('提示只在没有打不开时出现：有失效备份 → 去文档修复；部分图没备份 → 去补充备份', () => {
    expect(idle(summary({ kinds: { ok: 5, 'backup-broken': 1 } })).hint?.kind).toBe('doc-repair');
    expect(idle(summary({ kinds: { ok: 5 }, singleCopy: 2 })).hint).toMatchObject({
      kind: 'add-backup',
      text: '2 张图片只存在一个图床，那个图床出问题就找不回了',
    });
    expect(idle(summary({ kinds: { fixable: 1, ok: 5 }, singleCopy: 2 })).hint).toBeNull();
  });

  it('所有图都只传了一个图床：不反复劝补备份（只用一个图床的人不该被一直提醒）', () => {
    expect(idle(summary({ kinds: { ok: 5 }, singleCopy: 5 })).hint).toBeNull();
  });

  it('检查中：标题报进度，副标题报目前打不开的数量，按钮是暂停 / 停止', () => {
    const s = summary({ kinds: { fixable: 1, ok: 4 } });
    expect(buildCheckVerdict({ summary: s, running: { done: 5, total: 17, paused: false }, loadingRest: false })).toMatchObject({
      tone: 'running',
      title: '正在检查链接 5 / 17',
      subtitle: '目前有 1 张图片打不开',
      primary: { action: 'pause', label: '暂停' },
      secondary: { action: 'cancel', label: '停止' },
    });
    expect(buildCheckVerdict({ summary: summary({ kinds: { ok: 4 } }), running: { done: 5, total: 17, paused: true }, loadingRest: false })).toMatchObject({
      tone: 'paused',
      title: '已暂停 · 5 / 17',
      subtitle: '目前没发现打不开的图片',
      primary: { action: 'resume', label: '继续' },
    });
  });

  it('检查中报节奏：还要多久；卡在慢图床时直说在等，不给一个不靠谱的时间', () => {
    const s = summary({ kinds: { fixable: 1, ok: 4 } });
    const run = (extra: { etaSeconds?: number | null; stalled?: boolean }) => buildCheckVerdict({
      summary: s, running: { done: 5, total: 17, paused: false, ...extra }, loadingRest: false,
    }).subtitle;

    expect(run({ etaSeconds: 40 })).toBe('目前有 1 张图片打不开 · 预计不到 1 分钟');
    expect(run({ etaSeconds: 150 })).toBe('目前有 1 张图片打不开 · 预计还要 3 分钟');
    expect(run({ etaSeconds: 5400 })).toBe('目前有 1 张图片打不开 · 预计还要 1 小时 30 分钟');
    expect(run({ etaSeconds: 150, stalled: true })).toBe('目前有 1 张图片打不开 · 有些图床响应慢，正在等它们');
    expect(run({ etaSeconds: null })).toBe('目前有 1 张图片打不开');
  });

  it('其余记录还在读：数字不全，不能抢先说「全部正常」或「从没检查过」', () => {
    const readingAllUnchecked = buildCheckVerdict({
      summary: summary({ images: 3, links: 3, uncheckedLinks: 3, kinds: { unchecked: 3 } }),
      running: null,
      loadingRest: true,
    });
    expect(readingAllUnchecked).toMatchObject({ hero: false, title: '正在读取检查记录…', primary: null });

    const withProblems = buildCheckVerdict({ summary: summary({ kinds: { broken: 1 } }), running: null, loadingRest: true });
    expect(withProblems.title).toBe('1 张图片打不开');
    expect(withProblems.subtitle).toBe('1 张没有能用的备份 · 其余记录读取中');
  });

  it('从没记录过检查时间：副标题不编一个出来', () => {
    expect(idle(summary({ kinds: { ok: 2 }, lastCheckedAt: null })).subtitle).toBe('2 张图片都能打开');
  });
});
