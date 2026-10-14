import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import {
  getClipboardMocks,
  getInvokeMock,
  resetTauriMocks,
} from '../../helpers/tauriMock';
import RescueIdleZone from '@/components/views/link-check/rescue/RescueIdleZone.vue';
import RescueBrokenGroups from '@/components/views/link-check/rescue/RescueBrokenGroups.vue';
import RescueFixingCards from '@/components/views/link-check/rescue/RescueFixingCards.vue';
import RescueLastRepairCard from '@/components/views/link-check/rescue/RescueLastRepairCard.vue';
import type { FileHealth, MdImageLinkWithFile } from '@/composables/md-rescue/shared';
import type { CheckLinkResult } from '@/types/linkCheck';

const lastRepairMocks = vi.hoisted(() => ({
  state: { record: null as { value: unknown } | null },
  clearLastRepair: vi.fn(),
  saveLastRepair: vi.fn(),
  undoLastRepair: vi.fn(),
  isLastRepairRestorable: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
  silent: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => toastMocks,
}));

vi.mock('@/composables/useConfig', async () => {
  const { ref } = await import('vue');
  return {
    useConfigManager: () => ({
      config: ref({
        linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: false },
      }),
    }),
  };
});

vi.mock('@/composables/md-rescue/useMdRescueLastRepair', async () => {
  const { ref } = await import('vue');
  if (!lastRepairMocks.state.record) {
    lastRepairMocks.state.record = ref(null);
  }
  return {
    useLastRepair: () => ({ record: lastRepairMocks.state.record }),
    clearLastRepair: lastRepairMocks.clearLastRepair,
    saveLastRepair: lastRepairMocks.saveLastRepair,
    undoLastRepair: lastRepairMocks.undoLastRepair,
    isLastRepairRestorable: lastRepairMocks.isLastRepairRestorable,
  };
});

const ButtonStub = {
  props: ['label', 'loading', 'disabled'],
  emits: ['click'],
  template: '<button class="button-stub" :disabled="disabled || loading" @click="$emit(\'click\', $event)">{{ label }}<slot /></button>',
};

const CheckboxStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `
    <input
      class="checkbox-stub"
      type="checkbox"
      :checked="modelValue"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
  `,
};

function result(overrides: Partial<CheckLinkResult> = {}): CheckLinkResult {
  return {
    link: overrides.link ?? 'https://dead.example.com/a.png',
    is_valid: overrides.is_valid ?? false,
    status_code: overrides.status_code ?? 404,
    error_type: overrides.error_type ?? 'http_4xx',
    browser_might_work: overrides.browser_might_work ?? false,
    response_time: overrides.response_time,
    error: overrides.error,
  };
}

function mdLink(overrides: Partial<MdImageLinkWithFile> = {}): MdImageLinkWithFile {
  const url = overrides.url ?? 'https://dead.example.com/a.png';
  return {
    originalText: overrides.originalText ?? `![img](${url})`,
    url,
    altText: overrides.altText ?? 'img',
    lineNumber: overrides.lineNumber ?? 3,
    syntax: overrides.syntax ?? 'markdown',
    context: overrides.context ?? 'normal',
    sourceFile: overrides.sourceFile ?? 'C:/docs/a.md',
    sourceFileName: overrides.sourceFileName ?? 'a.md',
    checkResult: overrides.checkResult ?? result({ link: url }),
    backupLinks: overrides.backupLinks,
    selectedBackup: overrides.selectedBackup,
  };
}

function validBackup(url = 'https://cdn.example.com/a.png') {
  return {
    url,
    serviceId: 'github',
    checkResult: result({
      link: url,
      is_valid: true,
      status_code: 200,
      error_type: 'success',
      response_time: 80,
    }),
  };
}

describe('Markdown rescue P1 components', () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
    lastRepairMocks.state.record = ref(null);
    lastRepairMocks.isLastRepairRestorable.mockResolvedValue(false);
    lastRepairMocks.undoLastRepair.mockResolvedValue({ restored: 0, failed: 0, failedPairs: [] });
  });

  it('RescueIdleZone：选文档的三个入口；两个选项收在「选项」里，改过的会写在后面', async () => {
    const wrapper = mountWithDefaults(RescueIdleZone, {
      props: {
        isAnalyzing: false,
        isChecking: false,
        includeSubfolders: true,
        includeCodeBlocks: false,
      },
      global: {
        stubs: {
          Button: ButtonStub,
          Checkbox: CheckboxStub,
          RescueRecentList: { template: '<div class="recent-list-stub" />' },
          RescueLastRepairCard: { template: '<div class="last-repair-stub" />' },
        },
      },
    });
    await flushPromisesAndTicks();

    await wrapper.get('.idle-zone').trigger('click');
    await wrapper.get('.idle-secondary-link').trigger('click');
    await wrapper.get('.button-stub').trigger('click');

    expect(wrapper.findAll('.checkbox-stub')).toHaveLength(0);
    expect(wrapper.get('.options-toggle').text()).toBe('选项');

    await wrapper.get('.options-toggle').trigger('click');
    await wrapper.findAll('.checkbox-stub')[0].setValue(false);
    await wrapper.findAll('.checkbox-stub')[1].setValue(true);

    expect(wrapper.emitted('selectAny')).toHaveLength(1);
    expect(wrapper.emitted('selectFile')).toHaveLength(1);
    expect(wrapper.emitted('selectFolder')).toHaveLength(1);
    expect(wrapper.emitted('update:includeSubfolders')).toEqual([[false]]);
    expect(wrapper.emitted('update:includeCodeBlocks')).toEqual([[true]]);

    await wrapper.setProps({ includeSubfolders: false, includeCodeBlocks: true });
    expect(wrapper.get('.options-toggle').text()).toBe('选项 · 不含子文件夹、含代码块里的图片');
  });

  it('RescueBrokenGroups：按文档分组列出打不开的图，能折叠，行和文档上的操作都接上了', async () => {
    const links = [
      mdLink({
        url: 'https://dead.example.com/rescuable.png',
        backupLinks: [validBackup('https://cdn.example.com/rescuable.png')],
      }),
      mdLink({
        url: 'https://lost.example.com/manual.png',
        sourceFile: 'C:/docs/b.md',
        sourceFileName: 'b.md',
        lineNumber: 9,
        backupLinks: [],
      }),
    ];

    const wrapper = mountWithDefaults(RescueBrokenGroups, {
      props: { imageLinks: links, isRepaired: false, healedFiles: new Set() },
    });

    expect(wrapper.find('.mr-chip').exists()).toBe(false);
    expect(wrapper.findAll('.mr-row')).toHaveLength(2);
    expect(wrapper.findAll('.mr-group')).toHaveLength(2);
    expect(wrapper.find('.mr-no-backup').exists()).toBe(true);

    await wrapper.findAll('.mr-group-header')[1].trigger('click');
    await flushPromisesAndTicks();
    expect(wrapper.findAll('.mr-row')).toHaveLength(1);

    await wrapper.findAll('.mr-row-icon-btn')[0].trigger('click');

    expect(getClipboardMocks().writeText).toHaveBeenCalledWith('https://dead.example.com/rescuable.png');

    await wrapper.findAll('.mr-group-icon-btn')[0].trigger('click');
    expect(getInvokeMock()).toHaveBeenCalledWith('open_path', { path: 'C:/docs' });
  });

  it('RescueBrokenGroups 用白话说状态；修好的行只说「已换成 X」，不再叠一个「已修复」', () => {
    const fixed = mdLink({
      url: 'https://dead.example.com/fixed.png',
      checkResult: result({ link: 'https://dead.example.com/fixed.png', status_code: 502, error_type: 'http_5xx' }),
      backupLinks: [validBackup('https://cdn.example.com/fixed.png')],
      selectedBackup: 'https://cdn.example.com/fixed.png',
    });
    const pending = mdLink({
      url: 'https://dead.example.com/pending.png',
      sourceFile: 'C:/docs/b.md',
      sourceFileName: 'b.md',
      backupLinks: [validBackup('https://cdn.example.com/pending.png')],
    });
    const before = mountWithDefaults(RescueBrokenGroups, {
      props: { imageLinks: [fixed, pending], isRepaired: false, healedFiles: new Set() },
    });
    const beforeRows = before.findAll('.mr-row');
    expect(beforeRows[0].get('.status-pill').text()).toBe('图床故障');
    expect(beforeRows[0].get('.mr-backup-chip').text()).toContain('GitHub');
    expect(before.text()).toContain('1 张打不开');
    expect(before.text()).not.toContain('502');

    const after = mountWithDefaults(RescueBrokenGroups, {
      props: { imageLinks: [fixed, pending], isRepaired: true, healedFiles: new Set(['C:/docs/a.md']) },
    });
    const afterRows = after.findAll('.mr-row');
    expect(afterRows[0].get('.status-pill').text()).toBe('');
    expect(afterRows[0].get('.status-pill').classes()).toContain('status-pill--placeholder');
    expect(afterRows[0].get('.mr-fixed-to').text()).toContain('已换成 GitHub');
    expect(after.findAll('.mr-group-count').map((c) => c.text())).toEqual(['已修复 1 张', '1 张没修好']);
    // b.md 没被修好（不在 healedFiles）：不能被说成已修复，也不能再摆出「→ 图床」让人以为还没修
    expect(afterRows[1].find('.mr-fixed-to').exists()).toBe(false);
    expect(afterRows[1].find('.mr-backup-chip').exists()).toBe(false);
    expect(afterRows[1].get('.mr-fix-failed').text()).toContain('没改成');
  });

  it('修完后文档标签说清剩下的是什么：没有备份的不说成「已修复 0 / N」', () => {
    const fixed = mdLink({
      url: 'https://dead.example.com/fixed.png',
      backupLinks: [validBackup('https://cdn.example.com/fixed.png')],
      selectedBackup: 'https://cdn.example.com/fixed.png',
    });
    const noBackupSameDoc = mdLink({ url: 'https://dead.example.com/manual-a.png', backupLinks: [] });
    const noBackupOnly = mdLink({
      url: 'https://dead.example.com/manual-c.png',
      sourceFile: 'C:/docs/c.md',
      sourceFileName: 'c.md',
      backupLinks: [],
    });
    const wrapper = mountWithDefaults(RescueBrokenGroups, {
      props: {
        imageLinks: [fixed, noBackupSameDoc, noBackupOnly],
        isRepaired: true,
        healedFiles: new Set(['C:/docs/a.md']),
      },
    });

    expect(wrapper.findAll('.mr-group-count').map((c) => c.text()))
      .toEqual(['已修复 1 张 · 1 张没有备份', '1 张没有备份']);
  });

  it('RescueBrokenGroups shows the AppError message when open_path fails, not [object Object]', async () => {
    // Rust 的 AppError 序列化后是 { type, data: { message } }，不是 Error 实例
    getInvokeMock().mockImplementation(async (command) => {
      if (command === 'open_path') throw { type: 'FILE_IO', data: { message: '无法访问路径: C:/docs' } };
      return undefined;
    });

    const wrapper = mountWithDefaults(RescueBrokenGroups, {
      props: {
        imageLinks: [mdLink({ url: 'https://dead.example.com/rescuable.png', backupLinks: [] })],
        isRepaired: false,
        healedFiles: new Set(),
      },
    });

    await wrapper.findAll('.mr-group-icon-btn')[0].trigger('click');
    await flushPromisesAndTicks();

    expect(toastMocks.error).toHaveBeenCalledWith('无法打开文件夹', '无法访问路径: C:/docs');
  });

  it('RescueFixingCards shows active, pending, and done repair states', () => {
    const fileHealthList: FileHealth[] = [
      {
        path: 'C:/docs/a.md',
        name: 'a.md',
        totalCount: 2,
        brokenCount: 1,
        timeoutCount: 0,
        suspiciousCount: 0,
        rescuableCount: 1,
        unrescuableCount: 0,
        status: 'broken',
        ready: true,
        healed: false,
      },
      {
        path: 'C:/docs/b.md',
        name: 'b.md',
        totalCount: 1,
        brokenCount: 1,
        timeoutCount: 0,
        suspiciousCount: 0,
        rescuableCount: 1,
        unrescuableCount: 0,
        status: 'broken',
        ready: true,
        healed: false,
      },
      {
        path: 'C:/docs/c.md',
        name: 'c.md',
        totalCount: 1,
        brokenCount: 1,
        timeoutCount: 0,
        suspiciousCount: 0,
        rescuableCount: 1,
        unrescuableCount: 0,
        status: 'healthy',
        ready: true,
        healed: true,
      },
    ];

    const wrapper = mountWithDefaults(RescueFixingCards, {
      props: {
        fileHealthList,
        imageLinks: [
          mdLink({
            sourceFile: 'C:/docs/a.md',
            sourceFileName: 'a.md',
            backupLinks: [validBackup()],
          }),
        ],
        fixingProgress: { current: 1, total: 3 },
      },
    });

    const cards = wrapper.findAll('.fixing-card');
    expect(cards[0].classes()).toContain('fixing-card--active');
    expect(cards[1].classes()).toContain('fixing-card--pending');
    expect(cards[2].classes()).toContain('fixing-card--done');
    expect(wrapper.find('.fixing-link-row').exists()).toBe(true);
  });

  it('RescueLastRepairCard restores from the persisted backup record', async () => {
    const record = {
      date: Date.now(),
      filesFixed: 1,
      linksFixed: 2,
      backupPath: 'C:/docs/.picnexus-backup/20260429_120000',
      fileBackupMap: [{ original: 'C:/docs/a.md', backup: 'C:/backup/a.md' }],
    };
    lastRepairMocks.state.record!.value = record;
    lastRepairMocks.isLastRepairRestorable.mockResolvedValue(true);
    lastRepairMocks.undoLastRepair.mockResolvedValue({ restored: 1, failed: 0, failedPairs: [] });

    const wrapper = mountWithDefaults(RescueLastRepairCard, {
      global: { stubs: { Button: ButtonStub } },
    });
    await flushPromisesAndTicks();

    const undoButton = wrapper.findAll('.button-stub').find((button) => button.text() === '撤销');
    expect(undoButton?.attributes('disabled')).toBeUndefined();
    await undoButton!.trigger('click');
    await flushPromisesAndTicks();

    expect(lastRepairMocks.isLastRepairRestorable).toHaveBeenCalledWith(record);
    expect(lastRepairMocks.undoLastRepair).toHaveBeenCalledWith(record);
    expect(lastRepairMocks.clearLastRepair).toHaveBeenCalled();
  });

  it('RescueLastRepairCard keeps only failed backup entries after partial undo', async () => {
    const failedPair = { original: 'C:/docs/b.md', backup: 'C:/backup/b.md' };
    const record = {
      date: Date.now(),
      filesFixed: 2,
      linksFixed: 3,
      backupPath: 'C:/docs/.picnexus-backup/20260429_120000',
      fileBackupMap: [
        { original: 'C:/docs/a.md', backup: 'C:/backup/a.md' },
        failedPair,
      ],
    };
    lastRepairMocks.state.record!.value = record;
    lastRepairMocks.isLastRepairRestorable.mockResolvedValue(true);
    lastRepairMocks.undoLastRepair.mockResolvedValue({
      restored: 1,
      failed: 1,
      failedPairs: [failedPair],
    });

    const wrapper = mountWithDefaults(RescueLastRepairCard, {
      global: { stubs: { Button: ButtonStub } },
    });
    await flushPromisesAndTicks();

    const undoButton = wrapper.findAll('.button-stub').find((button) => button.text() === '撤销');
    await undoButton!.trigger('click');
    await flushPromisesAndTicks();

    expect(lastRepairMocks.clearLastRepair).not.toHaveBeenCalled();
    expect(lastRepairMocks.saveLastRepair).toHaveBeenCalledWith({
      ...record,
      filesFixed: 1,
      fileBackupMap: [failedPair],
    });
  });
});
