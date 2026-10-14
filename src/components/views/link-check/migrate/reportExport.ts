/**
 * 补充备份 · 终态报告导出（CSV / TXT）
 *
 * 纯函数，面板只负责调用保存对话框。跳过的条目按原因分开说（本来就有 / 没处理 / 不用补 / 记录已删），
 * 停止或中止后没轮到的不能写成「已在目标图床」。
 */
import type { MigrateItemStatus, MigrateResult, MigrateSkipReason } from '@/types/batchMigrate';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { formatSpeed, formatTime, getErrorInfo } from './utils';

/** 跳过原因的短名（状态列 / 分组标题）；旧数据没有原因时按「本来就有」 */
const SKIP_LABEL: Record<MigrateSkipReason, string> = {
  'already-there': '本来就有',
  'not-attempted': '没处理',
  'not-needed': '不用补',
  deleted: '记录已删',
};

const SKIP_NOTE: Record<MigrateSkipReason, string> = {
  'already-there': '目标图床上本来就有',
  'not-attempted': '没来得及处理',
  'not-needed': '已经不需要补了',
  deleted: '处理前这条记录被删除了',
};

function skipReasonOf(item: MigrateItemStatus): MigrateSkipReason {
  return item.skipReason ?? 'already-there';
}

function getFailedTargets(item: MigrateItemStatus): string[] {
  return Object.entries(item.serviceResults)
    .filter(([, state]) => state === 'failed')
    .map(([serviceId]) => serviceId);
}

function formatFailedTargets(targets: string[]): string {
  return targets.map(id => getServiceDisplayName(id)).join('、');
}

function skipCounts(items: MigrateItemStatus[]): Record<MigrateSkipReason, number> {
  const counts: Record<MigrateSkipReason, number> = { 'already-there': 0, 'not-attempted': 0, 'not-needed': 0, deleted: 0 };
  for (const item of items) {
    if (item.status === 'skipped') counts[skipReasonOf(item)]++;
  }
  return counts;
}

/** 「成功 3 · 本来就有 1 · 没处理 2 · 失败 0」：出现过的跳过原因才列 */
function countLine(r: MigrateResult): string {
  const counts = skipCounts(r.itemsSnapshot);
  const parts = [`成功 ${r.successCount}`, `本来就有 ${counts['already-there']}`];
  if (counts['not-attempted'] > 0) parts.push(`没处理 ${counts['not-attempted']}`);
  if (counts['not-needed'] > 0) parts.push(`不用补 ${counts['not-needed']}`);
  if (counts.deleted > 0) parts.push(`记录已删 ${counts.deleted}`);
  parts.push(`失败 ${r.failedCount}`);
  if (r.partialFailures.length > 0) parts.push(`部分成功 ${r.partialFailures.length}`);
  return parts.join(' · ');
}

export function buildCsvReport(r: MigrateResult): string {
  const lines = ['文件名,状态,错误类型,错误信息'];
  for (const item of r.itemsSnapshot) {
    const failedTargets = getFailedTargets(item);
    const isPartialSuccess = item.status === 'success' && failedTargets.length > 0;
    const statusText =
      isPartialSuccess ? '部分成功' :
      item.status === 'success' ? '成功' :
      item.status === 'skipped' ? SKIP_LABEL[skipReasonOf(item)] :
      item.status === 'failed' ? '失败' :
      item.status === 'converting' ? '转换中' :
      item.status;
    const errorTypeText = isPartialSuccess
      ? '部分图床失败'
      : item.errorType
        ? (item.errorType === 'download' ? '下载失败' : '上传失败')
        : '';
    const errorText = isPartialSuccess
      ? `失败目标: ${formatFailedTargets(failedTargets)}`
      : (item.error || '');
    const escapedError = `"${errorText.replace(/"/g, '""')}"`;
    const escapedName = `"${item.fileName.replace(/"/g, '""')}"`;
    lines.push(`${escapedName},${statusText},${errorTypeText},${escapedError}`);
  }
  lines.push('');
  lines.push(`# ${countLine(r)}`);
  lines.push(`# 用时: ${formatTime(r.durationMs)}，平均速度: ${formatSpeed(r.avgBytesPerSec)}`);
  // 保留 UTF-8 BOM，让 Excel 正确识别中文
  return '﻿' + lines.join('\n');
}

export function buildTxtReport(r: MigrateResult): string {
  const header = [
    'PicNexus · 补充备份报告',
    `导出时间：${new Date().toLocaleString()}`,
    `目标图床：${r.targetServiceIds.map(id => getServiceDisplayName(id)).join('、')}`,
    `用时：${formatTime(r.durationMs)}，平均速度：${formatSpeed(r.avgBytesPerSec)}`,
    countLine(r),
    '',
    '─'.repeat(60),
    '',
  ];
  const sections: string[] = [];
  const success = r.itemsSnapshot.filter(s => s.status === 'success');
  const skipped = r.itemsSnapshot.filter(s => s.status === 'skipped');
  const failed = r.itemsSnapshot.filter(s => s.status === 'failed');
  const partial = success
    .map(item => ({ item, failedTargets: getFailedTargets(item) }))
    .filter(({ failedTargets }) => failedTargets.length > 0);

  if (failed.length > 0) {
    sections.push(`[失败 ${failed.length}]`);
    for (const f of failed) {
      const info = getErrorInfo(f.errorType);
      sections.push(`  • ${f.fileName}`);
      sections.push(`    [${info.label}] ${f.error ?? ''}`);
    }
    sections.push('');
  }
  for (const reason of Object.keys(SKIP_LABEL) as MigrateSkipReason[]) {
    const group = skipped.filter(s => skipReasonOf(s) === reason);
    if (group.length === 0) continue;
    sections.push(`[${SKIP_LABEL[reason]} ${group.length}]`);
    for (const s of group) {
      sections.push(`  • ${s.fileName}`);
      sections.push(`    ${s.error ?? SKIP_NOTE[reason]}`);
    }
    sections.push('');
  }
  if (partial.length > 0) {
    sections.push(`[部分成功 ${partial.length}] 部分目标图床失败，需要重试或手动处理`);
    for (const { item, failedTargets } of partial) {
      sections.push(`  • ${item.fileName}`);
      sections.push(`    失败目标：${formatFailedTargets(failedTargets)}`);
    }
    sections.push('');
  }
  const fullSuccess = success.filter(s => getFailedTargets(s).length === 0);
  if (fullSuccess.length > 0) {
    sections.push(`[成功 ${fullSuccess.length}]`);
    for (const s of fullSuccess) sections.push(`  • ${s.fileName}`);
  }
  return header.join('\n') + sections.join('\n');
}
