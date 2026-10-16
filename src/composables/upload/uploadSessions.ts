// 首页「快传」的展示模型：把上传队列里的条目翻译成焦点卡 / 批量卡 / 最近上传要的样子。
// 只做纯计算，不碰界面与 Tauri，便于单测（HomeScreen.dc.html 的各状态）。

import type { QueueItem, ServiceProgress } from '@/core/UploadQueue';
import type { PetalState } from '@/utils/petals';
import { describeUploadFailure, type UploadFailureText } from '@/utils/uploadFailureMessage';
import { isStatusError, isStatusSuccess, isStatusUploading } from '@/utils/uploadStatus';

/** 一次上传操作（拖入 / 粘贴 / 选择文件 / 从 URL 下载各算一次） */
export interface UploadSession {
  id: string;
  startedAt: number;
  /** 本次加入队列的条目，按拖入顺序 */
  itemIds: string[];
  /** 整批结束（含全部失败） */
  finished: boolean;
  /** 自动复制的结果；null = 还没复制（或没开自动复制） */
  copied: { count: number; format: string } | null;
}

export type HostState = 'done' | 'uploading' | 'waiting' | 'failed' | 'skipped';

export interface HostView {
  id: string;
  state: HostState;
  progress: number;
  error?: string;
  link?: string;
}

/** 一张图在首页上的状态：上传中 / 全部传完 / 部分图床失败 / 全部失败 */
export type ItemPhase = 'uploading' | 'done' | 'partial' | 'failed';

function hostStateOf(progress: ServiceProgress | undefined): HostState {
  if (!progress) return 'waiting';
  if (isStatusSuccess(progress.status)) return 'done';
  if (progress.status?.startsWith('已跳过')) return 'skipped';
  if (isStatusError(progress.status)) return 'failed';
  if (progress.isRetrying || isStatusUploading(progress.status) || progress.progress > 0) return 'uploading';
  return 'waiting';
}

/** 各图床的情况，按勾选顺序（只是排版顺序，不代表优先级） */
export function hostViews(item: QueueItem): HostView[] {
  return item.enabledServices.map((id) => {
    const progress = item.serviceProgress[id];
    return {
      id,
      state: hostStateOf(progress),
      progress: progress?.progress ?? 0,
      error: progress?.error,
      link: progress?.link,
    };
  });
}

const PETAL_OF: Record<HostState, PetalState> = {
  done: 'ok',
  uploading: 'uploading',
  waiting: 'waiting',
  failed: 'failed',
  skipped: 'empty',
};

/** 花瓣：几个图床传完亮几片；哪片变红就是哪个图床出了问题 */
export function petalStates(item: QueueItem): PetalState[] {
  return hostViews(item).map((host) => PETAL_OF[host.state]);
}

export function itemPhase(item: QueueItem): ItemPhase {
  const hosts = hostViews(item);
  if (item.status === 'pending' || item.status === 'uploading' || hosts.some((h) => h.state === 'uploading' || h.state === 'waiting')) {
    // 已经有图床传完、其余还在传：对用户来说链接已经有了，但这张还没传完
    return 'uploading';
  }
  if (!hosts.some((h) => h.state === 'done')) return 'failed';
  return hosts.some((h) => h.state === 'failed') ? 'partial' : 'done';
}

/** 链接是否已经可用（单张：第一个图床传完就有） */
export function hasLink(item: QueueItem): boolean {
  return !!item.primaryUrl || hostViews(item).some((h) => h.state === 'done' && !!h.link);
}

export interface SessionCounts {
  total: number;
  done: number;
  failed: number;
  uploading: number;
  waiting: number;
}

/** 批量：一张至少传上一个图床才算成功（交接说明规则 4.9） */
export function sessionCounts(items: readonly QueueItem[]): SessionCounts {
  const counts: SessionCounts = { total: items.length, done: 0, failed: 0, uploading: 0, waiting: 0 };
  for (const item of items) {
    const phase = itemPhase(item);
    if (phase === 'failed') counts.failed += 1;
    else if (phase === 'uploading') {
      if (item.status === 'pending' && hostViews(item).every((h) => h.state === 'waiting')) counts.waiting += 1;
      else counts.uploading += 1;
    } else counts.done += 1;
  }
  return counts;
}

export interface HostMiss {
  hostId: string;
  /** 在这个图床没传上、别的图床传上了的那些图（整张都失败的另有一行） */
  items: QueueItem[];
  /** 第一张的失败原因：用来分「登录已过期」还是「上传失败」 */
  error?: string;
}

/** 批量里每个图床没传上的那些图：某个图床没传上只报一行，写清几张（交接说明 4.9） */
export function hostMisses(items: readonly QueueItem[]): HostMiss[] {
  const hostIds = items[0]?.enabledServices ?? [];
  return hostIds.flatMap((hostId) => {
    const missed = items.filter((item) => itemPhase(item) !== 'failed'
      && hostViews(item).some((h) => h.id === hostId && h.state === 'failed'));
    return missed.length ? [{ hostId, items: missed, error: missed[0].serviceProgress[hostId]?.error }] : [];
  });
}

/** 失败图床里第一条原因（焦点卡「微博上传失败：登录已过期」那一行用） */
export function firstFailure(item: QueueItem): HostView | undefined {
  return hostViews(item).find((h) => h.state === 'failed');
}

/** 某个图床失败的说法（原因 + 处理办法）；Cookie 登录的图床把权限问题说成「登录已过期」 */
export function hostFailureText(
  hostId: string,
  error: string | undefined,
  hosts: readonly { id: string; cookieLogin: boolean }[],
): UploadFailureText {
  return describeUploadFailure(hostId, error ?? '', { cookieLogin: hosts.find((h) => h.id === hostId)?.cookieLogin });
}
