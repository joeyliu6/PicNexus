/**
 * 护栏：禁止在「全局」.css 文件里使用 `:deep()` / `::v-deep` / `>>>`
 *
 * 背景：这些深度选择器是 Vue SFC scoped 样式的**编译期**语法糖，只有经过
 * @vitejs/plugin-vue 的 scoped 转写才会变成 `[data-v-xxx] .x`。
 * 全局样式表（index.html <link> 或 main.ts import 进来的 .css）不经过这层转写，
 * 浏览器把 `:deep(...)` 当作无法识别的选择器，按 CSS 错误处理规则**整条规则丢弃**
 * —— 写了等于没写，而且没有任何报错提示。
 *
 * 例外：`<style src="./x.css" scoped>` 引入的 .css 会被当作该 SFC 的 scoped 样式块
 * 编译，其中的 :deep() 是合法且生效的。本脚本自动识别这类文件并放行。
 *
 * 历史事故：src/styles/app.css 曾有 31 条这样的规则（DataTable / 输入框 / 按钮 /
 * 弹窗外壳 / Toast / Tag 的全局统一样式），长期从未生效，直接导致弹窗外观分裂。
 *
 * 用法：npm run lint 自动执行；单独跑 `node scripts/check-css-deep.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanDirs = ['src', 'tests'];
const failures = [];

/** 深度选择器的三种写法（Vue 2 遗留的 ::v-deep / >>> 一并拦截） */
const DEEP_PATTERNS = [
  { re: /:deep\s*\(/, name: ':deep()' },
  { re: /::v-deep\b/, name: '::v-deep' },
  { re: /(^|[^/*\w])>>>\s/, name: '>>>' },
];

/** `<style ... src="./x.css" ... scoped ...>` —— src 与 scoped 的顺序不固定 */
const SCOPED_SRC_STYLE = /<style\b([^>]*)>/gi;

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

/** 收集所有被 `<style src="..." scoped>` 引入的 .css —— 它们会走 scoped 编译，属合法用法 */
const scopedCssFiles = new Set();
for (const dir of scanDirs) {
  walk(path.join(root, dir), (file) => {
    if (!file.endsWith('.vue')) return;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(SCOPED_SRC_STYLE)) {
      const attrs = match[1];
      if (!/\bscoped\b/.test(attrs)) continue;
      const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/);
      if (!src) continue;
      scopedCssFiles.add(path.resolve(path.dirname(file), src[1]));
    }
  });
}

/** 去掉 CSS 注释，避免注释里提到 :deep() 被误报 */
function stripComments(source) {
  // 用等长空白替换，保持行号与列位置不变
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

for (const dir of scanDirs) {
  walk(path.join(root, dir), (file) => {
    if (!file.endsWith('.css')) return;
    if (scopedCssFiles.has(path.resolve(file))) return;

    const lines = stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { re, name } of DEEP_PATTERNS) {
        if (re.test(line)) {
          failures.push({
            file: path.relative(root, file),
            line: i + 1,
            token: name,
            text: line.trim().slice(0, 100),
          });
          break;
        }
      }
    });
  });
}

if (failures.length > 0) {
  console.error('\n❌ 全局 .css 文件中发现深度选择器 —— 这些规则在浏览器里会被整条丢弃，永远不会生效：\n');
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  [${f.token}]`);
    console.error(`    ${f.text}`);
  }
  console.error('\n修复方式（三选一）：');
  console.error('  1. 去掉 :deep() 包装，直接写普通全局选择器 —— 全局样式表本来就能命中所有元素；');
  console.error('  2. 把规则搬进对应 .vue 的 <style scoped> 块，或用 <style src="./x.css" scoped> 引入；');
  console.error('  3. 若目标是 PrimeVue Dialog 内部元素，必须写成全局选择器：');
  console.error('     Dialog 会 Teleport 到 body，根节点不带 data-v 属性，scoped :deep() 同样命中不了。');
  console.error('\n参考：src/styles/app.css 第 3 节「弹窗统一外壳」\n');
  process.exit(1);
}

console.log(
  `✅ CSS 深度选择器检查通过（扫描 ${scanDirs.join('/')} 下的 .css；`
  + `已放行 ${scopedCssFiles.size} 个由 <style src scoped> 引入的文件）`
);
