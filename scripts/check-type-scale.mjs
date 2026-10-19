/**
 * 护栏：字号只用 20 / 17 / 15 / 13 / 12 / 11，字重只用 400 / 500 / 600（交接说明 5.2、第 14 节验收清单）
 *
 * 两头都查：
 *   1. 令牌的值：tokens*.css 里 `--pn-text-*` 只能是刻度上的字号，`--pn-weight-*` 只能是三档字重。
 *   2. 用法：src 下 .vue / .css 的 `font-size` / `font-weight` 只能写这些令牌（或 inherit），
 *      不许写数字，也不许借别的令牌（比如拿一个尺寸令牌当字号）。
 *
 * 刻度外的例外是设计稿原值、记在 decisions 里的两个：花瓣角标 9px、日历星期 10px（EXCEPTIONS）。
 * 新增例外先在 decisions 里写清理由，再加进 EXCEPTIONS。@font-face 里的 font-weight 是字体文件的描述，不算。
 *
 * 截图测试（tests/redesign/designRules.ts）量的是画出来的字号，只覆盖录了基准图的状态；
 * 这里查源码，没录图的状态也拦得住。
 *
 * 用法：npm run lint 自动执行；单独跑 `node scripts/check-type-scale.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const root = process.cwd();
const FONT_SIZES = new Set(['20px', '17px', '15px', '13px', '12px', '11px']);
const FONT_WEIGHTS = new Set(['400', '500', '600']);
const TOKEN_FILES = ['src/styles/tokens.css', 'src/styles/tokens-extra.css'];

/** 刻度外的字号例外：令牌名 → 记在哪 */
const EXCEPTIONS = {
  '--pn-size-petal-badge-text': 'decisions/home.md（花瓣角标 9px）',
  '--pn-size-calendar-weekday-text': 'decisions/health.md（日历星期 10px）',
};

const SIZE_OK = /^var\(--pn-text-[a-z-]+\)$/;
const WEIGHT_OK = /^var\(--pn-weight-[a-z]+\)$/;

const failures = [];

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (/\.(css|vue)$/.test(entry.name)) onFile(full);
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function insideFontFace(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'font-face') return true;
  }
  return false;
}

// ---- 1. 令牌的值 ----
for (const file of TOKEN_FILES) {
  postcss.parse(fs.readFileSync(path.join(root, file), 'utf8')).walkDecls(/^--pn-(text|weight)-/, (decl) => {
    const value = decl.value.trim();
    const allowed = decl.prop.startsWith('--pn-text-') ? FONT_SIZES : FONT_WEIGHTS;
    if (!allowed.has(value)) failures.push(`${file}:${decl.source?.start?.line}  ${decl.prop}: ${value}（不在刻度上）`);
  });
}

// ---- 2. 用法 ----
walk(path.join(root, 'src'), (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replaceAll('\\', '/');
  const blocks = file.endsWith('.vue')
    ? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ text: m[1], offset: lineOf(source, m.index + m[0].indexOf(m[1])) - 1 }))
    : [{ text: source, offset: 0 }];

  for (const { text, offset } of blocks) {
    postcss.parse(text).walkDecls(/^font-(size|weight)$/, (decl) => {
      if (insideFontFace(decl)) return;
      const value = decl.value.trim();
      if (value === 'inherit') return;
      const ok = decl.prop === 'font-size'
        ? SIZE_OK.test(value) || Object.keys(EXCEPTIONS).some((name) => value === `var(${name})`)
        : WEIGHT_OK.test(value);
      if (!ok) failures.push(`${rel}:${offset + (decl.source?.start?.line ?? 0)}  ${decl.prop}: ${value}`);
    });
  }

  // 模板里的行内 style="font-size: …"（:style 绑定由截图测试量）
  if (file.endsWith('.vue')) {
    const template = source.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, (block) => block.replace(/[^\n]/g, ' '));
    for (const match of template.matchAll(/\sstyle="[^"]*font-(size|weight)\s*:[^"]*"/g)) {
      failures.push(`${rel}:${lineOf(template, match.index)}  行内 style 写了 font-${match[1]}`);
    }
  }
});

if (failures.length > 0) {
  console.error('\n❌ 字号 / 字重不在设计刻度上（交接说明 5.2：字号 20 / 17 / 15 / 13 / 12 / 11，字重 400 / 500 / 600）：\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\n修复方式：字号用 var(--pn-text-title / dialog-title / headline / body / footnote / caption / mono)，');
  console.error('字重用 var(--pn-weight-regular / medium / semibold)。设计稿确实用了刻度外的值：先记进 decisions，');
  console.error('再在 tokens-extra.css 写具名令牌、加进本脚本的 EXCEPTIONS。\n');
  process.exit(1);
}

console.log('✅ 字号 / 字重刻度检查通过（令牌值与 src 下全部 font-size / font-weight 都在刻度上）');
