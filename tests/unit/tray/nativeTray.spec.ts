// 把菜单数据画成原生菜单 / 托盘图标（nativeTray.ts）：Tauri 的菜单、托盘、图片接口都换成记录调用的假对象
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInvokeMock, resetTauriMocks } from '../helpers/tauriMock';
import type { TrayAction, TrayRow } from '@/tray/trayMenuModel';

const m = vi.hoisted(() => {
  let nextRid = 1;
  const menus: { rid: number; options: { items: unknown[] }; close: ReturnType<typeof vi.fn> }[] = [];
  const images: { close: ReturnType<typeof vi.fn> }[] = [];
  const tray = { setMenu: vi.fn(), setIcon: vi.fn(), setIconAsTemplate: vi.fn() };
  return {
    menus,
    images,
    tray,
    menuNew: vi.fn(async (options: { items: unknown[] }) => {
      const menu = { rid: nextRid++, options, close: vi.fn().mockResolvedValue(undefined) };
      menus.push(menu);
      return menu;
    }),
    imageNew: vi.fn(async () => {
      const image = { close: vi.fn().mockResolvedValue(undefined) };
      images.push(image);
      return image;
    }),
    fills: [] as string[],
  };
});

vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: m.menuNew } }));
vi.mock('@tauri-apps/api/image', () => ({ Image: { new: m.imageNew } }));
vi.mock('@tauri-apps/api/tray', () => ({ TrayIcon: { getById: vi.fn(async () => m.tray) } }));

import { __resetNativeTrayForTests, applyTrayIcon, applyTrayMenu, RETIRE_AFTER_MS } from '@/tray/nativeTray';

const ROWS: TrayRow[] = [
  { kind: 'status', text: '正在上传 a.png\t1 / 3', petals: ['ok', 'uploading', 'waiting'] },
  { kind: 'separator' },
  { kind: 'item', text: '上传剪贴板图片', enabled: true, accelerator: 'CommandOrControl+Shift+C', action: { type: 'uploadClipboard' } },
  { kind: 'submenu', text: '复制为\tURL', items: [{ kind: 'check', text: 'URL', checked: true, enabled: true, action: { type: 'setFormat', format: 'url' } }] },
  { kind: 'separator' },
  { kind: 'item', text: '打开 PicNexus', enabled: true, isDefault: true, action: { type: 'open' } },
];

type Entry = { text?: string; item?: string; enabled?: boolean; checked?: boolean; accelerator?: string; icon?: unknown; items?: Entry[]; action?: () => void };

function itemsOf(call = m.menuNew.mock.calls.length - 1): Entry[] {
  return m.menuNew.mock.calls[call][0].items as Entry[];
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  m.menus.length = 0;
  m.images.length = 0;
  m.fills.length = 0;
  __resetNativeTrayForTests();
  m.tray.setMenu.mockResolvedValue(undefined);
  m.tray.setIcon.mockResolvedValue(undefined);
  m.tray.setIconAsTemplate.mockResolvedValue(undefined);
  // jsdom 没有画布：给一个只记颜色、回一块空像素的假画布
  vi.stubGlobal('Path2D', class { constructor(public d: string) {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    return {
      save: vi.fn(), restore: vi.fn(), scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
      set globalAlpha(_value: number) {},
      set fillStyle(value: string) { m.fills.push(value); },
      fill: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }),
    } as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('applyTrayMenu', () => {
  it('把每种行画成对应的菜单项，点了交回对应的动作', async () => {
    const dispatch = vi.fn<(action: TrayAction) => void>();
    await applyTrayMenu(ROWS, dispatch);

    const [status, sep, upload, format] = itemsOf();
    expect(status).toMatchObject({ text: '正在上传 a.png\t1 / 3', enabled: false });
    expect(status.icon).toBe(m.images[0]);
    expect(sep).toEqual({ item: 'Separator' });
    expect(upload).toMatchObject({ text: '上传剪贴板图片', accelerator: 'CommandOrControl+Shift+C' });
    expect(format.items?.[0]).toMatchObject({ text: 'URL', checked: true });

    upload.action?.();
    format.items?.[0].action?.();
    expect(dispatch.mock.calls).toEqual([[{ type: 'uploadClipboard' }], [{ type: 'setFormat', format: 'url' }]]);
    expect(m.tray.setMenu).toHaveBeenCalledWith(m.menus[0]);
  });

  it('状态行的小图标交给菜单后就释放', async () => {
    await applyTrayMenu(ROWS, vi.fn());
    expect(m.images[0].close).toHaveBeenCalled();
  });

  it('Windows 默认项：位置把分隔线和状态行都算上', async () => {
    await applyTrayMenu(ROWS, vi.fn());
    expect(getInvokeMock()).toHaveBeenCalledWith('set_tray_default_item', { rid: m.menus[0].rid, position: 5 });
  });

  it('系统认不出快捷键写法时，去掉快捷键再建一次', async () => {
    m.menuNew.mockRejectedValueOnce(new Error('Couldn\'t recognize "F99" as a valid key'));
    await applyTrayMenu(ROWS, vi.fn());
    expect(m.menuNew).toHaveBeenCalledTimes(2);
    expect(itemsOf(1)[2]).not.toHaveProperty('accelerator');
    expect(m.tray.setMenu).toHaveBeenCalledWith(m.menus[0]);
  });

  it('换上去失败时释放新建的菜单', async () => {
    m.tray.setMenu.mockRejectedValueOnce(new Error('tray gone'));
    await expect(applyTrayMenu(ROWS, vi.fn())).rejects.toThrow('tray gone');
    expect(m.menus[0].close).toHaveBeenCalled();
  });

  it('换下来的菜单留够时间才释放：菜单开着时连着重建几次，正在显示的那份也不会被销毁', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    await applyTrayMenu(ROWS, vi.fn());
    await applyTrayMenu(ROWS, vi.fn());
    await applyTrayMenu(ROWS, vi.fn());
    expect(m.menus.some((menu) => menu.close.mock.calls.length > 0)).toBe(false);

    vi.setSystemTime(RETIRE_AFTER_MS);
    await applyTrayMenu(ROWS, vi.fn());
    expect(m.menus.map((menu) => menu.close.mock.calls.length > 0)).toEqual([true, true, false, false]);
  });
});

describe('applyTrayIcon', () => {
  it('macOS 每次换图标都重新标成模板图（系统每次换图都会把标记重置）', async () => {
    await applyTrayIcon([1, 1, 1, 1], { platform: 'macos', taskbarLight: null });
    await applyTrayIcon([1, 0.55, 0.3, 0.3], { platform: 'macos', taskbarLight: null });
    expect(m.tray.setIcon).toHaveBeenCalledTimes(2);
    expect(m.tray.setIconAsTemplate).toHaveBeenCalledTimes(2);
  });

  it('Windows 不用模板图，按任务栏深浅选墨色；图片用完即放', async () => {
    await applyTrayIcon([1, 1, 1, 1], { platform: 'windows', taskbarLight: true });
    await applyTrayIcon([1, 1, 1, 1], { platform: 'windows', taskbarLight: false });
    expect(m.tray.setIconAsTemplate).not.toHaveBeenCalled();
    expect(m.fills.slice(0, 4)).toEqual(['#171717', '#171717', '#171717', '#171717']);
    expect(m.fills.slice(4, 8)).toEqual(['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF']);
    expect(m.images.every((image) => image.close.mock.calls.length === 1)).toBe(true);
  });
});
