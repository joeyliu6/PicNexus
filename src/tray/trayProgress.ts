// 托盘上的上传进度（T02）：菜单顶部的状态行，与托盘图标的花瓣逐片点亮。纯计算，便于单测。
// 托盘图标是单色小图（16px），只画经典四瓣，靠每片的不透明度表达进度；关闭全局快捷键时整体变淡（T07）。

import type { QueueItem } from '@/core/UploadQueue';
import { hostViews, petalStates, sessionCounts, type HostState } from '@/composables/upload/uploadSessions';
import type { PetalState } from '@/utils/petals';
import type { TrayUploadStatus } from './trayMenuModel';

/** TrayWindow.dc.html 的 ic：传完 1、上传中 0.55、等待 0.3；暂停（关闭全局快捷键）整体 0.35 */
export const TRAY_PETAL_OPACITY = { lit: 1, uploading: 0.55, waiting: 0.3, paused: 0.35 } as const;

export type TrayIconOpacities = [number, number, number, number];

/** 多张时每个图床的整体情况：这批都落定了才算这一瓣传完 */
function batchPetal(states: HostState[]): PetalState {
  const settled = states.every((state) => state === 'done' || state === 'failed' || state === 'skipped');
  if (settled) {
    if (states.some((state) => state === 'done')) return 'ok';
    return states.every((state) => state === 'skipped') ? 'empty' : 'failed';
  }
  return states.some((state) => state !== 'waiting') ? 'uploading' : 'waiting';
}

/** 当前这次上传（单张或一批）在托盘上怎么写；没有正在进行的上传时为 null */
export function trayUploadStatus(items: readonly QueueItem[]): TrayUploadStatus | null {
  if (items.length === 0) return null;
  if (items.length === 1) {
    const [item] = items;
    const hosts = hostViews(item);
    return {
      subject: item.fileName,
      done: hosts.filter((host) => host.state === 'done').length,
      total: hosts.length,
      petals: petalStates(item),
    };
  }
  const counts = sessionCounts(items);
  const hostIds = items[0].enabledServices;
  return {
    subject: `${items.length} 张`,
    done: counts.done + counts.failed,
    total: counts.total,
    petals: hostIds.map((hostId) => batchPetal(items.map((item) => hostViews(item).find((host) => host.id === hostId)?.state ?? 'waiting'))),
  };
}

function petalOpacity(state: PetalState): number {
  if (state === 'uploading') return TRAY_PETAL_OPACITY.uploading;
  if (state === 'waiting' || state === 'empty') return TRAY_PETAL_OPACITY.waiting;
  // 传完、失败、可能受限都算这一瓣已落定（单色小图分不出红，失败由系统通知说明）
  return TRAY_PETAL_OPACITY.lit;
}

/**
 * 托盘图标四瓣（上、右、下、左）的不透明度。
 * 1–4 个图床：一瓣对一个图床，空槽按等待画；超过 4 个：按落定的比例逐片点亮，下一片半亮。
 */
export function trayIconOpacities(upload: TrayUploadStatus | null, paused: boolean): TrayIconOpacities {
  if (!upload) {
    const all = paused ? TRAY_PETAL_OPACITY.paused : TRAY_PETAL_OPACITY.lit;
    return [all, all, all, all];
  }
  const states = upload.petals;
  if (states.length <= 4) {
    return [0, 1, 2, 3].map((i) => petalOpacity(states[i] ?? 'empty')) as TrayIconOpacities;
  }
  const settled = states.filter((state) => petalOpacity(state) === TRAY_PETAL_OPACITY.lit).length;
  const lit = Math.floor((settled / states.length) * 4);
  return [0, 1, 2, 3].map((i) => {
    if (i < lit) return TRAY_PETAL_OPACITY.lit;
    return i === lit ? TRAY_PETAL_OPACITY.uploading : TRAY_PETAL_OPACITY.waiting;
  }) as TrayIconOpacities;
}
