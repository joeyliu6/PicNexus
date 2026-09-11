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
 *   - `--p-*` 是 PrimeVue 库内定义的令牌，项目里不会出现它们的声明，跳过。
 *   - 注释里的内容先剥掉（CSS 块注释、HTML 注释），避免示例代码误报。
 *
 * 用法：npm run lint 自动执行；单独跑 `node scripts/check-css-undefined-vars.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';

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

/** 由第三方库在运行时定义、项目源码里不会出现声明的前缀 */
const LIBRARY_PREFIXES = ['--p-'];

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
/** `--name:` 前面不能是字母/连字符，否则 `a--b:` 这种会被误抓 */
const DECLARATION = /(^|[^\w-])(--[\w-]+)\s*:/g;
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

// ---- 3. 报告 ----

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
