// docs/TODO.md 卫生门禁
//
// Why 需要这道门禁：TODO 会不自觉地兼职当档案馆。条目做完后正文留在原地，
// 完成的记录只进不出，文件无限膨胀——2026-08 时一条已完成条目占到全文件 58%，
// 真正的待办被埋在里面翻不到。
//
// 两条规则都是纯机械判定，不需要理解内容：
//   1. 待办区（待验收 / 待处理）里不得出现已完成条目 `### [x]`
//   2. 已完成区里每条正文不超过 MAX_DONE_BODY_LINES 行
//
// Why 不做自动搬运：正文该去 guides / troubleshooting / audits 哪一个，取决于内容性质，
// 脚本判断不了。搬错目录比留在 TODO 里更难找回，所以只负责报警，去处仍由人定。

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const todoPath = path.join(root, 'docs', 'TODO.md');

/** 已完成条目允许的正文行数（不含标题与空行） */
const MAX_DONE_BODY_LINES = 3;

/** 待办区小节名——这些区里出现 `### [x]` 说明该归档了 */
const PENDING_SECTIONS = new Set(['待验收', '待处理']);

/** 已完成区小节名——这些区里的条目要压缩成索引 */
const DONE_SECTIONS = new Set(['已完成']);

const failures = [];

if (!fs.existsSync(todoPath)) {
  console.error(`TODO hygiene check failed:\n  找不到 ${path.relative(root, todoPath)}`);
  process.exit(1);
}

const lines = fs.readFileSync(todoPath, 'utf8').split(/\r?\n/);
const entries = collectEntries(lines);

for (const entry of entries) {
  if (PENDING_SECTIONS.has(entry.section) && entry.marker === 'x') {
    failures.push(
      `docs/TODO.md:${entry.line}: 「${entry.section}」下出现已完成条目 “${entry.title}”\n` +
        '    → 正文按性质搬到 docs/audits/、docs/reference/guides/、docs/reference/troubleshooting/ 等目录，\n' +
        '      再把条目移到「已完成」并压缩成一句话结论 + 链接。'
    );
  }

  if (DONE_SECTIONS.has(entry.section) && entry.bodyLines > MAX_DONE_BODY_LINES) {
    failures.push(
      `docs/TODO.md:${entry.line}: 已完成条目 “${entry.title}” 正文 ${entry.bodyLines} 行，` +
        `超过 ${MAX_DONE_BODY_LINES} 行上限\n` +
        '    → 详细内容属于知识库，不属于待办索引。搬走后这里只留一句话结论 + 指向归档文档的链接。'
    );
  }
}

if (failures.length > 0) {
  console.error('TODO hygiene check failed:\n' + failures.join('\n'));
  process.exit(1);
}

/**
 * 按 `## 小节` / `### 条目` 切分，统计每个条目的正文行数
 *
 * 正文只数"有内容的行"：空行不算，代码块整体算一行（一段命令不该被当成三行超标），
 * 否则规则会逼人把有用的链接说明也删掉。
 */
function collectEntries(allLines) {
  const result = [];
  let section = null;
  let current = null;
  let inFence = false;

  const flush = () => {
    if (current) result.push(current);
    current = null;
  };

  allLines.forEach((rawLine, index) => {
    const line = rawLine.trim();

    // 代码围栏内不解析标题，避免示例里的 ## 被当成小节
    if (line.startsWith('```')) {
      if (current) {
        // 围栏开始时记一行，结束时不再重复计数
        if (!inFence) current.bodyLines += 1;
      }
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      flush();
      section = sectionMatch[1].trim();
      return;
    }

    const entryMatch = line.match(/^###\s+(?:\[(.)\]\s*)?(.+)$/);
    if (entryMatch) {
      flush();
      current = {
        section,
        marker: entryMatch[1] ?? null,
        title: entryMatch[2].trim(),
        line: index + 1,
        bodyLines: 0,
      };
      return;
    }

    // 更深的标题（#### 等）算正文的一部分
    if (current && line !== '') current.bodyLines += 1;
  });

  flush();
  return result;
}
