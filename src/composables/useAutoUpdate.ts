import { ref, type Ref } from 'vue';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
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
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
}

const status = ref<UpdateStatus>('idle');
const updateInfo = ref<UpdateInfo | null>(null);
const downloadProgress = ref(0);
const errorMessage = ref('');
const lastCheckTime = ref<number | null>(null);

let pendingUpdate: Update | null = null;

async function checkForUpdate(): Promise<void> {
  if (status.value === 'checking' || status.value === 'downloading') return;

  status.value = 'checking';
  errorMessage.value = '';
  updateInfo.value = null;

  try {
    const update = await check();
    lastCheckTime.value = Date.now();

    if (update) {
      pendingUpdate = update;
      updateInfo.value = {
        version: update.version,
        date: update.date ?? '',
        body: update.body ?? '',
      };
      status.value = 'available';
    } else {
      pendingUpdate = null;
      status.value = 'up-to-date';
    }
  } catch (e) {
    status.value = 'error';
    errorMessage.value = e instanceof Error ? e.message : String(e);
    console.error('[自动更新] 检查失败:', e);
  }
}

async function downloadAndInstall(): Promise<void> {
  if (!pendingUpdate || status.value === 'downloading') return;

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

    status.value = 'ready';

    try {
      await relaunch();
    } catch (relaunchErr) {
      errorMessage.value = '更新已安装，请手动重启应用';
      console.warn('[自动更新] 自动重启失败，请手动重启:', relaunchErr);
    }
  } catch (e) {
    status.value = 'error';
    errorMessage.value = e instanceof Error ? e.message : String(e);
    console.error('[自动更新] 下载/安装失败:', e);
  }
}

export function useAutoUpdate(): UseAutoUpdateReturn {
  return {
    status,
    updateInfo,
    downloadProgress,
    errorMessage,
    lastCheckTime,
    checkForUpdate,
    downloadAndInstall,
  };
}
