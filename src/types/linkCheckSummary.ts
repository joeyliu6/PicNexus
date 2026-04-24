/**
 * linkCheckSummary 重算工具
 *
 * 修改镜像结果（删镜像、剥单条 service 等）后，需要把 linkCheckSummary 里
 * 的四个计数（total / valid / invalid / unchecked）重新算一遍。
 *
 * 两个约定：
 * 1. 只统计 status === 'success' 的上传——与 linkCheckPersistence.ts 构造
 *    summary 时的口径保持一致（totalLinks = checkResults.length）。把 failed
 *    上传也算进来会让"未检测"计数虚增。
 * 2. previousSummary 为 undefined 时返回 undefined——保持"从未检测就不产生
 *    summary"的语义，不凭空造 summary。
 */

import type { HistoryItem } from '../config/types';

export function recomputeLinkCheckSummary(
  results: HistoryItem['results'],
  linkCheckStatus: HistoryItem['linkCheckStatus'],
  previousSummary: HistoryItem['linkCheckSummary'],
): HistoryItem['linkCheckSummary'] {
  if (!previousSummary) return undefined;

  const successResults = results.filter((r) => r.status === 'success' && r.result?.url);
  const total = successResults.length;
  let valid = 0;
  let invalid = 0;
  let unchecked = 0;

  if (linkCheckStatus) {
    for (const r of successResults) {
      const s = linkCheckStatus[r.serviceId];
      if (!s) { unchecked += 1; continue; }
      if (s.errorType === 'pending') { unchecked += 1; continue; }
      if (s.isValid) valid += 1;
      else invalid += 1;
    }
  } else {
    unchecked = total;
  }

  return {
    ...previousSummary,
    totalLinks: total,
    validLinks: valid,
    invalidLinks: invalid,
    uncheckedLinks: unchecked,
  };
}
