import { describe, expect, it } from 'vitest';
import { detailBanner, hostRows, lightboxFailure, linkHealth } from '@/views/gallery/detailHosts';
import type { MirrorInfo } from '@/composables/history/useMirrorFallback';

const mirror = (serviceId: string, checkState: MirrorInfo['checkState'], isPrimary = false): MirrorInfo => ({
  serviceId, url: `https://${serviceId}.example/a.png`, isPrimary, checkState,
});
const name = (id: string) => ({ weibo: '微博', jd: '京东', r2: 'Cloudflare R2', nas: '家里 NAS' })[id] ?? id;

// GalleryScreen.dc.html G05–G07：正常时只写名字和「复制」；复制时使用的那一份有标注；失效的琥珀色「⚠ 图片已不存在」
describe('hostRows', () => {
  it('marks the copy source and leaves healthy hosts unmarked', () => {
    const rows = hostRows([mirror('r2', 'valid', true), mirror('jd', 'valid'), mirror('nas', 'unchecked')], {}, null);
    expect(rows.map((r) => [r.id, r.status, r.warn, r.canCopy])).toEqual([
      ['r2', '复制时使用', false, true],
      ['jd', '', false, true],
      ['nas', '尚未检测', false, true],
    ]);
  });

  it('says a dead link is gone, takes away its copy button, and tells limited apart', () => {
    const rows = hostRows(
      [mirror('weibo', 'invalid', true), mirror('jd', 'invalid')],
      { jd: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx', browserMightWork: true } },
      null,
    );
    expect(rows.map((r) => [r.status, r.warn, r.canCopy])).toEqual([
      ['图片已不存在', true, false],
      ['可能受限', true, true],
    ]);
  });

  // 检测还在排队（errorType pending）：格子角标和状态筛选都算「尚未检测」，详情不能说成「图片已不存在」
  it('treats a queued check as not checked yet', () => {
    const rows = hostRows([mirror('jd', 'invalid', true)], { jd: { isValid: false, lastCheckTime: 1, errorType: 'pending' } }, null);
    expect([rows[0].health, rows[0].canCopy]).toEqual(['unchecked', true]);
  });

  it('notes a copy source that was just switched to', () => {
    expect(hostRows([mirror('jd', 'valid', true)], {}, 'jd')[0].status).toBe('复制时使用 · 刚刚切换');
  });
});

describe('detailBanner', () => {
  it('offers the working backup when the copy source is dead (G06)', () => {
    const rows = hostRows([mirror('weibo', 'invalid', true), mirror('jd', 'valid')], {}, null);
    expect(detailBanner(rows, name)).toEqual({ kind: 'broken', title: '微博链接已失效', sub: '京东备份可用', useId: 'jd', useName: '京东' });
  });

  it('says every link is gone when no copy is left (G07)', () => {
    expect(detailBanner(hostRows([mirror('weibo', 'invalid', true)], {}, null), name)).toEqual({ kind: 'dead' });
  });

  it('shows nothing while the copy source works', () => {
    expect(detailBanner(hostRows([mirror('r2', 'valid', true), mirror('jd', 'invalid')], {}, null), name)).toBeNull();
  });
});

describe('linkHealth', () => {
  it('reads one copy the way the tile badges and the status filter do', () => {
    const status = {
      ok: { isValid: true, lastCheckTime: 1, errorType: 'success' },
      dead: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
      limited: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx', browserMightWork: true },
      queued: { isValid: false, lastCheckTime: 1, errorType: 'pending' },
    } as const;
    expect(['ok', 'dead', 'limited', 'queued', 'never'].map((id) => linkHealth(status, id))).toEqual(['ok', 'dead', 'limited', 'unchecked', 'unchecked']);
  });
});

// 灯箱这次没加载出来（G08）：只有检测过、确认失效的那份才说「已失效 / 已不存在」；断网、超时、没检测过只说加载失败
describe('lightboxFailure', () => {
  const rows = hostRows(
    [mirror('weibo', 'invalid', true), mirror('jd', 'valid'), mirror('nas', 'unchecked')],
    { weibo: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' } },
    null,
  );

  it('keeps the design copy when the shown host was checked and found dead', () => {
    expect(lightboxFailure(rows, 'weibo', name)).toEqual({ banner: '微博链接已失效，可切换图床查看', body: '微博上的图片已不存在' });
  });

  it.each(['jd', 'nas'])('does not call a %s load failure a dead link', (hostId) => {
    expect(lightboxFailure(rows, hostId, name)).toEqual({
      banner: `${name(hostId)}图片加载失败，可切换图床查看`,
      body: `${name(hostId)}上的图片加载失败`,
    });
  });
});
