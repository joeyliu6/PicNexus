// 选出「复制时使用」的图床（交接说明规则 4.1）：勾选的图床同时上传，复制最先完成的链接；
// 用户固定了某个图床（linkOutput.copyFromService）且它这次传上了，就用它。不按配置顺序排。

/**
 * @param successIdsInCompletionOrder 已成功的图床，按完成先后排列
 * @param pinned linkOutput.copyFromService
 */
export function pickPrimaryService(successIdsInCompletionOrder: readonly string[], pinned?: string): string | undefined {
  if (pinned && successIdsInCompletionOrder.includes(pinned)) return pinned;
  return successIdsInCompletionOrder[0];
}
