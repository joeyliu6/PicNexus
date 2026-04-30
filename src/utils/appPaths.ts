import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';

let userDataDirPromise: Promise<string> | null = null;
let historyDbPathPromise: Promise<string> | null = null;

export async function getUserDataDir(): Promise<string> {
  if (!userDataDirPromise) {
    userDataDirPromise = (async () => {
      try {
        const dir = await invoke<string>('get_user_data_dir');
        if (dir) return dir;
      } catch {
        // Browser/unit-test fallback.
      }
      return appDataDir();
    })();
  }

  return userDataDirPromise;
}

export async function getHistoryDbPath(): Promise<string> {
  if (!historyDbPathPromise) {
    historyDbPathPromise = (async () => {
      try {
        const dbPath = await invoke<string>('get_history_db_path');
        if (dbPath) return dbPath;
      } catch {
        // Browser/unit-test fallback.
      }
      return 'sqlite:history.db';
    })();
  }

  return historyDbPathPromise;
}
