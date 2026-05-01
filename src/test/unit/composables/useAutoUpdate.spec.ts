import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRelaunchMock, getUpdaterCheckMock } from '../../helpers/tauriMock';
import { useAutoUpdate } from '../../../composables/useAutoUpdate';

const mockCheck = getUpdaterCheckMock();
const mockRelaunch = getRelaunchMock();

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
    api.pendingUpdateAvailable.value = false;
  });

  it('check 调用时显式传入 timeout，避免 TCP 半开/DNS 挂起永久 pending', async () => {
    mockCheck.mockResolvedValue(null as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it('再次 check 时旧 Update 调用 close 释放 Rust 资源', async () => {
    const oldUpdate = makeUpdate({ version: '1.0.0' });
    const newUpdate = makeUpdate({ version: '1.0.1' });
    mockCheck.mockResolvedValueOnce(oldUpdate).mockResolvedValueOnce(newUpdate);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(api.pendingUpdateAvailable.value).toBe(true);
    await api.checkForUpdate();
    expect(oldUpdate.close).toHaveBeenCalledTimes(1);
    expect(api.updateInfo.value?.version).toBe('1.0.1');
  });

  it('check 后无更新时旧 pendingUpdate 也被 close', async () => {
    const oldUpdate = makeUpdate();
    mockCheck.mockResolvedValueOnce(oldUpdate).mockResolvedValueOnce(null as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    await api.checkForUpdate();
    expect(oldUpdate.close).toHaveBeenCalledTimes(1);
    expect(api.pendingUpdateAvailable.value).toBe(false);
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
    api.pendingUpdateAvailable.value = false;
  });

  it('无 pendingUpdate → 什么都不做', async () => {
    const api = useAutoUpdate();
    await api.downloadAndInstall();
    expect(api.status.value).toBe('idle');
  });

  it('下载成功后进入 install-pending，等待用户手动重启', async () => {
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
    expect(api.status.value).toBe('install-pending');
    expect(api.downloadProgress.value).toBe(100);
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it('下载过程中按 contentLength 计算中途进度', async () => {
    const update = makeUpdate();
    const api = useAutoUpdate();
    update.downloadAndInstall = vi.fn(async (cb: any) => {
      cb({ event: 'Started', data: { contentLength: 1000 } });
      cb({ event: 'Progress', data: { chunkLength: 400 } });
      expect(api.downloadProgress.value).toBe(40);
      cb({ event: 'Finished' });
    });
    mockCheck.mockResolvedValue(update);
    mockRelaunch.mockResolvedValue(undefined as any);
    await api.checkForUpdate();
    await api.downloadAndInstall();
    expect(api.downloadProgress.value).toBe(100);
  });

  it('安装完成后不会自动 relaunch，也不会写入错误提示', async () => {
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
    expect(api.status.value).toBe('install-pending');
    expect(api.errorMessage.value).toBe('');
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it('install-pending 时再次点下载按钮不会触发二次 downloadAndInstall', async () => {
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
    expect(api.status.value).toBe('install-pending');
    await api.downloadAndInstall(); // 守卫拦截
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it('retryRelaunch 仅在 install-pending 时生效', async () => {
    const api = useAutoUpdate();
    api.status.value = 'idle';
    await api.retryRelaunch();
    expect(mockRelaunch).not.toHaveBeenCalled();

    api.status.value = 'install-pending';
    mockRelaunch.mockResolvedValue(undefined as any);
    await api.retryRelaunch();
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it('retryDownload 复用 pendingUpdate 重试，不再发起 check', async () => {
    const update = makeUpdate();
    update.downloadAndInstall = vi
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce(undefined as any);
    mockCheck.mockResolvedValue(update);
    mockRelaunch.mockResolvedValue(undefined as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    await api.downloadAndInstall();
    expect(api.status.value).toBe('error');
    expect(api.pendingUpdateAvailable.value).toBe(true);

    await api.retryDownload();
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(mockCheck).toHaveBeenCalledTimes(1); // 没有再次 check
    expect(api.status.value).toBe('install-pending');
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
