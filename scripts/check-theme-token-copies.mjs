/**
 * 首屏主题令牌副本一致性检查
 *
 * 有几个文件跑在 Vue 挂载之前（`login-webview.html` 的 <style>、`public/preload.css`），
 * 那一刻 `src/theme/*.css` 还没加载，`var(--bg-app)` 解析不出来，只能把色值**手抄一份**
 * 写死在里面。抄下来的值一旦和主题文件分叉，用户看到的就是首屏一个颜色、挂载后跳成
 * 另一个颜色——这类闪烁没人会报障，只会觉得"这软件有点糙"。
 *
 * 这条约定以前只写在源码注释里（"值必须与 src/theme/dark-theme.css 保持一致"）。
 * 注释拦不住任何东西：改了主题色不会红、测试不会挂、CI 不会拦。本脚本把它变成硬门禁。
 *
 * ── 真相源 ──
 * 按浏览器里的层叠顺序把 `:root` 变量摞起来：app.css 的全局别名 → dark-theme.css →
 * （亮色时再叠）light-theme.css。`var(--x)` 会被递归解开，所以副本里可以直接抄
 * `--state-info-bg` 展开后的 rgba 字面量。
 *
 * ── 新增一处副本 ──
 * 往 COPIES 里加一条。两种写法：
 *   1. `kind: 'custom-properties'`：副本块里重定义同名变量（如 `--bg-app: #131316`），
 *      块内每条 `--x` 声明都会自动和真相源的 `--x` 比对，不用手写映射。
 *   2. `kind: 'declarations'`：副本块里写的是真实属性（如 `background-color: #131316`），
 *      需要用 `map` 声明"这条属性抄的是哪个令牌"。
 *
 * ── 不适合放进来的 ──
 * `login-titlebar.html` 自成一套配色（`#111827` 等），它不是"主题令牌的副本"而是
 * 独立调色板，硬塞进来只会逼出一堆假映射。它的问题（含 `html.light` 类名不合约定）
 * 已单独记在 docs/TODO.md。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

/** 真相源：数组顺序 = 层叠顺序，后者覆盖前者 */
const TOKEN_LAYERS = {
  dark: [
    { file: 'src/styles/app.css', selector: ':root' },
    { file: 'src/theme/dark-theme.css', selector: ':root, :root.dark-theme' },
  ],
  light: [
    { file: 'src/styles/app.css', selector: ':root' },
    { file: 'src/theme/dark-theme.css', selector: ':root, :root.dark-theme' },
    { file: 'src/theme/light-theme.css', selector: ':root.light-theme' },
  ],
};

/** 手抄副本清单 */
const COPIES = [
  {
    file: 'login-webview.html',
    why: '登录 WebView 首屏在 Vue 挂载前渲染，app.css 未加载，只能就地重定义同名变量兜住骨架屏',
    blocks: [
      { selector: ':root', theme: 'dark', kind: 'custom-properties' },
      { selector: ':root.light-theme', theme: 'light', kind: 'custom-properties' },
    ],
  },
  {
    file: 'public/preload.css',
    why: '主窗口首屏防白闪样式，先于打包产物加载，拿不到 app.css 里的变量',
    blocks: [
      {
        selector: 'html.dark-theme, html.dark-theme body',
        theme: 'dark',
        kind: 'declarations',
        map: { 'background-color': '--bg-app', color: '--text-main' },
      },
      {
        selector: 'html.light-theme, html.light-theme body',
        theme: 'light',
        kind: 'declarations',
        map: { 'background-color': '--bg-app', color: '--text-main' },
      },
    ],
  },
];

const failures = [];

/** 去掉 CSS 注释，避免注释里的花括号/冒号干扰解析 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 把选择器里的换行和多余空格压平，便于和清单里的写法对齐 */
function normalizeSelector(selector) {
  return selector.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

/** 色值比对前统一大小写并抹掉空格：`rgba(96, 165, 250, 0.15)` 与紧凑写法视为同一个值 */
function normalizeValue(value) {
  return value.toLowerCase().replace(/\s+/g, '');
}

/**
 * 扫出顶层规则块（深度 1），跳过 @media / @supports 等 at-rule。
 * 这几个文件的结构都很朴素，不需要上真正的 CSS 解析器。
 */
function parseTopLevelBlocks(css) {
  const source = stripComments(css);
  const blocks = new Map();
  let depth = 0;
  let selectorStart = 0;
  let blockStart = 0;
  let currentSelector = '';

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === '{') {
      if (depth === 0) {
        currentSelector = normalizeSelector(source.slice(selectorStart, i));
        blockStart = i + 1;
      }
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        if (!currentSelector.startsWith('@')) {
          // 同一个选择器可能出现多次（app.css 就有两段 `:root`），按源码顺序拼起来，
          // 与浏览器里"后写的覆盖先写的"一致；只留最后一段会把前面的变量整批丢掉。
          const previous = blocks.get(currentSelector);
          const body = source.slice(blockStart, i);
          blocks.set(currentSelector, previous === undefined ? body : `${previous};${body}`);
        }
        selectorStart = i + 1;
      }
      continue;
    }

    if (ch === ';' && depth === 0) {
      // 顶层的 @import / @charset 之类，直接跳过
      selectorStart = i + 1;
    }
  }

  return blocks;
}

/** 把一个规则块的正文拆成 { 属性: 值 }，后写的覆盖先写的 */
function parseDeclarations(body) {
  const declarations = new Map();

  for (const chunk of body.split(';')) {
    const separator = chunk.indexOf(':');
    if (separator === -1) continue;

    const property = chunk.slice(0, separator).trim();
    const value = chunk.slice(separator + 1).trim();
    if (!property || !value) continue;

    declarations.set(property, value);
  }

  return declarations;
}

function readFileOrFail(file, context) {
  const fullPath = path.join(root, file);

  if (!fs.existsSync(fullPath)) {
    failures.push(`${context}: 文件不存在 ${file}（被移动或改名了？顺手更新 scripts/check-theme-token-copies.mjs）`);
    return null;
  }

  return fs.readFileSync(fullPath, 'utf8');
}

/** 从 HTML 里抽出所有 <style> 正文；非 HTML 文件原样返回 */
function extractCss(file, content) {
  if (!file.endsWith('.html')) return content;

  const styles = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  return styles.map(match => match[1]).join('\n');
}

function getBlockBody(file, selector, context) {
  const content = readFileOrFail(file, context);
  if (content === null) return null;

  const body = parseTopLevelBlocks(extractCss(file, content)).get(selector);
  if (body === undefined) {
    failures.push(`${context}: 在 ${file} 里找不到选择器 \`${selector}\`（选择器改写了？同步更新 scripts/check-theme-token-copies.mjs）`);
    return null;
  }

  return body;
}

/** 递归解开 var(--x) / var(--x, fallback)，解不开就原样返回 */
function resolveValue(value, tokens, seen = new Set()) {
  const match = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(value.trim());
  if (!match) return value;

  const [, name, fallback] = match;
  if (seen.has(name)) return value; // 变量互相引用成环，交给下游按不一致报错

  const next = tokens.get(name);
  if (next === undefined) {
    return fallback === undefined ? value : resolveValue(fallback.trim(), tokens, seen);
  }

  return resolveValue(next, tokens, new Set([...seen, name]));
}

/** 按层叠顺序摞出某个主题的最终令牌表 */
function buildTokenTable(theme) {
  const tokens = new Map();

  for (const layer of TOKEN_LAYERS[theme]) {
    const body = getBlockBody(layer.file, layer.selector, `真相源 ${theme}`);
    if (body === null) continue;

    for (const [property, value] of parseDeclarations(body)) {
      if (property.startsWith('--')) tokens.set(property, value);
    }
  }

  const resolved = new Map();
  for (const [name, value] of tokens) {
    resolved.set(name, resolveValue(value, tokens));
  }

  return resolved;
}

function checkBlock(copy, block, tokenTable) {
  const context = `${copy.file} ${block.selector}`;
  const body = getBlockBody(copy.file, block.selector, context);
  if (body === null) return;

  const declarations = parseDeclarations(body);

  // 两种写法归一成同一批比对项：[副本里的属性名, 对应的令牌名, 副本里的值]
  const comparisons = block.kind === 'custom-properties'
    ? [...declarations].filter(([property]) => property.startsWith('--')).map(([property, value]) => [property, property, value])
    : Object.entries(block.map).map(([property, token]) => [property, token, declarations.get(property)]);

  if (comparisons.length === 0) {
    failures.push(`${context}: 块里一条可比对的声明都没有（副本被清空了？那就把它从 scripts/check-theme-token-copies.mjs 的 COPIES 里删掉）`);
    return;
  }

  for (const [property, token, copiedValue] of comparisons) {
    if (copiedValue === undefined) {
      failures.push(`${context}: 缺少 \`${property}\`（清单说它抄的是 ${token}）`);
      continue;
    }

    const expected = tokenTable.get(token);
    if (expected === undefined) {
      failures.push(`${context}: 真相源里没有 \`${token}\` —— ${copy.file} 抄了一个不存在的令牌（拼错了，还是主题里刚删掉？）`);
      continue;
    }

    if (normalizeValue(copiedValue) !== normalizeValue(expected)) {
      failures.push(
        `${context}: \`${property}\` 与主题令牌 \`${token}\` 已分叉——${copy.why}\n`
        + `    真相源（${block.theme}）  ${expected}\n`
        + `    ${copy.file}  ${copiedValue}`,
      );
    }
  }
}

const tokenTables = {
  dark: buildTokenTable('dark'),
  light: buildTokenTable('light'),
};

for (const copy of COPIES) {
  for (const block of copy.blocks) {
    checkBlock(copy, block, tokenTables[block.theme]);
  }
}

if (failures.length > 0) {
  console.error('\n❌ 首屏主题令牌副本与 src/theme/ 已分叉 —— 用户会看到首屏一个颜色、Vue 挂载后跳成另一个：\n');
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  console.error('\n修复方式：把副本里的值改回真相源的值；若确实是主题色本身变了，两边一起改。');
  console.error('参考：src/theme/dark-theme.css、src/theme/light-theme.css\n');
  process.exit(1);
}

const copiedCount = COPIES.reduce((sum, copy) => sum + copy.blocks.length, 0);
console.log(`✅ 首屏主题令牌副本检查通过（${COPIES.length} 个文件 / ${copiedCount} 个块与 src/theme/ 一致）`);
