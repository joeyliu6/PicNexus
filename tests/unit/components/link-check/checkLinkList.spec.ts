import { describe, expect, it, vi } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';
import CheckLinkList from '@/components/views/link-check/history-check/CheckLinkList.vue';
import { createCheckLinkResult, createLinkCheckRow } from '../../factories/linkCheckFactory';
import type { CheckStatsResult } from '@/composables/link-check/useCheckStats';
import type { LinkCheckRow, StatusFilter } from '@/types/linkCheck';
import type { CopyHint } from '@/composables/link-check/rowCopies';

const emptyStats: CheckStatsResult = {
  total: 0,
  valid: 0,
  invalid: 0,
  timeout: 0,
  suspicious: 0,
  unchecked: 0,
  checked: 0,
  problems: 0,
};

function mountList(options: {
  rows?: LinkCheckRow[];
  filteredRows?: LinkCheckRow[];
  stats?: CheckStatsResult;
  selectedIds?: Set<string>;
  isChecking?: boolean;
  isActionLocked?: boolean;
  copiedKey?: string | null;
  loadError?: string | null;
  statusFilter?: StatusFilter;
  rowThumbSrcs?: (row: LinkCheckRow) => string[];
  rowHint?: (row: LinkCheckRow) => CopyHint | null;
} = {}) {
  const rows = options.rows ?? [];

  return mountWithDefaults(CheckLinkList, {
    props: {
      visibleRows: rows,
      filteredRows: options.filteredRows ?? rows,
      stats: options.stats ?? {
        ...emptyStats,
        total: rows.length,
        checked: rows.filter(row => row.checkResult).length,
      },
      statusFilter: options.statusFilter ?? 'invalid',
      isLoading: false,
      loadError: options.loadError ?? null,
      isChecking: options.isChecking ?? false,
      isActionLocked: options.isActionLocked ?? false,
      suppressListMotion: false,
      selectedIds: options.selectedIds ?? new Set<string>(),
      copiedKey: options.copiedKey ?? null,
      rowThumbSrcs: options.rowThumbSrcs ?? vi.fn(() => []),
      rowHint: options.rowHint ?? vi.fn(() => null),
    },
    global: {
      stubs: {
        EmptyState: {
          props: ['title', 'description'],
          template: '<section class="empty-state-stub">{{ title }}{{ description }}</section>',
        },
      },
    },
  });
}

describe('CheckLinkList', () => {
  it('未检测数据首次进入时展示时间轴同款空态', () => {
    const wrapper = mountList({
      stats: { ...emptyStats, total: 4, unchecked: 4 },
    });

    expect(wrapper.find('.empty-state-stub').exists()).toBe(true);
    expect(wrapper.text()).toContain('检查你的图片链接');
    expect(wrapper.find('.hero-cta').exists()).toBe(false);
  });

  it('renders unchecked rows instead of the first-run empty state when the filter has matches', () => {
    const row = createLinkCheckRow({
      historyId: 'hist-unchecked',
      serviceId: 'smms',
      fileName: 'pending-smms.jpg',
    });
    const wrapper = mountList({
      rows: [row],
      filteredRows: [row],
      stats: { ...emptyStats, total: 1, unchecked: 1 },
    });

    expect(wrapper.find('.empty-state-stub').exists()).toBe(false);
    expect(wrapper.find('.link-row').exists()).toBe(true);
    expect(wrapper.text()).toContain('pending-smms.jpg');
  });

  it('空筛选和无数据分别展示对应 empty 状态', () => {
    const filteredEmpty = mountList({
      statusFilter: 'valid',
      stats: { ...emptyStats, total: 2, checked: 2, invalid: 2, problems: 2 },
      filteredRows: [],
    });
    const noData = mountList({ stats: emptyStats });

    expect(filteredEmpty.text()).toContain('当前筛选暂无结果');
    expect(noData.text()).toContain('暂无数据');
    expect(noData.text()).toContain('尚无上传历史记录');
    expect(noData.text()).not.toContain('尚无上传历史记录。');
  });

  it('加载失败时优先展示错误空态', () => {
    const wrapper = mountList({
      loadError: 'database unavailable',
      stats: emptyStats,
    });

    expect(wrapper.text()).toContain('加载失败');
    expect(wrapper.text()).toContain('database unavailable');
    expect(wrapper.text()).not.toContain('暂无数据');
  });

  it('行级选择、复制、重检、删除都会 emit', async () => {
    const row = createLinkCheckRow({
      historyId: 'hist-1',
      serviceId: 'jd',
      fileName: 'broken.jpg',
      checkResult: createCheckLinkResult({ is_valid: false, status_code: 404, error_type: 'http_4xx' }),
    });
    const wrapper = mountList({ rows: [row] });

    await wrapper.get('.link-row').trigger('click');
    await wrapper.get('.service-badge').trigger('click');
    await wrapper.get('.recheck-btn').trigger('click');
    await wrapper.get('.delete-btn').trigger('click');

    expect(wrapper.emitted('toggle-select')).toEqual([['hist-1|jd', expect.any(MouseEvent)]]);
    expect(wrapper.emitted('copy-url')).toEqual([[row]]);
    expect(wrapper.emitted('recheck-single')).toEqual([[row]]);
    expect(wrapper.emitted('delete-row')).toEqual([[row]]);
  });

  it('选中、复制成功、重检中和重检结果状态都有可见反馈', () => {
    const loadingRow = createLinkCheckRow({
      historyId: 'hist-1',
      serviceId: 'jd',
      fileName: 'loading.jpg',
      checkResult: createCheckLinkResult({ is_valid: false, status_code: 500, error_type: 'http_5xx' }),
      recheckLoading: true,
    });
    const recheckedRow = createLinkCheckRow({
      historyId: 'hist-2',
      serviceId: 'github',
      fileName: 'fixed.jpg',
      checkResult: createCheckLinkResult({ is_valid: false, status_code: 404, error_type: 'http_4xx' }),
      recheckResult: createCheckLinkResult({ is_valid: true, status_code: 200 }),
    });
    const wrapper = mountList({
      rows: [loadingRow, recheckedRow],
      selectedIds: new Set(['hist-1|jd']),
      copiedKey: 'link-check:hist-1|jd',
    });

    expect(wrapper.get('.link-row').classes()).toContain('row-selected');
    expect(wrapper.get('.service-badge').classes()).toContain('is-copied');
    expect(wrapper.get('.recheck-btn').classes()).toContain('spinning');
    expect(wrapper.get('.recheck-result-badge').classes()).toContain('badge-valid');
  });

  it('检测中或动作锁定时禁用行级破坏性操作', () => {
    const row = createLinkCheckRow({
      checkResult: createCheckLinkResult({ is_valid: false, status_code: 404, error_type: 'http_4xx' }),
    });
    const wrapper = mountList({ rows: [row], isChecking: true, isActionLocked: true });

    expect(wrapper.get('.recheck-btn').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.delete-btn').attributes('disabled')).toBeDefined();
  });

  it('状态用白话显示，重检结果优先，主链接与后果提示可见', () => {
    const broken = createLinkCheckRow({
      historyId: 'hist-1',
      serviceId: 'webdav:a',
      isPrimary: true,
      checkResult: createCheckLinkResult({ is_valid: false, status_code: 502, error_type: 'http_5xx' }),
    });
    const fixed = createLinkCheckRow({
      historyId: 'hist-2',
      checkResult: createCheckLinkResult({ is_valid: false, status_code: 404, error_type: 'http_4xx' }),
      recheckResult: createCheckLinkResult({ is_valid: true, status_code: 200 }),
    });
    const wrapper = mountList({
      rows: [broken, fixed],
      rowHint: (row) => (row.historyId === 'hist-1' ? { text: '其他图床正常', tone: 'ok', tooltip: '' } : null),
    });

    const rows = wrapper.findAll('.link-row');
    expect(rows[0].get('.status-pill').text()).toBe('图床故障');
    expect(rows[0].get('.status-pill').classes()).toContain('status-pill--error');
    expect(rows[0].find('.primary-tag').exists()).toBe(true);
    expect(rows[0].get('.copy-hint').text()).toBe('其他图床正常');
    expect(rows[1].get('.status-pill').text()).toBe('正常');
    expect(rows[1].find('.primary-tag').exists()).toBe(false);
    expect(rows[1].find('.copy-hint').exists()).toBe(false);
    expect(rows[0].text()).not.toContain('502');
  });

  it('问题筛选下检测过且没有问题 → 正面空态，而不是「当前筛选暂无结果」', () => {
    const wrapper = mountList({
      statusFilter: 'problems',
      stats: { ...emptyStats, total: 15, checked: 13, valid: 13, unchecked: 2 },
      filteredRows: [],
    });
    expect(wrapper.text()).toContain('没有发现问题');
    expect(wrapper.text()).toContain('还有 2 条未检测');
    expect(wrapper.text()).not.toContain('当前筛选暂无结果');

    const valid = mountList({
      statusFilter: 'valid',
      stats: { ...emptyStats, total: 15, checked: 13, valid: 13, unchecked: 2 },
      filteredRows: [],
    });
    expect(valid.text()).toContain('当前筛选暂无结果');
  });
});

