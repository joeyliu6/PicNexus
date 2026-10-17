import { describe, expect, it } from 'vitest';
import { displayKind, displayTag, imageFormat, isAnimatedFormat, isLongRatio, layoutRatio, mayBeTransparent } from '@/utils/imageDisplay';

const pic = (width: number, height: number) => ({ aspectRatio: width / height, width, height });

// ImageRatios.dc.html（G13）：只有极端比例才裁切，并用角标说明
describe('displayKind / layoutRatio', () => {
  it('keeps ordinary pictures at their own ratio', () => {
    expect(displayKind(pic(1920, 1080))).toBe('normal');
    expect(layoutRatio(pic(1920, 1080))).toBeCloseTo(16 / 9, 6);
    // 1280 × 2200（高宽比 1.7）不算长图
    expect(layoutRatio(pic(1280, 2200))).toBeCloseTo(1280 / 2200, 6);
  });

  it('crops a scrolling screenshot taller than 1:2.5 to 1:2.5', () => {
    expect(displayKind(pic(1080, 6048))).toBe('long');
    expect(layoutRatio(pic(1080, 6048))).toBeCloseTo(0.4, 6);
    // 正好 1:2.5 还不算
    expect(displayKind(pic(400, 1000))).toBe('normal');
  });

  it('crops a panorama wider than 4:1 to 4:1', () => {
    expect(displayKind(pic(6000, 1000))).toBe('wide');
    expect(layoutRatio(pic(6000, 1000))).toBe(4);
    expect(displayKind(pic(4000, 1000))).toBe('normal');
  });

  // 不放大：长图 / 全景的裁切格会把图标、徽章这类小图放得更糊
  it('puts a picture whose short side is under 120 into a square cell', () => {
    expect(displayKind(pic(48, 48))).toBe('small');
    expect(layoutRatio(pic(48, 48))).toBe(1);
    // 徽章 90 × 20 本该算全景、40 × 400 本该算长图：小图优先
    expect(displayKind(pic(90, 20))).toBe('small');
    expect(layoutRatio(pic(90, 20))).toBe(1);
    expect(displayKind(pic(40, 400))).toBe('small');
    expect(displayKind(pic(120, 120))).toBe('normal');
  });

  it('falls back to the stored ratio when the size is unknown', () => {
    expect(displayKind({ aspectRatio: 0.2 })).toBe('long');
    expect(displayKind({ aspectRatio: 1.5, width: 0, height: 0 })).toBe('normal');
    expect(layoutRatio({ aspectRatio: 0 })).toBe(1);
  });
});

describe('displayTag', () => {
  it('names the kind of picture the cell has cropped or kept small', () => {
    expect(displayTag(pic(1080, 6048))).toBe('长图');
    expect(displayTag(pic(6000, 1000))).toBe('全景 6:1');
    expect(displayTag(pic(5300, 1000))).toBe('全景 5.3:1');
    expect(displayTag(pic(48, 48))).toBe('48 × 48');
  });

  it('marks nothing on an ordinary picture', () => {
    expect(displayTag(pic(1920, 1080))).toBeNull();
  });
});

describe('isLongRatio', () => {
  it('tells a picture taller than 1:2.5, whatever its size', () => {
    expect(isLongRatio(1080 / 6048)).toBe(true);
    expect(isLongRatio(100 / 2000)).toBe(true);
    expect(isLongRatio(0.4)).toBe(false);
    expect(isLongRatio(0)).toBe(false);
  });
});

describe('imageFormat', () => {
  it('reads the stored format, else the file name', () => {
    expect(imageFormat({ format: 'GIF', localFileName: 'a.png' })).toBe('gif');
    expect(imageFormat({ format: 'unknown', localFileName: '表情.GIF' })).toBe('gif');
    expect(imageFormat({ localFileName: 'logo.svg' })).toBe('svg');
    expect(imageFormat({ localFileName: '无扩展名' })).toBe('');
  });
});

describe('mayBeTransparent / isAnimatedFormat', () => {
  it('lays a checkerboard under every format that can carry transparency', () => {
    expect(['png', 'webp', 'svg', 'gif', 'avif'].every(mayBeTransparent)).toBe(true);
    expect(['jpg', 'jpeg'].some(mayBeTransparent)).toBe(false);
  });

  it('plays only GIFs on hover', () => {
    expect(isAnimatedFormat('gif')).toBe(true);
    expect(isAnimatedFormat('png')).toBe(false);
  });
});
