/**
 * 从 CHANGELOG.md 里抠出某个版本的段落，给 GitHub Release 正文用。
 *
 * 为什么需要：v1.1.2 之前 release.yml 用 git-cliff 把 commit 首行拼成英文初稿塞进
 * Release，靠发版清单提醒人工重写成中文；v1.1.2 漏了这一步，英文初稿直接发了出去。
 * 而 CHANGELOG.md 里本来就有写好的中文段落（归并、精简、剔除内部改动都已做完），
 * 所以正文直接取它，不再有"初稿→人工重写"这个会被跳过的环节。
 *
 * 纯逻辑，不碰磁盘：调用方负责读 CHANGELOG.md。CLI 入口在文件底部，
 * release.yml 与 scripts/test/extract-changelog-section.test.mjs 共用同一份实现。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HEADING_PREFIX = '## [';

/**
 * @param {string} markdown CHANGELOG.md 全文
 * @param {string} version 不带 v 前缀的版本号，如 1.1.2
 * @returns {string} 该版本段落正文：不含 `## [x.y.z]` 标题行、不含段末 `---`、首尾无空行
 * @throws 找不到该版本的标题时抛错——静默返回空串等于把空正文发出去
 */
export function extractChangelogSection(markdown, version) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('版本号为空');
  }

  const lines = markdown.split(/\r?\n/);
  // 只认 `## [1.1.2]` 这种精确标题：`[` 与 `]` 把版本号夹死，1.1.2 不会误中 1.1.22 / 11.1.2
  const target = `${HEADING_PREFIX}${version}]`;
  const start = lines.findIndex((line) => line.startsWith(target));
  if (start === -1) {
    throw new Error(
      `CHANGELOG.md 缺少 \`## [${version}]\` 段落。` +
        '请先补写该版本的中文说明（参照上一版的写法），提交后重打 tag：' +
        `git tag -f v${version} && git push -f origin v${version}`,
    );
  }

  let end = lines.findIndex((line, index) => index > start && line.startsWith(HEADING_PREFIX));
  if (end === -1) end = lines.length;

  const body = lines.slice(start + 1, end);
  // 段末的 `---` 是版本之间的分隔线，不属于正文
  while (body.length > 0 && /^\s*$/.test(body[body.length - 1])) body.pop();
  if (body.length > 0 && /^-{3,}\s*$/.test(body[body.length - 1])) body.pop();
  while (body.length > 0 && /^\s*$/.test(body[body.length - 1])) body.pop();
  while (body.length > 0 && /^\s*$/.test(body[0])) body.shift();

  if (body.length === 0) {
    throw new Error(`CHANGELOG.md 的 \`## [${version}]\` 段落是空的，Release 正文不能为空`);
  }

  return body.join('\n');
}

// CLI：node scripts/extract-changelog-section.mjs <version>
// 读仓库根 CHANGELOG.md，段落写 stdout；失败时 stderr 报错、退出码 1。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  const changelogPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
  try {
    const markdown = readFileSync(changelogPath, 'utf8');
    process.stdout.write(`${extractChangelogSection(markdown, version)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`extract-changelog-section: ${message}\n`);
    process.exit(1);
  }
}
