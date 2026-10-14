import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks, useFakeTimers } from '../../helpers/wait';
import { getInvokeMock, resetTauriMocks } from '../../helpers/tauriMock';
import { linkCheckRows } from '../../fixtures/linkCheckRows';
import LinkCheckView from '@/components/views/LinkCheckView.vue';

const mockState = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastWarn: vi.fn(),
  toastError: vi.fn(),
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
  setPrimaryServices: vi.fn(),
  onViewActivated: vi.fn(),
  onViewDeactivated: vi.fn(),
  bulkDeleteHistoryResults: vi.fn(),
  switchPrimaryService: vi.fn(),
  emitHistoryUpdated: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: mockState.toastSuccess, warn: mockState.toastWarn, error: mockState.toastError }),
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({ config: ref({}) }),
}));

vi.mock('@/services/database', () => ({
  historyDB: { switchPrimaryService: mockState.switchPrimaryService },
}));

vi.mock('@/events/cacheEvents', () => ({
  emitHistoryUpdated: mockState.emitHistoryUpdated,
}));

vi.mock('@/composables/link-check/useLinkCheck', () => ({
  useLinkCheckManager: () => ({
    isChecking: ref(false),
    isPaused: ref(false),
    isLoading: ref(false),
    loadError: ref(null),
    isPhase2Loading: ref(false),
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
    setPrimaryServices: mockState.setPrimaryServices,
    onViewActivated: mockState.onViewActivated,
    onViewDeactivated: mockState.onViewDeactivated,
  }),
}));

vi.mock('@/composables/history/useHistory', () => ({
  useHistoryManager: () => ({ bulkDeleteHistoryResults: mockState.bulkDeleteHistoryResults }),
}));

const imageEntry = { historyId: 'hist-broken-weibo', fileName: 'broken-weibo.jpg', rows: [linkCheckRows[1]] };

const HistoryCheckPanelStub = defineComponent({
  name: 'HistoryCheckPanel',
  props: ['checkRows', 'isChecking', 'isPaused', 'isLoading', 'loadError', 'isPhase2Loading', 'progress', 'progressSource', 'isActionLocked'],
  emits: ['check-all', 'check-subset', 'cancel-check', 'pause-check', 'resume-check', 'recheck-image', 'promote', 'remove-links', 'export-csv', 'navigate', 'retry'],
  setup() {
    return { imageEntry };
  },
  template: `
    <section data-testid="history-check-panel" :data-row-count="checkRows.length" :data-locked="String(isActionLocked)">
      <button class="check-all" @click="$emit('check-all')" />
      <button class="check-unchecked" @click="$emit('check-subset', { statusFilter: 'unchecked' })" />
      <button class="cancel-check" @click="$emit('cancel-check')" />
      <button class="pause-check" @click="$emit('pause-check')" />
      <button class="resume-check" @click="$emit('resume-check')" />
      <button class="recheck-image" @click="$emit('recheck-image', checkRows.slice(0, 2))" />
      <button class="promote-two" @click="$emit('promote', [{ historyId: 'h1', serviceId: 'jd' }, { historyId: 'h2', serviceId: 'r2' }])" />
      <button class="promote-one" @click="$emit('promote', [{ historyId: 'h1', serviceId: 'jd' }])" />
      <button class="remove-image" @click="$emit('remove-links', [checkRows[1]], { kind: 'image', entry: imageEntry })" />
      <button class="remove-lost" @click="$emit('remove-links', checkRows.slice(0, 2), { kind: 'lost', images: 2 })" />
      <button class="export" @click="$emit('export-csv', checkRows.slice(0, 2))" />
      <button class="go-rescue" @click="$emit('navigate', 'rescue')" />
      <button class="retry" @click="$emit('retry')" />
    </section>
  `,
});

async function mountLinkCheckView(provide: Record<string, unknown> = {}) {
  const wrapper = mountWithDefaults(LinkCheckView, {
    global: {
      provide: { linkCheckTargetTab: ref<string | null>(null), ...provide },
      stubs: {
        HistoryCheckPanel: HistoryCheckPanelStub,
        MdRescueInline: defineComponent({ name: 'MdRescueInline', template: '<section data-testid="rescue-panel" />' }),
        BatchMigratePanel: defineComponent({ name: 'BatchMigratePanel', template: '<section data-testid="migrate-panel" />' }),
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
  mockState.recheckSingle.mockResolvedValue(undefined);
  mockState.switchPrimaryService.mockResolvedValue(undefined);
  mockState.emitHistoryUpdated.mockResolvedValue(undefined);
  mockState.exportCsv.mockImplementation((rows) => `file,url\n${rows.map((row: any) => `${row.fileName},${row.url}`).join('\n')}`);
  mockState.bulkDeleteHistoryResults.mockResolvedValue({ removedCount: 0, resolvedHistoryIds: [], failedHistoryIds: [] });
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

  it('forwards check, subset, pause, resume, cancel and retry', async () => {
    const wrapper = await mountLinkCheckView();

    for (const cls of ['check-all', 'check-unchecked', 'pause-check', 'resume-check', 'cancel-check', 'retry']) {
      await wrapper.get(`.${cls}`).trigger('click');
    }

    expect(mockState.checkAllHistoryLinks).toHaveBeenCalled();
    expect(mockState.checkSubset).toHaveBeenCalledWith({ statusFilter: 'unchecked' });
    expect(mockState.pauseCheck).toHaveBeenCalled();
    expect(mockState.resumeCheck).toHaveBeenCalled();
    expect(mockState.cancelCheck).toHaveBeenCalled();
    expect(mockState.loadHistoryRows).toHaveBeenCalledTimes(2);
  });

  it('重查一张图 = 它的每一份链接各查一次（不按筛选淡出）', async () => {
    const wrapper = await mountLinkCheckView();
    await wrapper.get('.recheck-image').trigger('click');
    expect(mockState.recheckSingle).toHaveBeenCalledWith(linkCheckRows[0], 'all');
    expect(mockState.recheckSingle).toHaveBeenCalledWith(linkCheckRows[1], 'all');
  });

  it('改用备份：逐张切换主链接，一次同步到列表并广播，报实际改成的张数', async () => {
    const wrapper = await mountLinkCheckView();

    await wrapper.get('.promote-two').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.switchPrimaryService).toHaveBeenCalledWith('h1', 'jd');
    expect(mockState.switchPrimaryService).toHaveBeenCalledWith('h2', 'r2');
    expect(mockState.setPrimaryServices).toHaveBeenCalledWith(new Map([['h1', 'jd'], ['h2', 'r2']]));
    expect(mockState.emitHistoryUpdated).toHaveBeenCalledWith(['h1', 'h2']);
    expect(mockState.toastSuccess).toHaveBeenCalledWith('已把 2 张图改用备份', expect.stringContaining('文档修复'));
  });

  it('改用备份部分失败：成功的照样生效，提示里如实说几张没改成', async () => {
    mockState.switchPrimaryService.mockImplementation(async (id: string) => {
      if (id === 'h2') throw new Error('记录已被删除');
    });
    const wrapper = await mountLinkCheckView();

    await wrapper.get('.promote-two').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.setPrimaryServices).toHaveBeenCalledWith(new Map([['h1', 'jd']]));
    expect(mockState.toastWarn).toHaveBeenCalledWith('已把 1 张图改用备份，1 张没改成', '记录已被删除');
  });

  it('单张改用备份的提示说出换成了哪个图床', async () => {
    const wrapper = await mountLinkCheckView();
    await wrapper.get('.promote-one').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.toastSuccess).toHaveBeenCalledWith('已改用 京东', expect.any(String));
  });

  it('移除记录：确认框按图片说话；只移除处理成功的行，先淡出再摘掉', async () => {
    const timers = useFakeTimers();
    mockState.bulkDeleteHistoryResults.mockResolvedValue({
      removedCount: 1, resolvedHistoryIds: ['hist-broken-weibo'], failedHistoryIds: [],
    });
    const wrapper = await mountLinkCheckView();

    await wrapper.get('.remove-image').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.bulkDeleteHistoryResults).toHaveBeenCalledWith(
      [{ historyId: 'hist-broken-weibo', serviceId: 'weibo' }],
      expect.objectContaining({ header: '从记录中移除这张图？', message: expect.stringContaining('broken-weibo.jpg') }),
    );
    expect(mockState.setFadingOutRows).toHaveBeenCalledWith([linkCheckRows[1]], true);
    expect(mockState.removeRowsByKeys).not.toHaveBeenCalled();
    await timers.advanceBy(380);
    expect(mockState.removeRowsByKeys).toHaveBeenCalledWith([linkCheckRows[1]]);
    timers.restore();
  });

  it('清理找不回的图片用专门的确认文案', async () => {
    const wrapper = await mountLinkCheckView();
    await wrapper.get('.remove-lost').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.bulkDeleteHistoryResults).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ header: '清理 2 张找不回的图片？', acceptLabel: '清理 2 张' }),
    );
  });

  it('导出走统一的文件保存', async () => {
    const wrapper = await mountLinkCheckView();
    await wrapper.get('.export').trigger('click');
    await flushPromisesAndTicks();

    expect(getInvokeMock()).toHaveBeenCalledWith('export_text_file', expect.objectContaining({
      defaultPath: expect.stringMatching(/^link-check-\d+\.csv$/),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }));
    expect(mockState.exportCsv).toHaveBeenCalledWith(linkCheckRows.slice(0, 2));
    expect(mockState.toastSuccess).toHaveBeenCalledWith('导出成功', '已保存至 C:/tmp/link-check.csv');
  });

  it('结论卡上的提示能直接跳到另外两个页面', async () => {
    const wrapper = await mountLinkCheckView();
    await wrapper.get('.go-rescue').trigger('click');
    expect(wrapper.find('[data-testid="rescue-panel"]').exists()).toBe(true);
  });
});
