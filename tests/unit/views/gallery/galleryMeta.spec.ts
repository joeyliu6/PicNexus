import { describe, expect, it } from 'vitest';
import type { ImageMeta } from '@/types/image-meta';
import { badgeOf, petalLabelOf, petalsOf, statusOf } from '@/views/gallery/galleryMeta';

const meta = (copyLinkHealth: ImageMeta['copyLinkHealth'], copies = 2): ImageMeta => ({
  id: 'a',
  timestamp: 0,
  localFileName: 'a.png',
  aspectRatio: 1,
  primaryService: 'jd',
  primaryUrl: 'https://jd.example/a.png',
  copyLinkHealth,
  mirrorServices: (['jd', 'r2', 'github'] as const).slice(0, copies).map((serviceId) => ({ serviceId, url: `https://${serviceId}.example/a.png` })),
});

// GalleryScreen.dc.html：常驻角标只在需要注意时出现；正常不打任何标记（交接说明规则 4）
describe('gallery tile and row rules', () => {
  it('shows a badge only when something needs attention', () => {
    expect(badgeOf(meta('ok'))).toBeNull();
    expect(badgeOf(meta('unchecked'))).toBeNull();
    expect(badgeOf(meta('dead'))).toEqual({ text: '失效', warn: true });
    expect(badgeOf(meta('limited'))).toEqual({ text: '可能受限', warn: true });
    expect(badgeOf(meta('ok', 1))).toEqual({ text: '仅 1 份', warn: false });
  });

  // GalleryScreen.dc.html 的花瓣只数份数（全是品牌蓝）；健康状况由 ⚠ 角标说，
  // 红色留给「刚才的操作失败了」（交接说明规则 4.5）
  it('lights one brand petal per copy whatever the link health', () => {
    expect(petalsOf(meta('ok', 3))).toEqual(['ok', 'ok', 'ok']);
    expect(petalsOf(meta('dead'))).toEqual(['ok', 'ok']);
    expect(petalsOf(meta('limited'))).toEqual(['ok', 'ok']);
    expect(petalLabelOf(meta('ok'))).toBe('2 份均正常');
    expect(petalLabelOf(meta('dead'))).toBe('2 份，复制链接已失效');
  });

  it('leaves the list status empty while the link works', () => {
    expect(statusOf(meta('ok')).text).toBe('');
    expect(statusOf(meta('unchecked'))).toEqual({ text: '尚未检测', warn: false });
    expect(statusOf(meta('dead'))).toEqual({ text: '失效', warn: true });
  });
});
