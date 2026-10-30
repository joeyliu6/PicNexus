import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { createLogger } from '@/utils/logger';

const log = createLogger('AutoUpdate');

// Why: GitHub endpoint 在国内常见的失败模式是 TCP 半开/DNS 挂起，
// plugin-updater 默认无超时（reqwest 默认无 request timeout），不显式传会无限 pending。
const CHECK_TIMEOUT_MS = 30_000;

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  // 安装包已下好、正在安装（或等进行中的上传传完）。Windows 会停在这个状态直到进程被 exit(0) 杀掉；
  // macOS / Linux 会继续走到 install-pending。见 install 的注释。
  | 'installing'
  | 'install-pending'
  | 'error';

interface UpdateInfo {
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
  /** 下载中：已下 / 总字节（总数拿不到时为 0） */
  downloadedBytes: Ref<number>;
  totalBytes: Ref<number>;
  waitingForUploads: Ref<boolean>;
  hasAvailableUpdate: ComputedRef<boolean>;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  cancelDownload: () => void;
  retryRelaunch: () => Promise<void>;
  retryDownload: () => Promise<void>;
}

const status = ref<UpdateStatus>('idle');
const updateInfo = ref<UpdateInfo | null>(null);
const downloadProgress = ref(0);
const errorMessage = ref('');
const lastCheckTime = ref<number | null>(null);
const pendingUpdateAvailable = ref(false);
const downloadedBytes = ref(0);
const totalBytes = ref(0);
/** 安装 / 重启前在等上传传完 */
const waitingForUploads = ref(false);
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
  downloadTask = null;
  downloaded = false;
  wantInstall = false;
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

/**
 * 安装前的闸门：重启前要等正在进行的上传传完（交接说明 8.5）。由外壳注册（它握着上传控制器），
 * 这里不直接依赖上传模块；没注册时直接放行。
 */
let installGate: () => Promise<void> = async () => {};

export function setUpdateInstallGate(gate: () => Promise<void>): void {
  installGate = gate;
}

/** 正在进行的那次下载：插件的下载不能中途停，「取消」只是不再安装；再点「立即更新」接着显示这一次的进度 */
let downloadTask: Promise<void> | null = null;
/** 这一版的安装包已经下好（还没装） */
let downloaded = false;
/** 下好之后要不要接着装（点了「取消」就不装） */
let wantInstall = false;

async function install(): Promise<void> {
  if (!pendingUpdate) return;
  status.value = 'installing';
  waitingForUploads.value = true;
  try {
    await installGate();
  } finally {
    waitingForUploads.value = false;
  }
  try {
    await pendingUpdate.install();
    // ⚠️ 仅 macOS / Linux 可达：Windows 的 install() 以 exit(0) 收尾，安装程序接管并重启应用，UI 停在 installing。
    // 下载安装完成后不自动重启：让用户看到明确的完成态，再主动点「重启完成更新」，避免应用突然退出。
    status.value = 'install-pending';
  } catch (e) {
    status.value = 'error';
    errorMessage.value = e instanceof Error ? e.message : String(e);
    log.error('安装失败:', e);
  }
}

async function downloadAndInstall(): Promise<void> {
  // 只允许从 available 进入：installing / install-pending 时重复点击不能再装一次
  if (!pendingUpdate || status.value !== 'available') return;
  wantInstall = true;
  if (downloaded) { await install(); return; }
  status.value = 'downloading';
  if (downloadTask) return downloadTask;

  errorMessage.value = '';
  downloadProgress.value = 0;
  downloadedBytes.value = 0;
  totalBytes.value = 0;
  const update = pendingUpdate;
  downloadTask = (async () => {
    try {
      await update.download((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          totalBytes.value = event.data.contentLength;
        } else if (event.event === 'Progress') {
          downloadedBytes.value += event.data.chunkLength;
          if (totalBytes.value > 0) {
            downloadProgress.value = Math.min(Math.round((downloadedBytes.value / totalBytes.value) * 100), 100);
          }
        } else if (event.event === 'Finished') {
          downloadProgress.value = 100;
        }
      });
    } catch (e) {
      downloadTask = null;
      log.error('下载失败:', e);
      // 已经点了「取消」：没人在等这次下载，失败也不打扰；下次「立即更新」重新下
      if (!wantInstall || pendingUpdate !== update) return;
      status.value = 'error';
      errorMessage.value = e instanceof Error ? e.message : String(e);
      return;
    }
    downloadTask = null;
    if (pendingUpdate !== update) return;
    downloaded = true;
    if (wantInstall) await install();
  })();
  return downloadTask;
}

/** 下载中点「取消」：回到「发现新版本」，后台下载照常跑完但不安装 */
function cancelDownload(): void {
  if (status.value !== 'downloading') return;
  wantInstall = false;
  status.value = 'available';
}

async function retryRelaunch(): Promise<void> {
  if (status.value !== 'install-pending') return;
  waitingForUploads.value = true;
  try {
    await installGate();
  } finally {
    waitingForUploads.value = false;
  }
  try {
    await relaunch();
  } catch (e) {
    errorMessage.value = '重启失败，请关闭应用后重新打开';
    log.error('手动重启仍失败:', e);
  }
}

async function retryDownload(): Promise<void> {
  // 下载 / 安装失败后 pendingUpdate 仍有效：回到 available 复用它重试，省掉一次 latest.json 请求
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
    downloadedBytes,
    totalBytes,
    waitingForUploads,
    hasAvailableUpdate,
    checkForUpdate,
    downloadAndInstall,
    cancelDownload,
    retryRelaunch,
    retryDownload,
  };
}
