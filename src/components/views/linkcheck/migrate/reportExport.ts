/**
 * 批量迁移 · 终态报告导出（CSV / TXT）
 *
 * 从 MigrateProgressPhase.vue 抽出来的纯函数，让面板只负责调用 save dialog。
 * 状态文案保持和原实现一致（"成功/跳过/失败/转换中"）。
 */
import type { MigrateResult } from '../../../../types/batchMigrate';
import { getServiceDisplayName } from '../../../../constants/serviceNames';
import { formatSpeed, formatTime, getErrorInfo } from './utils';

export function buildCsvReport(r: MigrateResult): string {
  const lines = ['文件名,状态,错误类型,错误信息'];
  for (const item of r.itemsSnapshot) {
    const statusText =
      item.status === 'success' ? '成功' :
      item.status === 'skipped' ? '跳过' :
      item.status === 'failed' ? '失败' :
      item.status === 'converting' ? '转换中' :
      item.status;
    const errorTypeText = item.errorType
      ? (item.errorType === 'download' ? '下载失败' : '上传失败')
      : '';
    const escapedError = `"${(item.error || '').replace(/"/g, '""')}"`;
    const escapedName = `"${item.fileName.replace(/"/g, '""')}"`;
    lines.push(`${escapedName},${statusText},${errorTypeText},${escapedError}`);
  }
  lines.push('');
  lines.push(`# 成功: ${r.successCount}，跳过: ${r.skippedCount}，失败: ${r.failedCount}`);
  lines.push(`# 用时: ${formatTime(r.durationMs)}，平均速度: ${formatSpeed(r.avgBytesPerSec)}`);
  // 保留 UTF-8 BOM，让 Excel 正确识别中文
  return '﻿' + lines.join('\n');
}

export function buildTxtReport(r: MigrateResult): string {
  const header = [
    'PicNexus · 批量迁移报告',
    `导出时间：${new Date().toLocaleString()}`,
    `目标图床：${r.targetServiceIds.map(id => getServiceDisplayName(id)).join('、')}`,
    `用时：${formatTime(r.durationMs)}，平均速度：${formatSpeed(r.avgBytesPerSec)}`,
    `成功 ${r.successCount} · 跳过 ${r.skippedCount} · 失败 ${r.failedCount}`,
    '',
    '─'.repeat(60),
    '',
  ];
  const sections: string[] = [];
  const success = r.itemsSnapshot.filter(s => s.status === 'success');
  const skipped = r.itemsSnapshot.filter(s => s.status === 'skipped');
  const failed = r.itemsSnapshot.filter(s => s.status === 'failed');

  if (failed.length > 0) {
    sections.push(`[失败 ${failed.length}]`);
    for (const f of failed) {
      const info = getErrorInfo(f.errorType);
      sections.push(`  • ${f.fileName}`);
      sections.push(`    [${info.label}] ${f.error ?? ''}`);
    }
    sections.push('');
  }
  if (skipped.length > 0) {
    sections.push(`[跳过 ${skipped.length}] 已在目标图床中，无需迁移`);
    for (const s of skipped) sections.push(`  • ${s.fileName}`);
    sections.push('');
  }
  if (success.length > 0) {
    sections.push(`[成功 ${success.length}]`);
    for (const s of success) sections.push(`  • ${s.fileName}`);
  }
  return header.join('\n') + sections.join('\n');
}
