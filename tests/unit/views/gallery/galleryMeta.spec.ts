import { describe, expect, it } from 'vitest';
import type { ImageMeta } from '@/types/image-meta';
import { badgeOf, listLayout, petalLabelOf, petalsOf, statusOf } from '@/views/gallery/galleryMeta';

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
    const backups = { backupsExpected: true };
    expect(badgeOf(meta('ok'), backups)).toBeNull();
    expect(badgeOf(meta('unchecked'), backups)).toBeNull();
    expect(badgeOf(meta('dead'), backups)).toEqual({ text: '失效', warn: true });
    expect(badgeOf(meta('limited'), backups)).toEqual({ text: '可能受限', warn: true });
    expect(badgeOf(meta('ok', 1), backups)).toEqual({ text: '仅 1 份', warn: false });
  });

  // 「上传到」只勾一个图床时张张都只有 1 份：每格都标「仅 1 份」等于没标，只剩杂乱
  it('leaves 仅 1 份 off when uploads go to a single host, but still flags broken links', () => {
    const single = { backupsExpected: false };
    expect(badgeOf(meta('ok', 1), single)).toBeNull();
    expect(badgeOf(meta('dead', 1), single)).toEqual({ text: '失效', warn: true });
    expect(badgeOf(meta('limited', 1), single)).toEqual({ text: '可能受限', warn: true });
  });

  // GalleryScreen.dc.html 的花瓣只数份数（全是品牌蓝）；健康状况由 ⚠ 角标说，
  // 红色留给「刚才的操作失败了」（交接说明规则 4.5）
  it('lights one brand petal per copy whatever the link health', () => {
    expect(petalsOf(meta('ok', 3))).toEqual(['ok', 'ok', 'ok']);
    expect(petalsOf(meta('dead'))).toEqual(['ok', 'ok']);
    expect(petalsOf(meta('limited'))).toEqual(['ok', 'ok']);
    expect(petalLabelOf(meta('ok'))).toBe('2 份均正常');
    expect(petalLabelOf(meta('dead'))).toBe('2 份，复制链接已失效');
    // 没检测过就不能读成「均正常」
    expect(petalLabelOf(meta('unchecked'))).toBe('2 份，复制链接尚未检测');
  });

  it('leaves the list status empty while the link works', () => {
    expect(statusOf(meta('ok')).text).toBe('');
    expect(statusOf(meta('unchecked'))).toEqual({ text: '尚未检测', warn: false });
    expect(statusOf(meta('dead'))).toEqual({ text: '失效', warn: true });
  });
});

// 列表列数按列表自己的宽度：打开详情后（1300px 窗口里列表约 665px）文件名列不能被挤没
describe('gallery list layout', () => {
  it('drops columns as the list itself gets narrower', () => {
    expect(listLayout(0)).toBe('wide');
    expect(listLayout(1200)).toBe('wide');
    expect(listLayout(1000)).toBe('narrow');
    expect(listLayout(665)).toBe('compact');
  });
});
