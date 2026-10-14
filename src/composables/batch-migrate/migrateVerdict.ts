// 补充备份页顶部的结论卡：选择 / 进行中 / 完成三个阶段各说一句话，配这一刻最该点的按钮
//
// 纯函数：文案与按钮在这里定，组件只负责摆出来。内部类型沿用 migrate 词源，界面上一律叫「备份」。

import type { SummaryTone } from '@/components/views/link-check/common/SummaryCard.vue';
import type { MigrateResult, MigrateScope } from '@/types/batchMigrate';
import { joinCjk, listServiceNames } from '@/utils/cjkSpacing';
import { estimateText, remainingText } from '@/utils/durationText';
import { formatTime } from '@/components/views/link-check/migrate/utils';

export type MigrateVerdictAction = 'start' | 'pause' | 'resume' | 'cancel' | 'retry-failed' | 'done';

export interface MigrateVerdictButton {
  action: MigrateVerdictAction;
  label: string;
  /** 灰着的按钮必须说明为什么灰（悬停提示） */
  disabled?: boolean;
  hint?: string;
}

export interface MigrateVerdict {
  tone: SummaryTone;
  title: string;
  subtitle: string;
  primary: MigrateVerdictButton | null;
  secondary: MigrateVerdictButton | null;
  /** 卡片下方额外一行（公共图床的风险） */
  note: { tone: 'warning'; text: string } | null;
}

/** 开始前按每张约 2 秒估算：只用来给个量级，开始后换成按实际速度算的剩余时间 */
const SECONDS_PER_IMAGE = 2;

function verdict(partial: Partial<MigrateVerdict> & Pick<MigrateVerdict, 'tone' | 'title'>): MigrateVerdict {
  return { subtitle: '', primary: null, secondary: null, note: null, ...partial };
}

export interface SetupVerdictInput {
  /** 勾选的目标图床（显示名） */
  targets: string[];
  /** 要复制的张数 */
  pending: number;
  /** 条件刚变、数字正在重算 */
  refreshing: boolean;
  /** 用户把来源图床全取消了 */
  noSource: boolean;
  /** 勾选目标里的公共图床（显示名） */
  publicTargets: string[];
  /** 「更多选项」里设过的条件，白话；没设为 null */
  filterNote: string | null;
}

export function buildSetupVerdict(input: SetupVerdictInput): MigrateVerdict {
  const start = (hint?: string): MigrateVerdictButton => (hint
    ? { action: 'start', label: '开始备份', disabled: true, hint }
    : { action: 'start', label: '开始备份' });

  if (input.targets.length === 0) {
    return verdict({
      tone: 'neutral',
      title: '给图片多存一份',
      subtitle: '在下面选一个图床，把还没存到那里的图片复制过去；原来的图片不动',
      primary: start('先在下面选一个图床'),
    });
  }
  if (input.noSource) {
    return verdict({
      tone: 'neutral',
      title: '没选来源图床',
      subtitle: '要备份哪些图床上的图片？在「更多选项」里勾上',
      primary: start('在「更多选项」里至少选一个来源图床'),
    });
  }
  if (input.refreshing) {
    return verdict({ tone: 'neutral', title: '正在算要复制多少张…', primary: start('马上算好') });
  }

  const targets = listServiceNames(input.targets);
  if (input.pending === 0) {
    return verdict({
      tone: 'ok',
      title: joinCjk('这些图片都已经存到', targets, '了'),
      subtitle: input.filterNote ? `按现在的条件（${input.filterNote}）没有要补的` : '没有要补的',
    });
  }

  const parts: string[] = [];
  if (input.filterNote) parts.push(`只备份${input.filterNote}`);
  parts.push('原来的图片不动', estimateText(input.pending * SECONDS_PER_IMAGE));
  return verdict({
    tone: 'neutral',
    title: joinCjk(`把 ${input.pending.toLocaleString()} 张图复制到`, targets),
    subtitle: parts.join(' · '),
    primary: start(),
    note: input.publicTargets.length > 0
      ? { tone: 'warning', text: `${listServiceNames(input.publicTargets)}是公共图床：随时可能失效，单日上传数量也有限` }
      : null,
  });
}

export interface RunVerdictInput {
  targets: string[];
  done: number;
  total: number;
  success: number;
  failed: number;
  paused: boolean;
  /** 点了暂停，还有在途的没落定 */
  pausing: boolean;
  /** 点了停止，还有在途的没落定 */
  cancelling: boolean;
  etaMs: number | null;
}

export function buildRunVerdict(input: RunVerdictInput): MigrateVerdict {
  if (input.cancelling) {
    return verdict({ tone: 'running', title: '正在停止…', subtitle: '已成功的会保留' });
  }
  if (input.pausing) {
    return verdict({ tone: 'running', title: '正在暂停…', subtitle: '手上这几张传完就停' });
  }

  const parts = [`${input.success.toLocaleString()} 张已备份`];
  if (input.failed > 0) parts.push(`${input.failed.toLocaleString()} 张失败`);
  const progress = `${input.done.toLocaleString()} / ${input.total.toLocaleString()}`;
  const stop: MigrateVerdictButton = { action: 'cancel', label: '停止' };

  if (input.paused) {
    return verdict({
      tone: 'paused',
      title: `已暂停 · ${progress}`,
      subtitle: parts.join(' · '),
      primary: { action: 'resume', label: '继续' },
      secondary: stop,
    });
  }

  if (input.etaMs !== null && input.etaMs > 0) parts.push(remainingText(input.etaMs / 1000));
  return verdict({
    tone: 'running',
    title: joinCjk('正在备份到', listServiceNames(input.targets), ` · ${progress}`),
    subtitle: parts.join(' · '),
    primary: { action: 'pause', label: '暂停' },
    secondary: stop,
  });
}

export interface DoneVerdictInput {
  targets: string[];
  result: Pick<MigrateResult, 'successCount' | 'failedCount' | 'pauseReason' | 'itemsSnapshot' | 'failures' | 'durationMs'>;
  /** 正在原地重试的张数 */
  retrying: number;
}

export function buildDoneVerdict({ targets: targetNames, result, retrying }: DoneVerdictInput): MigrateVerdict {
  const targets = listServiceNames(targetNames);
  // 部分目标没传上的图：引擎记作成功、同时放进失败清单。它没按要求备份齐，算「没成功」，
  // 这样卡片、「失败」列表、「重试失败的 N 张」三处数字一致
  const partial = result.failures.filter(f => f.isPartial).length;
  const success = result.successCount - partial;
  const failed = result.failures.length;
  let alreadyThere = 0;
  let notDone = 0;
  for (const item of result.itemsSnapshot) {
    if (item.status !== 'skipped') continue;
    if (item.skipReason === 'not-attempted' || item.skipReason === 'deleted') notDone++;
    else alreadyThere++;
  }

  const finish: MigrateVerdictButton = { action: 'done', label: '完成' };
  const retry: MigrateVerdictButton | null = failed === 0 ? null : retrying > 0
    ? { action: 'retry-failed', label: `正在重试 ${retrying} 张…`, disabled: true }
    : { action: 'retry-failed', label: `重试失败的 ${failed.toLocaleString()} 张` };

  const counts: string[] = [];
  if (success > 0) counts.push(`${success.toLocaleString()} 张已备份`);
  if (failed > 0) counts.push(`${failed.toLocaleString()} 张失败`);
  if (alreadyThere > 0) counts.push(`${alreadyThere.toLocaleString()} 张本来就有`);

  if (result.pauseReason === 'user-cancelled') {
    if (notDone > 0) counts.push(`${notDone.toLocaleString()} 张没处理，下次开始会接着补`);
    return verdict({
      tone: 'neutral',
      title: '已停止',
      subtitle: counts.join(' · '),
      primary: retry ?? finish,
      secondary: retry ? finish : null,
    });
  }
  if (result.pauseReason === 'consecutive-failures') {
    counts.push(joinCjk('可能是', targets, '出了问题，先去设置里测一下连接'));
    return verdict({ tone: 'error', title: '连续失败，已自动停下', subtitle: counts.join(' · '), primary: finish, secondary: retry });
  }
  if (result.pauseReason === 'preload-error' || result.pauseReason === 'runtime-error') {
    return verdict({ tone: 'error', title: '出错中断', subtitle: counts.join(' · '), primary: finish, secondary: retry });
  }

  if (failed > 0) {
    const notes: string[] = [];
    if (partial > 0) notes.push(`其中 ${partial.toLocaleString()} 张只传成了一部分`);
    if (alreadyThere > 0) notes.push(`${alreadyThere.toLocaleString()} 张本来就有`);
    notes.push('失败的原因列在下面');
    return verdict({
      tone: 'warning',
      title: success > 0
        ? `${success.toLocaleString()} 张已备份，${failed.toLocaleString()} 张没成功`
        : `${failed.toLocaleString()} 张没成功`,
      subtitle: notes.join(' · '),
      primary: retry,
      secondary: finish,
    });
  }

  if (success === 0) {
    return verdict({ tone: 'ok', title: joinCjk('这些图片在', targets, '上本来就有'), primary: finish });
  }
  const notes: string[] = [];
  if (alreadyThere > 0) notes.push(`另外 ${alreadyThere.toLocaleString()} 张本来就有`);
  if (result.durationMs > 0) notes.push(`用时 ${formatTime(result.durationMs)}`);
  return verdict({
    tone: 'ok',
    title: joinCjk(`已备份 ${success.toLocaleString()} 张到`, targets),
    subtitle: notes.join(' · '),
    primary: finish,
  });
}

export interface FilterNoteInput {
  /** 勾选的来源图床（显示名） */
  sourceNames: string[];
  allSourcesSelected: boolean;
  timestampAfterMs: number | null;
  maxSuccessCount: number;
  scope: MigrateScope;
  now?: number;
}

/** 「更多选项」里设过的条件，说成白话；什么都没设返回 null */
export function migrateFilterNote(input: FilterNoteInput): string | null {
  const parts: string[] = [];
  if (!input.allSourcesSelected && input.sourceNames.length > 0) {
    parts.push(joinCjk('来自', listServiceNames(input.sourceNames)));
  }
  if (input.timestampAfterMs !== null) {
    const days = Math.max(1, Math.round(((input.now ?? Date.now()) - input.timestampAfterMs) / 86_400_000));
    parts.push(`最近 ${days} 天上传的`);
  }
  if (input.maxSuccessCount === 1) parts.push('只有 1 份的');
  else if (input.maxSuccessCount < 999) parts.push(`不超过 ${input.maxSuccessCount} 份的`);
  if (input.scope === 'broken-with-valid-source') parts.push('已经坏了一份的');
  return parts.length > 0 ? parts.join(' · ') : null;
}
