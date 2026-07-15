import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import {
  getClipboardMocks,
  getInvokeMock,
  resetTauriMocks,
} from '../../helpers/tauriMock';
import RescueIdleZone from '@/components/views/linkcheck/rescue/RescueIdleZone.vue';
import RescueBrokenGroups from '@/components/views/linkcheck/rescue/RescueBrokenGroups.vue';
import RescueFixingCards from '@/components/views/linkcheck/rescue/RescueFixingCards.vue';
import RescueLastRepairCard from '@/components/views/linkcheck/rescue/RescueLastRepairCard.vue';
import MdRepairDialog from '@/components/views/linkcheck/MdRepairDialog.vue';
import type { FileHealth, MdImageLinkWithFile } from '@/composables/useMdRescue';
import type { CheckLinkResult } from '@/types/linkCheck';

const lastRepairMocks = vi.hoisted(() => ({
  state: { record: null as { value: unknown } | null },
  clearLastRepair: vi.fn(),
  saveLastRepair: vi.fn(),
  undoLastRepair: vi.fn(),
  isLastRepairRestorable: vi.fn(),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    silent: vi.fn(),
  }),
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

const DialogStub = defineComponent({
  props: {
    visible: Boolean,
  },
  emits: ['update:visible', 'show'],
  mounted() {
    if (this.visible) this.$emit('show');
  },
  template: '<div v-if="visible" class="dialog-stub"><slot /><slot name="footer" /></div>',
});

const RadioButtonStub = {
  props: ['modelValue', 'value'],
  emits: ['update:modelValue'],
  template: '<input class="radio-stub" type="radio" :checked="modelValue === value" @change="$emit(\'update:modelValue\', value)" />',
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

  it('RescueIdleZone emits empty-state entry actions and option toggles', async () => {
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
    await wrapper.findAll('.checkbox-stub')[0].setValue(false);
    await wrapper.findAll('.checkbox-stub')[1].setValue(true);

    expect(wrapper.emitted('selectAny')).toHaveLength(1);
    expect(wrapper.emitted('selectFile')).toHaveLength(1);
    expect(wrapper.emitted('selectFolder')).toHaveLength(1);
    expect(wrapper.emitted('update:includeSubfolders')).toEqual([[false]]);
    expect(wrapper.emitted('update:includeCodeBlocks')).toEqual([[true]]);
  });

  it('RescueBrokenGroups renders scanning, grouped broken links, filters, collapse, and row actions', async () => {
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
      props: {
        imageLinks: links,
        isRepaired: false,
        phase: 'scanning',
        scanStage: 'checking',
        isCollecting: false,
        healedFiles: new Set(),
        emptyIcon: 'pi pi-search',
        emptyTitle: 'empty',
        emptyDesc: 'empty desc',
      },
    });

    expect(wrapper.find('.mr-scan-spinner').exists()).toBe(true);
    expect(wrapper.findAll('.mr-row')).toHaveLength(2);
    expect(wrapper.findAll('.mr-group')).toHaveLength(2);

    await wrapper.findAll('.mr-chip')[2].trigger('click');
    await flushPromisesAndTicks();

    expect(wrapper.findAll('.mr-row')).toHaveLength(1);
    expect(wrapper.find('.mr-no-backup').exists()).toBe(true);

    await wrapper.get('.mr-group-header').trigger('click');
    await flushPromisesAndTicks();

    expect(wrapper.find('.mr-row').exists()).toBe(false);

    await wrapper.findAll('.mr-chip')[0].trigger('click');
    await flushPromisesAndTicks();
    await wrapper.findAll('.mr-row-icon-btn')[0].trigger('click');

    expect(getClipboardMocks().writeText).toHaveBeenCalledWith('https://dead.example.com/rescuable.png');

    await wrapper.findAll('.mr-group-icon-btn')[0].trigger('click');
    expect(getInvokeMock()).toHaveBeenCalledWith('open_path', { path: 'C:/docs' });
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

  it('MdRepairDialog confirms non-happy repair strategies and closes itself', async () => {
    const wrapper = mountWithDefaults(MdRepairDialog, {
      props: {
        visible: true,
        availableBackupServices: ['github', 'smms'],
        rescuableCount: 1,
        rescuableLinks: [
          mdLink({
            backupLinks: [
              validBackup('https://cdn.example.com/a.png'),
              validBackup('https://smms.example.com/a.png'),
            ],
          }),
        ],
        initialPreference: ['smms', 'github'],
      },
      global: {
        stubs: {
          Dialog: DialogStub,
          Button: ButtonStub,
          RadioButton: RadioButtonStub,
        },
      },
    });
    await flushPromisesAndTicks();

    await wrapper.findAll('.repair-strategy-option')[1].trigger('click');
    await wrapper.findAll('.button-stub').at(-1)!.trigger('click');

    expect(wrapper.emitted('confirm')).toEqual([[{ type: 'fastest' }, ['smms', 'github']]]);
    expect(wrapper.emitted('update:visible')?.at(-1)).toEqual([false]);
  });

  it('MdRepairDialog preserves an inline selected backup as manual default', async () => {
    const wrapper = mountWithDefaults(MdRepairDialog, {
      props: {
        visible: true,
        availableBackupServices: ['github', 'smms'],
        rescuableCount: 1,
        rescuableLinks: [
          mdLink({
            selectedBackup: 'https://smms.example.com/a.png',
            backupLinks: [
              validBackup('https://cdn.example.com/a.png'),
              validBackup('https://smms.example.com/a.png'),
            ],
          }),
        ],
        initialPreference: ['github', 'smms'],
      },
      global: {
        stubs: {
          Dialog: DialogStub,
          Button: ButtonStub,
          RadioButton: RadioButtonStub,
        },
      },
    });
    await flushPromisesAndTicks();

    await wrapper.findAll('.button-stub').at(-1)!.trigger('click');

    expect(wrapper.emitted('confirm')).toEqual([[
      { type: 'manual', selections: new Map([['https://dead.example.com/a.png', 'https://smms.example.com/a.png']]) },
      ['github', 'smms'],
    ]]);
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
