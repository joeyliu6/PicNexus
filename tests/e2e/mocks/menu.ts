// @tauri-apps/api/menu 的模拟：托盘菜单只记下建出来的结构（tray.ts 的 setMenu 把它写进调用记录），
// 端到端测试据此核对托盘与首页 / 设置页是同一份配置。点击回调保留，测试可以直接调用。
import { record } from './state';

export interface MockMenuEntry {
  text?: string;
  enabled?: boolean;
  checked?: boolean;
  accelerator?: string;
  item?: unknown;
  icon?: unknown;
  items?: MockMenuEntry[];
  action?: (id: string) => void;
}

let nextRid = 1;

function strip(entry: MockMenuEntry): MockMenuEntry {
  const { action: _action, icon, items, ...rest } = entry;
  return { ...rest, ...(icon ? { icon: 'image' } : {}), ...(items ? { items: items.map(strip) } : {}) };
}

export class Menu {
  readonly rid = nextRid++;

  private constructor(readonly items: MockMenuEntry[]) {}

  static async new(options: { items?: MockMenuEntry[] } = {}): Promise<Menu> {
    return new Menu(options.items ?? []);
  }

  /** 去掉回调后的结构，给调用记录用 */
  snapshot(): MockMenuEntry[] {
    return this.items.map(strip);
  }

  async close(): Promise<void> {
    record({ type: 'tray.closeMenu', rid: this.rid });
  }
}
