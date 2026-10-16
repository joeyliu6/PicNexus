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

  it('lights one petal per copy and colours the copy source by its health', () => {
    expect(petalsOf(meta('ok', 3))).toEqual(['ok', 'ok', 'ok']);
    expect(petalsOf(meta('dead'))).toEqual(['failed', 'ok']);
    expect(petalsOf(meta('limited'))).toEqual(['limited', 'ok']);
    expect(petalLabelOf(meta('ok'))).toBe('2 份均正常');
  });

  it('leaves the list status empty while the link works', () => {
    expect(statusOf(meta('ok')).text).toBe('');
    expect(statusOf(meta('unchecked'))).toEqual({ text: '尚未检测', warn: false });
    expect(statusOf(meta('dead'))).toEqual({ text: '失效', warn: true });
  });
});
