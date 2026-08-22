// 历史记录 results 数组的共享谓词——「可用镜像」的唯一口径定义处。

import type { HistoryItem } from '../config/types';
import type { UploadResult } from '../uploaders/base/types';

export type HistoryResultEntry = HistoryItem['results'][number];

/** 通过 isUsableMirror 收窄后的条目：status 必为 success 且 result 必存在 */
export type UsableMirror = HistoryResultEntry & {
  status: 'success';
  result: UploadResult;
};

/**
 * 「可用镜像」统一口径：上传成功**且真的拿到了链接**。
 *
 * 为什么必须带 url：status 为 success 但 result.url 为空的条目无法展示、
 * 复制、迁移，也无法接任主服务（switchPrimaryService 对无 url 的目标抛错）。
 * 镜像菜单（useMirrorFallback）、批量迁移筛选（sourceSelection）、
 * linkCheckSummary 重算历来都按此口径。
 *
 * 2026-08-22 起 HistoryDatabase.removeMirror 的保留判断与
 * DataTransformer.deriveResultColumns 派生的 success_count /
 * successful_service_ids 两列也对齐至此，不再存在"只看 status"的宽松版本。
 * 新增消费点一律 import 本函数，不要内联重写这个条件。
 */
export function isUsableMirror(r: HistoryResultEntry): r is UsableMirror {
  return r.status === 'success' && Boolean(r.result?.url);
}
