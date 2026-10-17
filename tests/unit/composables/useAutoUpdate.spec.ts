import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRelaunchMock, getUpdaterCheckMock } from '../helpers/tauriMock';
import { setUpdateInstallGate, useAutoUpdate } from '@/composables/useAutoUpdate';

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
    expect(api.hasAvailableUpdate.value).toBe(true);
    expect(api.updateInfo.value).toEqual({ version: '1.2.3', date: '2026-04-01', body: 'release notes' });
    expect(api.lastCheckTime.value).not.toBeNull();
  });

  it('无更新 → status=up-to-date', async () => {
    mockCheck.mockResolvedValue(null as any);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    expect(api.status.value).toBe('up-to-date');
    expect(api.hasAvailableUpdate.value).toBe(false);
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
    expect(api.hasAvailableUpdate.value).toBe(false);
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

describe('useAutoUpdate - 下载与安装', () => {
  beforeEach(() => {
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    setUpdateInstallGate(async () => {});
    const api = useAutoUpdate();
    api.status.value = 'idle';
    api.updateInfo.value = null;
    api.downloadProgress.value = 0;
    api.errorMessage.value = '';
    api.pendingUpdateAvailable.value = false;
  });

  /** 下载按事件走完：Started(total) → Progress… → Finished */
  function downloadWith(total: number | undefined, chunks: number[]) {
    return vi.fn(async (cb: any) => {
      cb({ event: 'Started', data: total ? { contentLength: total } : {} });
      for (const chunk of chunks) cb({ event: 'Progress', data: { chunkLength: chunk } });
      cb({ event: 'Finished' });
    });
  }

  async function found(update: any) {
    mockCheck.mockResolvedValue(update);
    const api = useAutoUpdate();
    await api.checkForUpdate();
    return api;
  }

  it('无 pendingUpdate → 什么都不做', async () => {
    const api = useAutoUpdate();
    await api.downloadAndInstall();
    expect(api.status.value).toBe('idle');
  });

  it('下载完接着安装，进入 install-pending 等用户手动重启（不自动 relaunch）', async () => {
    const update = makeUpdate({ download: downloadWith(1000, [400, 600]), install: vi.fn().mockResolvedValue(undefined) });
    const api = await found(update);
    await api.downloadAndInstall();
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(api.status.value).toBe('install-pending');
    expect(api.downloadProgress.value).toBe(100);
    expect(api.downloadedBytes.value).toBe(1000);
    expect(api.totalBytes.value).toBe(1000);
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it('安装开始时进入 installing（Windows 上 install() 以 exit(0) 收尾，停在这一态）', async () => {
    let statusAtInstall: string | undefined;
    const update = makeUpdate({ download: downloadWith(100, [100]) });
    const api = await found(update);
    update.install = vi.fn(async () => { statusAtInstall = api.status.value; });
    await api.downloadAndInstall();
    expect(statusAtInstall).toBe('installing');
  });

  it('安装前等进行中的上传传完（交接说明 8.5）', async () => {
    let release!: () => void;
    setUpdateInstallGate(() => new Promise<void>((resolve) => { release = resolve; }));
    const update = makeUpdate({ download: downloadWith(100, [100]), install: vi.fn().mockResolvedValue(undefined) });
    const api = await found(update);
    const done = api.downloadAndInstall();
    await vi.waitFor(() => expect(api.waitingForUploads.value).toBe(true));
    expect(api.status.value).toBe('installing');
    expect(update.install).not.toHaveBeenCalled();
    release();
    await done;
    expect(update.install).toHaveBeenCalled();
    expect(api.waitingForUploads.value).toBe(false);
  });

  it('下载中「取消」：回到发现新版本，下完不安装；再点「立即更新」直接安装，不重复下载', async () => {
    let finish!: () => void;
    const update = makeUpdate({
      download: vi.fn((cb: any) => new Promise<void>((resolve) => {
        cb({ event: 'Started', data: { contentLength: 100 } });
        finish = () => { cb({ event: 'Finished' }); resolve(); };
      })),
      install: vi.fn().mockResolvedValue(undefined),
    });
    const api = await found(update);
    const first = api.downloadAndInstall();
    expect(api.status.value).toBe('downloading');
    api.cancelDownload();
    expect(api.status.value).toBe('available');
    finish();
    await first;
    expect(update.install).not.toHaveBeenCalled();
    expect(api.status.value).toBe('available');

    await api.downloadAndInstall();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it('取消后在下载结束前再点「立即更新」：接着显示同一次下载，不重新下', async () => {
    let finish!: () => void;
    const update = makeUpdate({
      download: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
      install: vi.fn().mockResolvedValue(undefined),
    });
    const api = await found(update);
    const first = api.downloadAndInstall();
    api.cancelDownload();
    const second = api.downloadAndInstall();
    expect(api.status.value).toBe('downloading');
    finish();
    await Promise.all([first, second]);
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(api.status.value).toBe('install-pending');
  });

  it('installing / install-pending 时再点不会再装一次', async () => {
    const update = makeUpdate({ download: downloadWith(100, [100]), install: vi.fn().mockResolvedValue(undefined) });
    const api = await found(update);
    await api.downloadAndInstall();
    await api.downloadAndInstall();
    api.status.value = 'installing';
    await api.downloadAndInstall();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
  });

  it('retryRelaunch 仅在 install-pending 时生效，并先等上传传完', async () => {
    const gate = vi.fn().mockResolvedValue(undefined);
    setUpdateInstallGate(gate);
    const api = useAutoUpdate();
    api.status.value = 'idle';
    await api.retryRelaunch();
    expect(mockRelaunch).not.toHaveBeenCalled();

    api.status.value = 'install-pending';
    mockRelaunch.mockResolvedValue(undefined as any);
    await api.retryRelaunch();
    expect(gate).toHaveBeenCalled();
    expect(mockRelaunch).toHaveBeenCalledTimes(1);
  });

  it('下载失败 → error；retryDownload 复用 pendingUpdate 重试，不再发起 check', async () => {
    const update = makeUpdate({
      download: vi.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce(undefined),
      install: vi.fn().mockResolvedValue(undefined),
    });
    const api = await found(update);
    await api.downloadAndInstall();
    expect(api.status.value).toBe('error');
    expect(api.errorMessage.value).toBe('net');
    expect(api.pendingUpdateAvailable.value).toBe(true);

    await api.retryDownload();
    expect(update.download).toHaveBeenCalledTimes(2);
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(api.status.value).toBe('install-pending');
  });

  it('安装失败 → error，重试时直接再装（包已下好）', async () => {
    const update = makeUpdate({
      download: downloadWith(100, [100]),
      install: vi.fn().mockRejectedValueOnce(new Error('os error 5')).mockResolvedValueOnce(undefined),
    });
    const api = await found(update);
    await api.downloadAndInstall();
    expect(api.status.value).toBe('error');
    await api.retryDownload();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(api.status.value).toBe('install-pending');
  });

  it('contentLength 缺失时进度不更新（但下载仍完成）', async () => {
    const update = makeUpdate({ download: downloadWith(undefined, [100]), install: vi.fn().mockResolvedValue(undefined) });
    const api = await found(update);
    await api.downloadAndInstall();
    expect(api.downloadProgress.value).toBe(100);
  });
});
