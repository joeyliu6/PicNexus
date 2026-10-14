// 时长说成人话：检查 / 备份途中「还要多久」，开始前「大约要多久」

function hoursAndMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

/** 进行中：「预计不到 1 分钟」「预计还要 3 分钟」「预计还要 1 小时 30 分钟」 */
export function remainingText(seconds: number): string {
  if (seconds < 60) return '预计不到 1 分钟';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `预计还要 ${minutes} 分钟`;
  return `预计还要 ${hoursAndMinutes(minutes)}`;
}

/** 开始前：「1 分钟以内」「大约 8 分钟」「大约 2 小时 10 分钟」 */
export function estimateText(seconds: number): string {
  if (seconds < 60) return '1 分钟以内';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `大约 ${minutes} 分钟`;
  return `大约 ${hoursAndMinutes(minutes)}`;
}
