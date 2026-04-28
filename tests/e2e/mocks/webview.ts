import { makeUnlisten } from './state';

const currentWebview = {
  label: 'main',
  async clearAllBrowsingData() {},
  async onDragDropEvent() {
    return makeUnlisten();
  },
};

export function getCurrentWebview() {
  return currentWebview;
}
