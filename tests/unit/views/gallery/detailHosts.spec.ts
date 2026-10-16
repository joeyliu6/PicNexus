import { describe, expect, it } from 'vitest';
import { detailBanner, hostRows } from '@/views/gallery/detailHosts';
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
