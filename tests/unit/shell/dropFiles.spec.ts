import { describe, expect, it } from 'vitest';
import { summarizeDrop } from '@/shell/dropFiles';

describe('summarizeDrop', () => {
  it('keeps images and names the one kind of file that will be skipped', () => {
    const summary = summarizeDrop(['C:/a.png', 'C:/b.JPG', 'C:/notes.zip']);
    expect(summary.images).toEqual(['C:/a.png', 'C:/b.JPG']);
    expect(summary.skippedText).toBe('包含 1 个 .zip 文件，将被跳过');
  });

  it('falls back to 非图片文件 when the skipped files differ', () => {
    expect(summarizeDrop(['C:/a.txt', 'C:/b.zip', 'C:/folder']).skippedText).toBe('包含 3 个非图片文件，将被跳过');
  });

  it('says nothing when everything is an image', () => {
    expect(summarizeDrop(['/x/a.webp']).skippedText).toBe('');
  });
});
