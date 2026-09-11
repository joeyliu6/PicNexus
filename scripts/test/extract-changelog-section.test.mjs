import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

import { extractChangelogSection } from '../extract-changelog-section.mjs';

const SCRIPT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extract-changelog-section.mjs');

// 结构照抄真实 CHANGELOG.md：头部说明、`---` 分隔、每个版本下分 ### 小节、
// 列表项带两空格续行。内容用中文 + 加粗 + 反引号，非 ASCII 往返是真实风险。
const CHANGELOG = [
  '# Changelog',
  '',
  '所有重要变更都将记录在此文件中。',
  '',
  '---',
  '',
  '## [1.1.22] - 2026-10-01',
  '',
  '### Fixed',
  '- 这是 1.1.22 的条目，不该被 1.1.2 匹配到。',
  '',
  '---',
  '',
  '## [1.1.2] - 2026-09-11',
  '',
  '### Changed',
  '- **历史表格的灯箱开关动画重做**：打开是一段连续的放大，不再"黑一下、停一拍、再放大"；关闭时大图精确落回',
  '  你鼠标停着的那张预览卡片上。',
  '',
  '### Fixed',
  '- 错误提示不再显示成 `[object Object]`，而是后端给的真实原因。',
  '',
  '---',
  '',
  '## [1.1.1] - 2026-08-24',
  '',
  '### Changed',
  '- 这是 1.1.1 的条目。',
  '',
  '---',
  '',
  '## [11.1.2] - 2026-01-01',
  '',
  '- 这是 11.1.2 的条目，不该被 1.1.2 匹配到。',
  '',
].join('\n');

test('extracts a middle version without its heading, separator or neighbours', () => {
  const body = extractChangelogSection(CHANGELOG, '1.1.2');

  assert.ok(body.startsWith('### Changed'), 'body should start at the first sub-heading');
  assert.ok(body.endsWith('后端给的真实原因。'), 'body should end at the last entry');
  assert.doesNotMatch(body, /## \[1\.1\.2\]/);
  assert.doesNotMatch(body, /^---$/m);
  assert.doesNotMatch(body, /1\.1\.1 的条目/);
  assert.doesNotMatch(body, /1\.1\.22 的条目/);
  assert.doesNotMatch(body, /11\.1\.2 的条目/);
});

test('extracts the newest version at the top of the file', () => {
  const body = extractChangelogSection(CHANGELOG, '1.1.22');
  assert.equal(body, '### Fixed\n- 这是 1.1.22 的条目，不该被 1.1.2 匹配到。');
});

test('extracts the last version when nothing follows it', () => {
  const body = extractChangelogSection(CHANGELOG, '11.1.2');
  assert.equal(body, '- 这是 11.1.2 的条目，不该被 1.1.2 匹配到。');
});

test('keeps the two-space continuation lines of wrapped list items', () => {
  const body = extractChangelogSection(CHANGELOG, '1.1.2');
  assert.match(body, /；关闭时大图精确落回\n  你鼠标停着的那张预览卡片上。/);
});

test('round-trips bold, backticks and CJK punctuation untouched', () => {
  const body = extractChangelogSection(CHANGELOG, '1.1.2');
  assert.match(body, /\*\*历史表格的灯箱开关动画重做\*\*/);
  assert.match(body, /`\[object Object\]`/);
  assert.match(body, /不再"黑一下、停一拍、再放大"/);
});

test('accepts CRLF line endings', () => {
  const body = extractChangelogSection(CHANGELOG.replace(/\n/g, '\r\n'), '1.1.22');
  assert.equal(body, '### Fixed\n- 这是 1.1.22 的条目，不该被 1.1.2 匹配到。');
});

test('throws with the version in the message when the section is missing', () => {
  assert.throws(
    () => extractChangelogSection(CHANGELOG, '9.9.9'),
    (error) => error instanceof Error && error.message.includes('## [9.9.9]') && error.message.includes('git tag -f v9.9.9'),
  );
});

test('throws when the section exists but is empty', () => {
  const empty = '## [2.0.0] - 2026-12-31\n\n---\n\n## [1.0.0] - 2026-01-01\n- 旧条目\n';
  assert.throws(() => extractChangelogSection(empty, '2.0.0'), /段落是空的/);
});

test('throws on an empty version', () => {
  assert.throws(() => extractChangelogSection(CHANGELOG, ''), /版本号为空/);
});

test('does not let a pre-release heading satisfy the plain version', () => {
  const withRc = CHANGELOG.replace('## [1.1.2] - 2026-09-11', '## [1.1.2-rc.1] - 2026-09-10');
  assert.throws(() => extractChangelogSection(withRc, '1.1.2'), /缺少 `## \[1\.1\.2\]`/);
  assert.match(extractChangelogSection(withRc, '1.1.2-rc.1'), /^### Changed/);
});

test('only strips the trailing separator, never a --- inside the body', () => {
  const inner = '## [2.0.0] - 2026-12-31\n\n- 第一条\n\n---\n\n- 第二条\n\n---\n\n## [1.0.0] - 2026-01-01\n- 旧条目\n';
  assert.equal(extractChangelogSection(inner, '2.0.0'), '- 第一条\n\n---\n\n- 第二条');
});

// release.yml 依赖的是 CLI 进程的退出码和 stderr，而不是上面的纯函数：
// 文件底部那个 `process.argv[1] === import.meta.url` 守卫在纯函数测试里永远为假。
// 守卫一旦失效，CLI 不会报错，只是什么都不输出、退出码 0，Release 正文就静默变空，
// 所以这里必须真的拉起一个子进程跑一遍。
test('CLI exits 1 with the version in stderr when the section is missing', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '9.9.9'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /## \[9\.9\.9\]/);
});

test('CLI prints the section to stdout with exit 0, accepting a v prefix', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, 'v1.1.2'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.startsWith('- '), `stdout should start with a list item, got: ${result.stdout.slice(0, 40)}`);
  assert.ok(result.stdout.endsWith('\n'), 'stdout should end with exactly one newline for the $GITHUB_OUTPUT heredoc');
  assert.doesNotMatch(result.stdout, /^## \[/m);
  assert.doesNotMatch(result.stdout, /^---$/m);
});
