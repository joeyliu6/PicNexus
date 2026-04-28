import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFsMocks, resetTauriMocks } from '../../../helpers/tauriMock';
import type { CheckLinkResult } from '../../../../types/linkCheck';

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

const lastRepairMocks = vi.hoisted(() => ({
  saveLastRepair: vi.fn(),
  clearLastRepair: vi.fn(),
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => toastMocks,
}));

vi.mock('../../../../composables/md-rescue/useMdRescueLastRepair', () => ({
  saveLastRepair: lastRepairMocks.saveLastRepair,
  clearLastRepair: lastRepairMocks.clearLastRepair,
}));

import { executeReplace, undoReplace } from '../../../../composables/md-rescue/useFileBackup';
import {
  fileContent,
  filePath,
  fixingProgress,
  folderPath,
  healedFiles,
  imageLinks,
  includeCodeBlocks,
  isCancelled,
  isReplacing,
  mdFiles,
  mode,
  phase,
  repairReceipt,
  type MdImageLinkWithFile,
} from '../../../../composables/md-rescue/shared';

function checkResult(valid = false): CheckLinkResult {
  return {
    link: valid ? 'https://ok.example/a.png' : 'https://dead.example/a.png',
    is_valid: valid,
    status_code: valid ? 200 : 404,
    error_type: valid ? 'success' : 'http_4xx',
    browser_might_work: false,
    response_time: 100,
  };
}

function makeLink(url: string, file: string, selectedBackup?: string): MdImageLinkWithFile {
  const sourceFileName = file.split('/').pop() ?? file;
  return {
    originalText: `![](${url})`,
    url,
    altText: '',
    lineNumber: 1,
    syntax: 'markdown',
    context: 'normal',
    sourceFile: file,
    sourceFileName,
    checkResult: checkResult(false),
    backupLinks: selectedBackup
      ? [{ url: selectedBackup, serviceId: 'mirror', checkResult: checkResult(true) }]
      : [],
    selectedBackup,
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
  isReplacing.value = false;
  isCancelled.value = false;
  healedFiles.value = new Set();
  fixingProgress.value = { current: 0, total: 0 };
  repairReceipt.value = null;
  includeCodeBlocks.value = false;
}

describe('useFileBackup', () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
    resetSharedState();
  });

  it('没有可替换链接时直接进入 done 并生成空 receipt', async () => {
    imageLinks.value = [
      { ...makeLink('https://ok.example/a.png', 'C:/docs/a.md'), checkResult: checkResult(true) },
      makeLink('https://dead.example/a.png', 'C:/docs/a.md'),
    ];

    const result = await executeReplace(1);

    expect(result).toEqual({ success: 0, skipped: 2, failed: 0 });
    expect(phase.value).toBe('done');
    expect(repairReceipt.value).toEqual({
      filesFixed: 0,
      linksFixed: 0,
      unrescuableCount: 1,
      backupPath: '',
      fileBackupMap: [],
    });
    expect(getFsMocks().mkdir).not.toHaveBeenCalled();
  });

  it('无法确定备份路径时报告备份失败并回到 scanning', async () => {
    imageLinks.value = [
      makeLink('https://dead.example/a.png', 'C:/docs/a.md', 'https://cdn.example/a.png'),
    ];

    const result = await executeReplace(0);

    expect(result).toEqual({ success: 0, skipped: 0, failed: 1 });
    expect(phase.value).toBe('scanning');
    expect(isReplacing.value).toBe(false);
    expect(toastMocks.error).toHaveBeenCalledWith('备份失败', '无法确定备份路径');
    expect(getFsMocks().mkdir).not.toHaveBeenCalled();
  });

  it('成功备份并替换单文件内容，记录可撤销 receipt', async () => {
    const fs = getFsMocks();
    mode.value = 'file';
    filePath.value = 'C:/docs/a.md';
    fileContent.value = 'before ![](https://dead.example/a.png) after';
    imageLinks.value = [
      makeLink('https://dead.example/a.png', 'C:/docs/a.md', 'https://cdn.example/a.png'),
    ];
    fs.readTextFile.mockResolvedValue('before ![](https://dead.example/a.png) after');

    const result = await executeReplace(0);

    expect(result).toEqual({ success: 1, skipped: 0, failed: 0 });
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('C:/docs/.picnexus-backup/'), { recursive: true });
    expect(fs.copyFile).toHaveBeenCalledWith('C:/docs/a.md', expect.stringMatching(/\.picnexus-backup\/\d{8}_\d{6}\/a\.md$/));
    expect(fs.writeTextFile).toHaveBeenCalledWith('C:/docs/a.md', 'before ![](https://cdn.example/a.png) after');
    expect(fileContent.value).toBe('before ![](https://cdn.example/a.png) after');
    expect(healedFiles.value).toEqual(new Set(['C:/docs/a.md']));
    expect(fixingProgress.value).toEqual({ current: 1, total: 1 });
    expect(phase.value).toBe('done');
    expect(repairReceipt.value?.linksFixed).toBe(1);
    expect(repairReceipt.value?.filesFixed).toBe(1);
    expect(lastRepairMocks.saveLastRepair).toHaveBeenCalledWith(expect.objectContaining({
      filesFixed: 1,
      linksFixed: 1,
      fileBackupMap: [{ original: 'C:/docs/a.md', backup: expect.stringContaining('/a.md') }],
    }));
  });

  it('读取源文件失败时继续完成流程并把该文件计入失败', async () => {
    const fs = getFsMocks();
    mode.value = 'file';
    filePath.value = 'C:/docs/a.md';
    imageLinks.value = [
      makeLink('https://dead.example/a.png', 'C:/docs/a.md', 'https://cdn.example/a.png'),
    ];
    fs.readTextFile.mockRejectedValue(new Error('EACCES'));

    const result = await executeReplace(0);

    expect(result).toEqual({ success: 0, skipped: 0, failed: 1 });
    expect(fs.copyFile).not.toHaveBeenCalled();
    expect(fs.writeTextFile).not.toHaveBeenCalled();
    expect(phase.value).toBe('done');
    expect(repairReceipt.value?.fileBackupMap).toEqual([]);
    expect(lastRepairMocks.saveLastRepair).not.toHaveBeenCalled();
  });

  it('修复中被取消时保留已完成文件并停止后续文件', async () => {
    const fs = getFsMocks();
    mode.value = 'file';
    filePath.value = 'C:/docs/a.md';
    mdFiles.value = ['C:/docs/a.md', 'C:/docs/b.md'];
    imageLinks.value = [
      makeLink('https://dead.example/a.png', 'C:/docs/a.md', 'https://cdn.example/a.png'),
      makeLink('https://dead.example/b.png', 'C:/docs/b.md', 'https://cdn.example/b.png'),
    ];
    fs.readTextFile.mockResolvedValue('![](https://dead.example/a.png)\n![](https://dead.example/b.png)');
    fs.writeTextFile.mockImplementation(async () => {
      isCancelled.value = true;
    });

    const result = await executeReplace(0);

    expect(result).toEqual({ success: 1, skipped: 0, failed: 0 });
    expect(fs.writeTextFile).toHaveBeenCalledTimes(1);
    expect(healedFiles.value).toEqual(new Set(['C:/docs/a.md']));
    expect(repairReceipt.value?.fileBackupMap).toHaveLength(1);
    expect(phase.value).toBe('done');
  });

  it('undoReplace 全部恢复成功时清除 receipt 并执行 reset', async () => {
    const fs = getFsMocks();
    const resetFn = vi.fn();
    repairReceipt.value = {
      filesFixed: 2,
      linksFixed: 2,
      unrescuableCount: 0,
      backupPath: 'C:/docs/.picnexus-backup/20260428_120000',
      fileBackupMap: [
        { original: 'C:/docs/a.md', backup: 'C:/backup/a.md' },
        { original: 'C:/docs/b.md', backup: 'C:/backup/b.md' },
      ],
    };

    await undoReplace(resetFn);

    expect(fs.copyFile).toHaveBeenCalledWith('C:/backup/a.md', 'C:/docs/a.md');
    expect(fs.copyFile).toHaveBeenCalledWith('C:/backup/b.md', 'C:/docs/b.md');
    expect(lastRepairMocks.clearLastRepair).toHaveBeenCalled();
    expect(toastMocks.success).toHaveBeenCalledWith('已撤销', '已恢复所有文件至修复前状态');
    expect(resetFn).toHaveBeenCalled();
  });

  it('undoReplace 部分恢复失败时只保留失败项供重试', async () => {
    const fs = getFsMocks();
    const resetFn = vi.fn();
    repairReceipt.value = {
      filesFixed: 2,
      linksFixed: 2,
      unrescuableCount: 0,
      backupPath: 'C:/docs/.picnexus-backup/20260428_120000',
      fileBackupMap: [
        { original: 'C:/docs/a.md', backup: 'C:/backup/a.md' },
        { original: 'C:/docs/b.md', backup: 'C:/backup/b.md' },
      ],
    };
    fs.copyFile.mockImplementation(async (backup) => {
      if (backup === 'C:/backup/b.md') throw new Error('locked');
    });

    await undoReplace(resetFn);

    expect(resetFn).not.toHaveBeenCalled();
    expect(lastRepairMocks.clearLastRepair).not.toHaveBeenCalled();
    expect(repairReceipt.value?.fileBackupMap).toEqual([
      { original: 'C:/docs/b.md', backup: 'C:/backup/b.md' },
    ]);
    expect(toastMocks.error).toHaveBeenCalledWith(
      '部分撤销失败',
      '已恢复 1 个，1 个失败（保留以便重试）',
    );
  });
});
