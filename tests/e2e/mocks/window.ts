import { makeUnlisten } from './state';

export class LogicalSize {
  constructor(
    public width: number,
    public height: number,
  ) {}
}

export class PhysicalPosition {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

const currentWindow = {
  label: 'main',
  async show() {},
  async hide() {},
  async minimize() {},
  async unminimize() {},
  async toggleMaximize() {},
  async close() {},
  async setFocus() {},
  async setMinSize(_size: LogicalSize | null) {},
  async setMaxSize(_size: LogicalSize | null) {},
  async setSize(_size: LogicalSize) {},
  async setPosition(_position: PhysicalPosition) {},
  async outerPosition() {
    return { x: 1200, y: 600 };
  },
  async scaleFactor() {
    return 1;
  },
  async onFocusChanged() {
    return makeUnlisten();
  },
};

export class Window {
  static async getByLabel(_label: string) {
    return currentWindow;
  }
}

export function getCurrentWindow() {
  return currentWindow;
}

export async function monitorFromPoint(_x: number, _y: number) {
  return {
    scaleFactor: 1,
    workArea: {
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
    },
  };
}
