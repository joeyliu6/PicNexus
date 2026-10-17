// 自动上传剪贴板：开关跟着配置走；后台报「新图片」时照粘贴上传；关着时不传；卸载时关掉后台监听
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvokeMock, getListenMock, resetTauriMocks } from '../../helpers/tauriMock';

const m = vi.hoisted(() => ({ on: false }));
vi.mock('@/store/instances', () => ({
  readFreshConfig: vi.fn(async () => ({ appBehavior: { autoUpload: true, autoUploadClipboard: m.on } })),
}));

import { CLIPBOARD_IMAGE_EVENT, installClipboardWatch } from '@/composables/upload/clipboardWatch';

type Handler = () => void;
const handlers: Record<string, Handler> = {};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetTauriMocks();
  for (const key of Object.keys(handlers)) delete handlers[key];
  getListenMock().mockImplementation(async (event: string, handler: unknown) => {
    handlers[event] = handler as Handler;
    return vi.fn();
  });
});

describe('installClipboardWatch', () => {
  it('配置开着：启动时打开后台监听，发现新图片就照粘贴上传', async () => {
    m.on = true;
    const target = { pasteClipboard: vi.fn().mockResolvedValue(undefined) };
    installClipboardWatch(target);
    await flush();
    expect(getInvokeMock()).toHaveBeenCalledWith('set_clipboard_watch', { enabled: true });
    handlers[CLIPBOARD_IMAGE_EVENT]();
    expect(target.pasteClipboard).toHaveBeenCalledTimes(1);
  });

  it('配置关着：不开监听，事件来了也不传；配置改成开着时再打开', async () => {
    m.on = false;
    const target = { pasteClipboard: vi.fn().mockResolvedValue(undefined) };
    installClipboardWatch(target);
    await flush();
    expect(getInvokeMock()).toHaveBeenCalledWith('set_clipboard_watch', { enabled: false });
    handlers[CLIPBOARD_IMAGE_EVENT]();
    expect(target.pasteClipboard).not.toHaveBeenCalled();

    m.on = true;
    handlers['config-updated']();
    await flush();
    expect(getInvokeMock()).toHaveBeenLastCalledWith('set_clipboard_watch', { enabled: true });
  });

  it('卸载时关掉后台监听', async () => {
    m.on = true;
    const dispose = installClipboardWatch({ pasteClipboard: vi.fn() });
    await flush();
    dispose();
    expect(getInvokeMock()).toHaveBeenLastCalledWith('set_clipboard_watch', { enabled: false });
  });
});
