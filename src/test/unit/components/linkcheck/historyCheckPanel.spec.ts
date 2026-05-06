import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithDefaults } from '../../../helpers/vueMount';
import { flushPromisesAndTicks, useFakeTimers } from '../../../helpers/wait';
import HistoryCheckPanel from '../../../../components/views/linkcheck/HistoryCheckPanel.vue';
import { createCheckLinkResult, createLinkCheckRow } from '../../../factories/linkCheckFactory';
import type { LinkCheckRow } from '../../../../types/linkCheck';

const toastSilent = vi.fn();
const toastError = vi.fn();

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    silent: toastSilent,
    error: toastError,
  }),
}));

vi.mock('../../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: ref({}),
    getActivePrefix: vi.fn(),
  }),
}));

function invalidRow(overrides: Partial<LinkCheckRow> = {}) {
  return createLinkCheckRow({
    historyId: 'hist-invalid',
    serviceId: 'jd',
    fileName: 'broken-jd.jpg',
    checkResult: createCheckLinkResult({ is_valid: false, status_code: 404, error_type: 'http_4xx' }),
    ...overrides,
  });
}

function validRow(overrides: Partial<LinkCheckRow> = {}) {
  return createLinkCheckRow({
    historyId: 'hist-valid',
    serviceId: 'github',
    fileName: 'ok-github.jpg',
    checkResult: createCheckLinkResult({ is_valid: true, status_code: 200 }),
    ...overrides,
  });
}

function mountPanel(props = {}) {
  return mountWithDefaults(HistoryCheckPanel, {
    props: {
      checkRows: [],
      isChecking: false,
      isPaused: false,
      isLoading: false,
      isPhase2Loading: false,
      phase2Duration: 0,
      progress: null,
      progressSource: null,
      isActionLocked: false,
      ...props,
    },
    global: {
      stubs: {
        Skeleton: { template: '<span class="skeleton-stub" />' },
      },
    },
  });
}

describe('HistoryCheckPanel', () => {
  beforeEach(() => {
    toastSilent.mockClear();
    toastError.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('首次加载时展示完整骨架屏', () => {
    const wrapper = mountPanel({ isLoading: true });

    expect(wrapper.find('.lc-skeleton-panel').exists()).toBe(true);
    expect(wrapper.findAll('.lc-sk-link-row')).toHaveLength(12);
  });

  it('筛选 chip 和搜索框会改变可见行', async () => {
    const timers = useFakeTimers();
    const wrapper = mountPanel({
      checkRows: [
        invalidRow(),
        validRow(),
        createLinkCheckRow({ historyId: 'hist-unchecked', serviceId: 'smms', fileName: 'pending-smms.jpg' }),
      ],
    });

    expect(wrapper.text()).toContain('broken-jd.jpg');
    expect(wrapper.text()).not.toContain('ok-github.jpg');

    await wrapper.get('.chip--all').trigger('click');
    await flushPromisesAndTicks();
    expect(wrapper.text()).toContain('ok-github.jpg');

    await wrapper.get('input[aria-label="搜索链接文件名"]').setValue('ok-github');
    await timers.advanceBy(250);

    expect(wrapper.text()).toContain('ok-github.jpg');
    expect(wrapper.text()).not.toContain('broken-jd.jpg');
    timers.restore();
  });

  it('[BUG 回归] 主检测按钮会把当前搜索条件带入状态子集检测', async () => {
    const timers = useFakeTimers();
    try {
      const wrapper = mountPanel({
        checkRows: [
          createLinkCheckRow({ historyId: 'hist-alpha', serviceId: 'jd', fileName: 'alpha-pending.jpg' }),
          createLinkCheckRow({ historyId: 'hist-beta', serviceId: 'jd', fileName: 'beta-pending.jpg' }),
        ],
      });

      await wrapper.get('.chip--unchecked').trigger('click');
      await wrapper.get('input[aria-label="搜索链接文件名"]').setValue('alpha');
      await timers.advanceBy(250);
      await wrapper.get('.btn-primary').trigger('click');

      expect(wrapper.emitted('check-subset')).toEqual([[
        { statusFilter: 'unchecked', searchQuery: 'alpha' },
      ]]);
    } finally {
      timers.restore();
    }
  });

  it('复制链接会写入剪贴板并显示复制反馈', async () => {
    const row = invalidRow({ url: 'https://img.example.com/broken.jpg' });
    const wrapper = mountPanel({ checkRows: [row] });

    await wrapper.get('.service-badge').trigger('click');
    await flushPromisesAndTicks();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://img.example.com/broken.jpg');
    expect(toastSilent).toHaveBeenCalledWith('log', '已复制到剪贴板');
    expect(wrapper.get('.service-badge').classes()).toContain('is-copied');
  });

  it('选中后智能主按钮执行批量重检并清空选择', async () => {
    const row = invalidRow();
    const wrapper = mountPanel({ checkRows: [row] });

    await wrapper.get('.link-row').trigger('click');
    expect(wrapper.text()).toContain('重检选中 (1)');

    await wrapper.get('.btn-primary').trigger('click');

    expect(wrapper.emitted('bulk-recheck')).toEqual([[[row]]]);
    expect(wrapper.text()).not.toContain('已选 1 条');
  });

  it('更多菜单支持导出、复制、删除当前筛选结果', async () => {
    const row = invalidRow();
    const wrapper = mountPanel({ checkRows: [row] });

    await wrapper.get('.overflow-toggle').trigger('click');
    await flushPromisesAndTicks();

    const items = wrapper.findAll('.overflow-dropdown-item');
    await items.find(item => item.text().includes('导出'))!.trigger('click');

    await wrapper.get('.overflow-toggle').trigger('click');
    await flushPromisesAndTicks();
    await wrapper.findAll('.overflow-dropdown-item')
      .find(item => item.text().includes('复制链接'))!
      .trigger('click');

    await wrapper.get('.overflow-toggle').trigger('click');
    await flushPromisesAndTicks();
    await wrapper.findAll('.overflow-dropdown-item')
      .find(item => item.text().includes('删除'))!
      .trigger('click');

    expect(wrapper.emitted('export-csv')).toEqual([[[row]]]);
    expect(wrapper.emitted('bulk-copy')).toEqual([[[row]]]);
    expect(wrapper.emitted('bulk-delete')).toEqual([[[row]]]);
  });

  it('运行中展示暂停/继续/取消并锁定行级动作', async () => {
    const wrapper = mountPanel({
      checkRows: [invalidRow()],
      isChecking: true,
      progressSource: 'monitor',
      progress: { checked: 2, total: 5, current_url: 'https://img.example.com/a.jpg' },
    });

    await wrapper.get('.btn-ghost').trigger('click');
    await wrapper.get('.btn-danger').trigger('click');

    expect(wrapper.text()).toContain('检测中');
    expect(wrapper.emitted('pause-check')).toHaveLength(1);
    expect(wrapper.emitted('cancel-check')).toHaveLength(1);
    expect(wrapper.get('.recheck-btn').attributes('disabled')).toBeDefined();

    await wrapper.setProps({ isPaused: true });
    await wrapper.get('.btn-primary').trigger('click');
    expect(wrapper.emitted('resume-check')).toHaveLength(1);
  });
});
