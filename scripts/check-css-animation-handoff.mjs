/**
 * 护栏：禁止用 `animation: none` + `transition` 去接管一个正在跑（或正在 fill）的 animation
 *
 * 背景：这个写法看着最自然，实际是**静默瞬切** —— transition 一帧都不会跑。
 *
 * 原因：transition 的起始值取自 before-change style，而 animation 带 `both` /
 * `forwards` 时的填充值属于 animation origin，**不参与**这个比较。于是
 * "解除 animation" 和 "改属性值" 落在同一帧，浏览器认定没有可插值的起点，
 * 直接跳到终值。声明写了，规则也命中了，就是不动画。
 *
 * 历史事故（2026-09-11，灯箱关场背景淡出）：
 *
 *   .pswp-blur-bg { animation: pswp-blur-bg-open ... both; }   // 基础态把 opacity 钉在 1
 *   .is-pswp-closing .pswp-blur-bg {
 *     animation: none;                                          // ❌ 这三行合起来 = 瞬切
 *     opacity: 0;
 *     transition: opacity var(--duration-normal) ...;
 *   }
 *
 * 真机（Tauri WebView2）逐帧采样结果：关场第一帧 opacity 就已经是 0，全程无插值。
 * 同一个文件里底栏那条规则没有 animation 要解除，transition 就正常跑
 * （实测 1 → 0.966 → 0.881 → …），两相对照能把原因钉死。
 *
 * ⚠️ 这类缺陷 lint / typecheck / 单测**一个都拦不住** —— jsdom 不解析 CSS 动画，
 * 当时 3012 条单测全绿，问题只有真机采样才暴露。所以才需要这道静态护栏。
 *
 * 正确写法：用新的 keyframes 顶替，animation-name 一变，新动画立刻从 from 值起跑，
 * 与旧动画是否还在 fill 无关：
 *
 *   @keyframes pswp-blur-bg-close { from { opacity: 1; } to { opacity: 0; } }
 *   .is-pswp-closing .pswp-blur-bg {
 *     animation: pswp-blur-bg-close var(--duration-normal) ... both;
 *   }
 *
 * 说明：`animation: none` 单独出现是合法的（例如 prefers-reduced-motion 里关掉动效），
 * 本脚本只拦「同一声明块里既解除 animation、又想用 transition 接管」这一种组合。
 *
 * 用法：npm run lint 自动执行；单独跑 `node scripts/check-css-animation-handoff.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanDirs = ['src', 'tests'];
const failures = [];
let blocksScanned = 0;

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

/** 去掉 CSS 注释，避免注释里的示例代码被误报（本文件顶部就有一段） */
function stripComments(source) {
  // 用等长空白替换，保持行号与列位置不变
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * .vue 只取 <style> 块内容，其余位置替换成等长空白。
 * 不这么做的话 template 的 {{ }} 和 script 的 { } 会被当成声明块。
 */
function extractStyleBlocks(source) {
  let out = source.replace(/[^\n]/g, ' ');
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const body = match[1];
    const start = match.index + match[0].indexOf(body);
    out = out.slice(0, start) + body + out.slice(start + body.length);
  }
  return out;
}

/** 解除 animation：animation: none 或 animation-name: none */
const ANIMATION_NONE = /(^|[;{\s])animation(-name)?\s*:\s*none\s*(;|$)/;
/** 真实的 transition（transition: none 不算 —— 那是"关掉过渡"，不是想用它接管） */
const TRANSITION_DECL = /(^|[;{\s])transition(-property|-duration)?\s*:\s*([^;]+)/;

for (const dir of scanDirs) {
  walk(path.join(root, dir), (file) => {
    if (!/\.(css|vue)$/.test(file)) return;

    const raw = fs.readFileSync(file, 'utf8');
    const source = stripComments(file.endsWith('.vue') ? extractStyleBlocks(raw) : raw);

    // 最内层声明块：body 里不含 { }，@media / @supports 的外层因此被自然跳过
    for (const match of source.matchAll(/\{([^{}]*)\}/g)) {
      const body = match[1];
      blocksScanned += 1;

      if (!ANIMATION_NONE.test(body)) continue;
      const transition = body.match(TRANSITION_DECL);
      if (!transition) continue;
      if (/^none\b/.test(transition[3].trim())) continue;

      failures.push({
        file: path.relative(root, file),
        line: source.slice(0, match.index).split(/\r?\n/).length,
        body: body.replace(/\s+/g, ' ').trim().slice(0, 140),
      });
    }
  });
}

if (failures.length > 0) {
  console.error(
    '\n❌ 发现「animation: none + transition」的接管写法 —— 这是静默瞬切，transition 一帧都不会跑：\n'
  );
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    { ${f.body} }`);
  }
  console.error('\n为什么不生效：');
  console.error('  transition 的起始值取自 before-change style，而带 both/forwards 的动画填充值');
  console.error('  属于 animation origin，不参与这个比较。"解除 animation" 和 "改属性" 落在同一帧，');
  console.error('  浏览器认定没有可插值的起点，直接跳终值。');
  console.error('\n修复方式：用新的 keyframes 顶替，别退回 transition');
  console.error('  @keyframes x-close { from { opacity: 1; } to { opacity: 0; } }');
  console.error('  .is-closing .x { animation: x-close var(--duration-normal) var(--ease-decelerate) both; }');
  console.error('\n  animation-name 一变，新动画立刻从 from 值起跑，与旧动画是否还在 fill 无关。');
  console.error('\n参考：src/components/views/history/lightbox-pswp.css 的 pswp-blur-bg-close\n');
  process.exit(1);
}

console.log(
  `✅ CSS animation/transition 交接检查通过（扫描 ${scanDirs.join('/')} 下的 .css/.vue，`
  + `共 ${blocksScanned} 个声明块）`
);
