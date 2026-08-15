import { describe, expect, it } from 'vitest';
import {
  TRAY_LAYOUT,
  calculateFlyoutPanelHeight,
  calculateFlyoutRowOffset,
  calculateMenuPanelHeight,
  calculatePanelHeight,
  clampAnchor,
  countCommands,
  countSeparators,
  resolveFlyoutLeft,
  resolveFlyoutOpensLeft,
  resolveFlyoutTop,
  type WorkAreaFrame,
} from '@/services/trayMenuLayout';
import type { TrayMenuItem } from '@/services/trayMenu';

function command(id: string): TrayMenuItem {
  return { id, text: id };
}

function separator(): TrayMenuItem {
  return { item: 'Separator' };
}

/** 与 buildTrayMenuItems 的实际输出同构：7 个命令项 + 3 条分隔线 */
function mainMenuItems(): TrayMenuItem[] {
  return [
    command('open_window'),
    separator(),
    command('upload_clipboard'),
    command('select_upload_files'),
    command('current_service'),
    separator(),
    command('open_history'),
    command('toggle_theme'),
    separator(),
    command('quit'),
  ];
}

/** 用户截图里的二级面板：5 个图床 + 2 条分组分隔线 */
function serviceFlyoutItems(): TrayMenuItem[] {
  return [
    command('tray_service_qiyu'),
    command('tray_service_jd'),
    separator(),
    command('tray_service_r2'),
    separator(),
    command('tray_service_dufs'),
    command('tray_service_openlist'),
  ];
}

/** 1920×1080 屏幕，底部 40px 任务栏，无缩放 */
function workArea(overrides: Partial<WorkAreaFrame> = {}): WorkAreaFrame {
  return { left: 0, top: 0, width: 1920, height: 1040, scaleFactor: 1, ...overrides };
}

describe('trayMenuLayout 面板高度计算', () => {
  it('counts commands and separators separately', () => {
    expect(countCommands(mainMenuItems())).toBe(7);
    expect(countSeparators(mainMenuItems())).toBe(3);
  });

  it('measures the main menu panel at 215px', () => {
    // 7×26 + 3×5 + 18
    expect(calculateMenuPanelHeight(mainMenuItems())).toBe(215);
  });

  it('measures the service flyout panel at 150px', () => {
    // 5×26 + 2×5 + 10
    expect(calculateFlyoutPanelHeight(serviceFlyoutItems())).toBe(150);
  });

  it('falls back to the bare panel padding for an empty list', () => {
    expect(calculatePanelHeight([], TRAY_LAYOUT.MENU_PANEL_EXTRA_HEIGHT))
      .toBe(TRAY_LAYOUT.MENU_PANEL_EXTRA_HEIGHT);
  });

  it('offsets the flyout to the top of the 当前图床 row', () => {
    // 8(padding) + 26(打开界面) + 5(分隔线) + 26(上传剪贴板) + 26(选择图片…)
    expect(calculateFlyoutRowOffset(mainMenuItems())).toBe(91);
  });

  it('returns the leading padding when the target row is missing', () => {
    expect(calculateFlyoutRowOffset([], 'current_service')).toBe(TRAY_LAYOUT.LIST_PADDING);
  });
});

describe('clampAnchor 主菜单锚点', () => {
  it('lifts the anchor just enough for the main menu itself to fit', () => {
    const anchor = clampAnchor({ x: 1200, y: 900 }, workArea(), 215);

    // 1040 - 215 = 825；只按主菜单高度让位
    expect(anchor).toEqual({ x: 1200, y: 825 });
  });

  it('ignores the service flyout when placing the main menu', () => {
    // 回归断言：二级面板底边会到 91 + 150 = 241，旧实现会据此把锚点压到 1040 - 241 = 799，
    // 导致展开二级面板时一级菜单被向上顶 26px。锚点必须只认主菜单的 215。
    const anchor = clampAnchor({ x: 1200, y: 900 }, workArea(), 215);

    expect(anchor.y).toBe(825);
    expect(anchor.y).not.toBe(799);
  });

  it('is idempotent so repeated syncs never drift the menu upward', () => {
    const frame = workArea();
    const once = clampAnchor({ x: 1200, y: 900 }, frame, 215);
    const twice = clampAnchor(once, frame, 215);
    const thrice = clampAnchor(twice, frame, 215);

    expect(twice).toEqual(once);
    expect(thrice).toEqual(once);
  });

  it('leaves an anchor that already fits untouched', () => {
    expect(clampAnchor({ x: 1200, y: 500 }, workArea(), 215)).toEqual({ x: 1200, y: 500 });
  });

  it('clamps against the right edge and the work area origin', () => {
    expect(clampAnchor({ x: 1900, y: 500 }, workArea(), 215).x).toBe(1735); // 1920 - 185
    expect(clampAnchor({ x: -50, y: -50 }, workArea(), 215)).toEqual({ x: 0, y: 0 });
  });

  it('honours a non-origin work area (taskbar docked left or top)', () => {
    const frame = workArea({ left: 80, top: 40, width: 1840, height: 1040 });

    expect(clampAnchor({ x: 0, y: 0 }, frame, 215)).toEqual({ x: 80, y: 40 });
    expect(clampAnchor({ x: 9999, y: 9999 }, frame, 215)).toEqual({ x: 1735, y: 865 });
  });

  it('scales the menu box by the monitor scale factor', () => {
    const frame = workArea({ scaleFactor: 1.5 });

    // round(185 × 1.5) = 278 → maxX = 1920 - 278
    expect(clampAnchor({ x: 1900, y: 0 }, frame, 215).x).toBe(1642);
  });

  it('pins the anchor to the work area origin when the menu is taller than the screen', () => {
    expect(clampAnchor({ x: 100, y: 500 }, workArea({ height: 120 }), 215).y).toBe(0);
  });
});

describe('resolveFlyoutTop 二级面板纵向落位', () => {
  it('aligns with the 当前图床 row when there is room below', () => {
    expect(resolveFlyoutTop(500, 91, 150, 1040)).toBe(591);
  });

  it('slides the flyout up until its bottom sits on the work area floor', () => {
    // 期望 825 + 91 = 916，底边会到 1066 越界；改为 890，底边正好 1040
    expect(resolveFlyoutTop(825, 91, 150, 1040)).toBe(890);
    expect(resolveFlyoutTop(825, 91, 150, 1040) + 150).toBe(1040);
  });

  it('pins the flyout to the top when it is taller than the work area', () => {
    expect(resolveFlyoutTop(825, 91, 1200, 1040)).toBe(0);
  });

  it('never returns a negative top', () => {
    expect(resolveFlyoutTop(0, 0, 150, 100)).toBe(0);
  });
});

describe('resolveFlyoutOpensLeft / resolveFlyoutLeft 二级面板横向落位', () => {
  it('opens rightward when the right edge has room', () => {
    expect(resolveFlyoutOpensLeft({ x: 1200, y: 500 }, workArea())).toBe(false);
    expect(resolveFlyoutLeft(1200, false, 1920)).toBe(1385); // 1200 + 185
  });

  it('opens leftward when the flyout would overflow the right edge', () => {
    expect(resolveFlyoutOpensLeft({ x: 1700, y: 500 }, workArea())).toBe(true);
    expect(resolveFlyoutLeft(1700, true, 1920)).toBe(1540); // 1700 - 160
  });

  it('stays rightward when neither side has room', () => {
    const narrow = workArea({ width: 300 });

    expect(resolveFlyoutOpensLeft({ x: 0, y: 0 }, narrow)).toBe(false);
    // 兜底夹进窗口，宁可盖住主菜单也不被裁掉
    expect(resolveFlyoutLeft(0, false, 300)).toBe(140); // 300 - 160
  });

  it('accounts for the scale factor when measuring the right edge', () => {
    const frame = workArea({ scaleFactor: 2 });

    // round(185×2) + round(160×2) = 370 + 320；1500 + 690 > 1920 且左侧放得下
    expect(resolveFlyoutOpensLeft({ x: 1500, y: 0 }, frame)).toBe(true);
  });

  it('never returns a negative left', () => {
    expect(resolveFlyoutLeft(100, true, 1920)).toBe(0);
  });
});
