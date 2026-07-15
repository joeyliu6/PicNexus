import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import FloatingActionBar from '@/components/views/history/FloatingActionBar.vue';

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>();
  return {
    ...actual,
    onClickOutside: vi.fn(),
  };
});

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    config: ref({
      linkOutput: {
        defaultFormat: 'markdown',
        customTemplate: '',
        autoCopy: true,
      },
    }),
    saveConfig: vi.fn(),
  }),
}));

const FabStatusBarStub = {
  props: ['selectedCount', 'serviceCount'],
  emits: ['close'],
  template: '<button class="status-close-stub" @click="$emit(\'close\')">close {{ selectedCount }} {{ serviceCount }}</button>',
};

const FabCopySectionStub = {
  props: ['selectedCount'],
  emits: ['copy', 'format-change'],
  template: `
    <div class="copy-section-stub">
      <button class="format-html-stub" @click="$emit('format-change', 'html')">html</button>
      <button class="copy-stub" @click="$emit('copy', 'url')">copy {{ selectedCount }}</button>
    </div>
  `,
};

const FabServiceChipsStub = {
  props: ['services'],
  emits: ['copy-service'],
  template: '<button class="service-copy-stub" @click="$emit(\'copy-service\', services[0].serviceId)">service</button>',
};

function mountFab(props = {}) {
  return mountWithDefaults(FloatingActionBar, {
    props: {
      selectedCount: 3,
      visible: true,
      availableServices: [
        { serviceId: 'jd', count: 2 },
        { serviceId: 'github', count: 1 },
      ],
      favoriteState: 'none',
      ...props,
    },
    global: {
      stubs: {
        Transition: true,
        FabStatusBar: FabStatusBarStub,
        FabCopySection: FabCopySectionStub,
        FabServiceChips: FabServiceChipsStub,
      },
    },
  });
}

describe('FloatingActionBar', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('气泡面板转发格式复制与按图床复制', async () => {
    const wrapper = mountFab();

    await wrapper.get('.fab-bubble').trigger('click');
    await wrapper.get('.copy-stub').trigger('click');
    await wrapper.get('.format-html-stub').trigger('click');
    await wrapper.get('.service-copy-stub').trigger('click');

    expect(wrapper.find('.fab-bubble').exists()).toBe(true);
    expect(wrapper.find('.fab-panel').exists()).toBe(true);
    expect(wrapper.emitted('copy')).toEqual([
      ['url', undefined],
      ['html', 'jd'],
    ]);
  });

  it('导出会关闭面板并清空选择，删除只触发删除', async () => {
    const wrapper = mountFab();

    await wrapper.get('.fab-bubble').trigger('click');
    await wrapper.findAll('.panel-item')
      .find(button => button.text().includes('导出'))!
      .trigger('click');

    expect(wrapper.emitted('export')).toHaveLength(1);
    expect(wrapper.emitted('clear-selection')).toHaveLength(1);
    expect(wrapper.find('.fab-panel').exists()).toBe(false);

    await wrapper.get('.fab-bubble').trigger('click');
    await wrapper.findAll('.panel-item')
      .find(button => button.text().includes('删除'))!
      .trigger('click');

    expect(wrapper.emitted('delete')).toHaveLength(1);
  });

  it('收藏三态会决定按钮文案和 batch-favorite 方向', async () => {
    const wrapper = mountFab({ favoriteState: 'all' });

    await wrapper.get('.fab-bubble').trigger('click');
    const favoriteButton = wrapper.findAll('.panel-item')
      .find(button => button.text().includes('取消收藏'))!;

    expect(favoriteButton.classes()).toContain('panel-item-warn');

    await favoriteButton.trigger('click');

    expect(wrapper.emitted('batch-favorite')).toEqual([[false]]);
  });

  it('Esc：面板打开时先关面板，面板关闭时清空选择', async () => {
    const wrapper = mountFab();

    await wrapper.get('.fab-bubble').trigger('click');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.fab-panel').exists()).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('clear-selection')).toHaveLength(1);
  });

  it('状态栏关闭按钮直接清空选择', async () => {
    const wrapper = mountFab();

    await wrapper.get('.fab-bubble').trigger('click');
    await wrapper.get('.status-close-stub').trigger('click');

    expect(wrapper.emitted('clear-selection')).toHaveLength(1);
  });
});
