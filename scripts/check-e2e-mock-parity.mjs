/**
 * E2E mock 导出完整性检查
 *
 * `tests/e2e/vite.config.ts` 用 alias 把整个 `@tauri-apps/*` 模块替换成 `tests/e2e/mocks/*.ts`。
 * mock 的导出清单是**手写**的：真模块有几十个导出，mock 只挑用得到的写。
 * 于是 src 里第一次用上某个以前没用过的导出时，mock 里就少了这个名字。
 *
 * 这类漏写的后果远比"某个功能坏掉"严重。Vite 开发模式跑的是原生 ES 模块，
 * 缺失的具名导出在**链接阶段**就抛错（`does not provide an export named 'x'`），
 * 在此之前没有任何一行代码被执行过——只要那个模块挂在从 main.ts 出发的静态导入链上，
 * 整个应用直接白屏，所有 E2E 用例齐刷刷卡在"等主界面出现"这一步。
 *
 * 真实案例：`7fb363c` 新建的 `mdTextIo.ts` 用了 `readFile`，而 `mocks/fs.ts` 没有它。
 * mdTextIo 挂在 MainLayout → LinkCheckView → MdRescueInline → useFileBackup 这条静态链上，
 * 于是 8 条 smoke 用例全红，且连续 5 次 push 无人察觉。
 *
 * 为什么其他门禁一个都拦不住：
 *   - `npm run build` 用的是**真**模块，真模块有 `readFile`，构建照样绿；
 *   - `npm run typecheck` 的 tsconfig `include` 只有 `["src"]`，`tests/` 不在检查范围；
 *   - 单元测试用的是另一套 mock（`tests/unit/helpers/tauriMock.ts`），那次改对了；
 *   - `pre-push` 门禁不跑 E2E——唯一能发现它的检查，恰好是唯一不在推送前跑的那个。
 * 本脚本把这条约定变成推送前的硬门禁。
 *
 * ── 检查什么 ──
 * src 里对被 alias 的模块做的每一个具名/默认导入，对应 mock 文件是否真的导出了这个名字。
 *
 * ── 检查不到什么（脚本结尾会明着打印出来，别把"全绿"当成"全覆盖"）──
 *   1. 只保证"点名点得通"，不保证 mock 的**行为**对（参数、返回类型都不核对）；
 *   2. 命名空间导入 `import * as ns` 的成员用法、以及动态 `import()` 里的解构，静态分析拿不到；
 *   3. 只扫 `src/`，测试自己直接导入 mock 的写法不在范围内。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const skipped = [];

const viteConfigPath = path.join(root, 'tests', 'e2e', 'vite.config.ts');
const mocksDir = path.join(root, 'tests', 'e2e', 'mocks');

const aliases = collectAliases();
const mockExports = new Map();
for (const mockName of new Set(aliases.values())) {
  mockExports.set(mockName, collectMockExports(mockName));
}

checkSourceImports();

if (skipped.length > 0) {
  console.log(
    `E2E mock 导出检查：${aliases.size} 个 alias 已核对，`
    + `另有 ${skipped.length} 处导入无法静态核对：\n`
    + skipped.map(entry => `    ${entry.location}  ${entry.reason}`).join('\n'),
  );
}

if (failures.length > 0) {
  console.error('E2E mock export parity check failed:\n' + failures.join('\n'));
  process.exit(1);
}

// ───────────────────────── alias 表 ─────────────────────────

/**
 * 从 vite.config.ts 里读 `'@tauri-apps/plugin-fs': mock('fs')` 这样的条目。
 * 解析不到就直接失败——config 一改写法，静默返回空表等于悄悄关掉整个门禁。
 */
function collectAliases() {
  if (!fs.existsSync(viteConfigPath)) {
    console.error(`E2E mock export parity check failed:\n${path.relative(root, viteConfigPath)} 不存在（路径变了？请更新 scripts/check-e2e-mock-parity.mjs）`);
    process.exit(1);
  }

  const source = fs.readFileSync(viteConfigPath, 'utf8');
  const masked = maskLiteralsAndComments(source);
  const table = new Map();

  // 掩码后字符串内容变空格，模块名要按捕获组偏移回原文取（d 标志给出每组的 [start, end)）
  const pattern = /(['"])(\s*)\1\s*:\s*mock\((['"])(\s*)\3\)/dg;
  let match;
  while ((match = pattern.exec(masked)) !== null) {
    const moduleName = sliceGroup(source, match, 2);
    const mockName = sliceGroup(source, match, 4);
    table.set(moduleName, mockName);
  }

  // config 里出现了 mock(...) 却没被解析进表里，说明写法变了，不能当成"没有 alias"
  const declared = (masked.match(/\bmock\(/g) ?? []).length;
  if (table.size === 0 || table.size !== declared) {
    console.error(
      'E2E mock export parity check failed:\n'
      + `${path.relative(root, viteConfigPath)}: alias 表解析不完整`
      + `（找到 ${declared} 处 mock(...)，只解析出 ${table.size} 条）\n`
      + '    写法变了就请同步更新 scripts/check-e2e-mock-parity.mjs，别让门禁静默失效',
    );
    process.exit(1);
  }

  return table;
}

// ───────────────────────── mock 侧：收集导出名 ─────────────────────────

/** 值导出与类型导出合成一个集合：类型只在类型位置使用时会被 esbuild 直接擦掉，不构成链接错误 */
function collectMockExports(mockName) {
  const file = path.join(mocksDir, `${mockName}.ts`);
  if (!fs.existsSync(file)) {
    failures.push(`${path.relative(root, viteConfigPath)}: alias 指向了不存在的 mock 文件 ${path.relative(root, file)}`);
    return new Set();
  }

  const source = fs.readFileSync(file, 'utf8');
  const masked = maskLiteralsAndComments(source);
  const names = new Set();

  const declaration = /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of masked.matchAll(declaration)) names.add(match[1]);

  // `export { a, b as c }`：对外可见的是重命名后的名字
  const listed = /^\s*export\s+(?:type\s+)?\{([^}]*)\}/gm;
  for (const match of masked.matchAll(listed)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }

  if (/^\s*export\s+default\b/m.test(masked)) names.add('default');

  return names;
}

// ───────────────────────── src 侧：核对导入名 ─────────────────────────

function checkSourceImports() {
  const base = path.join(root, 'src');
  if (!fs.existsSync(base)) return;

  const extensions = new Set(['.ts', '.vue']);
  for (const file of walk(base)) {
    if (!extensions.has(path.extname(file))) continue;

    const source = fs.readFileSync(file, 'utf8');
    const masked = maskLiteralsAndComments(source);

    // 子句里不允许出现 `;` 和引号，避免把 `import './a.css'` 之后的下一条导入误并进来
    const pattern = /\b(?:import|export)\b([^;'"`]*?)(?<![.\w$])from\s*(['"])(\s*)\2/dg;

    let match;
    while ((match = pattern.exec(masked)) !== null) {
      const moduleName = sliceGroup(source, match, 3);
      const mockName = aliases.get(moduleName);
      if (!mockName) continue;

      const location = `${path.relative(root, file)}:${lineOf(source, match.index)}`;
      verifyClause({ clause: match[1], moduleName, mockName, location });
    }
  }
}

function verifyClause({ clause, moduleName, mockName, location }) {
  const exported = mockExports.get(mockName) ?? new Set();
  const braced = /\{([\s\S]*)\}/.exec(clause);
  const wanted = [];

  // 显式标注 type 的导入（`import type { X }` 或内联 `{ type X }`）会被 esbuild 整条擦掉，
  // 编译产物里压根没有这个导入，因此不可能触发链接错误——mock 没有它也无所谓。
  const typeOnlyClause = /^\s*type\s/.test(clause);

  if (braced) {
    for (const part of braced[1].split(',')) {
      const entry = part.trim();
      if (!entry) continue;
      if (typeOnlyClause || /^type\s/.test(entry)) continue;
      const name = entry.split(/\s+as\s+/)[0].trim();
      if (name) wanted.push(name);
    }
  }

  const bare = clause.replace(/\{[\s\S]*\}/, '').replace(/^\s*type\s+/, '').replace(/,/g, ' ').trim();
  if (bare.startsWith('*')) {
    skipped.push({ location, reason: `命名空间导入 ${moduleName}，成员用法查不了` });
  } else if (bare && !typeOnlyClause) {
    wanted.push('default');
  }

  for (const name of wanted) {
    if (exported.has(name)) continue;
    failures.push(
      `${location}: 从 "${moduleName}" 导入了 "${name}"，`
      + `但 tests/e2e/mocks/${mockName}.ts 没有导出它\n`
      + '    E2E 里这个模块被 alias 成该 mock，缺具名导出会在链接阶段整条模块图报废——\n'
      + '    只要它挂在 main.ts 的静态导入链上，应用直接白屏，全部 E2E 用例一起失败\n'
      + `    修法：在 tests/e2e/mocks/${mockName}.ts 里补一个 "${name}" 的假实现`,
    );
  }
}

// ───────────────────────── 通用扫描工具 ─────────────────────────

/**
 * 把注释与字符串**内容**替换成等长空格（保留定界符与所有位置偏移），
 * 这样后续的正则匹配不会被注释里的 import 或字符串里的引号带偏。
 */
function maskLiteralsAndComments(source) {
  const chars = source.split('');
  const blank = index => {
    if (chars[index] !== '\n') chars[index] = ' ';
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') blank(i++);
      continue;
    }

    if (char === '/' && next === '*') {
      blank(i++);
      blank(i++);
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) blank(i++);
      if (i < source.length) { blank(i++); blank(i++); }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { blank(i++); if (i < source.length) blank(i++); continue; }
        blank(i++);
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return chars.join('');
}

/** 按捕获组在掩码文本里的偏移，回原文取真实内容（掩码是等长替换，偏移通用） */
function sliceGroup(source, match, group) {
  const span = match.indices?.[group];
  if (!span) return '';
  return source.slice(span[0], span[1]);
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}
