// 图库详情「存放在」一栏（GalleryScreen.dc.html G05–G07）：每个图床一行写什么、顶上要不要琥珀提示。
// 只做纯计算；检测结果来自 useMirrorFallback（valid / invalid / unchecked）+ 记录里的 browserMightWork。

import type { HistoryItem } from '@/config/types';
import type { MirrorInfo } from '@/composables/history/useMirrorFallback';

export type HostHealth = 'ok' | 'dead' | 'limited' | 'unchecked';

export interface HostRow {
  id: string;
  url: string;
  isCopySource: boolean;
  health: HostHealth;
  /** 名字下面那一行；正常时为空（不打任何标记，交接说明规则 4） */
  status: string;
  /** 琥珀色 ⚠ */
  warn: boolean;
  /** 失效的那份没有「复制」 */
  canCopy: boolean;
}

export type DetailBanner =
  | { kind: 'broken'; title: string; sub: string; useId: string; useName: string }
  | { kind: 'dead' };

/** 一条记录在某个图床上那份链接的检测结论（与格子角标、状态筛选的 SQL 同一口径） */
export function linkHealth(status: HistoryItem['linkCheckStatus'], serviceId: string): HostHealth {
  const entry = status?.[serviceId];
  if (!entry || entry.isValid == null || entry.errorType === 'pending') return 'unchecked';
  if (entry.isValid) return 'ok';
  return entry.browserMightWork ? 'limited' : 'dead';
}

function healthOf(mirror: MirrorInfo, status: HistoryItem['linkCheckStatus']): HostHealth {
  if (mirror.checkState === 'valid') return 'ok';
  if (mirror.checkState === 'unchecked') return 'unchecked';
  const entry = status?.[mirror.serviceId];
  // 检测还在排队（pending）不算失效，与 linkHealth 一致
  if (entry?.errorType === 'pending') return 'unchecked';
  return entry?.browserMightWork ? 'limited' : 'dead';
}

/** @param justSwitched 刚刚「改用」过去的那个图床：写「复制时使用 · 刚刚切换」 */
export function hostRows(mirrors: readonly MirrorInfo[], status: HistoryItem['linkCheckStatus'], justSwitched: string | null): HostRow[] {
  return mirrors.map((mirror) => {
    const health = healthOf(mirror, status);
    let text = '';
    if (health === 'dead') text = '图片已不存在';
    else if (health === 'limited') text = '可能受限';
    else if (mirror.isPrimary) text = justSwitched === mirror.serviceId ? '复制时使用 · 刚刚切换' : '复制时使用';
    else if (health === 'unchecked') text = '尚未检测';
    return {
      id: mirror.serviceId,
      url: mirror.url,
      isCopySource: mirror.isPrimary,
      health,
      status: text,
      warn: health === 'dead' || health === 'limited',
      canCopy: health !== 'dead',
    };
  });
}

/**
 * 「复制时使用」那份失效、还有别的可用：一条提示 + 唯一主按钮「改用 X」（G06）；
 * 一份都不剩：说清下一步（G07）；其余情况不提示。
 */
export function detailBanner(rows: readonly HostRow[], name: (hostId: string) => string): DetailBanner | null {
  if (rows.length === 0) return null;
  if (rows.every((row) => row.health === 'dead')) return { kind: 'dead' };
  const source = rows.find((row) => row.isCopySource);
  if (source?.health !== 'dead') return null;
  const others = rows.filter((row) => !row.isCopySource);
  const backup = others.find((row) => row.health === 'ok') ?? others.find((row) => row.health !== 'dead');
  if (!backup) return null;
  const useName = name(backup.id);
  return {
    kind: 'broken',
    title: `${name(source.id)}链接已失效`,
    sub: backup.health === 'ok' ? `${useName}备份可用` : `可改用${useName}的备份`,
    useId: backup.id,
    useName,
  };
}
