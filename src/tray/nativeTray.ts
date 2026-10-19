// 把 trayMenuModel 算出的菜单画成系统原生菜单，把花瓣画成托盘图标（Tauri 的菜单 / 托盘 / 图片接口）。
// 托盘图标本身由 Rust 在启动时建好（src-tauri/src/commands/tray.rs），这里只换菜单和图标。

import { invoke } from '@tauri-apps/api/core';
import { Image } from '@tauri-apps/api/image';
import { Menu, type CheckMenuItemOptions, type IconMenuItemOptions, type MenuItemOptions, type PredefinedMenuItemOptions, type SubmenuOptions } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { allocatePetals, CLASSIC_PETAL_PATHS, MAX_PETALS, petalWidthScale, type PetalState } from '@/utils/petals';
import type { UiPlatform } from '@/utils/platform';
import { createLogger } from '@/utils/logger';
import type { TrayAction, TrayRow } from './trayMenuModel';
import type { TrayIconOpacities } from './trayProgress';

const log = createLogger('NativeTray');

/** 与 src-tauri/src/commands/tray.rs 的 TRAY_ID 一致 */
export const TRAY_ID = 'main-tray';

/**
 * 单色托盘图标的颜色（TrayWindow.dc.html 的 barIconStrong）：浅色任务栏上深色、深色任务栏上白色。
 * 这是画给系统任务栏的位图，跟任务栏走、不随应用主题，所以不用 --pn-* 令牌。
 * macOS 用模板图，系统只看透明度、自己上色，画成黑色即可。
 */
const ICON_INK = { onLight: '#171717', onDark: '#FFFFFF', template: '#000000' } as const;

/** 花瓣路径的坐标范围（与品牌 Logo 同：viewBox -4 -4 136 136） */
const PETAL_VIEWBOX = { origin: -4, size: 136 } as const;

type MenuEntry = MenuItemOptions | CheckMenuItemOptions | IconMenuItemOptions | SubmenuOptions | PredefinedMenuItemOptions;

/**
 * 换下来的菜单留这么久才释放：菜单正开着时被重建，正在显示的那份若被销毁，Windows 上会出错。
 * 用户看着菜单的这段时间里可能连着重建好几次（上传中每个图床传完一次），所以按时间留，不按「留一份」
 */
export const RETIRE_AFTER_MS = 60_000;

let trayPromise: Promise<TrayIcon | null> | null = null;
let currentMenu: Menu | null = null;
/** 已换下、还没释放的菜单与换下的时刻 */
let retired: { menu: Menu; at: number }[] = [];

function getTray(): Promise<TrayIcon | null> {
  trayPromise ??= TrayIcon.getById(TRAY_ID).catch((error) => {
    trayPromise = null;
    throw error;
  });
  return trayPromise;
}

interface PetalPaint {
  color: string;
  opacity: number;
}

/** 在 size×size 的画布上画花瓣，返回 RGBA。1–4 瓣用经典四瓣，5–8 瓣按 PetalScale 的规则旋转排布 */
function paintPetals(size: number, petals: readonly PetalPaint[]): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布不可用');
  const unit = size / PETAL_VIEWBOX.size;
  const classic = petals.length <= 4;
  const shown = classic ? petals : petals.slice(0, MAX_PETALS);
  const scale = petalWidthScale(shown.length);
  shown.forEach((petal, i) => {
    ctx.save();
    ctx.scale(unit, unit);
    ctx.translate(-PETAL_VIEWBOX.origin, -PETAL_VIEWBOX.origin);
    if (!classic) {
      ctx.translate(64, 64);
      ctx.rotate(((360 / shown.length) * i * Math.PI) / 180);
      ctx.translate(-64, -64);
      ctx.translate(64, 0);
      ctx.scale(scale, 1);
      ctx.translate(-64, 0);
    }
    ctx.globalAlpha = petal.opacity;
    ctx.fillStyle = petal.color;
    ctx.fill(new Path2D(classic ? CLASSIC_PETAL_PATHS[i] : CLASSIC_PETAL_PATHS[0]));
    ctx.restore();
  });
  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
}

/** 状态行前面的小花瓣：与首页 PetalGlyph 同色（令牌取自当前主题） */
function statusPetalPaints(states: readonly PetalState[]): PetalPaint[] {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const uploadingOpacity = Number.parseFloat(token('--pn-opacity-petal-uploading')) || 0.45;
  const paintOf = (state: PetalState): PetalPaint => {
    switch (state) {
      case 'ok': return { color: token('--pn-brand'), opacity: 1 };
      case 'uploading': return { color: token('--pn-brand'), opacity: uploadingOpacity };
      case 'waiting': return { color: token('--pn-petal-wait'), opacity: 1 };
      case 'failed': return { color: token('--pn-danger-fill'), opacity: 1 };
      case 'limited': return { color: token('--pn-warning-fill'), opacity: 1 };
      default: return { color: token('--pn-petal-empty'), opacity: 1 };
    }
  };
  // 超过 8 个图床按状态比例分到 8 瓣（与首页同一条规则）
  const shown = allocatePetals(states);
  const padded = shown.length < 4 ? [...shown, ...Array<PetalState>(4 - shown.length).fill('empty')] : shown;
  return padded.map(paintOf);
}

/** 菜单项图标按 16pt 画两倍大 */
const STATUS_ICON_PX = 32;

async function toEntry(row: TrayRow, dispatch: (action: TrayAction) => void, withAccelerators: boolean, images: Image[]): Promise<MenuEntry> {
  switch (row.kind) {
    case 'separator':
      return { item: 'Separator' };
    case 'status': {
      const icon = await Image.new(paintPetals(STATUS_ICON_PX, statusPetalPaints(row.petals)), STATUS_ICON_PX, STATUS_ICON_PX);
      images.push(icon);
      return { text: row.text, enabled: false, icon };
    }
    case 'item':
      return {
        text: row.text,
        enabled: row.enabled,
        ...(withAccelerators && row.accelerator ? { accelerator: row.accelerator } : {}),
        action: () => dispatch(row.action),
      };
    case 'check':
      return { text: row.text, checked: row.checked, enabled: row.enabled, action: () => dispatch(row.action) };
    case 'submenu':
      return { text: row.text, items: await Promise.all(row.items.map((item) => toEntry(item, dispatch, withAccelerators, images))) };
  }
}

async function buildMenu(rows: readonly TrayRow[], dispatch: (action: TrayAction) => void, withAccelerators: boolean): Promise<Menu> {
  const images: Image[] = [];
  try {
    const items = await Promise.all(rows.map((row) => toEntry(row, dispatch, withAccelerators, images)));
    return await Menu.new({ items });
  } finally {
    // 菜单项已经拿到了自己那份图标，图片资源用完即放
    await Promise.all(images.map((image) => image.close().catch(() => undefined)));
  }
}

/** 换上新菜单。快捷键写法系统认不出时（用户录了少见的组合键）去掉快捷键再建一次，菜单照样可用 */
export async function applyTrayMenu(rows: readonly TrayRow[], dispatch: (action: TrayAction) => void): Promise<void> {
  const tray = await getTray();
  if (!tray) return;
  let menu: Menu;
  try {
    menu = await buildMenu(rows, dispatch, true);
  } catch (error) {
    log.warn('托盘菜单建立失败，去掉快捷键后重试', error);
    menu = await buildMenu(rows, dispatch, false);
  }
  try {
    await tray.setMenu(menu);
  } catch (error) {
    await menu.close().catch(() => undefined);
    throw error;
  }
  const defaultPosition = rows.findIndex((row) => row.kind === 'item' && row.isDefault);
  if (defaultPosition >= 0) {
    await invoke('set_tray_default_item', { rid: menu.rid, position: defaultPosition })
      .catch((error) => log.warn('设置托盘默认项失败', error));
  }
  const now = Date.now();
  if (currentMenu) retired.push({ menu: currentMenu, at: now });
  currentMenu = menu;
  const expired = retired.filter((entry) => now - entry.at >= RETIRE_AFTER_MS);
  retired = retired.filter((entry) => now - entry.at < RETIRE_AFTER_MS);
  await Promise.all(expired.map(({ menu: old }) => old.close().catch((error) => log.warn('释放旧托盘菜单失败', error))));
}

export interface TrayIconLook {
  platform: UiPlatform;
  /** Windows 任务栏是不是浅色；读不到时为 null（按深色任务栏画，Windows 10 / 11 默认如此） */
  taskbarLight: boolean | null;
}

/** 托盘图标像素：Windows / Linux 按 16 / 22 的两倍以内画，macOS 菜单栏 18pt 的两倍 */
function iconPixels(platform: UiPlatform): number {
  return platform === 'macos' ? 36 : 32;
}

function iconInk(look: TrayIconLook): string {
  if (look.platform === 'macos') return ICON_INK.template;
  if (look.platform === 'windows' && look.taskbarLight) return ICON_INK.onLight;
  return ICON_INK.onDark;
}

/** 换托盘图标：单色四瓣，每瓣的不透明度来自 trayIconOpacities */
export async function applyTrayIcon(opacities: TrayIconOpacities, look: TrayIconLook): Promise<void> {
  const tray = await getTray();
  if (!tray) return;
  const size = iconPixels(look.platform);
  const ink = iconInk(look);
  const image = await Image.new(paintPetals(size, opacities.map((opacity) => ({ color: ink, opacity }))), size, size);
  try {
    await tray.setIcon(image);
    // macOS 每换一次图标，系统那边的「模板图」标记就被重置成否，每次都要重新标上
    if (look.platform === 'macos') await tray.setIconAsTemplate(true);
  } finally {
    await image.close().catch(() => undefined);
  }
}

/** 测试用 */
export function __resetNativeTrayForTests(): void {
  trayPromise = null;
  currentMenu = null;
  retired = [];
}
