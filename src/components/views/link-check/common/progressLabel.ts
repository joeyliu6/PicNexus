/**
 * 运行状态药丸的文字：「检测中 12 / 17」
 *
 * Why 把数字放进标签：长任务里用户最想知道的是「到哪了」，原来只在悬停提示里才看得到。
 * 只加计数、不加圆环和百分比，底栏仍然安静。
 */
export function progressLabel(base: string, done: number, total: number): string {
  if (!(total > 0)) return base;
  const clamped = Math.min(Math.max(done, 0), total);
  return `${base} ${clamped.toLocaleString()} / ${total.toLocaleString()}`;
}
