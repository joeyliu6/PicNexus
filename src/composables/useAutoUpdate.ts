import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { createLogger } from '../utils/logger';

const log = createLogger('AutoUpdate');

// Why: GitHub endpoint 在国内常见的失败模式是 TCP 半开/DNS 挂起，
// plugin-updater 默认无超时（reqwest 默认无 request timeout），不显式传会无限 pending。
const CHECK_TIMEOUT_MS = 30_000;

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'install-pending'
  | 'error';

export interface UpdateInfo {
  version: string;
  date: string;
  body: string;
}

export interface UseAutoUpdateReturn {
  status: Ref<UpdateStatus>;
  updateInfo: Ref<UpdateInfo | null>;
  downloadProgress: Ref<number>;
  errorMessage: Ref<string>;
  lastCheckTime: Ref<number | null>;
  pendingUpdateAvailable: Ref<boolean>;
  hasAvailableUpdate: ComputedRef<boolean>;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  retryRelaunch: () => Promise<void>;
  retryDownload: () => Promise<void>;
}

const status = ref<UpdateStatus>('idle');
const updateInfo = ref<UpdateInfo | null>(null);
const downloadProgress = ref(0);
const errorMessage = ref('');
const lastCheckTime = ref<number | null>(null);
const pendingUpdateAvailable = ref(false);
const hasAvailableUpdate = computed(() =>
  status.value === 'available' || status.value === 'install-pending'
);

let pendingUpdate: Update | null = null;

// Why: tauri-plugin-updater 的 Update 对象在 Rust 侧持有 ResourceTable rid，
// 不调 close() 反复 check 会泄漏句柄；切换或重置时必须显式释放。
async function disposePendingUpdate(): Promise<void> {
  if (!pendingUpdate) return;
  const old = pendingUpdate;
  pendingUpdate = null;
  pendingUpdateAvailable.value = false;
  try {
    await old.close();
  } catch (e) {
    log.warn('释放旧 Update 资源失败:', e);
  }
}

async function checkForUpdate(): Promise<void> {
  if (status.value === 'checking' || status.value === 'downloading') return;

  status.value = 'checking';
  errorMessage.value = '';
  updateInfo.value = null;

  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    lastCheckTime.value = Date.now();

    await disposePendingUpdate();

    if (update) {
      pendingUpdate = update;
      pendingUpdateAvailable.value = true;
      updateInfo.value = {
        version: update.version,
        date: update.date ?? '',
        body: update.body ?? '',
      };
      status.value = 'available';
    } else {
      status.value = 'up-to-date';
    }
  } catch (e) {
    lastCheckTime.value = Date.now();
    status.value = 'error';
    errorMessage.value = e instanceof Error ? e.message : String(e);
    log.error('检查失败:', e);
  }
}

async function downloadAndInstall(): Promise<void> {
  // Why: 收紧守卫——只允许从 available 进入。原守卫只挡 'downloading'，
  // 漏过 'ready' / 'install-pending'，relaunch 失败后用户重复点击会触发同一 Update 的二次 downloadAndInstall。
  if (!pendingUpdate || status.value !== 'available') return;

  status.value = 'downloading';
  downloadProgress.value = 0;
  errorMessage.value = '';

  let totalBytes = 0;
  let downloadedBytes = 0;

  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started' && event.data.contentLength) {
        totalBytes = event.data.contentLength;
      } else if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength;
        if (totalBytes > 0) {
          downloadProgress.value = Math.min(Math.round((downloadedBytes / totalBytes) * 100), 100);
        }
      } else if (event.event === 'Finished') {
        downloadProgress.value = 100;
      }
    });

    // Why: 下载安装完成后不自动重启。让用户看到明确的完成态，再主动点击重启，避免应用突然退出。
    status.value = 'install-pending';
  } catch (e) {
    // Why: 下载失败保留 pendingUpdate 供 retryDownload() 直接重试，避免强制走完整 check。
    status.value = 'error';
    errorMessage.value = e instanceof Error ? e.message : String(e);
    log.error('下载/安装失败:', e);
  }
}

async function retryRelaunch(): Promise<void> {
  if (status.value !== 'install-pending') return;
  try {
    await relaunch();
  } catch (e) {
    errorMessage.value = '重启失败，请关闭应用后重新打开';
    log.error('手动重启仍失败:', e);
  }
}

async function retryDownload(): Promise<void> {
  // Why: 下载失败后 pendingUpdate 仍有效（plugin 内部无"已消费"标记），
  // 直接重置 status='available' 并复用旧 Update 重试，省掉一次 latest.json 请求。
  if (!pendingUpdate || status.value !== 'error') return;
  status.value = 'available';
  errorMessage.value = '';
  await downloadAndInstall();
}

export function useAutoUpdate(): UseAutoUpdateReturn {
  return {
    status,
    updateInfo,
    downloadProgress,
    errorMessage,
    lastCheckTime,
    pendingUpdateAvailable,
    hasAvailableUpdate,
    checkForUpdate,
    downloadAndInstall,
    retryRelaunch,
    retryDownload,
  };
}
