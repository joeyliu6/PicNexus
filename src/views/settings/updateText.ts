// 更新卡片的几句文字：发布说明要点、失败标题、下载大小。纯函数，组件与测试共用。

/** 发布说明最多列几条 */
const MAX_NOTES = 6;
const MB = 1024 * 1024;

/** 发布说明里的要点行（「- 」「* 」开头的），去掉 Markdown 记号，最多 6 条 */
export function releaseNotes(body: string): string[] {
  return body.split(/\r?\n/)
    .map((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.replace(/\*\*|`/g, '').trim() ?? '')
    .filter(Boolean)
    .slice(0, MAX_NOTES);
}

/** 「更新失败：更新包下载中断」；归类不出来的兜底标题本身就写着「…失败」，不再叠一层 */
export function updateFailureTitle(reason: string): string {
  return reason.endsWith('失败') ? reason : `更新失败：${reason}`;
}

/** 「11 / 18 MB」：总大小 10 MB 以上取整，以下留一位小数 */
export function downloadSize(downloaded: number, total: number): string {
  const digits = total >= 10 * MB ? 0 : 1;
  return `${(downloaded / MB).toFixed(digits)} / ${(total / MB).toFixed(digits)} MB`;
}
