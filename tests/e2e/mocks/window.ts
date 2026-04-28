import { makeUnlisten } from './state';

const currentWindow = {
  label: 'main',
  async show() {},
  async hide() {},
  async minimize() {},
  async toggleMaximize() {},
  async close() {},
  async onFocusChanged() {
    return makeUnlisten();
  },
};

export function getCurrentWindow() {
  return currentWindow;
}
