import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import CopyButton from '../../../components/common/CopyButton.vue';

const copyLinkMock = vi.fn();
const configState = {
  value: {
    linkOutput: {
      customTemplate: '{url}',
    },
  },
};

vi.mock('@vueuse/core', () => ({
  onClickOutside: vi.fn(),
}));

vi.mock('../../../composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLink: copyLinkMock,
  }),
}));

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: configState,
  }),
}));

describe('CopyButton', () => {
  const item = {
    url: 'https://example.com/a.png',
    fileName: 'a.png',
    serviceId: 'jd',
  } as const;

  beforeEach(() => {
    copyLinkMock.mockReset();
    configState.value.linkOutput.customTemplate = '{url}';
  });

  it('copies default format on left click', async () => {
    const wrapper = mount(CopyButton, {
      props: { item },
    });

    await wrapper.get('.copy-btn').trigger('click');

    expect(copyLinkMock).toHaveBeenCalledTimes(1);
    expect(copyLinkMock).toHaveBeenLastCalledWith(expect.objectContaining(item));
  });

  it('supports explicit format dropdown with menuTrigger=button', async () => {
    const wrapper = mount(CopyButton, {
      props: {
        item,
        menuTrigger: 'button',
      },
    });

    await wrapper.get('.menu-toggle-btn').trigger('click');
    await nextTick();

    const markdownItem = wrapper.findAll('.format-item')
      .find(node => node.text().includes('Markdown'));

    expect(markdownItem).toBeTruthy();
    await markdownItem!.trigger('click');

    expect(copyLinkMock).toHaveBeenCalledTimes(1);
    expect(copyLinkMock).toHaveBeenLastCalledWith(
      expect.objectContaining(item),
      { format: 'markdown' }
    );
  });

  it('hides custom format option when custom template is empty', async () => {
    configState.value.linkOutput.customTemplate = '';
    const wrapper = mount(CopyButton, {
      props: {
        item,
        menuTrigger: 'button',
      },
    });

    await wrapper.get('.menu-toggle-btn').trigger('click');
    await nextTick();

    expect(wrapper.findAll('.format-item')).toHaveLength(4);
  });
});
