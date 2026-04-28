import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { getFsMocks, getInvokeMock, resetTauriMocks } from '../../../helpers/tauriMock';
import type { CheckLinkResult } from '../../../../types/linkCheck';

const deps = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  runLinkCheck: vi.fn(),
  toast: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
  linkManager: null as null | {
    checkUrls: ReturnType<typeof vi.fn>;
    isChecking: ReturnType<typeof ref<boolean>>;
    progress: ReturnType<typeof ref<unknown>>;
    progressSource: ReturnType<typeof ref<string>>;
    cancelCheck: ReturnType<typeof vi.fn>;
  },
}));

vi.mock('../../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    loadConfig: deps.loadConfig,
  }),
}));

vi.mock('../../../../composables/useLinkCheck', () => ({
  useLinkCheckManager: () => deps.linkManager,
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => deps.toast,
}));

vi.mock('../../../../composables/md-rescue/LinkChecker', () => ({
  runLinkCheck: deps.runLinkCheck,
}));

vi.mock('../../../../composables/md-rescue/useMdRescueMru', () => ({
  recordMruEntry: vi.fn(),
}));

import { useMdRescueManager } from '../../../../composables/useMdRescue';
import {
  collectProgress,
  excludedUrls,
  fileContent,
  filePath,
  fixingProgress,
  folderPath,
  healedFiles,
  hostPreference,
  imageLinks,
  includeCodeBlocks,
  includeSubfolders,
  isAnalyzing,
  isCancelled,
  isCollecting,
  isReplacing,
  mdFiles,
  mode,
  phase,
  readyFiles,
  repairReceipt,
  scanProgress,
  scanStage,
  setCheckStartTime,
  setCollectCancelled,
  setUrlIndex,
  skippedDirs,
  type MdImageLinkWithFile,
} from '../../../../composables/md-rescue/shared';

function makeLink(
  url: string,
  opts: {
    file?: string;
    valid?: boolean;
    errorType?: CheckLinkResult['error_type'];
    backups?: Array<{ url: string; serviceId: string; valid: boolean }>;
    selectedBackup?: string;
  } = {},
): MdImageLinkWithFile {
  const sourceFile = opts.file ?? 'C:/docs/a.md';
  const sourceFileName = sourceFile.split('/').pop() ?? sourceFile;
  const valid = opts.valid ?? false;
  return {
    originalText: `![](${url})`,
    url,
    altText: '',
    lineNumber: 1,
    syntax: 'markdown',
    context: 'normal',
    sourceFile,
    sourceFileName,
    checkResult: {
      link: url,
      is_valid: valid,
      status_code: valid ? 200 : 404,
      error_type: valid ? 'success' : (opts.errorType ?? 'http_4xx'),
      browser_might_work: false,
      response_time: 100,
    },
    backupLinks: opts.backups?.map((b) => ({
      url: b.url,
      serviceId: b.serviceId,
      checkResult: {
        link: b.url,
        is_valid: b.valid,
        status_code: b.valid ? 200 : 404,
        error_type: b.valid ? 'success' : 'http_4xx',
        browser_might_work: false,
      },
    })),
    selectedBackup: opts.selectedBackup,
  };
}

function resetSharedState(): void {
  phase.value = 'idle';
  mode.value = null;
  filePath.value = null;
  folderPath.value = null;
  mdFiles.value = [];
  fileContent.value = null;
  imageLinks.value = [];
  isAnalyzing.value = false;
  isCollecting.value = false;
  collectProgress.value = null;
  isReplacing.value = false;
  excludedUrls.value = new Set();
  includeSubfolders.value = true;
  includeCodeBlocks.value = false;
  fixingProgress.value = { current: 0, total: 0 };
  repairReceipt.value = null;
  healedFiles.value = new Set();
  hostPreference.value = [];
  scanStage.value = 'checking';
  readyFiles.value = new Set();
  scanProgress.value = null;
  isCancelled.value = false;
  skippedDirs.value = [];
  setCollectCancelled(false);
  setCheckStartTime(0);
  setUrlIndex(null);
}

function installLinkManager(overrides: Partial<NonNullable<typeof deps.linkManager>> = {}) {
  deps.linkManager = {
    checkUrls: vi.fn(),
    isChecking: ref(false),
    progress: ref(null),
    progressSource: ref('rescue'),
    cancelCheck: vi.fn(),
    ...overrides,
  };
}

describe('useMdRescueManager', () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
    resetSharedState();
    installLinkManager();
    deps.loadConfig.mockResolvedValue({});
    deps.runLinkCheck.mockResolvedValue(undefined);
  });

  it('analyzeFile 空链接时保持 idle 且不启动扫描', async () => {
    const manager = useMdRescueManager();

    await manager.analyzeFile();

    expect(phase.value).toBe('idle');
    expect(deps.loadConfig).not.toHaveBeenCalled();
    expect(deps.runLinkCheck).not.toHaveBeenCalled();
  });

  it('已有非 rescue 链接检测时拒绝扫描并提示', async () => {
    installLinkManager({
      isChecking: ref(true),
      progressSource: ref('history'),
      checkUrls: vi.fn(),
      progress: ref(null),
      cancelCheck: vi.fn(),
    });
    imageLinks.value = [makeLink('https://dead.example/a.png')];
    const manager = useMdRescueManager();

    await manager.analyzeFile();

    expect(deps.toast.warn).toHaveBeenCalledWith('检测进行中', '请等待当前链接检测完成后再修复文档');
    expect(phase.value).toBe('idle');
    expect(deps.runLinkCheck).not.toHaveBeenCalled();
  });

  it('analyzeFile 正常推进 scanning，并在 runLinkCheck 完成后关闭 isAnalyzing', async () => {
    imageLinks.value = [makeLink('https://dead.example/a.png')];
    deps.runLinkCheck.mockImplementation(async () => {
      scanStage.value = 'complete';
      readyFiles.value = new Set(['C:/docs/a.md']);
    });
    const manager = useMdRescueManager();

    await manager.analyzeFile();

    expect(phase.value).toBe('scanning');
    expect(scanStage.value).toBe('complete');
    expect(isAnalyzing.value).toBe(false);
    expect(deps.loadConfig).toHaveBeenCalled();
    expect(deps.runLinkCheck).toHaveBeenCalledWith({
      config: {},
      checkUrls: deps.linkManager?.checkUrls,
    });
  });

  it('analyzeFile 失败时回到 idle 并提示错误', async () => {
    imageLinks.value = [makeLink('https://dead.example/a.png')];
    deps.runLinkCheck.mockRejectedValue(new Error('scan failed'));
    const manager = useMdRescueManager();

    await manager.analyzeFile();

    expect(phase.value).toBe('idle');
    expect(isAnalyzing.value).toBe(false);
    expect(deps.toast.error).toHaveBeenCalledWith('分析失败', 'Error: scan failed');
  });

  it('cancelScan 标记取消中并转发 cancelCheck', () => {
    const manager = useMdRescueManager();

    manager.cancelScan();

    expect(isCancelled.value).toBe(true);
    expect(scanStage.value).toBe('cancelling');
    expect(deps.linkManager?.cancelCheck).toHaveBeenCalled();
  });

  it('handleDropPaths 多文件拖入时只收集 Markdown 并自动进入扫描', async () => {
    const fs = getFsMocks();
    fs.stat.mockResolvedValue({ isFile: true, isDirectory: false } as never);
    fs.readTextFile
      .mockResolvedValueOnce('![](https://dead.example/a.png)')
      .mockResolvedValueOnce('![](https://dead.example/b.png)');
    deps.runLinkCheck.mockImplementation(async () => {
      scanStage.value = 'complete';
    });
    const manager = useMdRescueManager();

    await manager.handleDropPaths(['C:/docs/a.md', 'C:/docs/skip.txt', 'C:/docs/b.markdown']);

    expect(mode.value).toBe('file');
    expect(filePath.value).toBe('C:/docs/a.md');
    expect(mdFiles.value).toEqual(['C:/docs/a.md', 'C:/docs/b.markdown']);
    expect(imageLinks.value.map((l) => l.url).sort()).toEqual([
      'https://dead.example/a.png',
      'https://dead.example/b.png',
    ]);
    expect(isCollecting.value).toBe(false);
    expect(collectProgress.value).toBeNull();
    expect(phase.value).toBe('scanning');
    expect(deps.runLinkCheck).toHaveBeenCalled();
  });

  it('handleDropPaths 多文件中没有 Markdown 时提示并停留 idle', async () => {
    getFsMocks().stat.mockResolvedValue({ isFile: true, isDirectory: false } as never);
    const manager = useMdRescueManager();

    await manager.handleDropPaths(['C:/docs/a.txt', 'C:/docs/b.png']);

    expect(deps.toast.info).toHaveBeenCalledWith('未找到 MD 文件', '拖放的文件中没有 Markdown 文件');
    expect(phase.value).toBe('idle');
    expect(imageLinks.value).toEqual([]);
  });

  it('cancelCollect 取消收集、清理进度并通知 Rust 侧', () => {
    isCollecting.value = true;
    collectProgress.value = { scannedFiles: 10, processedFiles: 3, foundLinks: 2 };
    phase.value = 'scanning';
    getInvokeMock().mockResolvedValue(undefined);
    const manager = useMdRescueManager();

    manager.cancelCollect();

    expect(isCollecting.value).toBe(false);
    expect(collectProgress.value).toBeNull();
    expect(phase.value).toBe('idle');
    expect(getInvokeMock()).toHaveBeenCalledWith('cancel_md_scan');
  });

  it('fileHealthList 按文件汇总坏链、可修复数量和修复状态', () => {
    imageLinks.value = [
      makeLink('https://dead.example/a.png', {
        file: 'C:/docs/a.md',
        backups: [{ url: 'https://cdn.example/a.png', serviceId: 'mirror', valid: true }],
      }),
      makeLink('https://timeout.example/b.png', {
        file: 'C:/docs/b.md',
        errorType: 'timeout',
      }),
      makeLink('https://ok.example/c.png', {
        file: 'C:/docs/c.md',
        valid: true,
      }),
    ];
    readyFiles.value = new Set(['C:/docs/a.md', 'C:/docs/b.md', 'C:/docs/c.md']);
    healedFiles.value = new Set(['C:/docs/a.md']);
    const manager = useMdRescueManager();

    expect(manager.fileHealthList.value.map((f) => ({
      name: f.name,
      status: f.status,
      brokenCount: f.brokenCount,
      timeoutCount: f.timeoutCount,
      rescuableCount: f.rescuableCount,
      unrescuableCount: f.unrescuableCount,
      healed: f.healed,
    }))).toEqual([
      {
        name: 'a.md',
        status: 'broken',
        brokenCount: 1,
        timeoutCount: 0,
        rescuableCount: 1,
        unrescuableCount: 0,
        healed: true,
      },
      {
        name: 'b.md',
        status: 'warning',
        brokenCount: 0,
        timeoutCount: 1,
        rescuableCount: 0,
        unrescuableCount: 1,
        healed: false,
      },
      {
        name: 'c.md',
        status: 'healthy',
        brokenCount: 0,
        timeoutCount: 0,
        rescuableCount: 0,
        unrescuableCount: 0,
        healed: false,
      },
    ]);
    expect(manager.availableBackupServices.value).toEqual(['mirror']);
    expect(manager.unrescuableLinks.value.map((l) => l.url)).toEqual(['https://timeout.example/b.png']);
  });
});
