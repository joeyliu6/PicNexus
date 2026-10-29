// 从 URL 下载（H10）：底栏的提交快捷键照全应用的写法（交接说明 3.3：Ctrl+Enter，macOS ⌘Enter），同命令面板底栏
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('@/utils/platform', () => ({ uiPlatform: () => 'windows' }));
vi.mock('@/composables/upload/useUrlDownload', () => ({ useUrlDownload: () => ({ parseUrls: (text: string) => text.split('\n').filter(Boolean) }) }));

const { default: UrlDownloadDialog } = await import('@/views/home/UrlDownloadDialog.vue');

afterEach(() => { document.body.innerHTML = ''; });

describe('UrlDownloadDialog', () => {
  it('writes the submit shortcut as Ctrl+Enter', async () => {
    mount(UrlDownloadDialog, { props: { open: true, hostNames: ['京东'], downloading: false }, attachTo: document.body });
    await nextTick();
    expect(document.body.textContent).toContain('Ctrl+Enter 提交');
  });
});
