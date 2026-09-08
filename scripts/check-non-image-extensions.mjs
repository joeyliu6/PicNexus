/**
 * NON_IMAGE_EXTENSIONS 跨语言一致性检查
 *
 * 图片扩展名黑名单在两处各写一份：文件夹模式走 Rust（md_scanner.rs），
 * 单文件/拖放走 JS（mdParser.ts）。当前逐条一致，但没有任何东西守着这份一致性——
 * 改一边漏改另一边，folder 扫描和拖放扫描会静默给出不同结果，没有报错也没有测试会红。
 *
 * 这不适合放进 check-cross-language-constants.mjs（那个脚本只比对"必须逐字一致的
 * 字符串字面量"，见其文件头注释），这里比的是集合，用正则各自抽出扩展名列表后按
 * Set 比较。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const JS_FILE = 'src/utils/mdParser.ts';
const RUST_FILE = 'src-tauri/src/commands/md_scanner.rs';

function extractSet(filePath, blockPattern, itemPattern, label) {
  const fullPath = path.join(root, filePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`${label}: 文件不存在 ${filePath}（文件被移动或改名了？顺手更新 scripts/check-non-image-extensions.mjs）`);
    return null;
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const blockMatch = blockPattern.exec(content);
  if (!blockMatch) {
    failures.push(`${label}: 在 ${filePath} 里找不到 NON_IMAGE_EXTENSIONS 定义（改名了、还是换了写法？）`);
    return null;
  }

  const items = [...blockMatch[1].matchAll(itemPattern)].map((m) => m[1]);
  if (items.length === 0) {
    failures.push(`${label}: 在 ${filePath} 里解析到 0 个扩展名，正则可能没跟上写法变化`);
    return null;
  }

  return new Set(items);
}

const jsSet = extractSet(
  JS_FILE,
  /NON_IMAGE_EXTENSIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
  /'([a-z0-9]+)'/g,
  'JS',
);

const rustSet = extractSet(
  RUST_FILE,
  /NON_IMAGE_EXTENSIONS\s*:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/,
  /"([a-z0-9]+)"/g,
  'Rust',
);

if (jsSet && rustSet) {
  const onlyInJs = [...jsSet].filter((ext) => !rustSet.has(ext));
  const onlyInRust = [...rustSet].filter((ext) => !jsSet.has(ext));

  if (onlyInJs.length > 0 || onlyInRust.length > 0) {
    failures.push(
      `NON_IMAGE_EXTENSIONS: ${JS_FILE} 与 ${RUST_FILE} 的黑名单不一致\n`
      + (onlyInJs.length > 0 ? `    只在 JS 里: ${onlyInJs.join(', ')}\n` : '')
      + (onlyInRust.length > 0 ? `    只在 Rust 里: ${onlyInRust.join(', ')}\n` : '')
      + '    文件夹扫描（Rust）与单文件/拖放扫描（JS）会对同一个 URL 给出不同的"是不是图片"判断',
    );
  }
}

if (failures.length > 0) {
  console.error('NON_IMAGE_EXTENSIONS 一致性检查失败:\n' + failures.join('\n'));
  process.exit(1);
}

console.log(`✅ NON_IMAGE_EXTENSIONS 一致性检查通过（${jsSet?.size ?? 0} 个扩展名，两侧一致）`);
