import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const m = vi.hoisted(() => ({
  uploadFiles: vi.fn(),
  pasteClipboard: vi.fn(),
  dragHandler: null as null | ((event: { payload: Record<string, unknown> }) => void),
  selected: true,
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async (handler: (event: { payload: Record<string, unknown> }) => void) => {
      m.dragHandler = handler;
      return vi.fn();
    }),
  }),
}));

vi.mock('@/composables/upload/useUploadController', () => ({
  useUploadController: () => ({
    uploadFiles: m.uploadFiles,
    pasteClipboard: m.pasteClipboard,
    hosts: ref([{ id: 'jd', name: '京东', selected: m.selected, warning: null, cookieLogin: false }]),
  }),
}));

import { useGlobalUploadInput, type DropOverlayState } from '@/shell/useGlobalUploadInput';

async function mountInput(path = '/home') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/home', '/gallery', '/health'].map((p) => ({ path: p, component: { template: '<div />' } })),
  });
  await router.push(path);
  let overlay: DropOverlayState | null = null;
  const Host = defineComponent({
    setup() {
      overlay = useGlobalUploadInput().overlay;
      return () => h('div', [h('input', { class: 'text' }), h('div', { class: 'plain', tabindex: 0 })]);
    },
  });
  const wrapper = mount(Host, { global: { plugins: [router] }, attachTo: document.body });
  await vi.waitFor(() => expect(m.dragHandler).not.toBeNull());
  return { wrapper, overlay: () => overlay!, router };
}

function pressPaste(target: Element) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
}

describe('useGlobalUploadInput', () => {
  beforeEach(() => {
    m.uploadFiles.mockReset();
    m.pasteClipboard.mockReset();
    m.dragHandler = null;
    m.selected = true;
    document.body.innerHTML = '';
  });

  it('pastes on Ctrl+V anywhere on the page but leaves text fields alone', async () => {
    const { wrapper } = await mountInput('/gallery');
    pressPaste(wrapper.get('.plain').element);
    expect(m.pasteClipboard).toHaveBeenCalledTimes(1);

    pressPaste(wrapper.get('.text').element);
    expect(m.pasteClipboard).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('shows the overlay with the skipped files, then uploads only the images', async () => {
    const { wrapper, overlay } = await mountInput();
    m.dragHandler!({ payload: { type: 'enter', paths: ['C:/a.png', 'C:/b.zip'] } });
    expect(overlay()).toMatchObject({ active: true, imageCount: 1, skippedText: '包含 1 个 .zip 文件，将被跳过' });

    m.dragHandler!({ payload: { type: 'drop', paths: ['C:/a.png', 'C:/b.zip'] } });
    expect(overlay().active).toBe(false);
    expect(m.uploadFiles).toHaveBeenCalledWith(['C:/a.png']);
    wrapper.unmount();
  });

  it('does not upload when no host is selected', async () => {
    m.selected = false;
    const { wrapper } = await mountInput();
    m.dragHandler!({ payload: { type: 'drop', paths: ['C:/a.png'] } });
    expect(m.uploadFiles).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // 弹窗开着时拖进来：不出遮罩、不上传，免得在对话框背后悄悄传图
  it('ignores drags while a dialog or the command palette is open', async () => {
    const { wrapper, overlay } = await mountInput();
    const layer = document.createElement('div');
    layer.className = 'pn-dialog';
    layer.dataset.state = 'open';
    document.body.append(layer);

    m.dragHandler!({ payload: { type: 'enter', paths: ['C:/a.png'] } });
    expect(overlay().active).toBe(false);
    m.dragHandler!({ payload: { type: 'drop', paths: ['C:/a.png'] } });
    expect(m.uploadFiles).not.toHaveBeenCalled();

    layer.className = 'command-palette';
    m.dragHandler!({ payload: { type: 'drop', paths: ['C:/a.png'] } });
    expect(m.uploadFiles).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // 链接健康页按新设计重写后不再自己接 .md，拖入回到全局上传入口
  it('uploads drops on the 链接健康 page like on every other page', async () => {
    const { wrapper, overlay } = await mountInput('/health');
    m.dragHandler!({ payload: { type: 'enter', paths: ['C:/a.png'] } });
    expect(overlay().active).toBe(true);
    m.dragHandler!({ payload: { type: 'drop', paths: ['C:/a.png'] } });
    expect(m.uploadFiles).toHaveBeenCalledWith(['C:/a.png']);
    wrapper.unmount();
  });
});
