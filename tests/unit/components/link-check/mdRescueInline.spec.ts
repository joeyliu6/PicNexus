import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import MdRescueInline from '@/components/views/link-check/MdRescueInline.vue';
import type { FileHealth, MdImageLinkWithFile } from '@/composables/md-rescue/shared';

const rescueMocks = vi.hoisted(() => ({
  manager: null as unknown,
  toast: {
    warn: vi.fn(),
    error: vi.fn(),
  },
  removeMruEntry: vi.fn(),
}));

vi.mock('@/composables/md-rescue/useMdRescue', () => ({
  useMdRescueManager: () => rescueMocks.manager,
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => rescueMocks.toast,
}));

vi.mock('@/composables/md-rescue/useMdRescueMru', () => ({
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
  props: ['imageLinks', 'isRepaired', 'healedFiles'],
  template: `
    <section class="broken-groups-stub">
      <span class="stub-repaired">{{ isRepaired }}</span>
      <span class="stub-count">{{ imageLinks.length }}</span>
    </section>
  `,
};

const RescueFixingCardsStub = {
  props: ['fileHealthList', 'imageLinks', 'fixingProgress'],
  template: '<section class="fixing-cards-stub">fixing {{ fixingProgress.current }} / {{ fixingProgress.total }}</section>',
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
    fixingProgress,
    repairReceipt: ref(null),
    healedFiles: ref(new Set<string>()),
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
    applyDefaultBackups: vi.fn(),
    preferServiceForAll: vi.fn(),
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

  it('检查中：卡片报进度，下面陆续列出打不开的图，「取消」停止检查', async () => {
    const manager = makeManager({
      phase: ref('scanning'),
      scanStage: ref('checking'),
      scanProgress: ref({ checked: 1, total: 2 }),
    });
    manager.imageLinks.value = [makeLink()];
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.find('.broken-groups-stub').exists()).toBe(true);
    expect(wrapper.get('.summary-title').text()).toBe('正在检查图片 · 1 / 2');
    expect(wrapper.find('.summary-progress').exists()).toBe(true);
    await wrapper.get('.summary-btn--ghost').trigger('click');

    expect(manager.cancelScan).toHaveBeenCalled();
  });

  it('修复中：卡片按文档报进度，「取消」停止修复', async () => {
    const manager = makeManager({
      phase: ref('fixing'),
      fixingProgress: ref({ current: 1, total: 2 }),
      fileHealthList: ref([makeFileHealth()]),
    });
    manager.imageLinks.value = [makeLink()];
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.find('.fixing-cards-stub').exists()).toBe(true);
    expect(wrapper.get('.summary-title').text()).toBe('正在修复 · 1 / 2 个文档');
    await wrapper.get('.summary-btn--ghost').trigger('click');

    expect(manager.cancelFix).toHaveBeenCalled();
  });

  it('修好了：卡片一句结论、写出备份位置；「撤销」「完成」都接上了', async () => {
    const manager = makeManager({
      phase: ref('done'),
      repairReceipt: ref({
        filesFixed: 1,
        linksFixed: 2,
        unrescuableCount: 0,
        backupPath: 'C:/docs/.picnexus-backup/20260428_120000',
        fileBackupMap: [{ original: 'C:/docs/a.md', backup: 'C:/backup/a.md' }],
        failedFiles: [],
      }),
    });
    manager.imageLinks.value = [{ ...makeLink(), selectedBackup: 'https://cdn.example/a.png' }];
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.get('.summary-title').text()).toBe('已修复 0 张图片');
    expect(wrapper.text()).toContain('原文件备份在 .../.picnexus-backup/20260428_120000');
    await wrapper.get('.summary-btn--ghost').trigger('click');
    const finish = wrapper.get('.summary-btn--primary');
    expect(finish.text()).toBe('完成');
    await finish.trigger('click');

    expect(manager.undoReplace).toHaveBeenCalled();
    expect(manager.reset).toHaveBeenCalled();
  });

  it('修好了但没有备份映射：「撤销」灰着', () => {
    const manager = makeManager({
      phase: ref('done'),
      repairReceipt: ref({
        filesFixed: 0,
        linksFixed: 0,
        unrescuableCount: 0,
        backupPath: '',
        fileBackupMap: [],
        failedFiles: [],
      }),
    });
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.get('.summary-btn--ghost').attributes('disabled')).toBeDefined();
  });

  it('有文档没写进去：卡片如实说，并列出是哪几个文档', () => {
    const manager = makeManager({
      phase: ref('done'),
      repairReceipt: ref({
        filesFixed: 1,
        linksFixed: 1,
        unrescuableCount: 0,
        backupPath: 'C:/docs/.picnexus-backup/20260428_120000',
        fileBackupMap: [{ original: 'C:/docs/a.md', backup: 'C:/backup/a.md' }],
        failedFiles: [{ file: 'C:/docs/b.md', links: 2, error: 'EACCES' }],
      }),
    });
    manager.imageLinks.value = [{ ...makeLink(), selectedBackup: 'https://cdn.example/a.png' }];
    rescueMocks.manager = manager;

    const wrapper = mountInline();

    expect(wrapper.get('.summary-title').text()).toBe('1 个文档没改成');
    // 卡片上说人话，系统错误码留在悬停提示里
    expect(wrapper.get('.summary-subtitle').text()).toBe('没有写入权限 · 改好的可以撤销');
    expect(wrapper.text()).toContain('没改成的文档：.../docs/b.md');
  });

  it('扫描结束立刻按首选顺序定好替换来源；「修复 N 张」不弹框直接修', async () => {
    const manager = makeManager({
      phase: ref('scanning'),
      scanStage: ref('checking'),
      hostPreference: ref(['mirror']),
    });
    manager.imageLinks.value = [makeLink()];
    rescueMocks.manager = manager;

    const wrapper = mountInline();
    manager.scanStage.value = 'complete';
    await nextTick();
    await Promise.resolve();

    expect(manager.loadHostPreference).toHaveBeenCalled();
    expect(manager.applyDefaultBackups).toHaveBeenCalledWith(['mirror']);

    const repair = wrapper.get('.summary-btn--primary');
    expect(repair.text()).toBe('修复 1 张');
    await repair.trigger('click');
    expect(manager.executeReplace).toHaveBeenCalledTimes(1);
  });

  it('扫完没有问题：卡片说都能打开，只留「换一批文档」', () => {
    const manager = makeManager({ phase: ref('scanning'), scanStage: ref('complete') });
    rescueMocks.manager = manager;
    const wrapper = mountInline();
    expect(wrapper.find('.summary-btn--primary').exists()).toBe(false);
    expect(wrapper.get('.summary-btn--ghost').text()).toBe('换一批文档');
  });
});
