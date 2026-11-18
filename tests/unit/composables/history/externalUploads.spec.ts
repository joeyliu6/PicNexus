import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from '@/config/types';
import type { ExternalUpload } from '@/composables/history/externalUploads';

const { invokeMock, insertOrIgnoreMock, readFreshConfigMock, emitHistoryUpdatedMock, invalidateCacheMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  insertOrIgnoreMock: vi.fn(),
  readFreshConfigMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/services/database', () => ({ historyDB: { insertOrIgnore: insertOrIgnoreMock } }));
vi.mock('@/store/instances', () => ({ readFreshConfig: readFreshConfigMock }));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: emitHistoryUpdatedMock }));
vi.mock('@/composables/history/useHistory', () => ({ invalidateCache: invalidateCacheMock }));

import {
  drainExternalUploads,
  resetExternalUploadsForTest,
  resolveServiceId,
  toHistoryItem,
} from '@/composables/history/externalUploads';

function makeUpload(overrides: Partial<ExternalUpload> = {}): ExternalUpload {
  return {
    id: '1700000000000-42-0',
    timestamp: 1700000000000,
    source: 'cli',
    serviceId: 'github',
    url: 'https://raw.githubusercontent.com/u/r/main/images/a.png',
    fileName: 'a.png',
    filePath: 'C:\\pics\\a.png',
    metadata: { width: 400, height: 200, aspect_ratio: 2, file_size: 1234, format: 'png' },
    ...overrides,
  };
}

function configWith(editorServer: Partial<NonNullable<UserConfig['editorServer']>>): UserConfig {
  return { editorServer } as UserConfig;
}

describe('resolveServiceId', () => {
  it('命令行给的编号原样使用，不拿编辑器设置去改', () => {
    const config = configWith({ typoraService: 'webdav:p2', obsidianService: 'webdav:p3' });
    expect(resolveServiceId(makeUpload({ serviceId: 'webdav' }), config)).toBe('webdav');
  });

  it('Typora 配置档只知道 webdav：按设置里的 Typora 图床补成完整编号', () => {
    const upload = makeUpload({ source: 'typora', serviceId: 'webdav' });
    expect(resolveServiceId(upload, configWith({ typoraService: 'webdav:p1' }))).toBe('webdav:p1');
  });

  it('编辑器服务只知道 custom_s3：按设置里的 Obsidian 图床补全', () => {
    const upload = makeUpload({ source: 'editor', serviceId: 'custom_s3' });
    expect(resolveServiceId(upload, configWith({ obsidianService: 'custom_s3:s1' }))).toBe('custom_s3:s1');
  });

  it('设置已经改成别的类型：保留原样，不张冠李戴', () => {
    const upload = makeUpload({ source: 'editor', serviceId: 'webdav' });
    expect(resolveServiceId(upload, configWith({ obsidianService: 'github' }))).toBe('webdav');
  });

  it('普通图床类型本身就是完整编号', () => {
    const upload = makeUpload({ source: 'typora', serviceId: 'r2' });
    expect(resolveServiceId(upload, configWith({ typoraService: 'webdav:p1' }))).toBe('r2');
  });
});

describe('toHistoryItem', () => {
  it('一张成功的上传 = 一条历史记录，链接即「复制时使用」的链接', () => {
    const item = toHistoryItem(makeUpload(), 'github');
    expect(item).toMatchObject({
      id: 'external-1700000000000-42-0',
      timestamp: 1700000000000,
      localFileName: 'a.png',
      filePath: 'C:\\pics\\a.png',
      primaryService: 'github',
      generatedLink: 'https://raw.githubusercontent.com/u/r/main/images/a.png',
      width: 400,
      height: 200,
      aspectRatio: 2,
      fileSize: 1234,
      format: 'png',
    });
    expect(item.results).toEqual([{
      serviceId: 'github',
      status: 'success',
      result: { serviceId: 'github', fileKey: '', url: 'https://raw.githubusercontent.com/u/r/main/images/a.png' },
    }]);
  });

  it('编辑器服务没有本机路径：不写 filePath', () => {
    expect('filePath' in toHistoryItem(makeUpload({ filePath: null }), 'github')).toBe(false);
  });
});

describe('drainExternalUploads', () => {
  beforeEach(() => {
    resetExternalUploadsForTest();
    invokeMock.mockReset();
    insertOrIgnoreMock.mockReset().mockResolvedValue(true);
    readFreshConfigMock.mockReset().mockResolvedValue(null);
    emitHistoryUpdatedMock.mockReset().mockResolvedValue(undefined);
    invalidateCacheMock.mockReset();
  });

  it('写进历史库、通知各页面，然后让 Rust 删掉这几条', async () => {
    const uploads = [makeUpload(), makeUpload({ id: '1700000000001-42-1', fileName: 'b.png' })];
    invokeMock.mockImplementation(async (cmd: string) => (cmd === 'list_external_uploads' ? uploads : undefined));

    await drainExternalUploads();

    expect(insertOrIgnoreMock).toHaveBeenCalledTimes(2);
    expect(invalidateCacheMock).toHaveBeenCalledTimes(1);
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['external-1700000000000-42-0', 'external-1700000000001-42-1']);
    expect(invokeMock).toHaveBeenCalledWith('remove_external_uploads', { ids: ['1700000000000-42-0', '1700000000001-42-1'] });
  });

  it('写库失败的那条留在收件箱，下次再试', async () => {
    const uploads = [makeUpload(), makeUpload({ id: '1700000000001-42-1' })];
    invokeMock.mockImplementation(async (cmd: string) => (cmd === 'list_external_uploads' ? uploads : undefined));
    insertOrIgnoreMock.mockRejectedValueOnce(new Error('database is locked'));

    await drainExternalUploads();

    expect(invokeMock).toHaveBeenCalledWith('remove_external_uploads', { ids: ['1700000000001-42-1'] });
  });

  it('收件箱是空的：不读配置、不发通知', async () => {
    invokeMock.mockResolvedValue([]);

    await drainExternalUploads();

    expect(readFreshConfigMock).not.toHaveBeenCalled();
    expect(emitHistoryUpdatedMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('跑的时候又被叫（焦点和事件撞在一起）：跑完补一轮，不并发写', async () => {
    let release!: (value: ExternalUpload[]) => void;
    invokeMock
      .mockImplementationOnce(() => new Promise<ExternalUpload[]>((resolve) => { release = resolve; }))
      .mockResolvedValue([]);

    const first = drainExternalUploads();
    const second = drainExternalUploads();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    release([]);
    await Promise.all([first, second]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
