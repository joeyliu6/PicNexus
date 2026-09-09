#!/usr/bin/env node
/**
 * .claude/skills 与 .codex/skills 的一致性守卫
 *
 * 两个目录装的是同一套技能，但**不该逐字相同**：
 *
 *   - scan-bugs 是刻意做成互补的双胞胎。Claude 侧走「意图一致性」视角
 *     （代码 vs 文档声称的行为），Codex 侧走「对抗性」视角（构造能让代码
 *     出错的输入/时序/状态），两边的描述里还互相点名对方。把它们抹平，
 *     等于砍掉一半能力。
 *   - 另外三处是工具语法差异：Claude Code 认 disable-model-invocation 这个
 *     frontmatter 字段，Codex 不认；描述里的尖括号占位符在 Codex 侧会被
 *     解析器吃掉，所以那边写成不带尖括号的形式。
 *
 * 所以这里做的不是「强制一致」，而是「登记已知差异，其余必须一致」——
 * 跟 check-cross-language-constants.mjs、check-theme-token-copies.mjs 一个套路：
 * 手抄的副本要登记下来，别只写一句「必须保持一致」的注释就完事。
 *
 * 这两个目录都在 .gitignore 里，CI 环境不存在，所以目录缺失时静默跳过，
 * 也因此**不接进 `npm run lint`**（否则 CI 必挂）。用 `npm run check:skills` 手动跑。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const A = path.join(ROOT, '.claude', 'skills');
const B = path.join(ROOT, '.codex', 'skills');

/** 已知且有意的差异：文件相对路径 -> 原因 */
const ALLOWED_DIFFS = {
  'scan-bugs/SKILL.md':
    '刻意互补：Claude 侧=意图一致性视角，Codex 侧=对抗性视角，两边互相点名',
  'create-skill/SKILL.md':
    'Claude 侧多一行 disable-model-invocation（Claude Code 专有 frontmatter 字段）',
  'kaihui/SKILL.md':
    'description 里的尖括号占位符在 Codex 侧会被解析器吃掉，那边写成无尖括号形式',
  'summon/SKILL.md':
    '同 kaihui：尖括号占位符的写法差异',
};

if (!existsSync(A) || !existsSync(B)) {
  console.log('跳过技能一致性检查：.claude/skills 或 .codex/skills 不存在（CI 环境属正常）');
  process.exit(0);
}

/** 递归列出目录下所有文件的相对路径 */
function listFiles(base, prefix = '') {
  const out = [];
  for (const entry of readdirSync(base)) {
    const full = path.join(base, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out.sort();
}

const md5 = p => createHash('md5').update(readFileSync(p)).digest('hex');

const filesA = listFiles(A);
const filesB = listFiles(B);
const setB = new Set(filesB);
const setA = new Set(filesA);

const problems = [];

for (const f of filesA) if (!setB.has(f)) problems.push(`只在 .claude 存在: ${f}`);
for (const f of filesB) if (!setA.has(f)) problems.push(`只在 .codex  存在: ${f}`);

const shared = filesA.filter(f => setB.has(f));
const differing = shared.filter(f => md5(path.join(A, f)) !== md5(path.join(B, f)));

for (const f of differing) {
  if (!(f in ALLOWED_DIFFS)) problems.push(`内容不一致但未登记: ${f}`);
}
for (const f of Object.keys(ALLOWED_DIFFS)) {
  if (shared.includes(f) && !differing.includes(f)) {
    problems.push(`登记为「有意差异」但两边已相同，可从白名单移除: ${f}`);
  }
}

console.log(`技能文件: .claude ${filesA.length} 个 / .codex ${filesB.length} 个，共有 ${shared.length} 个`);
console.log(`已登记的有意差异 ${Object.keys(ALLOWED_DIFFS).length} 处:`);
for (const [f, why] of Object.entries(ALLOWED_DIFFS)) console.log(`  ${f}\n      ${why}`);

if (problems.length) {
  console.error(`\n技能一致性检查失败:\n${problems.map(p => '  ' + p).join('\n')}`);
  process.exit(1);
}

console.log(`\n其余 ${shared.length - differing.length} 个文件两边逐字一致。`);
