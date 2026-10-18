// @tauri-apps/api/tray 的模拟：托盘图标由 Rust 建好，这里只记下换上去的菜单与图标
import type { Menu } from './menu';
import { record } from './state';

export class TrayIcon {
  private constructor(readonly id: string) {}

  static async getById(id: string): Promise<TrayIcon | null> {
    return new TrayIcon(id);
  }

  async setMenu(menu: Menu | null): Promise<void> {
    globalThis.__PICNEXUS_E2E_TRAY_MENU__ = menu ?? undefined;
    record({ type: 'tray.setMenu', items: menu?.snapshot() ?? [] });
  }

  async setIcon(_icon: unknown): Promise<void> {
    record({ type: 'tray.setIcon' });
  }

  async setIconAsTemplate(_template: boolean): Promise<void> {}
}

declare global {
  /** 最近一次换上的托盘菜单（测试里可以直接调用某一项的点击回调） */
  var __PICNEXUS_E2E_TRAY_MENU__: Menu | undefined;
}
