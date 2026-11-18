// 软件外上传（命令行 / Typora 配置档 / 编辑器服务）进历史记录：Rust 每传成功一张，在用户数据目录的
// pending-uploads/ 记一条（src-tauri/src/external_uploads.rs）；这里在主界面启动、窗口拿到焦点、
// 编辑器服务通知时把它们写进历史库，写完再让 Rust 删掉。流程见 docs/flows/history-flow.md「软件外的上传」。

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { HistoryItem, UserConfig } from '@/config/types';
import { historyDB } from '@/services/database';
import { readFreshConfig } from '@/store/instances';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import { invalidateCache } from './useHistory';
import { createLogger } from '@/utils/logger';

const log = createLogger('ExternalUploads');

/** 与 src-tauri/src/external_uploads.rs 的 EXTERNAL_UPLOAD_EVENT 一致：编辑器服务记下一条后发 */
export const EXTERNAL_UPLOAD_EVENT = 'external-uploads://recorded';

/** Rust ExternalUpload 的 JSON 形状 */
export interface ExternalUpload {
  id: string;
  timestamp: number;
  source: 'cli' | 'typora' | 'editor';
  serviceId: string;
  url: string;
  fileName: string;
  filePath: string | null;
  metadata: { width: number; height: number; aspect_ratio: number; file_size: number; format: string };
}

/**
 * Typora 配置档和编辑器服务只知道图床类型：WebDAV / 自定义 S3 记的是 `webdav` / `custom_s3`，
 * 按设置里这条路用的图床补成带档案号的完整编号（`webdav:<档案>`）；设置已经改成别的图床，就保留原样。
 */
export function resolveServiceId(upload: ExternalUpload, config: UserConfig | null): string {
  const { serviceId, source } = upload;
  if (source === 'cli') return serviceId;
  const editor = config?.editorServer;
  const configured = source === 'typora' ? editor?.typoraService : editor?.obsidianService;
  return configured?.startsWith(`${serviceId}:`) ? configured : serviceId;
}

export function toHistoryItem(upload: ExternalUpload, serviceId: string): HistoryItem {
  const { metadata } = upload;
  return {
    id: `external-${upload.id}`,
    timestamp: upload.timestamp,
    localFileName: upload.fileName,
    ...(upload.filePath ? { filePath: upload.filePath } : {}),
    primaryService: serviceId,
    // 编辑器 / 命令行那条路只拿得到链接，没有各图床的文件标识
    results: [{ serviceId, status: 'success', result: { serviceId, fileKey: '', url: upload.url } }],
    generatedLink: upload.url,
    width: metadata.width,
    height: metadata.height,
    aspectRatio: metadata.aspect_ratio,
    fileSize: metadata.file_size,
    format: metadata.format,
  };
}

let running: Promise<void> | null = null;
let again = false;

async function drainOnce(): Promise<void> {
  const uploads = await invoke<ExternalUpload[]>('list_external_uploads');
  if (uploads.length === 0) return;
  const config = await readFreshConfig();
  const done: string[] = [];
  const historyIds: string[] = [];
  for (const upload of uploads) {
    const item = toHistoryItem(upload, resolveServiceId(upload, config));
    try {
      // 记录 ID 由收件箱的 ID 决定：上次写进库、没来得及删的那条再来一次会被忽略，不会重复
      await historyDB.insertOrIgnore(item);
      done.push(upload.id);
      historyIds.push(item.id);
    } catch (error) {
      log.error('软件外上传写入历史失败，下次再试:', upload.fileName, error);
    }
  }
  if (historyIds.length > 0) {
    invalidateCache();
    await emitHistoryUpdated(historyIds);
    log.info(`已收进 ${historyIds.length} 条软件外上传`);
  }
  if (done.length > 0) await invoke('remove_external_uploads', { ids: done });
}

/** 把收件箱里的记录写进历史库。同时只跑一轮；跑的时候又被叫，跑完再补一轮 */
export function drainExternalUploads(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await drainOnce().catch((error) => log.warn('读取软件外上传失败', error));
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

/** 在应用外壳里装一次：启动时收一次，之后编辑器服务通知、窗口拿到焦点（命令行传完切回来）时再收；返回卸载函数 */
export function installExternalUploads(): () => void {
  const unlisteners: UnlistenFn[] = [];
  let disposed = false;
  const keep = (promise: Promise<UnlistenFn>) => promise
    .then((unlisten) => { if (disposed) unlisten(); else unlisteners.push(unlisten); })
    .catch((error) => log.warn('监听软件外上传失败', error));

  void drainExternalUploads();
  keep(listen(EXTERNAL_UPLOAD_EVENT, () => { void drainExternalUploads(); }));
  keep(getCurrentWindow().onFocusChanged(({ payload: focused }) => { if (focused) void drainExternalUploads(); }));

  return () => {
    disposed = true;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };
}

/** 测试用 */
export function resetExternalUploadsForTest(): void {
  running = null;
  again = false;
}
