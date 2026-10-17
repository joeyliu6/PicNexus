// 文档文件夹：增删记进配置、不重复添加、上层文件夹收掉被包含的、扫不到的写明原因
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDialogOpenMock, getInvokeMock, resetTauriMocks } from '../../helpers/tauriMock';
import type { UserConfig } from '@/config/types';

const { configRef, saveConfigMock, toastInfoMock } = vi.hoisted(() => ({
  configRef: { current: {} as Partial<UserConfig> },
  saveConfigMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    loadConfig: async () => configRef.current,
    saveConfig: async (next: UserConfig) => { saveConfigMock(next); configRef.current = next; },
  }),
}));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ info: toastInfoMock, warn: vi.fn(), error: vi.fn(), success: vi.fn() }) }));

async function fresh() {
  vi.resetModules();
  return (await import('@/views/health/useDocFolders')).useDocFolders();
}

const scanResult = (files: Array<{ filePath: string }>) => ({ files: files.map((f) => ({ ...f, fileName: 'a.md', links: [] })), cancelled: false });

describe('useDocFolders', () => {
  beforeEach(() => {
    resetTauriMocks();
    saveConfigMock.mockReset();
    toastInfoMock.mockReset();
    configRef.current = { linkHealth: { docFolders: ['D:\\Notes'], autoCheck: { enabled: true, intervalDays: 7 } } };
  });

  it('扫描前申请访问权限，逐个文件夹扫，写明各有几个文档', async () => {
    const invoke = getInvokeMock();
    invoke.mockImplementation(async (cmd: string) => (cmd === 'scan_md_folder' ? scanResult([{ filePath: 'D:\\Notes\\a.md' }]) : undefined));
    const docs = await fresh();

    await docs.scan();

    expect(invoke.mock.calls.map((c) => c[0])).toEqual(['allow_user_path', 'scan_md_folder']);
    expect(docs.folders.value).toEqual([{ path: 'D:\\Notes', status: 'ok', docs: [expect.objectContaining({ filePath: 'D:\\Notes\\a.md' })] }]);
    expect(docs.scanned.value).toBe(true);
  });

  it('文件夹不存在 / 没有权限分开说', async () => {
    configRef.current = { linkHealth: { docFolders: ['D:\\Gone', 'D:\\Locked'], autoCheck: { enabled: true, intervalDays: 7 } } };
    getInvokeMock().mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd !== 'scan_md_folder') return undefined;
      throw new Error((args as { dir: string }).dir === 'D:\\Gone' ? '路径无效或不存在: D:\\Gone (os error 2)' : '路径无效或不存在: D:\\Locked (Access is denied. (os error 5))');
    });
    const docs = await fresh();
    await docs.scan();
    expect(docs.folders.value.map((f) => f.status)).toEqual(['missing', 'denied']);
  });

  it('添加：已在列表里或在某个文件夹里面的不重复加', async () => {
    getDialogOpenMock().mockResolvedValueOnce('d:\\notes\\blog');
    const docs = await fresh();
    expect(await docs.add()).toBe(false);
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(toastInfoMock).toHaveBeenCalledWith('已在文档文件夹中', 'd:\\notes\\blog');
  });

  it('添加上层文件夹：收掉被它包含的那几个，记进配置后只扫新加的', async () => {
    getDialogOpenMock().mockResolvedValueOnce('D:\\');
    const invoke = getInvokeMock();
    invoke.mockImplementation(async (cmd: string) => (cmd === 'scan_md_folder' ? scanResult([]) : undefined));
    const docs = await fresh();

    expect(await docs.add()).toBe(true);

    expect(saveConfigMock.mock.calls[0][0].linkHealth.docFolders).toEqual(['D:\\']);
    expect(invoke.mock.calls.filter((c) => c[0] === 'scan_md_folder').map((c) => (c[1] as { dir: string }).dir)).toEqual(['D:\\']);
  });

  it('移除：从配置里删掉，自动检测设置不动', async () => {
    const docs = await fresh();
    await docs.remove('d:\\notes');
    expect(saveConfigMock.mock.calls[0][0].linkHealth).toEqual({ docFolders: [], autoCheck: { enabled: true, intervalDays: 7 } });
  });
});
