#!/usr/bin/env node
/**
 * 批量修复 stylelint 硬编码值 → CSS 变量
 * 一次性工具，修复后删除
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative } from 'path';

// ── Token 映射表 ──────────────────────────────

const SPACING = {
  '2px': 'var(--space-2xs)', '3px': 'var(--space-2xs)',
  '4px': 'var(--space-xs)', '5px': 'var(--space-xs)',
  '6px': 'var(--space-xs-sm)', '8px': 'var(--space-sm)',
  '10px': 'var(--space-sm-md)', '12px': 'var(--space-md)',
  '14px': 'var(--space-md-lg)', '16px': 'var(--space-lg)',
  '18px': 'var(--space-lg)', '20px': 'var(--space-lg-xl)',
  '24px': 'var(--space-xl)', '28px': 'var(--space-xl)',
  '32px': 'var(--space-2xl)', '36px': 'var(--space-2xl)',
  '40px': 'var(--space-3xl)', '48px': 'var(--space-4xl)',
  '60px': 'var(--space-5xl)',
};

const RADIUS = {
  '2px': 'var(--radius-xs)', '3px': 'var(--radius-xs-sm)',
  '4px': 'var(--radius-sm)', '5px': 'var(--radius-sm)',
  '6px': 'var(--radius-sm-md)', '8px': 'var(--radius-md)',
  '10px': 'var(--radius-md)', '12px': 'var(--radius-lg)',
  '16px': 'var(--radius-xl)', '20px': 'var(--radius-2xl)',
  '24px': 'var(--radius-3xl)',
};

const DURATION = {
  '0.1s': 'var(--duration-micro)', '100ms': 'var(--duration-micro)',
  '0.12s': 'var(--duration-fast)', '120ms': 'var(--duration-fast)',
  '0.15s': 'var(--duration-fast)', '150ms': 'var(--duration-fast)',
  '0.2s': 'var(--duration-normal)', '200ms': 'var(--duration-normal)',
  '0.25s': 'var(--duration-normal)', '250ms': 'var(--duration-normal)',
  '0.3s': 'var(--duration-medium)', '300ms': 'var(--duration-medium)',
  '0.35s': 'var(--duration-slow)', '350ms': 'var(--duration-slow)',
  '0.4s': 'var(--duration-slow)', '400ms': 'var(--duration-slow)',
  '0.5s': 'var(--duration-slower)', '500ms': 'var(--duration-slower)',
};

const SPACING_PROPS = /^(margin|padding|gap|row-gap|column-gap)/;
const RADIUS_PROPS = /border.*radius/;
const ANIM_PROPS = /^(transition|animation)$/;

// ── 收集所有目标文件 ──────────────────────

function collectFiles(dir, exts) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

// ── 对单个文件获取 lint 错误 ──────────────

function getLintErrors(filePath) {
  let stdout = '';
  try {
    stdout = execSync(`npx stylelint "${filePath}" --formatter json`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    stdout = e.stdout || e.stderr || '';
  }
  if (!stdout) return [];
  try {
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

// ── 替换一行 ──────────────────

function fixLine(line, prop) {
  const isSpacing = SPACING_PROPS.test(prop);
  const isRadius = RADIUS_PROPS.test(prop);
  const isAnim = ANIM_PROPS.test(prop);

  if (isSpacing || isRadius) {
    const map = isSpacing ? SPACING : RADIUS;
    return line.replace(/\b(\d+(?:\.\d+)?)px\b/g, (match, num) => {
      const key = `${num}px`;
      if (key === '1px' || key === '0px') return match === '0px' ? '0' : match;
      return map[key] || match;
    });
  }

  if (isAnim) {
    let result = line;
    result = result.replace(/\b(\d+)ms\b/g, (m) => DURATION[m] || m);
    result = result.replace(/\b(\d+\.\d+)s\b/g, (m) => DURATION[m] || m);
    return result;
  }

  return line;
}

// ── 主流程 ──────────────────────────────────

const srcDir = join(process.cwd(), 'src');
const allFiles = collectFiles(srcDir, ['.css', '.vue']);
let totalFixed = 0;
let filesFixed = 0;

console.log(`扫描 ${allFiles.length} 个文件...`);

for (const filePath of allFiles) {
  const results = getLintErrors(filePath);
  const fileResult = results[0];
  if (!fileResult?.warnings?.length) continue;

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let fileFixed = 0;

  const errorsByLine = new Map();
  for (const w of fileResult.warnings) {
    if (w.rule !== 'declaration-property-value-disallowed-list') continue;
    const lineIdx = w.line - 1;
    if (!errorsByLine.has(lineIdx)) errorsByLine.set(lineIdx, []);
    errorsByLine.get(lineIdx).push(w);
  }

  for (const [lineIdx] of errorsByLine) {
    const originalLine = lines[lineIdx];
    if (!originalLine) continue;
    if (lineIdx > 0 && lines[lineIdx - 1]?.includes('stylelint-disable')) continue;

    const propMatch = originalLine.match(/^\s*([\w-]+)\s*:/);
    if (!propMatch) continue;

    const newLine = fixLine(originalLine, propMatch[1]);
    if (newLine !== originalLine) {
      lines[lineIdx] = newLine;
      fileFixed++;
    }
  }

  if (fileFixed > 0) {
    writeFileSync(filePath, lines.join('\n'), 'utf-8');
    totalFixed += fileFixed;
    filesFixed++;
    const short = relative(process.cwd(), filePath).replace(/\\/g, '/');
    console.log(`  ✓ ${short} — ${fileFixed} 行`);
  }
}

console.log(`\n完成：${filesFixed} 文件 / ${totalFixed} 行已修复`);
