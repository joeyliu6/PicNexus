import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useAutoUpdate } from '../../../composables/useAutoUpdate';

const mockCheck = vi.mocked(check);
const mockRelaunch = vi.mocked(relaunch);

function makeUpdate(overrides: Partial<any> = {}): any {
  return {
    version: '1.2.3',
    date: '2026-04-01',
    body: 'release notes',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides,
  };
}

describe('useAutoUpdate - checkForUpdate', () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    // 重置共享状态
    const api = useAutoUpdate();
    api.status.value = 'idle';
    api.updateInfo.value = null;
    api.downloadProgress.value = 0;
    api.errorMessage.value = '';
    api.lastCheckTime.value = null;
  });

  it('有更新 → status=available 并填入 updateInfo', async () => {
    mockCheck.mockResolvedValue(makeUpdate());
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(api.status.value).toBe('available');
    expect(api.updateInfo.value).toEqual({ version: '1.2.3', date: '2026-04-01', body: 'release notes' });
    expect(api.lastCheckTime.value).not.toBeNull();
  });

  it('无更新 → status=up-to-date', async () => {
    mockCheck.mockResolvedValue(null as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(api.status.value).toBe('up-to-date');
    expect(api.updateInfo.value).toBeNull();
  });

  it('Update 缺少 date/body 时使用空字符串', async () => {
    mockCheck.mockResolvedValue(makeUpdate({ date: undefined, body: undefined }));
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(api.updateInfo.value).toEqual({ version: '1.2.3', date: '', body: '' });
  });

  it('检查失败 → status=error 并记录 errorMessage', async () => {
    mockCheck.mockRejectedValue(new Error('network'));
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(api.status.value).toBe('error');
    expect(api.errorMessage.value).toBe('network');
  });

  it('检查失败抛出非 Error 对象 → 转成字符串', async () => {
    mockCheck.mockRejectedValue('weird');
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(api.errorMessage.value).toBe('weird');
  });

  it('正在检查时再次调用不重入', async () => {
    let resolveCheck!: (v: any) => void;
    mockCheck.mockImplementation(() => new Promise(r => { resolveCheck = r; }));
    const api = useAutoUpdate();
    const p1 = api.checkForUpdate();
    expect(api.status.value).toBe('checking');
    const p2 = api.checkForUpdate();
    await p2; // 立即返回
    resolveCheck(null);
    await p1;
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });
});

describe('useAutoUpdate - downloadAndInstall', () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    const api = useAutoUpdate();
    api.status.value = 'idle';
    api.updateInfo.value = null;
    api.downloadProgress.value = 0;
    api.errorMessage.value = '';
  });

  it('无 pendingUpdate → 什么都不做', async () => {
    const api = useAutoUpdate();
    await api.downloadAndInstall();
    expect(api.status.value).toBe('idle');
  });

  it('下载成功 + relaunch 成功 → ready', async () => {
    const update = makeUpdate();
    update.downloadAndInstall = vi.fn(async (cb: any) => {
      cb({ event: 'Started', data: { contentLength: 1000 } });
      cb({ event: 'Progress', data: { chunkLength: 400 } });
      cb({ event: 'Progress', data: { chunkLength: 600 } });
      cb({ event: 'Finished' });
    });
    mockCheck.mockResolvedValue(update);
    mockRelaunch.mockResolvedValue(undefined as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    await api.downloadAndInstall();
    expect(api.status.value).toBe('ready');
    expect(api.downloadProgress.value).toBe(100);
    expect(mockRelaunch).toHaveBeenCalled();
  });

  it('relaunch 失败 → 设置手动重启提示', async () => {
    const update = makeUpdate();
    update.downloadAndInstall = vi.fn(async (cb: any) => {
      cb({ event: 'Started', data: { contentLength: 100 } });
      cb({ event: 'Finished' });
    });
    mockCheck.mockResolvedValue(update);
    mockRelaunch.mockRejectedValue(new Error('perm'));
    const api = useAutoUpdate();
    await api.checkForUpdate();
    await api.downloadAndInstall();
    expect(api.status.value).toBe('ready');
    expect(api.errorMessage.value).toBe('更新已安装，请手动重启应用');
  });

  it('下载失败 → status=error', async () => {
    const update = makeUpdate();
    update.downloadAndInstall = vi.fn().mockRejectedValue(new Error('net'));
    mockCheck.mockResolvedValue(update);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    await api.downloadAndInstall();
    expect(api.status.value).toBe('error');
    expect(api.errorMessage.value).toBe('net');
  });

  it('正在下载时重入立即返回', async () => {
    const update = makeUpdate();
    let resolveDl!: () => void;
    update.downloadAndInstall = vi.fn(() => new Promise<void>(r => { resolveDl = r; }));
    mockCheck.mockResolvedValue(update);
    mockRelaunch.mockResolvedValue(undefined as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    const p1 = api.downloadAndInstall();
    const p2 = api.downloadAndInstall();
    await p2;
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    resolveDl();
    await p1;
  });

  it('contentLength 缺失时进度不更新（但下载仍完成）', async () => {
    const update = makeUpdate();
    update.downloadAndInstall = vi.fn(async (cb: any) => {
      cb({ event: 'Started', data: {} }); // 无 contentLength
      cb({ event: 'Progress', data: { chunkLength: 100 } });
      cb({ event: 'Finished' });
    });
    mockCheck.mockResolvedValue(update);
    mockRelaunch.mockResolvedValue(undefined as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    await api.downloadAndInstall();
    // Finished 仍设 100
    expect(api.downloadProgress.value).toBe(100);
  });
});
