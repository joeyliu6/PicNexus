import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockImage {
  static instances: MockImage[] = [];

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  referrerPolicy = '';
  decoding = '';
  complete = false;
  naturalWidth = 0;
  private _src = '';

  constructor() {
    MockImage.instances.push(this);
  }

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
  }
}

describe('imagePreload', () => {
  beforeEach(() => {
    vi.resetModules();
    MockImage.instances = [];
    vi.stubGlobal('Image', MockImage);
  });

  it('sets no-referrer on warm image requests', async () => {
    const { warmImage } = await import('@/utils/imagePreload');

    warmImage('https://example.com/a.jpg');

    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0].referrerPolicy).toBe('no-referrer');
    expect(MockImage.instances[0].decoding).toBe('async');
  });

  it('allows warming the same URL again after a preload error', async () => {
    const { warmImage } = await import('@/utils/imagePreload');

    warmImage('https://example.com/a.jpg');
    MockImage.instances[0].onerror?.();
    warmImage('https://example.com/a.jpg');

    expect(MockImage.instances).toHaveLength(2);
  });

  it('does not warm the same URL again after a successful preload', async () => {
    const { warmImage } = await import('@/utils/imagePreload');

    warmImage('https://example.com/a.jpg');
    MockImage.instances[0].onload?.();
    warmImage('https://example.com/a.jpg');

    expect(MockImage.instances).toHaveLength(1);
  });
});
