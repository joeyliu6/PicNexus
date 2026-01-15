/**
 * 上传状态判断工具函数
 */

/**
 * 判断状态是否为成功
 */
export function isStatusSuccess(status: string | undefined): boolean {
  if (!status) return false;
  return status.includes('✓') || status.includes('完成');
}

/**
 * 判断状态是否为错误
 */
export function isStatusError(status: string | undefined): boolean {
  if (!status) return false;
  return status.includes('✗') || status.includes('失败');
}

/**
 * 判断状态是否为上传中
 */
export function isStatusUploading(status: string | undefined): boolean {
  if (!status) return false;
  if (status.includes('等待中')) return false;
  // 包含 '%' 或 '上传' 或 '准备' 表示上传中
  // 或者包含步骤格式 "(数字/数字)" 也表示上传中
  return status.includes('%') ||
         status.includes('上传') ||
         status.includes('准备') ||
         /\(\d+\/\d+\)/.test(status);
}

/**
 * 获取状态类型
 */
export type StatusType = 'success' | 'error' | 'uploading' | 'pending';

export function getStatusType(status: string | undefined): StatusType {
  if (isStatusSuccess(status)) return 'success';
  if (isStatusError(status)) return 'error';
  if (isStatusUploading(status)) return 'uploading';
  return 'pending';
}

/**
 * 获取状态标签文本
 */
export function getStatusLabel(status: string | undefined): string {
  if (isStatusSuccess(status)) return '已发布';
  if (isStatusError(status)) return '失败';
  if (isStatusUploading(status)) return '上传中...';
  return '等待中';
}
