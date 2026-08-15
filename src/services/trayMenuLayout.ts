import type { TrayMenuItem } from './trayMenu';

/**
 * 托盘菜单几何计算（纯函数，无副作用、不碰 Tauri API）。
 *
 * 背景：托盘菜单不是系统原生菜单，而是一个铺满工作区的透明 webview 窗口
 * （label `tray-menu`），主菜单与二级面板都是窗口内的绝对定位面板。
 * 因此「面板放哪」全靠这里的数学，抽出来是为了能单测。
 *
 * 核心不变式：**主菜单锚点只由主菜单自身尺寸决定**，与二级面板是否展开无关。
 * 空间不足时让位的是二级面板（`resolveFlyoutTop` / `resolveFlyoutLeft`），
 * 而不是把一级菜单往上顶。
 */

/** 布局常量，必须与 TrayMenuList.vue / TrayServiceFlyout.vue 的 CSS 保持一致 */
export const TRAY_LAYOUT = {
  /** .menu-panel 宽度 */
  MENU_WIDTH: 185,
  /** .flyout-panel / .service-flyout 宽度 */
  FLYOUT_WIDTH: 160,
  /** .menu-row / .flyout-row 行高 */
  ITEM_HEIGHT: 26,
  /** .menu-panel padding-top + .menu-list padding-top */
  LIST_PADDING: 8,
  /** .menu-separator 上下 margin 合计（含 1px 冗余） */
  SEPARATOR_BLOCK_HEIGHT: 5,
  /** .menu-panel + .menu-list 的上下 padding 合计（含 2px 冗余） */
  MENU_PANEL_EXTRA_HEIGHT: 18,
  /** .service-flyout 的上下 padding 合计（含 2px 冗余） */
  FLYOUT_PANEL_EXTRA_HEIGHT: 10,
} as const;

/** 二级菜单宿主行的 id，必须与 `buildTrayMenuItems` 中的 `current_service` 一致 */
export const TRAY_SERVICE_SUBMENU_ID = 'current_service';

/** 显示器工作区（物理像素）+ 缩放比 */
export interface WorkAreaFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleFactor: number;
}

/** 屏幕物理像素坐标 */
export interface AnchorPosition {
  x: number;
  y: number;
}

function isSeparator(item: TrayMenuItem): boolean {
  return 'item' in item && item.item === 'Separator';
}

export function countSeparators(items: TrayMenuItem[]): number {
  return items.filter(isSeparator).length;
}

export function countCommands(items: TrayMenuItem[]): number {
  return items.length - countSeparators(items);
}

/** 面板高度（逻辑像素）= 行数 × 行高 + 分隔线 + 面板自身内边距 */
export function calculatePanelHeight(items: TrayMenuItem[], extraHeight: number): number {
  return countCommands(items) * TRAY_LAYOUT.ITEM_HEIGHT
    + countSeparators(items) * TRAY_LAYOUT.SEPARATOR_BLOCK_HEIGHT
    + extraHeight;
}

export function calculateMenuPanelHeight(items: TrayMenuItem[]): number {
  return calculatePanelHeight(items, TRAY_LAYOUT.MENU_PANEL_EXTRA_HEIGHT);
}

export function calculateFlyoutPanelHeight(items: TrayMenuItem[]): number {
  return calculatePanelHeight(items, TRAY_LAYOUT.FLYOUT_PANEL_EXTRA_HEIGHT);
}

/**
 * 「当前图床」那一行相对主菜单面板顶部的偏移（逻辑像素）。
 * 二级面板空间充足时就贴着这个偏移展开。
 */
export function calculateFlyoutRowOffset(
  items: TrayMenuItem[],
  targetId: string = TRAY_SERVICE_SUBMENU_ID,
): number {
  let offset = TRAY_LAYOUT.LIST_PADDING;

  for (const item of items) {
    if (isSeparator(item)) {
      offset += TRAY_LAYOUT.SEPARATOR_BLOCK_HEIGHT;
      continue;
    }
    if ((item as { id: string }).id === targetId) break;
    offset += TRAY_LAYOUT.ITEM_HEIGHT;
  }

  return offset;
}

/**
 * 把 Rust 给出的原始锚点夹进工作区（物理像素）。
 *
 * ⚠️ 只吃主菜单高度，**不得**把二级面板算进来 —— 否则展开二级面板会把一级菜单顶上去。
 * 夹紧边界与锚点无关，因此函数幂等：对结果再夹一次不会继续位移。
 */
export function clampAnchor(
  rawAnchor: AnchorPosition,
  frame: WorkAreaFrame,
  menuPanelHeight: number,
): AnchorPosition {
  const menuWidth = Math.round(TRAY_LAYOUT.MENU_WIDTH * frame.scaleFactor);
  const menuHeight = Math.round(menuPanelHeight * frame.scaleFactor);
  const maxX = Math.max(frame.left, frame.left + frame.width - menuWidth);
  const maxY = Math.max(frame.top, frame.top + frame.height - menuHeight);

  return {
    x: Math.min(Math.max(rawAnchor.x, frame.left), maxX),
    y: Math.min(Math.max(rawAnchor.y, frame.top), maxY),
  };
}

/** 右侧放不下且左侧放得下时，二级面板改为向左展开 */
export function resolveFlyoutOpensLeft(anchor: AnchorPosition, frame: WorkAreaFrame): boolean {
  const workAreaRight = frame.left + frame.width;
  const menuRight = anchor.x + Math.round(TRAY_LAYOUT.MENU_WIDTH * frame.scaleFactor);
  const flyoutWidth = Math.round(TRAY_LAYOUT.FLYOUT_WIDTH * frame.scaleFactor);

  const canOpenRight = menuRight + flyoutWidth <= workAreaRight;
  const canOpenLeft = anchor.x - flyoutWidth >= frame.left;

  return !canOpenRight && canOpenLeft;
}

/**
 * 二级面板顶边（窗口内逻辑像素）。
 * 空间够就与「当前图床」行顶对齐；不够就整体上移，直到底边贴住工作区底部。
 */
export function resolveFlyoutTop(
  menuTopPx: number,
  rowOffsetPx: number,
  flyoutHeightPx: number,
  windowHeightPx: number,
): number {
  const desiredTop = menuTopPx + rowOffsetPx;
  const maxTop = Math.max(0, windowHeightPx - flyoutHeightPx);

  return Math.max(0, Math.min(desiredTop, maxTop));
}

/** 二级面板左边（窗口内逻辑像素），并兜底夹进窗口，防止极窄屏两侧都放不下时被裁掉 */
export function resolveFlyoutLeft(
  menuLeftPx: number,
  opensLeft: boolean,
  windowWidthPx: number,
): number {
  const desiredLeft = opensLeft
    ? menuLeftPx - TRAY_LAYOUT.FLYOUT_WIDTH
    : menuLeftPx + TRAY_LAYOUT.MENU_WIDTH;
  const maxLeft = Math.max(0, windowWidthPx - TRAY_LAYOUT.FLYOUT_WIDTH);

  return Math.max(0, Math.min(desiredLeft, maxLeft));
}
