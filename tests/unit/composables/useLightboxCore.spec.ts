import { describe, expect, it, vi } from 'vitest';
import { useLightboxCore } from '@/composables/common/useLightboxCore';

// 打开大图、翻页时读不出这张图的记录：原因照原话 + 处理办法（交接说明 9.4）；
// 数据库报的错可能是 { type, data: { message } } 对象，要读出里面的话，不能显示成 [object Object]
describe('useLightboxCore', () => {
  it('says why the picture could not open and what to do', async () => {
    const toast = { error: vi.fn() };
    const core = useLightboxCore({ toast, silentLoadError: true });

    await core.showItem(async () => { throw { type: 'STORAGE', data: { message: '数据库被占用' } }; });

    expect(toast.error).toHaveBeenCalledWith('未能打开大图', '数据库被占用，请重试');
    expect(core.lightboxVisible.value).toBe(false);
  });

  it('words a failed page turn the same way', async () => {
    const toast = { error: vi.fn() };
    const core = useLightboxCore({ toast, silentLoadError: true });

    await core.loadItem(async () => { throw new Error('读取记录超时'); });

    expect(toast.error).toHaveBeenCalledWith('未能打开大图', '读取记录超时，请重试');
  });
});
