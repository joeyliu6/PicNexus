export interface TextRange {
  start: number;
  end: number;
}

/** 占位符的起始标记；同时充当 {@link findPlaceholderRange} 的匹配边界 */
const PLACEHOLDER_PREFIX = '⏳';

export function escapeMarkdownText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

export function escapeMarkdownUrl(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

export function formatMarkdownImage(name: string, url: string): string {
  return `![${escapeMarkdownText(name)}](${escapeMarkdownUrl(url)})`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 上传中的临时占位符：`⏳ Uploading x… (id)`
 *
 * **纯文本，不带任何 Markdown 语法**——这是踩了两次才收敛到的形态：
 *
 * 1. 最初是 `![Uploading x...](#picnexus-upload-<id>)`。`](#...)` 在 Obsidian 里是「指向当前
 *    笔记某个标题」的内部链接，占位符存在的那几秒解析不到同名标题，Obsidian 会渲染成失效链接
 *    并弹「在 <笔记名> 中未找到 <锚点>」——上传明明成功，用户却先撞见报错。
 * 2. 改成纯文本 + HTML 注释藏 ID，报错没了，但注释会在**光标所在行**原样露出来。
 * 3. 再改成社区同款 `![⏳ Uploading x… (id)]()`（空 URL 就没东西可解析了），可 `![` 和 `]()`
 *    同样会在光标所在行露出来——而刚粘完图，光标恰恰就在那一行。
 *
 * 根子上的教训：**Live Preview 只在光标不在的行隐藏原始标记**，而占位符的整个生命周期里
 * 光标基本都压在它身上，所以任何依赖「反正会被渲染隐藏」的写法都不成立。纯文本没有需要
 * 隐藏的东西，任何时候看到的都是 `⏳ Uploading image.png… (pmt4)`。
 *
 * ID 直接显示给用户看，所以调用方传的是「会话标签 + 自增序号」这种四五个字符的短串。
 */
export function createUploadPlaceholder(fileName: string, uploadId: string): string {
  // 文件名里若混进 `⏳`，会把 findPlaceholderRange 区分「同一行多个占位符」的边界判据搅乱；
  // `[` `]` 仍要转义，否则 `[[x]].png` 这种名字会被 Obsidian 当成 wikilink 渲染。
  const safeName = escapeMarkdownText(fileName)
    .split(PLACEHOLDER_PREFIX)
    .join('')
    .replace(/[\r\n]+/g, ' ');
  return `${PLACEHOLDER_PREFIX} Uploading ${safeName}… (${uploadId})`;
}

/**
 * 按上传 ID 定位占位符所占的文本区间
 *
 * Why 按 ID 匹配、而不是拿占位符全文做 `indexOf`：占位符插进编辑器后，**可见部分随时可能
 * 被别的插件改写**——Smart Typography 会替换省略号，Linter 会重排空白。文本一对不上，
 * 精确匹配就找不到，替换静默失败（返回值调用方全丢弃，连告警都没有），
 * 占位符会永久留在用户笔记里。
 *
 * 中间段写成 `(?:(?!⏳)[^\n])*`：不跨越换行、也不跨越下一个 `⏳`。批量上传会把多个占位符排在
 * **同一行**，若允许跨越，找第二个时就会从**第一个**的 `⏳` 一路吃到第二个的 `(id)`，
 * 把中间无关的正文一起圈进替换范围。贪婪匹配配合 `(id)` 尾锚，
 * 顺带处理了「文件名本身就带 `(pmt4)`」的情况。
 */
export function findPlaceholderRange(content: string, uploadId: string): TextRange | null {
  const prefix = escapeRegExp(PLACEHOLDER_PREFIX);
  const pattern = new RegExp(`${prefix}(?:(?!${prefix})[^\\n])*\\(${escapeRegExp(uploadId)}\\)`);
  const match = pattern.exec(content);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
