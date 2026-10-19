// 托盘的调度（交接说明 8.6）：菜单跟着上传控制器的配置 / 图床 / 进度走；点了什么交给同一个控制器或设置页的保存入口
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import type { UploadController, UploadHost } from '@/composables/upload/useUploadController';
import type { TrayAction, TrayRow } from '@/tray/trayMenuModel';
import { getEmitMock, getExitMock, getInvokeMock, getListenMock, resetTauriMocks } from '../helpers/tauriMock';
import { flushPromisesAndTicks } from '../helpers/wait';

const m = vi.hoisted(() => ({
  applyTrayMenu: vi.fn(),
  applyTrayIcon: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/tray/nativeTray', () => ({ applyTrayMenu: m.applyTrayMenu, applyTrayIcon: m.applyTrayIcon }));
vi.mock('@/views/settings/useSettingsConfig', () => ({ useSettingsConfig: () => ({ patch: m.patch }) }));
vi.mock('@/utils/platform', () => ({ uiPlatform: () => 'windows' }));

import { installTray, TRAY_CLIPBOARD_EVENT, TRAY_HOVER_EVENT } from '@/tray/installTray';

const HOSTS: UploadHost[] = [
  { id: 'jd', name: '京东', selected: true, warning: null, cookieLogin: false },
  { id: 'weibo', name: '微博', selected: false, warning: '登录失效', cookieLogin: true },
  { id: 'qiyu', name: '七鱼', selected: false, warning: null, cookieLogin: false },
];

function fakeController() {
  const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));
  const hosts = ref<UploadHost[]>(structuredClone(HOSTS));
  const sessions = reactive<{ id: string; finished: boolean; itemIds: string[] }[]>([]);
  const items = ref<Record<string, unknown[]>>({});
  return {
    config,
    hosts,
    sessions,
    ready: ref(false),
    itemsOf: (session: { id: string }) => items.value[session.id] ?? [],
    items,
    pasteClipboard: vi.fn().mockResolvedValue(undefined),
    pickAndUpload: vi.fn().mockResolvedValue(undefined),
    toggleHost: vi.fn().mockResolvedValue(undefined),
    loginHost: vi.fn().mockResolvedValue(undefined),
    setFormat: vi.fn().mockResolvedValue(undefined),
    setCompression: vi.fn().mockResolvedValue(undefined),
  };
}

type Fake = ReturnType<typeof fakeController>;
const listeners: Record<string, (event: { payload: unknown }) => void> = {};

function install(upload: Fake) {
  return installTray(upload as unknown as UploadController);
}

/** 最近一次画出来的菜单 */
function lastRows(): TrayRow[] {
  return m.applyTrayMenu.mock.calls.at(-1)?.[0] as TrayRow[];
}

function dispatch(action: TrayAction): void {
  const send = m.applyTrayMenu.mock.calls.at(-1)?.[1] as (action: TrayAction) => void;
  send(action);
}

function textOf(rows: TrayRow[], label: string): string {
  const row = rows.find((r) => r.kind !== 'separator' && r.text.startsWith(label));
  return row && row.kind !== 'separator' ? row.text : '';
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  m.applyTrayMenu.mockResolvedValue(undefined);
  m.applyTrayIcon.mockResolvedValue(undefined);
  m.patch.mockResolvedValue(true);
  for (const key of Object.keys(listeners)) delete listeners[key];
  getListenMock().mockImplementation(async (event, handler) => {
    listeners[event as string] = handler as (event: { payload: unknown }) => void;
    return vi.fn();
  });
  getInvokeMock().mockImplementation(async (command: string) => {
    if (command === 'clipboard_has_image') return true;
    if (command === 'get_taskbar_light') return false;
    return undefined;
  });
});

describe('installTray', () => {
  it('配置读完之前不画（用 Rust 的兜底菜单），读完立刻画菜单和图标', async () => {
    const upload = fakeController();
    install(upload);
    await flushPromisesAndTicks();
    expect(m.applyTrayMenu).not.toHaveBeenCalled();

    upload.ready.value = true;
    await flushPromisesAndTicks();
    expect(m.applyTrayMenu).toHaveBeenCalledTimes(1);
    expect(m.applyTrayIcon).toHaveBeenCalledWith([1, 1, 1, 1], { platform: 'windows', taskbarLight: false });
  });

  it('首页或设置页改了同一份配置，托盘跟着重画；没变就不重画', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();
    expect(textOf(lastRows(), '复制为')).toBe('复制为\tURL');
    const before = m.applyTrayMenu.mock.calls.length;

    upload.config.value = { ...upload.config.value, linkOutput: { ...DEFAULT_CONFIG.linkOutput!, defaultFormat: 'html' } };
    upload.hosts.value = upload.hosts.value.map((h) => ({ ...h, selected: true }));
    await flushPromisesAndTicks();
    expect(textOf(lastRows(), '复制为')).toBe('复制为\tHTML');
    expect(textOf(lastRows(), '上传到')).toBe('上传到\t⚠ 3 个图床');

    const after = m.applyTrayMenu.mock.calls.length;
    upload.config.value = JSON.parse(JSON.stringify(upload.config.value)) as UserConfig;
    await flushPromisesAndTicks();
    expect(m.applyTrayMenu.mock.calls.length).toBe(after);
    expect(after).toBeGreaterThan(before);
  });

  it('关闭全局快捷键：托盘图标整体变淡', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();
    upload.config.value = { ...upload.config.value, globalShortcut: { ...DEFAULT_CONFIG.globalShortcut!, enabled: false } };
    await flushPromisesAndTicks();
    expect(m.applyTrayIcon).toHaveBeenLastCalledWith([0.35, 0.35, 0.35, 0.35], expect.anything());
  });

  it('上传中：菜单顶部出状态行，图标按图床点亮；传完状态行消失', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();

    upload.items.value = { s1: [{
      id: 'i1', fileName: 'a.png', filePath: 'C:/a.png', enabledServices: ['jd', 'r2'], status: 'uploading',
      serviceProgress: { jd: { serviceId: 'jd', progress: 100, status: '✓ 完成' }, r2: { serviceId: 'r2', progress: 0, status: '等待中...' } },
    }] };
    upload.sessions.push({ id: 's1', finished: false, itemIds: ['i1'] });
    await flushPromisesAndTicks();
    expect(lastRows()[0]).toMatchObject({ kind: 'status', text: '正在上传 a.png\t1 / 2' });
    expect(m.applyTrayIcon).toHaveBeenLastCalledWith([1, 0.3, 0.3, 0.3], expect.anything());

    upload.sessions[0].finished = true;
    await flushPromisesAndTicks();
    expect(lastRows()[0].kind).not.toBe('status');
    expect(m.applyTrayIcon).toHaveBeenLastCalledWith([1, 1, 1, 1], expect.anything());
  });

  it('悬停托盘图标时重看剪贴板：没有图片第一项变灰', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();
    getInvokeMock().mockImplementation(async (command: string) => (command === 'clipboard_has_image' ? false : undefined));

    listeners[TRAY_HOVER_EVENT]({ payload: { taskbarLight: true } });
    await flushPromisesAndTicks();
    expect(lastRows()[0]).toMatchObject({ enabled: false, text: '上传剪贴板图片\t剪贴板无图片  Ctrl+Shift+C' });
    expect(m.applyTrayIcon).toHaveBeenLastCalledWith(expect.anything(), { platform: 'windows', taskbarLight: true });
  });

  it('剪贴板一变（Windows）就重看，不等悬停：打开菜单前已经是对的', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();
    getInvokeMock().mockImplementation(async (command: string) => (command === 'clipboard_has_image' ? false : undefined));

    listeners[TRAY_CLIPBOARD_EVENT]({ payload: null });
    await flushPromisesAndTicks();
    expect(lastRows()[0]).toMatchObject({ enabled: false });
  });

  it('上传与「上传到 / 复制为 / 压缩」交给上传控制器；托盘改格式不重新复制剪贴板', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();

    dispatch({ type: 'uploadClipboard' });
    dispatch({ type: 'pickFiles' });
    dispatch({ type: 'toggleHost', hostId: 'jd' });
    dispatch({ type: 'loginHost', hostId: 'weibo' });
    dispatch({ type: 'setFormat', format: 'markdown' });
    dispatch({ type: 'setCompression', presetId: null });
    await flushPromisesAndTicks();

    expect(upload.pasteClipboard).toHaveBeenCalledTimes(1);
    expect(upload.pickAndUpload).toHaveBeenCalledWith({ showHint: false });
    expect(upload.toggleHost).toHaveBeenCalledWith('jd');
    expect(upload.loginHost).toHaveBeenCalledWith('weibo');
    expect(upload.setFormat).toHaveBeenCalledWith('markdown', { recopy: false });
    expect(upload.setCompression).toHaveBeenCalledWith(null);
    // 后台进行，不打开主界面
    expect(getEmitMock()).not.toHaveBeenCalledWith('navigate-to', expect.anything());
  });

  it('第一次启用公共图床：先打开主界面，再弹风险确认', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();
    const { getCurrentWindow } = await import('@tauri-apps/api/window');

    dispatch({ type: 'toggleHost', hostId: 'qiyu' });
    await flushPromisesAndTicks();
    expect(getCurrentWindow().show).toHaveBeenCalled();
    expect(upload.toggleHost).toHaveBeenCalledWith('qiyu');
  });

  it('三个勾选开关走设置页的保存入口，按磁盘上的值取反', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();

    dispatch({ type: 'toggleAutoCopy' });
    dispatch({ type: 'toggleAutoUploadClipboard' });
    dispatch({ type: 'toggleGlobalShortcut' });
    await flushPromisesAndTicks();

    const drafts = m.patch.mock.calls.map(([rowId, mutate]) => {
      expect(rowId).toBeNull();
      const draft = structuredClone(DEFAULT_CONFIG);
      (mutate as (c: UserConfig) => void)(draft);
      return draft;
    });
    expect(drafts[0].linkOutput?.autoCopy).toBe(false);
    expect(drafts[1].appBehavior?.autoUploadClipboard).toBe(true);
    expect(drafts[2].globalShortcut?.enabled).toBe(false);
  });

  it('打开 / 设置 / 管理图床 / 自定义格式打开主界面并跳到对应位置；退出结束进程', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();

    dispatch({ type: 'settings' });
    dispatch({ type: 'manageHosts' });
    dispatch({ type: 'customFormat' });
    dispatch({ type: 'compressionSettings' });
    dispatch({ type: 'quit' });
    await flushPromisesAndTicks();

    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', 'settings');
    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', { view: 'settings', tab: 'hosting' });
    expect(upload.setFormat).toHaveBeenCalledWith('custom', { recopy: false });
    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', { view: 'settings', section: 'customTemplate' });
    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', { view: 'settings', section: 'compression' });
    expect(getExitMock()).toHaveBeenCalledWith(0);
  });

  it('从托盘打开主界面后马上重判「在不在屏」（拿不到前台时没有焦点事件）', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();
    const presence = await import('@/composables/appPresence');
    presence.__setAppOnScreenForTests(false);

    dispatch({ type: 'open' });
    await flushPromisesAndTicks();
    expect(presence.isAppOnScreen()).toBe(true);
  });

  it('点完总要按配置重画一次（系统菜单自己翻过的勾要纠正回来）', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    install(upload);
    await flushPromisesAndTicks();
    const before = m.applyTrayMenu.mock.calls.length;

    // 点已选中的格式：配置不变，签名不变
    dispatch({ type: 'setFormat', format: 'url' });
    await flushPromisesAndTicks();
    expect(m.applyTrayMenu.mock.calls.length).toBe(before + 1);
  });

  it('点了真改配置的项：只由配置变化重画一次，不再多画一遍', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    upload.setFormat.mockImplementation(async (format: string) => {
      upload.config.value = { ...upload.config.value, linkOutput: { ...DEFAULT_CONFIG.linkOutput!, defaultFormat: format as 'html' } };
    });
    install(upload);
    await flushPromisesAndTicks();
    const before = m.applyTrayMenu.mock.calls.length;

    dispatch({ type: 'setFormat', format: 'html' });
    await flushPromisesAndTicks();
    expect(m.applyTrayMenu.mock.calls.length).toBe(before + 1);
  });

  it('卸载后不再画', async () => {
    const upload = fakeController();
    upload.ready.value = true;
    const dispose = install(upload);
    await flushPromisesAndTicks();
    const before = m.applyTrayMenu.mock.calls.length;
    dispose();
    upload.config.value = { ...upload.config.value, linkOutput: { ...DEFAULT_CONFIG.linkOutput!, defaultFormat: 'bbcode' } };
    await flushPromisesAndTicks();
    expect(m.applyTrayMenu.mock.calls.length).toBe(before);
  });
});
