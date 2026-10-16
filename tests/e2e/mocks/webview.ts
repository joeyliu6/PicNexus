import { getState, makeUnlisten } from './state';

const currentWebview = {
  label: 'main',
  async clearAllBrowsingData() {},
  async onDragDropEvent(handler: (event: { payload: unknown }) => void) {
    getState().dragDropHandler = handler;
    return makeUnlisten();
  },
};

export function getCurrentWebview() {
  return currentWebview;
}
