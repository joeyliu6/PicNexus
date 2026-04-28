import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { mountWithDefaults } from '../../../helpers/vueMount';
import MdRescueInline from '../../../../components/views/linkcheck/MdRescueInline.vue';
import type { FileHealth, MdImageLinkWithFile } from '../../../../composables/useMdRescue';

const rescueMocks = vi.hoisted(() => ({
  manager: null as unknown,
  toast: {
    warn: vi.fn(),
    error: vi.fn(),
  },
  removeMruEntry: vi.fn(),
}));

vi.mock('../../../../composables/useMdRescue', () => ({
  useMdRescueManager: () => rescueMocks.manager,
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => rescueMocks.toast,
}));

vi.mock('../../../../composables/md-rescue/useMdRescueMru', () => ({
  removeMruEntry: rescueMocks.removeMruEntry,
}));

const ButtonStub = {
  props: ['label', 'disabled', 'loading'],
  emits: ['click'],
  template: '<button class="button-stub" :disabled="disabled || loading" @click="$emit(\'click\', $event)">{{ label }}<slot /></button>',
};

const RescueIdleZoneStub = {
  props: ['isAnalyzing', 'isChecking', 'includeSubfolders', 'includeCodeBlocks'],
  emits: ['selectFile', 'selectFolder', 'selectAny', 'dropPaths', 'pickRecent', 'update:includeSubfolders', 'update:includeCodeBlocks'],
  template: `
    <section class="idle-zone-stub">
      <button class="select-file" @click="$emit('selectFile')">file</button>
      <button class="select-folder" @click="$emit('selectFolder')">folder</button>
      <button class="select-any" @click="$emit('selectAny')">any</button>
    </section>
  `,
};

const RescueBrokenGroupsStub = {
  props: ['imageLinks', 'isRepaired', 'phase', 'scanStage', 'isCollecting', 'emptyTitle', 'emptyDesc'],
  template: `
    <section class="broken-groups-stub">
      <span class="stub-phase">{{ phase }}</span>
      <span class="stub-stage">{{ scanStage }}</span>
      <span class="stub-count">{{ imageLinks.length }}</span>
      <span class="stub-empty">{{ emptyTitle }}|{{ emptyDesc }}</span>
    </section>
  `,
};

const RescueFixingCardsStub = {
  props: ['fileHealthList', 'imageLinks', 'fixingProgress'],
  template: '<section class="fixing-cards-stub">fixing {{ fixingProgress.current }} / {{ fixingProgress.total }}</section>',
};

const MdRepairDialogStub = {
  props: ['visible'],
  emits: ['update:visible', 'confirm'],
  template: '<section v-if="visible" class="repair-dialog-stub" />',
};

function makeLink(url = 'https://dead.example/a.png'): MdImageLinkWithFile {
  return {
    originalText: `![](${url})`,
    url,
    altText: '',
    lineNumber: 1,
    syntax: 'markdown',
    context: 'normal',
    sourceFile: 'C:/docs/a.md',
    sourceFileName: 'a.md',
    checkResult: {
      link: url,
      is_valid: false,
      status_code: 404,
      error_type: 'http_4xx',
      browser_might_work: false,
    },
    backupLinks: [{
      url: 'https://cdn.example/a.png',
      serviceId: 'mirror',
      checkResult: {
        link: 'https://cdn.example/a.png',
        is_valid: true,
        status_code: 200,
        error_type: 'success',
        browser_might_work: false,
      },
    }],
  };
}

function makeFileHealth(overrides: Partial<FileHealth> = {}): FileHealth {
  return {
    path: 'C:/docs/a.md',
    name: 'a.md',
    totalCount: 1,
    brokenCount: 1,
    timeoutCount: 0,
    suspiciousCount: 0,
    rescuableCount: 1,
    unrescuableCount: 0,
    status: 'broken',
    ready: true,
    healed: false,
    ...overrides,
  };
}

function makeManager(overrides: Record<string, unknown> = {}) {
  const imageLinks = ref<MdImageLinkWithFile[]>([]);
  const fixingProgress = ref({ current: 0, total: 0 });
  const bottomStats = computed(() => ({
    totalFiles: 0,
    totalImages: imageLinks.value.length,
    normalCount: 0,
    problemCount: imageLinks.value.filter((l) => l.checkResult && !l.checkResult.is_valid).length,
    checkedCount: imageLinks.value.filter((l) => l.checkResult).length,
    repairedCount: 0,
    manualCount: 0,
    normalFileCount: 0,
    problemFileCount: imageLinks.value.length > 0 ? 1 : 0,
  }));

  return {
    phase: ref('idle'),
    imageLinks,
    isAnalyzing: ref(false),
    isCollecting: ref(false),
    collectProgress: ref(null),
    isChecking: ref(false),
    fileHealthList: ref<FileHealth[]>([]),
    availableBackupServices: ref<string[]>([]),
    fixingProgress,
    repairReceipt: ref(null),
    hostPreference: ref<string[]>([]),
    includeSubfolders: ref(true),
    includeCodeBlocks: ref(false),
    bottomStats,
    selectMdFile: vi.fn().mockResolvedValue(false),
    selectFolder: vi.fn().mockResolvedValue(false),
    selectAny: vi.fn().mockResolvedValue(false),
    handleDropPaths: vi.fn(),
    loadFilePath: vi.fn().mockResolvedValue(false),
    loadFolderPath: vi.fn().mockResolvedValue(false),
    analyzeFile: vi.fn(),
    applyRepairStrategy: vi.fn(),
    loadHostPreference: vi.fn().mockResolvedValue(undefined),
    saveHostPreference: vi.fn().mockResolvedValue(undefined),
    cancelCollect: vi.fn(),
    cancelScan: vi.fn(),
    cancelFix: vi.fn(),
    undoReplace: vi.fn(),
    executeReplace: vi.fn(),
    reset: vi.fn(),
    scanStage: ref('checking'),
    scanProgress: ref({ checked: 0, total: 0 }),
    skippedDirs: ref<string[]>([]),
    ...overrides,
  };
}

function mountInline() {
  return mountWithDefaults(MdRescueInline, {
    global: {
      stubs: {
        Button: ButtonStub,
        RescueIdleZone: RescueIdleZoneStub,
        RescueBrokenGroups: RescueBrokenGroupsStub,
        RescueFixingCards: RescueFixingCardsStub,
        MdRepairDialog: MdRepairDialogStub,
      },
    },
  });
}

describe('MdRescueInline state rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rescueMocks.manager = makeManager();
  });

  it('idle 空状态渲染入口组件，并在选择后无链接时不触发分析', async () => {
    const wrapper = mountInline();

    expect(wrapper.find('.idle-zone-stub').exists()).toBe(true);
    await wrapper.get('.select-file').trigger('click');

    const manager = rescueMocks.manager as ReturnType<typeof makeManager>;
    expect(manager.selectMdFile).toHaveBeenCalled();
    expect(manager.analyzeFile).not.toHaveBeenCalled();
  });

  it('scanning 状态渲染坏链分组、底部扫描进度和取消动作', async () => {
    const manager = makeManager({
      phase: ref('scanning'),
      scanStage: ref('checking'),
      scanProgress: ref({ checked: 1, total: 2 }),
    });
    manager.imageLinks.value = [makeLink()];
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.find('.broken-groups-stub').exists()).toBe(true);
    expect(wrapper.get('.stub-stage').text()).toBe('checking');
    expect(wrapper.text()).toContain('已检测 1 / 1 图片');
    await wrapper.get('.bottom-actions .btn-ghost').trigger('click');

    expect(manager.cancelScan).toHaveBeenCalled();
  });

  it('fixing 状态渲染修复卡片、进度和取消修复动作', async () => {
    const manager = makeManager({
      phase: ref('fixing'),
      fixingProgress: ref({ current: 1, total: 2 }),
      fileHealthList: ref([makeFileHealth()]),
    });
    manager.imageLinks.value = [makeLink()];
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.find('.fixing-cards-stub').exists()).toBe(true);
    expect(wrapper.text()).toContain('正在修复 1 / 2');
    await wrapper.get('.btn-danger').trigger('click');

    expect(manager.cancelFix).toHaveBeenCalled();
  });

  it('done 状态显示修复完成、备份位置，并允许撤销和重新扫描', async () => {
    const manager = makeManager({
      phase: ref('done'),
      repairReceipt: ref({
        filesFixed: 1,
        linksFixed: 2,
        unrescuableCount: 0,
        backupPath: 'C:/docs/.picnexus-backup/20260428_120000',
        fileBackupMap: [{ original: 'C:/docs/a.md', backup: 'C:/backup/a.md' }],
      }),
    });
    manager.imageLinks.value = [{ ...makeLink(), selectedBackup: 'https://cdn.example/a.png' }];
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.text()).toContain('修复完成');
    expect(wrapper.text()).toContain('共修复 2 张图片链接');
    expect(wrapper.text()).toContain('原文件已备份至 .../.picnexus-backup/20260428_120000');
    await wrapper.get('.wk-actions .button-stub').trigger('click');
    await wrapper.get('.bottom-actions .btn-ghost').trigger('click');

    expect(manager.undoReplace).toHaveBeenCalled();
    expect(manager.reset).toHaveBeenCalled();
  });

  it('done 状态没有备份映射时禁用撤销按钮', () => {
    const manager = makeManager({
      phase: ref('done'),
      repairReceipt: ref({
        filesFixed: 0,
        linksFixed: 0,
        unrescuableCount: 0,
        backupPath: '',
        fileBackupMap: [],
      }),
    });
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.get('.wk-actions .button-stub').attributes('disabled')).toBeDefined();
  });
});
