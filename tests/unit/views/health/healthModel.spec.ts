// 健康模型：交接说明 13.4 的口径（失效 / 可改用备份 / 无可用备份 / 可能受限 / 仅有 1 份 / 改用哪一份）
import { describe, expect, it } from 'vitest';
import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';
import { getDayKey } from '@/utils/formatters';
import {
  backupLine, buildHealthImages, concentration, copyStatus, deadGroups, deadImages, minutesText,
  NO_FILTERS, problemSubline, reasonLine, summarize,
} from '@/views/health/healthModel';

const ok = (ms = 300): CheckLinkResult => ({ link: '', is_valid: true, error_type: 'success', browser_might_work: false, response_time: ms, status_code: 200 });
const http = (code: number): CheckLinkResult => ({ link: '', is_valid: false, error_type: code >= 500 ? 'http_5xx' : 'http_4xx', status_code: code, browser_might_work: false });
const timeout: CheckLinkResult = { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false };
const hotlink: CheckLinkResult = { link: '', is_valid: false, error_type: 'http_4xx', status_code: 403, browser_might_work: true };

const NAMES: Record<string, string> = { weibo: '微博', jd: '京东', r2: 'Cloudflare R2' };
const name = (id: string) => NAMES[id] ?? id;

let seq = 0;
function row(historyId: string, serviceId: string, result?: CheckLinkResult, extra: Partial<LinkCheckRow> = {}): LinkCheckRow {
  seq += 1;
  return {
    historyId, serviceId, url: `https://${serviceId}.example/${historyId}.png`, rawUrl: `https://${serviceId}.example/${historyId}.png`,
    fileName: `${historyId}.png`, uploadedAt: Date.UTC(2023, 4, 22, 4), isPrimary: false,
    checkResult: result, checkedAt: result ? 1000 + seq : undefined, ...extra,
  };
}
const primary = (historyId: string, serviceId: string, result?: CheckLinkResult, extra: Partial<LinkCheckRow> = {}) =>
  row(historyId, serviceId, result, { isPrimary: true, ...extra });

describe('copyStatus', () => {
  it('分出三种失效、可能受限、正常与尚未检测', () => {
    expect(copyStatus(undefined)).toBe('unchecked');
    expect(copyStatus(ok())).toBe('ok');
    expect(copyStatus(http(404))).toBe('gone');
    expect(copyStatus(http(410))).toBe('gone');
    expect(copyStatus(http(403))).toBe('denied');
    expect(copyStatus(http(429))).toBe('denied');
    expect(copyStatus(timeout)).toBe('timeout');
    expect(copyStatus({ ...timeout, error_type: 'network' })).toBe('timeout');
    expect(copyStatus(http(502))).toBe('timeout');
    expect(copyStatus({ ...timeout, error_type: 'blocked' })).toBe('denied');
    expect(copyStatus({ ...ok(), is_valid: false, error_type: 'suspicious' })).toBe('denied');
  });

  it('防盗链与跳转算可能受限，不算失效', () => {
    expect(copyStatus(hotlink)).toBe('limited');
    expect(copyStatus({ ...http(301), error_type: 'redirect', browser_might_work: true })).toBe('limited');
  });

  it('超时结果带着旧的 404 状态码也不算「图片已不存在」', () => {
    expect(copyStatus({ ...timeout, status_code: 404 })).toBe('timeout');
  });
});

describe('buildHealthImages', () => {
  it('复制时使用的那份失效、还有可访问的备份 = 可改用备份；改用响应最快的那份', () => {
    const [image] = buildHealthImages([
      primary('a', 'weibo', http(404)),
      row('a', 'jd', ok(800)),
      row('a', 'r2', ok(120)),
    ]);
    expect(image.state).toBe('fixable');
    expect(image.reason).toBe('gone');
    expect(image.fixTo).toBe('r2');
    expect(image.copies.map((c) => c.host)).toEqual(['weibo', 'jd', 'r2']);
  });

  it('复制时使用的那份不在第一行也排到最前', () => {
    const [image] = buildHealthImages([row('a', 'jd', ok()), primary('a', 'weibo', timeout)]);
    expect(image.copyHost).toBe('weibo');
    expect(image.copies[0].host).toBe('weibo');
  });

  it('备份受限或尚未检测不算可改用：无可用备份', () => {
    const [a, b] = buildHealthImages([
      primary('a', 'weibo', timeout, { uploadedAt: 2 }), row('a', 'jd', hotlink, { uploadedAt: 2 }),
      primary('b', 'weibo', timeout, { uploadedAt: 1 }), row('b', 'jd', undefined, { uploadedAt: 1 }),
    ]);
    expect(a.state).toBe('unfixable');
    expect(b.state).toBe('unfixable');
  });

  it('复制时使用的那份受限 / 尚未检测 / 正常，就是这张图的状态', () => {
    const images = buildHealthImages([
      primary('a', 'weibo', hotlink, { uploadedAt: 3 }),
      primary('b', 'weibo', undefined, { uploadedAt: 2 }),
      primary('c', 'weibo', ok(), { uploadedAt: 1 }), row('c', 'jd', http(404), { uploadedAt: 1 }),
    ]);
    expect(images.map((i) => i.state)).toEqual(['limited', 'unchecked', 'ok']);
  });

  it('仅有 1 份 = 没被查出失效的副本只剩 1 份（尚未检测的当作可用）', () => {
    const images = buildHealthImages([
      primary('a', 'weibo', ok(), { uploadedAt: 4 }),
      primary('b', 'weibo', ok(), { uploadedAt: 3 }), row('b', 'jd', http(404), { uploadedAt: 3 }),
      primary('c', 'weibo', ok(), { uploadedAt: 2 }), row('c', 'jd', undefined, { uploadedAt: 2 }),
      primary('d', 'weibo', http(404), { uploadedAt: 1 }),
    ]);
    expect(images.map((i) => i.singleCopy)).toEqual([true, true, false, false]);
  });

  it('找不回 = 每一份都是「图片已不存在」，超时的不算', () => {
    const images = buildHealthImages([
      primary('a', 'weibo', http(404), { uploadedAt: 2 }), row('a', 'jd', http(410), { uploadedAt: 2 }),
      primary('b', 'weibo', http(404), { uploadedAt: 1 }), row('b', 'jd', timeout, { uploadedAt: 1 }),
    ]);
    expect(images.map((i) => i.lostForGood)).toEqual([true, false]);
  });

  it('检测进行中：本轮还没查到的旧结果先当作待查，不在本轮里的照旧', () => {
    const rows = [
      primary('a', 'weibo', http(404), { checkedAt: 10, uploadedAt: 2 }),
      primary('b', 'weibo', http(404), { checkedAt: 10, uploadedAt: 1 }),
    ];
    const images = buildHealthImages(rows, { keys: new Set(['a::weibo']), startedAt: 50 });
    expect(images.map((i) => i.state)).toEqual(['unchecked', 'unfixable']);
    rows[0].checkedAt = 60;
    expect(buildHealthImages(rows, { keys: new Set(['a::weibo']), startedAt: 50 })[0].state).toBe('unfixable');
  });

  it('新到旧排列', () => {
    const images = buildHealthImages([primary('old', 'jd', ok(), { uploadedAt: 1 }), primary('new', 'jd', ok(), { uploadedAt: 9 })]);
    expect(images.map((i) => i.id)).toEqual(['new', 'old']);
  });
});

describe('summarize', () => {
  it('失效 = 可改用 + 无可用；可能受限单独计数；上次检测取最新的一次', () => {
    const images = buildHealthImages([
      primary('a', 'weibo', http(404), { uploadedAt: 3, checkedAt: 5 }), row('a', 'jd', ok(), { uploadedAt: 3, checkedAt: 7 }),
      primary('b', 'weibo', timeout, { uploadedAt: 2, checkedAt: 6 }),
      primary('c', 'weibo', hotlink, { uploadedAt: 1, checkedAt: 4 }),
    ]);
    const s = summarize(images);
    expect([s.total, s.dead, s.fixable, s.unfixable, s.limited]).toEqual([3, 2, 1, 1, 1]);
    expect(s.lastCheckedAt).toBe(7);
    expect(s.everChecked).toBe(true);
    expect(s.links).toBe(4);
  });

  it('一份都没检测过就是尚未检测', () => {
    const s = summarize(buildHealthImages([primary('a', 'weibo')]));
    expect(s.everChecked).toBe(false);
    expect(s.lastCheckedAt).toBeNull();
  });
});

describe('deadGroups', () => {
  const images = buildHealthImages([
    primary('a', 'weibo', http(404), { uploadedAt: new Date(2023, 4, 22).getTime() }), row('a', 'jd', ok(), { uploadedAt: new Date(2023, 4, 22).getTime() }),
    primary('b', 'r2', timeout, { uploadedAt: new Date(2020, 5, 3).getTime() }),
    primary('c', 'weibo', hotlink, { uploadedAt: new Date(2021, 0, 1).getTime() }),
  ]);

  it('分「可改用备份 / 无可用备份」两组', () => {
    const groups = deadGroups(images, NO_FILTERS, getDayKey);
    expect(groups.map((g) => [g.title, g.images.map((i) => i.id)])).toEqual([['可改用备份', ['a']], ['无可用备份', ['b']]]);
  });

  it('按原因 / 图床 / 年份 / 某一天筛，空组不出现', () => {
    expect(deadGroups(images, { ...NO_FILTERS, reason: 'timeout' }, getDayKey).map((g) => g.key)).toEqual(['unfixable']);
    expect(deadGroups(images, { ...NO_FILTERS, host: 'weibo' }, getDayKey).map((g) => g.key)).toEqual(['fixable']);
    expect(deadGroups(images, { ...NO_FILTERS, year: 2020 }, getDayKey).map((g) => g.key)).toEqual(['unfixable']);
    expect(deadGroups(images, { ...NO_FILTERS, day: getDayKey(new Date(2023, 4, 22, 18).getTime()) }, getDayKey)[0].images).toHaveLength(1);
    expect(deadGroups(images, { ...NO_FILTERS, year: 2019 }, getDayKey)).toEqual([]);
  });

  it('按「可能受限」筛：只有一组', () => {
    expect(deadGroups(images, { ...NO_FILTERS, reason: 'limited' }, getDayKey).map((g) => [g.title, g.images[0].id])).toEqual([['可能受限', 'c']]);
  });
});

describe('行上的文字', () => {
  it('原因写「图床：原因」，备份写「X 有备份」', () => {
    const [image] = buildHealthImages([primary('a', 'weibo', http(404)), row('a', 'r2', ok())]);
    expect(reasonLine(image, name)).toBe('微博：图片已不存在');
    expect(backupLine(image, name)).toBe('Cloudflare R2 有备份');
  });

  it('没有备份 / 备份尚未检测 / 备份受限 / 备份也失效', () => {
    const lines = buildHealthImages([
      primary('a', 'weibo', timeout, { uploadedAt: 4 }),
      primary('b', 'weibo', timeout, { uploadedAt: 3 }), row('b', 'jd', undefined, { uploadedAt: 3 }),
      primary('c', 'weibo', timeout, { uploadedAt: 2 }), row('c', 'jd', hotlink, { uploadedAt: 2 }),
      primary('d', 'weibo', timeout, { uploadedAt: 1 }), row('d', 'jd', http(404), { uploadedAt: 1 }),
    ]).map((image) => backupLine(image, name));
    expect(lines).toEqual(['无备份', '备份尚未检测', '备份可能受限', '备份也已失效']);
  });
});

describe('状态栏说明', () => {
  const at = (y: number) => new Date(y, 5, 1).getTime();
  const dead = (pairs: Array<[string, number]>) => buildHealthImages(pairs.map(([host, y], i) => primary(`i${i}`, host, timeout, { uploadedAt: at(y) })));

  it('年份跨度不超过 6 年、某个图床占八成以上：集中在 2020–2023 年上传到微博的图片', () => {
    expect(concentration(dead([['weibo', 2020], ['weibo', 2023], ['weibo', 2021], ['weibo', 2022], ['jd', 2022]]), name))
      .toBe('集中在 2020–2023 年上传到微博的图片');
  });

  it('只有一年；图床名是英文时补空格', () => {
    expect(concentration(dead([['r2', 2023]]), name)).toBe('集中在 2023 年上传到 Cloudflare R2 的图片');
  });

  it('图床分散只写年份；年份太散只写图床；都不成立不写', () => {
    expect(concentration(dead([['weibo', 2022], ['jd', 2023]]), name)).toBe('集中在 2022–2023 年上传的图片');
    expect(concentration(dead([['weibo', 2015], ['weibo', 2023]]), name)).toBe('集中在上传到微博的图片');
    expect(concentration(dead([['weibo', 2015], ['jd', 2023]]), name)).toBeNull();
  });

  it('有可修复的：集中在… · N 张可用备份修复 · 另有 N 张可能受限', () => {
    const images = buildHealthImages([
      primary('a', 'weibo', http(404), { uploadedAt: at(2023) }), row('a', 'jd', ok(), { uploadedAt: at(2023) }),
      primary('b', 'weibo', hotlink, { uploadedAt: at(2023) }),
    ]);
    expect(problemSubline(summarize(images), deadImages(images), 0, name))
      .toBe('集中在 2023 年上传到微博的图片 · 1 张可用备份修复 · 另有 1 张可能受限');
  });

  it('一张都修不了：均无可用备份 · N 张已修复（L11）', () => {
    const images = dead([['weibo', 2020]]);
    expect(problemSubline(summarize(images), deadImages(images), 15, name)).toBe('均无可用备份 · 15 张已修复');
    expect(problemSubline(summarize(images), deadImages(images), 0, name)).toBe('均无可用备份');
  });
});

describe('minutesText', () => {
  it('不到 1 分钟 / N 分钟 / N 小时 M 分钟', () => {
    expect(minutesText(30)).toBe('不到 1 分钟');
    expect(minutesText(15 * 60)).toBe('15 分钟');
    expect(minutesText(90 * 60)).toBe('1 小时 30 分钟');
    expect(minutesText(120 * 60)).toBe('2 小时');
  });
});
