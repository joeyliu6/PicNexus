/**
 * 护栏：`var(--xxx)` 引用的自定义属性必须在项目里有定义
 *
 * 背景：引用一个从没定义过的 CSS 变量，浏览器不报错、stylelint 不报错、
 * 单测更不报错 —— 那条声明只是在计算值阶段静默作废（IACVT，invalid at
 * computed-value time），属性退回 initial / 继承值。写的人以为规则生效了，
 * 实际上什么都没画。
 *
 * 历史事故（2026-09-11 发版前扫描一次挖出 5 个，`git log -S` 确认在 src/ 里
 * **从未**被定义过，也就是从写下那天起就一直没生效）：
 *
 *   TimelineTrack.vue      background: var(--border-color);   // 时间轴轨道线整条不可见
 *   TimelineYearLabels.vue background: var(--bg-hover);       // hover 时底色瞬间消失
 *   app.css .p-popover     box-shadow: var(--shadow-md);      // 所有 Popover 无阴影
 *   PrivateStorageGroup    border: 1px solid var(--error-alpha-20);
 *   MigrateFilterPopover   font-weight: var(--weight-normal); // 令牌叫 --weight-regular
 *
 * 全是"名字猜错了"：令牌表里有 --border-subtle / --hover-overlay / --shadow-float /
 * --error-border / --weight-regular，作者凭印象写了个相近的名字。
 *
 * 判定规则：
 *   - 定义集 = src/**、根目录四个 html、public/ 里所有 `--name:` 声明
 *     （CSS 声明、.vue <style>、TS 里的 `'--name': value` 对象键都算），
 *     以及 JS 侧 `style.setProperty('--name', …)` 动态写入的名字。
 *   - 引用集 = src/** 的 .css / .vue 里所有 `var(--name`（含带 fallback 的写法：
 *     fallback 只是掩盖问题，不是定义，同样要报）。
 *   - 引用集 − 定义集 非空即失败。
 *   - `--p-*`（PrimeVue）与 `--reka-*`（Reka UI 写在浮层上的触发器尺寸等）由库在运行时定义，跳过。
 *   - 注释里的内容先剥掉（CSS 块注释、HTML 注释），避免示例代码误报。
 *
 * 另查一类同样静默的错：同一选择器下把同名变量定义两次且取值不同（见第 3 节）。
 *
 * 用法：npm run lint 自动执行；单独跑 `node scripts/check-css-undefined-vars.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const root = process.cwd();

/** 定义扫描面：项目里任何可能声明 CSS 变量的地方 */
const DEFINITION_SCAN = {
  dirs: ['src', 'public'],
  rootFiles: ['index.html', 'login-webview.html', 'login-titlebar.html', 'tray-menu.html'],
  extensions: /\.(css|vue|ts|js|mjs|html)$/,
};

/** 引用扫描面：只看会被浏览器当 CSS 解析的地方 */
const REFERENCE_SCAN = {
  dirs: ['src'],
  extensions: /\.(css|vue)$/,
};

/** 由第三方库在运行时定义、项目源码里不会出现声明的前缀（PrimeVue / Reka UI 的浮层尺寸变量） */
const LIBRARY_PREFIXES = ['--p-', '--reka-'];

function walk(dir, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}

/** 去掉 CSS 块注释与 HTML 注释，用等长空白替换以保持行号 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ' '));
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

// ---- 1. 收集定义 ----

const defined = new Set();
/**
 * `--name:` 前面不能是字母/连字符，否则 `a--b:` 这种会被误抓；
 * 名字后允许一个收尾引号，这样 TS / 模板里的对象键 `'--name': value`（:style 绑定）也算定义
 */
const DECLARATION = /(^|[^\w-])(--[\w-]+)['"]?\s*:/g;
const SET_PROPERTY = /setProperty\(\s*['"`](--[\w-]+)['"`]/g;

function collectDefinitions(file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  for (const match of source.matchAll(DECLARATION)) defined.add(match[2]);
  for (const match of source.matchAll(SET_PROPERTY)) defined.add(match[1]);
}

for (const dir of DEFINITION_SCAN.dirs) {
  walk(path.join(root, dir), (file) => {
    if (DEFINITION_SCAN.extensions.test(file)) collectDefinitions(file);
  });
}
for (const name of DEFINITION_SCAN.rootFiles) {
  const file = path.join(root, name);
  if (fs.existsSync(file)) collectDefinitions(file);
}

// ---- 2. 收集引用并做差集 ----

const REFERENCE = /var\(\s*(--[\w-]+)/g;
const failures = [];
let referencesScanned = 0;

for (const dir of REFERENCE_SCAN.dirs) {
  walk(path.join(root, dir), (file) => {
    if (!REFERENCE_SCAN.extensions.test(file)) return;
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of source.matchAll(REFERENCE)) {
      const name = match[1];
      referencesScanned += 1;
      if (LIBRARY_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      if (defined.has(name)) continue;
      failures.push({ file: path.relative(root, file), line: lineOf(source, match.index), name });
    }
  });
}

// ---- 3. 同一选择器下取值冲突的重复定义 ----
// 同一个选择器（同一层 @media）下把同名变量定义两次、取值还不一样，后一条静默盖掉前一条
// （例：新加的 --pn-size-chip: 24px 把首页用的 28px 改小了），任何门禁都看不见。
// 全局 .css 跨文件比（都在同一个 :root 上）；.vue 的 <style> 只在本文件内比。取值相同的重复无害，不报。

const DUPLICATE_SCAN = { dirs: ['src'], extensions: /\.(css|vue)$/ };
const seen = new Map();
const duplicates = [];

function contextOf(node) {
  const chain = [];
  for (let parent = node.parent; parent && parent.type !== 'root'; parent = parent.parent) {
    if (parent.type === 'atrule') chain.unshift(`@${parent.name} ${parent.params}`);
  }
  return chain.join(' ');
}

function checkDuplicates(file) {
  const source = fs.readFileSync(file, 'utf8');
  const blocks = file.endsWith('.vue')
    ? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ text: m[1], startLine: lineOf(source, m.index + m[0].indexOf(m[1])) - 1 }))
    : [{ text: source, startLine: 0 }];
  const scope = file.endsWith('.vue') ? path.relative(root, file) : 'global';
  for (const { text, startLine } of blocks) {
    postcss.parse(text).walkDecls(/^--/, (decl) => {
      if (decl.parent.type !== 'rule') return;
      const selector = decl.parent.selector.replace(/\s+/g, ' ').trim();
      const key = `${scope}|${contextOf(decl.parent)}|${selector}|${decl.prop}`;
      const where = { file: path.relative(root, file), line: startLine + decl.source.start.line, value: decl.value.trim() };
      const first = seen.get(key);
      if (!first) seen.set(key, where);
      else if (first.value !== where.value) duplicates.push({ name: decl.prop, selector, first, again: where });
    });
  }
}

for (const dir of DUPLICATE_SCAN.dirs) {
  walk(path.join(root, dir), (file) => {
    if (DUPLICATE_SCAN.extensions.test(file)) checkDuplicates(file);
  });
}

if (duplicates.length > 0) {
  console.error('\n❌ 同一选择器下重复定义了 CSS 变量且取值不同 —— 后一条静默盖掉前一条：\n');
  for (const d of duplicates) {
    console.error(`  ${d.name}（${d.selector}）：${d.first.file}:${d.first.line} 是 ${d.first.value}，${d.again.file}:${d.again.line} 又写成 ${d.again.value}`);
  }
  console.error('\n多半是新加令牌时撞了已有的名字：换个更具体的名字，别改已有的值。\n');
  process.exit(1);
}

// ---- 4. 报告 ----

if (failures.length > 0) {
  console.error('\n❌ 以下 CSS 变量被 var() 引用，但项目里没有任何定义 —— 这条声明在浏览器里静默作废：\n');
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  var(${f.name})`);
  }
  console.error('\n为什么不报错：引用未定义变量属于 IACVT（计算值阶段无效），浏览器不抛错、');
  console.error('stylelint 不查跨文件定义、jsdom 不解析样式，三道门禁都看不见。');
  console.error('\n修复方式：到 docs/design/tokens.md 或 src/styles/app.css、src/theme/*.css 里');
  console.error('找那个真正存在的令牌名（多半是名字记错了：--weight-normal → --weight-regular，');
  console.error('--border-color → --border-subtle）。确实需要新令牌时在 app.css 定义深色默认值、');
  console.error('light-theme.css 定义浅色覆盖，两边都要有。\n');
  process.exit(1);
}

console.log(
  `✅ CSS 变量定义检查通过（${defined.size} 个定义，${referencesScanned} 处 var() 引用全部有定义）`
);
