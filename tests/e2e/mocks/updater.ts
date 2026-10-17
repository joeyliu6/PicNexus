// @tauri-apps/plugin-updater 的替身：默认「已是最新」。seed.update 摆出发现新版本、下载到一半、安装中、失败等状态。
import { getState } from './state';

export interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data?: { contentLength?: number; chunkLength?: number };
}

export interface Update {
  version: string;
  date?: string;
  body?: string;
  close: () => Promise<void>;
  download: (handler?: (event: DownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
  downloadAndInstall: (handler?: (event: DownloadEvent) => void) => Promise<void>;
}

const never = () => new Promise<never>(() => {});

export async function check(): Promise<Update | null> {
  const plan = getState().update;
  if (!plan) return null;
  if (plan.hang === 'check') return never();
  if (plan.checkError) throw new Error(plan.checkError);
  if (!plan.version) return null;

  const download = async (handler?: (event: DownloadEvent) => void) => {
    handler?.({ event: 'Started', data: { contentLength: plan.total } });
    if (plan.downloaded) handler?.({ event: 'Progress', data: { chunkLength: plan.downloaded } });
    if (plan.hang === 'download') return never();
    if (plan.downloadError) throw new Error(plan.downloadError);
    handler?.({ event: 'Finished' });
  };
  const install = async () => {
    if (plan.hang === 'install') return never();
  };
  return {
    version: plan.version,
    date: '2026-10-16',
    body: plan.body ?? '',
    close: async () => {},
    download,
    install,
    downloadAndInstall: async (handler) => { await download(handler); await install(); },
  };
}
