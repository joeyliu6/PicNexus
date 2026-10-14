// 文档修复页顶部的结论卡：找文件 / 检查 / 结果 / 修复中 / 修好了，各说一句话，配这一刻该点的按钮
//
// 纯函数：文案与按钮在这里定，MdRescueInline 只负责摆出来。

import type { SummaryTone } from '@/components/views/link-check/common/SummaryCard.vue';

export type RescueVerdictAction = 'cancel' | 'repair' | 'reset' | 'undo' | 'finish';

export interface RescueVerdictButton {
  action: RescueVerdictAction;
  label: string;
  disabled?: boolean;
}

export interface RescueVerdict {
  tone: SummaryTone;
  title: string;
  subtitle: string;
  primary: RescueVerdictButton | null;
  secondary: RescueVerdictButton | null;
  /** 卡片下方的一行安心话（「修改前会自动备份原文件……」） */
  note: string | null;
}

export interface RescueVerdictInput {
  phase: 'idle' | 'scanning' | 'fixing' | 'done';
  /** 正在找 Markdown 文件时为已找到的个数，否则 null */
  collectingFound: number | null;
  scan: { stage: 'checking' | 'backups' | 'complete' | 'cancelling' | 'cancelled'; checked: number; total: number };
  /** 图片按出现次数计：同一张图在文档里出现两次就是两处，与列表行数一致 */
  stats: { files: number; images: number; problems: number; problemFiles: number; manual: number; repaired: number };
  /** 能换成备份的处数 */
  fixable: number;
  fixing: { current: number; total: number } | null;
  /** 写入失败的文档数 */
  failedFiles: number;
  failedReason: string | null;
}

const CANCEL: RescueVerdictButton = { action: 'cancel', label: '取消' };
const RESET: RescueVerdictButton = { action: 'reset', label: '换一批文档' };

/** 写入失败的原因说成人话；原始错误留给悬停提示 */
function describeWriteError(error: string | null): string {
  if (!error) return '文件可能被占用，或者没有写入权限';
  if (/EACCES|EPERM|permission|拒绝访问|权限/i.test(error)) return '没有写入权限';
  if (/EBUSY|locked|占用/i.test(error)) return '文件被其他程序占用';
  if (/ENOENT|not found|no such file|找不到/i.test(error)) return '文件找不到了';
  return '写入时出错';
}

function verdict(partial: Partial<RescueVerdict> & Pick<RescueVerdict, 'tone' | 'title'>): RescueVerdict {
  return { subtitle: '', primary: null, secondary: null, note: null, ...partial };
}

export function buildRescueVerdict(input: RescueVerdictInput): RescueVerdict {
  const { stats, scan } = input;

  if (input.collectingFound !== null) {
    return verdict({
      tone: 'running',
      title: '正在找 Markdown 文件…',
      subtitle: input.collectingFound > 0 ? `已找到 ${input.collectingFound} 个` : '',
      secondary: CANCEL,
    });
  }

  if (input.phase === 'fixing') {
    const progress = input.fixing ? ` · ${input.fixing.current} / ${input.fixing.total} 个文档` : '';
    return verdict({ tone: 'running', title: `正在修复${progress}`, secondary: CANCEL });
  }

  if (input.phase === 'done') {
    if (input.failedFiles > 0) {
      return verdict({
        tone: 'warning',
        title: stats.repaired > 0
          ? `修复了 ${stats.repaired} 张，${input.failedFiles} 个文档没改成`
          : `${input.failedFiles} 个文档没改成`,
        subtitle: [describeWriteError(input.failedReason), '改好的可以撤销'].join(' · '),
        primary: { action: 'finish', label: '完成' },
        secondary: { action: 'undo', label: '撤销' },
      });
    }
    const parts = ['原文件已备份，可以撤销'];
    if (stats.manual > 0) parts.push(`${stats.manual} 张没有备份，要手动处理`);
    return verdict({
      tone: 'ok',
      title: `已修复 ${stats.repaired} 张图片`,
      subtitle: parts.join(' · '),
      primary: { action: 'finish', label: '完成' },
      secondary: { action: 'undo', label: '撤销' },
    });
  }

  if (scan.stage === 'cancelling') return verdict({ tone: 'running', title: '正在停止…' });

  if (scan.stage === 'checking' || scan.stage === 'backups') {
    const parts = [`在 ${stats.files} 个文档里`];
    if (stats.problems > 0) parts.push(`目前有 ${stats.problems} 张打不开`);
    return verdict({
      tone: 'running',
      title: scan.stage === 'backups' ? '正在找能用的备份…' : `正在检查图片 · ${scan.checked} / ${scan.total}`,
      subtitle: parts.join(' · '),
      secondary: CANCEL,
    });
  }

  // complete / cancelled：给结论
  const stoppedEarly = scan.stage === 'cancelled';
  const stoppedNote = stoppedEarly ? `检查停在 ${scan.checked} / ${scan.total}` : null;

  if (stats.images === 0) {
    return verdict({ tone: 'neutral', title: '这些文档里没有图片', subtitle: `检查了 ${stats.files} 个文档`, secondary: RESET });
  }

  if (stats.problems === 0) {
    return verdict({
      tone: 'ok',
      title: stoppedEarly ? `已检查的 ${scan.checked} 张都能打开` : `${stats.images} 张图片都能打开`,
      subtitle: stoppedNote ?? `检查了 ${stats.files} 个文档`,
      secondary: RESET,
    });
  }

  const parts = [`在 ${stats.problemFiles} 个文档里`];
  if (input.fixable > 0) {
    parts.push(`${input.fixable} 张可以换成备份`);
    if (stats.manual > 0) parts.push(`${stats.manual} 张没有备份`);
  } else {
    parts.push('都没有能用的备份，要手动处理');
  }
  if (stoppedNote) parts.push(stoppedNote);

  return verdict({
    tone: input.fixable > 0 && stats.manual === 0 ? 'warning' : 'error',
    title: `${stats.problems} 张图片打不开`,
    subtitle: parts.join(' · '),
    primary: input.fixable > 0 ? { action: 'repair', label: `修复 ${input.fixable} 张` } : null,
    secondary: RESET,
    note: input.fixable > 0 ? '修改前会自动备份原文件，改完可以撤销' : null,
  });
}
