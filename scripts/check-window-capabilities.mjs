/**
 * 窗口命令权限一致性检查
 *
 * build.rs 用 AppManifest 登记了应用命令清单之后，Tauri 才会按 src-tauri/capabilities/
 * 逐窗口检查「谁能调用哪个应用命令」。没登记时任何页面——包括登录窗口里打开的外部网站——
 * 都能调用全部命令（2026-10-06 对抗式审查 P0）。
 *
 * 收紧的代价：某个窗口的前端新用了一个命令，却忘了在它的 capability 里放行，运行时就报
 * "not allowed"，而且只有真点到那条路径才会发现。本脚本把它变成 lint 门禁。
 *
 * ── 检查什么 ──
 *   1. build.rs 的 APP_COMMANDS 与 main.rs 的 generate_handler! 是同一份清单（不缺、不多、不重复）；
 *   2. capability 里的应用命令权限只能写 `allow-<已登记的命令名>`；
 *   3. 每个页面（vite 的每个 HTML 入口）沿 import 关系可达的代码里出现的命令名，
 *      都在它所在窗口的 capability 里放行；反过来，放行了却没出现的也报错（多给的权限）；
 *      代码里出现但运行时走不到、刻意不放行的，登记在 WITHHELD 并写明理由；
 *   4. vite 新增了页面却没在 PAGE_WINDOWS 登记它跑在哪个窗口；或者 capability 把应用命令
 *      放行给了一个不加载 PicNexus 页面的窗口（外部网站、统计窗口）。
 *
 * ── 检查不到什么 ──
 * 命令名在运行时拼出来的写法（模板字符串插值、字符串相加）。仓库里目前没有。真出现了，
 * 本脚本会把它当成「没用到」——后果是放行少了、运行时报 not allowed，不会多给权限。
 *
 * 代码用 TypeScript 自己的解析器读（.vue 先用 vue/compiler-sfc 拆出 <script>），
 * 不用正则：正则字面量里的引号会把手写扫描器带偏，悄悄漏掉 import。
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse as parseSfc } from 'vue/compiler-sfc';

const root = process.cwd();
const failures = [];

/**
 * 每个页面跑在哪个窗口 / webview 里。来源：tauri.conf.json（main）、
 * src-tauri/src/commands/cookie_login.rs（login-window 及其两个子 webview）。
 * 统计窗口（analytics-transport）加载的是本机统计服务的远程页，不在这里，也不该被放行任何命令。
 */
const PAGE_WINDOWS = {
  'index.html': { window: 'main', webview: 'main' },
  'login-webview.html': { window: 'login-window', webview: 'login-content' },
  'login-titlebar.html': { window: 'login-window', webview: 'login-titlebar' },
};

/** 页面代码里出现、但运行时走不到的命令：刻意不放行，并写明理由 */
const WITHHELD = {};

/** 不是代码、不会再引入命令的资源扩展名 */
const ASSET_EXTENSIONS = new Set(['.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.json', '.woff', '.woff2']);

const registered = readGenerateHandler();
const manifest = readBuildManifest();
compareCommandLists(registered, manifest);

const knownCommands = new Set(registered);
const grants = readCapabilityGrants(new Set(manifest));
const pages = readVitePages();
const summary = [];

for (const page of pages) {
  const placement = PAGE_WINDOWS[page];
  if (!placement) {
    failures.push(`${page}：vite 打包了这个页面，但 PAGE_WINDOWS 里没登记它跑在哪个窗口`);
    continue;
  }

  const referenced = commandsReachableFrom(page, knownCommands);
  const withheld = WITHHELD[page] ?? {};
  const granted = grantedTo(grants, placement);
  const label = `${page}（${placement.window}/${placement.webview}）`;

  for (const command of referenced) {
    if (command in withheld || granted.has(command)) continue;
    failures.push(
      `${label} 的代码会调用 ${command}，但没被放行——运行时会报 not allowed。`
      + `在管这个窗口的 capability 里加 "allow-${toPermission(command)}"`,
    );
  }
  for (const command of granted) {
    if (referenced.has(command)) continue;
    failures.push(`${label} 被放行了 ${command}，但它的代码里根本没出现——多给的权限，从 capability 里删掉`);
  }
  for (const [command, reason] of Object.entries(withheld)) {
    if (!referenced.has(command)) {
      failures.push(`WITHHELD 里 ${page} 的 ${command} 已不在它的代码里出现，删掉这条（原理由：${reason}）`);
    }
    if (granted.has(command)) {
      failures.push(`${command} 登记为对 ${page} 刻意不放行，capability 却放行了它——二选一`);
    }
  }

  summary.push(`${placement.webview} ${granted.size}`);
}

for (const page of Object.keys(PAGE_WINDOWS)) {
  if (!pages.includes(page)) failures.push(`PAGE_WINDOWS 登记了 ${page}，但 vite 并不打包它`);
}

for (const grant of grants) {
  if (grant.commands.size === 0) continue;
  const servesAPage = Object.values(PAGE_WINDOWS).some(
    (placement) => grant.windows.includes(placement.window) || grant.webviews.includes(placement.webview),
  );
  if (!servesAPage) {
    failures.push(`${grant.file} 把应用命令放行给了不加载 PicNexus 页面的窗口：${[...grant.windows, ...grant.webviews].join(', ')}`);
  }
}

if (failures.length > 0) {
  console.error('Window capability check failed:\n' + failures.map((line) => `  - ${line}`).join('\n'));
  process.exit(1);
}

console.log(`窗口命令权限检查：${registered.length} 个命令已登记；各窗口放行 ${summary.join(' / ')}`);

// ───────────────────────── Rust 侧：两份命令清单 ─────────────────────────

function readGenerateHandler() {
  const file = 'src-tauri/src/main.rs';
  const source = read(file);
  const match = /generate_handler!\s*\[([^\]]*)\]/.exec(source);
  if (!match) throw new Error(`${file} 里找不到 generate_handler![...]（写法变了？请更新本脚本）`);
  // 先去掉整段里的注释再切：被注释掉的命令不算注册
  return stripRustLineComments(match[1])
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('::').pop());
}

function readBuildManifest() {
  const file = 'src-tauri/build.rs';
  const source = read(file);
  const match = /const\s+APP_COMMANDS\s*:[^=]*=\s*&\s*\[([^\]]*)\]/.exec(source);
  if (!match) throw new Error(`${file} 里找不到 const APP_COMMANDS（写法变了？请更新本脚本）`);
  return [...stripRustLineComments(match[1]).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** 两份清单里只有命令名和 `//` 注释，命令名不含 `//`，按行截掉即可 */
function stripRustLineComments(text) {
  return text.replace(/\/\/.*$/gm, '');
}

function compareCommandLists(handler, buildList) {
  for (const [name, list] of [['main.rs 的 generate_handler!', handler], ['build.rs 的 APP_COMMANDS', buildList]]) {
    const seen = new Set();
    for (const command of list) {
      if (seen.has(command)) failures.push(`${name} 里 ${command} 写了两次`);
      seen.add(command);
    }
  }
  const inBuild = new Set(buildList);
  const inHandler = new Set(handler);
  for (const command of handler) {
    if (!inBuild.has(command)) {
      failures.push(`${command} 在 main.rs 注册了，但 build.rs 的 APP_COMMANDS 没登记——任何窗口都调不了它`);
    }
  }
  for (const command of buildList) {
    if (!inHandler.has(command)) {
      failures.push(`${command} 在 build.rs 登记了，但 main.rs 没注册这个命令`);
    }
  }
}

// ───────────────────────── capability：谁被放行了什么 ─────────────────────────

function readCapabilityGrants(manifestCommands) {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const active = conf.app?.security?.capabilities;
  const dir = path.join(root, 'src-tauri', 'capabilities');
  const result = [];

  // Tauri 还认 tauri.conf.json 里内嵌的 capability 对象、子目录和 .toml / .json5 文件；
  // 本脚本只读顶层 .json，读不到的写法直接报错，不能悄悄漏掉一份放行
  if (Array.isArray(active) && active.some((entry) => typeof entry !== 'string')) {
    failures.push('tauri.conf.json 里内嵌了 capability 对象——请改成 src-tauri/capabilities/ 下的独立 .json 文件');
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    if (!entry.isFile() || path.extname(name) !== '.json') {
      failures.push(`src-tauri/capabilities/${name}：本检查只读 capabilities/ 顶层的 .json 文件，请改成这种写法`);
      continue;
    }
    const file = `src-tauri/capabilities/${name}`;
    const capability = JSON.parse(read(file));
    // tauri.conf.json 列了清单就只认清单里的；没列则目录里全部生效（Tauri 的口径）
    if (Array.isArray(active) && !active.some((entry) => entry === capability.identifier)) continue;

    const commands = new Set();
    for (const permission of capability.permissions ?? []) {
      const id = typeof permission === 'string' ? permission : permission.identifier;
      if (typeof id !== 'string' || id.includes(':')) continue; // 插件权限
      const command = id.startsWith('allow-') ? id.slice('allow-'.length).replaceAll('-', '_') : null;
      if (!command || !manifestCommands.has(command)) {
        failures.push(`${file}：应用命令权限只能写 allow-<build.rs 登记过的命令>，看到 "${id}"`);
        continue;
      }
      commands.add(command);
    }

    const windows = capability.windows ?? [];
    const webviews = capability.webviews ?? [];
    if (commands.size > 0 && [...windows, ...webviews].some((label) => label.includes('*'))) {
      // Tauri 支持通配符，但那会把命令悄悄放行给将来新建的任何窗口（包括加载外部网站的）
      failures.push(`${file} 用通配符窗口名放行应用命令——请写出具体的窗口 / webview 名`);
    }
    if (capability.remote) {
      failures.push(`${file} 给远程页面开了口子（remote 字段）——本应用没有任何外部网页需要调用命令`);
    }

    result.push({ file, windows, webviews, commands });
  }
  return result;
}

/** Tauri 的匹配口径：capability 的 windows 命中窗口 label，或 webviews 命中 webview label */
function grantedTo(capabilityGrants, placement) {
  const granted = new Set();
  for (const grant of capabilityGrants) {
    if (grant.windows.includes(placement.window) || grant.webviews.includes(placement.webview)) {
      for (const command of grant.commands) granted.add(command);
    }
  }
  return granted;
}

function toPermission(command) {
  return command.replaceAll('_', '-');
}

// ───────────────────────── 前端：每个页面会用到哪些命令 ─────────────────────────

function readVitePages() {
  const source = read('vite.config.ts');
  const input = /input\s*:\s*\{([\s\S]*?)\}/.exec(source);
  if (!input) throw new Error('vite.config.ts 里找不到 rollupOptions.input（写法变了？请更新本脚本）');
  return [...input[1].matchAll(/["']([\w.-]+\.html)["']/g)].map((m) => m[1]);
}

function commandsReachableFrom(page, commandNames) {
  const html = read(page);
  // 属性顺序不固定：先抓整个 <script ...> 标签，再分别看 type 和 src
  const entries = [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => /\btype=["']module["']/.test(attrs))
    .map((attrs) => /\bsrc=["']\/?([^"']+)["']/.exec(attrs)?.[1])
    .filter((src) => typeof src === 'string');
  if (entries.length === 0) {
    failures.push(`${page} 里没找到 <script type="module" src="...">，没法确定它的代码入口`);
    return new Set();
  }

  const referenced = new Set();
  const visited = new Set();
  const queue = entries.map((entry) => path.join(root, entry));

  let file;
  while ((file = queue.pop()) !== undefined) {
    if (visited.has(file)) continue;
    visited.add(file);
    if (!fs.existsSync(file)) {
      failures.push(`${page} 的入口 ${path.relative(root, file)} 不存在`);
      continue;
    }

    for (const unit of codeUnits(file)) {
      const { specifiers, strings, globs, opaqueImports } = scanUnit(unit.code, unit.fileName);
      if (opaqueImports > 0) {
        failures.push(`${rel(file)}：有 ${opaqueImports} 处 import() 的路径不是字面量，本脚本跟不进去——请改成写死路径`);
      }
      for (const text of strings) {
        if (commandNames.has(text)) referenced.add(text);
      }
      for (const pattern of globs) {
        // 不用 path.extname：'*.svg' 去掉星号后是 '.svg'，Node 会把它当成点开头的文件名、扩展名为空
        const extension = (/\.[a-z0-9]+$/i.exec(pattern)?.[0] ?? '').toLowerCase();
        if (!ASSET_EXTENSIONS.has(extension)) {
          failures.push(`${rel(file)}：import.meta.glob('${pattern}') 引入的是代码，本脚本跟不进去——请改成显式 import`);
        }
      }
      for (const specifier of specifiers) {
        const resolved = resolveImport(file, specifier);
        if (resolved) queue.push(resolved);
      }
    }
  }
  return referenced;
}

/** .vue 拆成 <script> 与 <script setup>；模板里的表达式也可能直接写命令名，一并按字面量查 */
function codeUnits(file) {
  const source = fs.readFileSync(file, 'utf8');
  if (path.extname(file) !== '.vue') return [{ fileName: file, code: source }];

  const { descriptor, errors } = parseSfc(source, { filename: file });
  if (errors.length > 0) failures.push(`${rel(file)}：SFC 解析失败（${errors[0].message}）`);
  const units = [];
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue;
    // <script src="./x.ts">：内容在外部文件里，当成一次 import 交给后面的引用追踪
    units.push({ fileName: `${file}.ts`, code: block.src ? `import '${block.src}';` : block.content });
  }
  if (descriptor.template) {
    // 模板表达式不是完整的 TS 文件，只抽带引号的字面量给命令名比对
    const literals = [...descriptor.template.content.matchAll(/'([a-z][a-z0-9_]*)'|"([a-z][a-z0-9_]*)"/g)]
      .map((m) => `'${m[1] ?? m[2]}';`)
      .join('\n');
    units.push({ fileName: `${file}.template.ts`, code: literals });
  }
  return units;
}

function scanUnit(code, fileName) {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];
  const strings = [];
  const globs = [];
  let opaqueImports = 0;

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return; // import 语句里的字符串只有模块路径，不往下看
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (first && ts.isStringLiteralLike(first)) specifiers.push(first.text);
        else opaqueImports += 1;
      }
      if (
        ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'glob'
        && ts.isMetaProperty(node.expression.expression)
      ) {
        const patterns = first && ts.isArrayLiteralExpression(first) ? first.elements : [first];
        for (const pattern of patterns) {
          if (pattern && ts.isStringLiteralLike(pattern)) globs.push(pattern.text);
        }
      }
    }
    if (ts.isStringLiteralLike(node)) strings.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { specifiers, strings, globs, opaqueImports };
}

function resolveImport(fromFile, specifier) {
  const bare = specifier.split('?')[0];
  let base;
  if (bare.startsWith('@/')) base = path.join(root, 'src', bare.slice(2));
  else if (bare.startsWith('.')) base = path.resolve(path.dirname(fromFile), bare);
  else return null; // npm 包：不含本应用的命令名

  if (ASSET_EXTENSIONS.has(path.extname(bare))) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.vue`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.ts'), path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  failures.push(`${rel(fromFile)} 引用的 '${specifier}' 找不到对应文件——引用关系断了，本脚本没法往下查`);
  return null;
}

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function rel(file) {
  return path.relative(root, file);
}
