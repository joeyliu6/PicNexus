/**
 * Tauri invoke 参数名一致性检查
 *
 * Rust 侧 `#[tauri::command] fn get_image_metadata(file_path: String)` 的参数名，
 * 到了 JS 侧必须写成 camelCase 的 `filePath`——这是 Tauri 默认的 rename 规则。
 * 名字一旦对不上，Tauri 在反序列化阶段就直接拒收，命令**根本没被调用**。
 *
 * 这类笔误有三个特别恶心的性质：
 *   1. TypeScript 拦不住——invoke 的第二参数类型是 `InvokeArgs`（任意对象），键名爱写啥写啥；
 *   2. 单元测试通常也拦不住——mock 一般只对命令名分支，不校验参数对象；
 *   3. 失败发生在运行时的 IPC 边界上，报错文案是 Rust 抛的反序列化错误，
 *      用户看到的是一句读不懂的英文，而开发者只有在真机点到那条路径时才会发现。
 *
 * 真实案例：`useCompressionTask.ts` 里把 `{ filePath }` 写成了 `{ path: filePath }`，
 * 导致"压缩预览 + 缩放"这条路径必炸，一直活到被人工审查逮住为止。本脚本把这条约定变成硬门禁。
 *
 * ── 检查什么 ──
 *   1. JS 传了 Rust 签名里不存在的键
 *   2. Rust 的必填参数（非 Option<T>）在 JS 侧缺失
 *   3. invoke 的命令名在 Rust 侧压根不存在
 *
 * ── 检查不到什么（脚本结尾会明着打印出来，别把"全绿"当成"全覆盖"）──
 * 第二参数不是对象字面量（是变量）、或字面量里含展开 `...args` / 计算键 `[k]:` 的调用，
 * 静态分析无法核对，只能靠测试和真机覆盖。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const skipped = [];

/**
 * Tauri 会自行注入这些参数，前端不需要（也不能）传。
 * 依据仓库实测签名：AppHandle / AppHandle<R> / tauri::AppHandle / Window / State<'_, T> 等。
 */
const INJECTED_TYPES = new Set(['AppHandle', 'Window', 'WebviewWindow', 'Webview', 'State']);

const rustCommands = collectRustCommands();
checkFrontendInvocations();

if (skipped.length > 0) {
  console.log(
    `invoke 参数检查：${rustCommands.size} 个命令已核对，`
    + `另有 ${skipped.length} 处调用无法静态核对（参数非字面量/含展开或计算键）：\n`
    + skipped.map(entry => `    ${entry.location}  ${entry.reason}`).join('\n'),
  );
}

if (failures.length > 0) {
  console.error('Tauri invoke argument check failed:\n' + failures.join('\n'));
  process.exit(1);
}

// ───────────────────────── Rust 侧：解析命令签名 ─────────────────────────

function collectRustCommands() {
  const commands = new Map();
  const base = path.join(root, 'src-tauri', 'src');
  if (!fs.existsSync(base)) return commands;

  for (const file of walk(base)) {
    if (path.extname(file) !== '.rs') continue;

    const source = fs.readFileSync(file, 'utf8');
    const masked = maskLiteralsAndComments(source, 'rust');
    const attrPattern = /#\[tauri::command(\s*\([^)]*\))?\s*\]/g;

    let attrMatch;
    while ((attrMatch = attrPattern.exec(masked)) !== null) {
      const renameRule = readRenameRule(source.slice(attrMatch.index, attrMatch.index + attrMatch[0].length));
      const parsed = parseFnAfter(masked, attrPattern.lastIndex);
      if (!parsed) {
        failures.push(
          `${path.relative(root, file)}:${lineOf(source, attrMatch.index)}: `
          + '找到 #[tauri::command] 但没能解析紧随其后的 fn 签名（写法变了？请更新 scripts/check-invoke-args.mjs）',
        );
        continue;
      }

      commands.set(parsed.name, {
        params: parseRustParams(source.slice(parsed.paramsStart, parsed.paramsEnd), renameRule),
        location: `${path.relative(root, file)}:${lineOf(source, parsed.nameIndex)}`,
      });
    }
  }

  return commands;
}

/** `#[tauri::command(rename_all = "snake_case")]` → 'snake_case'；默认 camelCase */
function readRenameRule(attrText) {
  const match = /rename_all\s*=\s*"([^"]+)"/.exec(attrText);
  return match ? match[1] : 'camelCase';
}

/** 从属性结束处向后找 `pub? async? fn name<..>(..)`，中间只允许空白与其他属性 */
function parseFnAfter(masked, from) {
  let cursor = from;

  for (;;) {
    while (cursor < masked.length && /\s/.test(masked[cursor])) cursor += 1;
    // 命令上还可能叠加 #[allow(..)] 之类的属性，跳过它们继续找 fn
    if (masked[cursor] === '#' && masked[cursor + 1] === '[') {
      const attrEnd = matchBracket(masked, cursor + 1, '[', ']');
      if (attrEnd === -1) return null;
      cursor = attrEnd + 1;
      continue;
    }
    break;
  }

  const header = /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/.exec(
    masked.slice(cursor),
  );
  if (!header) return null;

  const nameIndex = cursor + header[0].lastIndexOf(header[1]);
  let afterName = cursor + header[0].length;

  // 跳过泛型参数，如 allow_user_path<R: Runtime>
  while (afterName < masked.length && /\s/.test(masked[afterName])) afterName += 1;
  if (masked[afterName] === '<') {
    const genericsEnd = matchAngle(masked, afterName);
    if (genericsEnd === -1) return null;
    afterName = genericsEnd + 1;
    while (afterName < masked.length && /\s/.test(masked[afterName])) afterName += 1;
  }

  if (masked[afterName] !== '(') return null;
  const paramsEnd = matchBracket(masked, afterName, '(', ')');
  if (paramsEnd === -1) return null;

  return { name: header[1], nameIndex, paramsStart: afterName + 1, paramsEnd };
}

function parseRustParams(paramsText, renameRule) {
  const params = [];

  for (const raw of splitTopLevel(paramsText, true)) {
    const param = raw.trim();
    if (!param || param.startsWith('#')) continue;

    const colon = indexOfTopLevelColon(param);
    if (colon === -1) continue; // self / 解析不出来的写法，跳过

    const name = param.slice(0, colon).replace(/\bmut\b/g, '').trim();
    const type = param.slice(colon + 1).trim();
    if (!/^[A-Za-z_]\w*$/.test(name)) continue;
    if (isInjectedType(type)) continue;

    params.push({
      jsName: renameRule === 'camelCase' ? toCamelCase(name) : name,
      optional: /^(?:std::|core::)?option::Option\s*</.test(type) || /^Option\s*</.test(type),
    });
  }

  return params;
}

function isInjectedType(type) {
  const bare = type.replace(/^&\s*(?:mut\s+)?/, '').trim();
  const withoutGenerics = bare.split('<')[0].trim();
  const lastSegment = withoutGenerics.split('::').pop().trim();
  return INJECTED_TYPES.has(lastSegment);
}

function toCamelCase(name) {
  return name.replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

// ───────────────────────── 前端侧：解析 invoke 调用 ─────────────────────────

function checkFrontendInvocations() {
  const base = path.join(root, 'src');
  if (!fs.existsSync(base)) return;

  for (const file of walk(base)) {
    if (!new Set(['.ts', '.vue']).has(path.extname(file))) continue;

    const source = fs.readFileSync(file, 'utf8');
    const masked = maskLiteralsAndComments(source, 'js');
    const callPattern = /\binvoke\s*(?=[<(])/g;

    let callMatch;
    while ((callMatch = callPattern.exec(masked)) !== null) {
      const before = masked[callMatch.index - 1];
      if (before && /[.\w$]/.test(before)) continue; // foo.invoke / myinvoke

      const call = parseInvokeCall(masked, callPattern.lastIndex);
      if (!call) continue;

      callPattern.lastIndex = call.end;
      verifyInvokeCall({ file, source, masked, call });
    }
  }
}

function parseInvokeCall(masked, from) {
  let cursor = from;
  while (cursor < masked.length && /\s/.test(masked[cursor])) cursor += 1;

  if (masked[cursor] === '<') {
    const genericsEnd = matchAngle(masked, cursor);
    if (genericsEnd === -1) return null;
    cursor = genericsEnd + 1;
    while (cursor < masked.length && /\s/.test(masked[cursor])) cursor += 1;
  }

  if (masked[cursor] !== '(') return null;
  const end = matchBracket(masked, cursor, '(', ')');
  if (end === -1) return null;

  return { argsStart: cursor + 1, argsEnd: end, end: end + 1 };
}

function verifyInvokeCall({ file, source, masked, call }) {
  const location = `${path.relative(root, file)}:${lineOf(source, call.argsStart)}`;
  // 尾随逗号会切出一个空段（`invoke(\n  'cmd',\n  { ... },\n)`），不能算成第三个参数
  const args = splitTopLevel(masked.slice(call.argsStart, call.argsEnd), false)
    .filter(part => part.trim() !== '');

  const commandArg = (args[0] ?? '').trim();
  if (!/^['"]/.test(commandArg)) {
    skipped.push({ location, reason: '命令名不是字面量' });
    return;
  }

  // 掩码后的字符串内容是空格，要回原文取真实命令名
  const literalStart = call.argsStart + masked.slice(call.argsStart, call.argsEnd).indexOf(commandArg);
  const commandName = source.slice(literalStart + 1, literalStart + commandArg.length - 1);

  // 插件命令形如 `plugin:fs|read`，不由本仓库的 Rust 命令表覆盖
  if (!/^[a-z][a-z0-9_]*$/.test(commandName)) {
    skipped.push({ location, reason: `非本地命令名 "${commandName}"` });
    return;
  }

  const command = rustCommands.get(commandName);
  if (!command) {
    failures.push(`${location}: 调用了不存在的 Tauri 命令 "${commandName}"（改名了、还是漏注册？）`);
    return;
  }

  const argsArg = (args[1] ?? '').trim();
  if (args.length > 2) {
    skipped.push({ location, reason: `"${commandName}" 的调用形态超出预期` });
    return;
  }

  if (!argsArg) {
    report({ location, commandName, command, passed: [] });
    return;
  }

  if (!argsArg.startsWith('{')) {
    skipped.push({ location, reason: `"${commandName}" 的参数不是对象字面量` });
    return;
  }

  const objectStart = call.argsStart + masked.slice(call.argsStart, call.argsEnd).indexOf(argsArg);
  const parsedKeys = parseObjectKeys(masked, objectStart, source);
  if (!parsedKeys.static) {
    skipped.push({ location, reason: `"${commandName}" 的参数含展开或计算键` });
    return;
  }

  report({ location, commandName, command, passed: parsedKeys.keys });
}

/**
 * 一个调用点只出一条报告。参数名写错时"多了个陌生键"和"少了个必填键"其实是同一件事，
 * 分成两条只会让人以为有两个 bug。
 */
function report({ location, commandName, command, passed }) {
  const known = new Set(command.params.map(param => param.jsName));
  const unknown = passed.filter(key => !known.has(key));
  const missing = command.params
    .filter(param => !param.optional && !passed.includes(param.jsName))
    .map(param => param.jsName);

  if (unknown.length === 0 && missing.length === 0) return;

  const problems = [];
  if (unknown.length > 0) problems.push(`多出签名里没有的 ${quoteAll(unknown)}`);
  if (missing.length > 0) problems.push(`缺少必填的 ${quoteAll(missing)}`);

  failures.push(
    `${location}: 命令 "${commandName}" 的参数对不上——${problems.join('，')}\n`
    + '    Tauri 会在反序列化阶段直接拒收，这条命令根本不会执行\n'
    + `    Rust 签名（${command.location}）接受：${formatParams(command)}`,
  );
}

function quoteAll(names) {
  return names.map(name => `"${name}"`).join('、');
}

function formatParams(command) {
  if (command.params.length === 0) return '（无参数）';
  return command.params.map(param => (param.optional ? `${param.jsName}?` : param.jsName)).join('、');
}

/** 解析对象字面量的静态键名；遇到展开/计算键就判定为无法静态核对 */
function parseObjectKeys(masked, objectStart, source) {
  const objectEnd = matchBracket(masked, objectStart, '{', '}');
  if (objectEnd === -1) return { static: false, keys: [] };

  const keys = [];
  for (const raw of splitTopLevel(masked.slice(objectStart + 1, objectEnd), false)) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.startsWith('...') || entry.startsWith('[')) return { static: false, keys: [] };

    const quoted = /^(['"])\s*/.exec(entry);
    if (quoted) {
      // 键名是字符串字面量，掩码后为空格，回原文读
      const offset = objectStart + 1 + masked.slice(objectStart + 1, objectEnd).indexOf(entry);
      const closing = source.indexOf(quoted[1], offset + 1);
      if (closing === -1) return { static: false, keys: [] };
      keys.push(source.slice(offset + 1, closing));
      continue;
    }

    const named = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(entry);
    if (!named) return { static: false, keys: [] };
    keys.push(named[1]);
  }

  return { static: true, keys };
}

// ───────────────────────── 通用扫描工具 ─────────────────────────

/**
 * 把注释与字符串**内容**替换成等长空格（保留定界符与所有位置偏移），
 * 这样后续的括号配对/逗号切分不会被注释里的括号或字符串里的引号带偏。
 */
function maskLiteralsAndComments(source, flavor) {
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

    // Rust 的 r"..." / r#"..."# 原始字符串
    if (flavor === 'rust' && char === 'r' && (next === '"' || next === '#')) {
      const rawMatch = /^r(#*)"/.exec(source.slice(i));
      if (rawMatch) {
        const terminator = `"${rawMatch[1]}`;
        const contentStart = i + rawMatch[0].length;
        const closing = source.indexOf(terminator, contentStart);
        const contentEnd = closing === -1 ? source.length : closing;
        for (let j = contentStart; j < contentEnd; j += 1) blank(j);
        i = closing === -1 ? source.length : closing + terminator.length;
        continue;
      }
    }

    if (char === '"' || char === "'" || (flavor === 'js' && char === '`')) {
      // Rust 的生命周期标注 'a / '_ 不是字符串
      if (flavor === 'rust' && char === "'" && !/^'(?:\\.|[^'\\])'/.test(source.slice(i))) {
        i += 1;
        continue;
      }

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

/** 在掩码文本上按顶层逗号切分；withAngle 用于 Rust（类型里的 `<>` 要计入深度） */
function splitTopLevel(text, withAngle) {
  const parts = [];
  let depth = 0;
  let angle = 0;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (withAngle && char === '<') angle += 1;
    else if (withAngle && char === '>' && text[i - 1] !== '-') angle = Math.max(0, angle - 1);
    else if (char === ',' && depth === 0 && angle === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

/** Rust 参数 `name: Type` 的分隔冒号；要跳过 `::` 和泛型内部 */
function indexOfTopLevelColon(param) {
  let angle = 0;
  for (let i = 0; i < param.length; i += 1) {
    const char = param[i];
    if (char === '<') angle += 1;
    else if (char === '>') angle = Math.max(0, angle - 1);
    else if (char === ':' && angle === 0) {
      if (param[i + 1] === ':') { i += 1; continue; }
      return i;
    }
  }
  return -1;
}

function matchBracket(text, openIndex, open, close) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 配对 `<>`，同时跳过其中的 `()[]{}`，避免把 `=>` 或括号里的比较号算进去 */
function matchAngle(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === '<') depth += 1;
    else if (char === '>') {
      if (text[i - 1] === '=' || text[i - 1] === '-') continue;
      depth -= 1;
      if (depth === 0) return i;
    } else if (char === '(' || char === '[' || char === '{') {
      const closing = matchBracket(text, i, char, { '(': ')', '[': ']', '{': '}' }[char]);
      if (closing === -1) return -1;
      i = closing;
    }
  }
  return -1;
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
