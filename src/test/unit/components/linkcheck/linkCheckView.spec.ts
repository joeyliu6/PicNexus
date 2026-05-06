import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithDefaults } from '../../../helpers/vueMount';
import { flushPromisesAndTicks, useFakeTimers } from '../../../helpers/wait';
import {
  getInvokeMock,
  resetTauriMocks,
} from '../../../helpers/tauriMock';
import { linkCheckRows, selectedLinkCheckRows } from '../../../fixtures/linkCheckRows';
import LinkCheckView from '../../../../components/views/LinkCheckView.vue';

const mockState = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  loadHistoryRows: vi.fn(),
  checkAllHistoryLinks: vi.fn(),
  checkSubset: vi.fn(),
  recheckSingle: vi.fn(),
  cancelCheck: vi.fn(),
  pauseCheck: vi.fn(),
  resumeCheck: vi.fn(),
  exportCsv: vi.fn(),
  removeRowsByKeys: vi.fn(),
  setFadingOutRows: vi.fn(),
  onViewActivated: vi.fn(),
  onViewDeactivated: vi.fn(),
  deleteHistoryResult: vi.fn(),
  bulkDeleteHistoryResults: vi.fn(),
  bulkRecheck: vi.fn(),
  bulkCopyUrls: vi.fn(),
  bulkDelete: vi.fn(),
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    success: mockState.toastSuccess,
  }),
}));

vi.mock('../../../../composables/useLinkCheck', () => ({
  useLinkCheckManager: () => ({
    isChecking: ref(false),
    isPaused: ref(false),
    isLoading: ref(false),
    loadError: ref(null),
    isPhase2Loading: ref(false),
    phase2Duration: ref(0),
    progress: ref({ checked: 0, total: 0 }),
    progressSource: ref('monitor'),
    checkRows: ref(linkCheckRows),
    loadHistoryRows: mockState.loadHistoryRows,
    checkAllHistoryLinks: mockState.checkAllHistoryLinks,
    checkSubset: mockState.checkSubset,
    recheckSingle: mockState.recheckSingle,
    cancelCheck: mockState.cancelCheck,
    pauseCheck: mockState.pauseCheck,
    resumeCheck: mockState.resumeCheck,
    exportCsv: mockState.exportCsv,
    removeRowsByKeys: mockState.removeRowsByKeys,
    setFadingOutRows: mockState.setFadingOutRows,
    onViewActivated: mockState.onViewActivated,
    onViewDeactivated: mockState.onViewDeactivated,
  }),
}));

vi.mock('../../../../composables/useHistory', () => ({
  useHistoryManager: () => ({
    deleteHistoryResult: mockState.deleteHistoryResult,
    bulkDeleteHistoryResults: mockState.bulkDeleteHistoryResults,
  }),
}));

vi.mock('../../../../composables/link-check/useLinkCheckBulkActions', () => ({
  useLinkCheckBulkActions: () => ({
    isBulkActing: ref(false),
    bulkRecheck: mockState.bulkRecheck,
    bulkCopyUrls: mockState.bulkCopyUrls,
    bulkDelete: mockState.bulkDelete,
  }),
}));

const HistoryCheckPanelStub = defineComponent({
  name: 'HistoryCheckPanel',
  props: [
    'checkRows',
    'isChecking',
    'isPaused',
    'isLoading',
    'loadError',
    'progress',
    'progressSource',
    'isActionLocked',
  ],
  emits: [
    'check-all',
    'check-subset',
    'cancel-check',
    'pause-check',
    'resume-check',
    'recheck-single',
    'export-csv',
    'export-csv-selected',
    'delete-row',
    'bulk-recheck',
    'bulk-copy',
    'bulk-delete',
  ],
  template: `
    <section data-testid="history-check-panel" :data-row-count="checkRows.length">
      <button class="check-all" @click="$emit('check-all')">check all</button>
      <button class="check-invalid" @click="$emit('check-subset', { filter: 'invalid' })">check invalid</button>
      <button class="cancel-check" @click="$emit('cancel-check')">cancel</button>
      <button class="pause-check" @click="$emit('pause-check')">pause</button>
      <button class="resume-check" @click="$emit('resume-check')">resume</button>
      <button class="recheck-one" @click="$emit('recheck-single', checkRows[1], 'invalid')">recheck</button>
      <button class="export-all" @click="$emit('export-csv')">export all</button>
      <button class="export-selected" @click="$emit('export-csv-selected', checkRows.slice(0, 2))">export selected</button>
      <button class="delete-one" @click="$emit('delete-row', checkRows[1])">delete one</button>
      <button class="bulk-recheck" @click="$emit('bulk-recheck', checkRows.slice(0, 2))">bulk recheck</button>
      <button class="bulk-copy" @click="$emit('bulk-copy', checkRows.slice(0, 2))">bulk copy</button>
      <button class="bulk-delete" @click="$emit('bulk-delete', checkRows.slice(0, 2))">bulk delete</button>
    </section>
  `,
});

const MdRescueInlineStub = defineComponent({
  name: 'MdRescueInline',
  template: '<section data-testid="rescue-panel" />',
});

const BatchMigratePanelStub = defineComponent({
  name: 'BatchMigratePanel',
  template: '<section data-testid="migrate-panel" />',
});

async function mountLinkCheckView(provide: Record<string, unknown> = {}) {
  const wrapper = mountWithDefaults(LinkCheckView, {
    global: {
      provide: {
        linkCheckTargetTab: ref<string | null>(null),
        ...provide,
      },
      stubs: {
        HistoryCheckPanel: HistoryCheckPanelStub,
        MdRescueInline: MdRescueInlineStub,
        BatchMigratePanel: BatchMigratePanelStub,
      },
    },
  });

  await flushPromisesAndTicks(2);
  return wrapper;
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  mockState.loadHistoryRows.mockResolvedValue(undefined);
  mockState.checkAllHistoryLinks.mockResolvedValue(undefined);
  mockState.checkSubset.mockResolvedValue(undefined);
  mockState.recheckSingle.mockResolvedValue(undefined);
  mockState.exportCsv.mockImplementation((rows) => `file,url\n${rows.map((row: any) => `${row.fileName},${row.url}`).join('\n')}`);
  mockState.deleteHistoryResult.mockResolvedValue(true);
  mockState.bulkDeleteHistoryResults.mockResolvedValue(true);
  mockState.bulkRecheck.mockResolvedValue(undefined);
  mockState.bulkCopyUrls.mockResolvedValue(undefined);
  mockState.bulkDelete.mockResolvedValue(undefined);
  getInvokeMock().mockResolvedValue('C:/tmp/link-check.csv');
});

describe('LinkCheckView page interactions', () => {
  it('loads monitor rows and switches between monitor, rescue, and migrate tabs', async () => {
    const targetTab = ref<string | null>(null);
    const wrapper = await mountLinkCheckView({ linkCheckTargetTab: targetTab });

    expect(mockState.loadHistoryRows).toHaveBeenCalled();
    targetTab.value = 'rescue';
    await flushPromisesAndTicks();

    expect(wrapper.find('[data-testid="rescue-panel"]').exists()).toBe(true);
    expect(targetTab.value).toBeNull();

    await wrapper.findAll('.lc-tab')[2].trigger('click');
    expect(wrapper.find('[data-testid="migrate-panel"]').exists()).toBe(true);

    await wrapper.findAll('.lc-tab')[0].trigger('click');
    expect(wrapper.get('[data-testid="history-check-panel"]').attributes('data-row-count')).toBe(String(linkCheckRows.length));
  });

  it('forwards monitor check, pause, resume, cancel, recheck, and bulk actions', async () => {
    const wrapper = await mountLinkCheckView();

    await wrapper.get('.check-all').trigger('click');
    await wrapper.get('.check-invalid').trigger('click');
    await wrapper.get('.pause-check').trigger('click');
    await wrapper.get('.resume-check').trigger('click');
    await wrapper.get('.cancel-check').trigger('click');
    await wrapper.get('.recheck-one').trigger('click');
    await wrapper.get('.bulk-recheck').trigger('click');
    await wrapper.get('.bulk-copy').trigger('click');
    await wrapper.get('.bulk-delete').trigger('click');

    expect(mockState.checkAllHistoryLinks).toHaveBeenCalled();
    expect(mockState.checkSubset).toHaveBeenCalledWith({ filter: 'invalid' });
    expect(mockState.pauseCheck).toHaveBeenCalled();
    expect(mockState.resumeCheck).toHaveBeenCalled();
    expect(mockState.cancelCheck).toHaveBeenCalled();
    expect(mockState.recheckSingle).toHaveBeenCalledWith(linkCheckRows[1], 'invalid');
    expect(mockState.bulkRecheck).toHaveBeenCalledWith(selectedLinkCheckRows);
    expect(mockState.bulkCopyUrls).toHaveBeenCalledWith(selectedLinkCheckRows);
    expect(mockState.bulkDelete).toHaveBeenCalledWith(selectedLinkCheckRows);
  });

  it('exports all and selected rows through centralized dialog and fs mocks', async () => {
    const wrapper = await mountLinkCheckView();

    await wrapper.get('.export-all').trigger('click');
    await flushPromisesAndTicks();

    expect(getInvokeMock()).toHaveBeenCalledWith('export_text_file', expect.objectContaining({
      defaultPath: expect.stringMatching(/^link-check-\d+\.csv$/),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }));
    expect((getInvokeMock().mock.calls[0][1] as { content: string }).content).toContain('valid-jd.jpg');
    expect(mockState.toastSuccess).toHaveBeenCalledWith('导出成功', '已保存至 C:/tmp/link-check.csv');

    await wrapper.get('.export-selected').trigger('click');
    await flushPromisesAndTicks();

    expect(getInvokeMock()).toHaveBeenLastCalledWith('export_text_file', expect.objectContaining({
      defaultPath: expect.stringMatching(/^link-check-selected-\d+\.csv$/),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }));
    expect(mockState.exportCsv).toHaveBeenLastCalledWith(selectedLinkCheckRows);
  });

  it('deletes a single row and removes it after the fade-out delay', async () => {
    const timers = useFakeTimers();
    const wrapper = await mountLinkCheckView();

    await wrapper.get('.delete-one').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.deleteHistoryResult).toHaveBeenCalledWith('hist-broken-weibo', 'weibo');
    expect(mockState.setFadingOutRows).toHaveBeenCalledWith([linkCheckRows[1]], true);
    expect(mockState.removeRowsByKeys).not.toHaveBeenCalled();

    await timers.advanceBy(380);
    expect(mockState.removeRowsByKeys).toHaveBeenCalledWith([linkCheckRows[1]]);

    timers.restore();
  });
});
