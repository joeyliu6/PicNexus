// 主窗口不在屏时，通知改发系统通知（托盘 / 全局快捷键发起的上传靠它告知结果，交接说明 T02）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getListenMock, getNotificationMocks, getPathMocks, getTauriWindowMocks, resetTauriMocks } from '../helpers/tauriMock';
import { flushPromisesAndTicks } from '../helpers/wait';

const pushToast = vi.hoisted(() => vi.fn());
vi.mock('@/components/pn/toastStore', () => ({ pushToast, clearToasts: vi.fn() }));

import { __setAppOnScreenForTests, installAppPresence, isAppOnScreen, refreshAppPresence, WINDOW_PRESENCE_EVENT } from '@/composables/appPresence';
import { useToast } from '@/composables/useToast';

const notification = getNotificationMocks();
let dispose: (() => void) | null = null;

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  __setAppOnScreenForTests(true);
  notification.isPermissionGranted.mockResolvedValue(true);
  getPathMocks().resolveResource.mockResolvedValue('/mock/resources/icons/icon.png');
});

afterEach(() => {
  dispose?.();
  dispose = null;
  __setAppOnScreenForTests(true);
});

describe('appPresence', () => {
  it('隐藏到托盘或最小化 = 不在屏；窗口焦点一变就重新判断', async () => {
    const window = getTauriWindowMocks().currentWindow;
    window.isVisible.mockResolvedValue(false);
    dispose = installAppPresence();
    await flushPromisesAndTicks();
    expect(isAppOnScreen()).toBe(false);

    window.isVisible.mockResolvedValue(true);
    window.isMinimized.mockResolvedValue(true);
    const onFocus = window.onFocusChanged.mock.calls[0][0] as () => void;
    onFocus();
    await flushPromisesAndTicks();
    expect(isAppOnScreen()).toBe(false);

    window.isMinimized.mockResolvedValue(false);
    onFocus();
    await flushPromisesAndTicks();
    expect(isAppOnScreen()).toBe(true);
  });
});

describe('appPresence 不只靠焦点事件', () => {
  it('Rust 关到托盘 / 从托盘打开之后发的通知到了，马上重新判断', async () => {
    const window = getTauriWindowMocks().currentWindow;
    const listeners: Record<string, () => void> = {};
    getListenMock().mockImplementation(async (event, handler) => {
      listeners[event as string] = handler as () => void;
      return vi.fn();
    });
    dispose = installAppPresence();
    await flushPromisesAndTicks();
    expect(isAppOnScreen()).toBe(true);

    window.isVisible.mockResolvedValue(false);
    listeners[WINDOW_PRESENCE_EVENT]();
    await flushPromisesAndTicks();
    expect(isAppOnScreen()).toBe(false);
  });

  it('两次判断同时在问系统时，以后发起的为准（先发起的晚回来不能盖掉）', async () => {
    const window = getTauriWindowMocks().currentWindow;
    let answerFirst!: (visible: boolean) => void;
    window.isVisible
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce(false);
    const first = refreshAppPresence();
    const second = refreshAppPresence();
    await second;
    answerFirst(true);
    await first;
    expect(isAppOnScreen()).toBe(false);
  });

  it('标题栏按钮隐藏窗口后调用 refreshAppPresence，马上重新判断', async () => {
    const window = getTauriWindowMocks().currentWindow;
    window.isVisible.mockResolvedValue(false);
    await refreshAppPresence();
    expect(isAppOnScreen()).toBe(false);
  });
});

describe('useToast 在主窗口不在屏时', () => {
  it('在屏：照常显示应用内通知', () => {
    useToast().success('已复制', '1 个 Markdown 链接已复制');
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: '已复制' }));
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });

  it('不在屏：改发系统通知，不进应用内', async () => {
    __setAppOnScreenForTests(false);
    useToast().error('a.png 上传失败', '无法连接 GitHub，请稍后重试');
    await flushPromisesAndTicks();
    expect(pushToast).not.toHaveBeenCalled();
    expect(notification.sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'a.png 上传失败',
      body: '无法连接 GitHub，请稍后重试',
    }));
  });

  it('带「撤销」等动作的通知只能在应用里点，仍留在应用内', () => {
    __setAppOnScreenForTests(false);
    useToast().withAction('success', '已改用备份', undefined, { label: '撤销', run: vi.fn() });
    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });

  it('没有通知权限时先请求，拒绝了就不发', async () => {
    __setAppOnScreenForTests(false);
    notification.isPermissionGranted.mockResolvedValue(false);
    notification.requestPermission.mockResolvedValue('denied');
    useToast().warn('剪贴板里没有图片');
    await flushPromisesAndTicks();
    expect(notification.requestPermission).toHaveBeenCalled();
    expect(notification.sendNotification).not.toHaveBeenCalled();
  });
});
