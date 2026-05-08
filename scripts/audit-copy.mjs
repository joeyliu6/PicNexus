import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const defaultRoots = ['src', 'login-webview.html', 'login-titlebar.html', 'tray-menu.html', 'index.html'];
const productionExtensions = new Set(['.vue', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.html']);
const skippedDirs = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report']);
const copyRegistryFiles = new Set([
  'src/constants/uiCopy.ts',
  'src/constants/toastMessages.ts',
]);
const hanPattern = /[\u3400-\u9fff]/;
const quotePattern = /(['"`])((?:\\.|(?!\1)[\s\S])*?[\u3400-\u9fff](?:\\.|(?!\1)[\s\S])*?)\1/g;

const args = parseArgs(process.argv.slice(2));
const files = collectFiles(args.roots.length > 0 ? args.roots : defaultRoots);
const records = [];

for (const file of files) {
  const relativeFile = toPosix(path.relative(root, file));
  if (!args.includeRegistry && copyRegistryFiles.has(relativeFile)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const sanitized = stripComments(source);
  const sourceLines = source.split(/\r?\n/);

  sanitized.split(/\r?\n/).forEach((line, index) => {
    if (!hanPattern.test(line)) return;
    const lineNumber = index + 1;
    const originalLine = sourceLines[index] ?? line;
    if (isLogLine(originalLine)) return;
    const pieces = extractCopyPieces(line);

    for (const copy of pieces) {
      records.push({
        copyId: createCopyId(relativeFile, lineNumber, records.length + 1),
        surface: classifySurface(relativeFile, originalLine),
        module: classifyModule(relativeFile),
        file: relativeFile,
        line: lineNumber,
        currentCopy: copy,
        issue: '',
        proposedCopy: '',
        priority: defaultPriority(relativeFile, originalLine),
        status: 'todo',
      });
    }
  });
}

const report = buildReport(records, files.length);
if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(toMarkdown(report));
}

function parseArgs(argv) {
  const options = {
    includeRegistry: false,
    json: false,
    roots: [],
  };

  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--markdown') options.json = false;
    else if (arg === '--include-registry') options.includeRegistry = true;
    else options.roots.push(arg);
  }

  return options;
}

function collectFiles(inputRoots) {
  const result = [];
  for (const input of inputRoots) {
    const absolute = path.resolve(root, input);
    if (!fs.existsSync(absolute)) continue;
    const stats = fs.statSync(absolute);
    if (stats.isDirectory()) {
      walk(absolute, result);
    } else if (isProductionSource(absolute)) {
      result.push(absolute);
    }
  }
  return [...new Set(result)].sort();
}

function walk(directory, result) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skippedDirs.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, result);
    } else if (isProductionSource(fullPath)) {
      result.push(fullPath);
    }
  }
}

function isProductionSource(file) {
  if (!productionExtensions.has(path.extname(file))) return false;
  const normalized = toPosix(path.relative(root, file));
  if (/(^|\/)(test|tests|__tests__)(\/|$)/.test(normalized)) return false;
  if (/(^|\/).*\.spec\.[^/]+$/.test(normalized)) return false;
  if (/(^|\/).*\.test\.[^/]+$/.test(normalized)) return false;
  if (normalized.includes('-snapshots/')) return false;
  return true;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((line) => {
      if (line.trimStart().startsWith('//')) return '';
      return stripLineCommentOutsideStrings(line);
    })
    .join('\n');
}

function stripLineCommentOutsideStrings(line) {
  let quote = '';
  let escaped = false;

  for (let index = 0; index < line.length - 1; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '/' && next === '/') {
      return line.slice(0, index);
    }
  }

  return line;
}

function extractCopyPieces(line) {
  const pieces = [];
  quotePattern.lastIndex = 0;

  let match;
  while ((match = quotePattern.exec(line)) !== null) {
    const normalized = normalizeCopy(match[2]);
    if (normalized) pieces.push(normalized);
  }

  if (pieces.length > 0) return dedupe(pieces);

  const visibleText = normalizeCopy(
    line
      .replace(/<[^>]*>/g, ' ')
      .replace(/\{\{[^}]+\}\}/g, '${...}')
  );

  return visibleText ? [visibleText] : [];
}

function normalizeCopy(value) {
  return value
    .replace(/\$\{[^}]+\}/g, '${...}')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifySurface(file, line) {
  const trimmed = line.trim();
  if (/toast\.|TOAST_MESSAGES|summary\s*:|detail\s*:/.test(trimmed)) return 'toast';
  if (/confirm|showConfirm|acceptLabel|rejectLabel|ConfirmDialog|message\s*:/.test(trimmed)) return 'confirm';
  if (/Dialog|dialog|modal/i.test(file) || /<Dialog|header=/.test(trimmed)) return 'dialog';
  if (/placeholder\s*=|:placeholder\s*=/.test(trimmed)) return 'placeholder';
  if (/aria-label\s*=|:aria-label\s*=/.test(trimmed)) return 'aria';
  if (/v-tooltip|tooltip|title\s*=|:title\s*=/.test(trimmed)) return 'tooltip';
  if (/throw new Error|new Error\(|error\s*:/.test(trimmed)) return 'error';
  if (file.endsWith('.vue')) return 'visible-ui';
  if (file.includes('/composables/') || file.includes('/services/') || file.includes('/utils/') || file.includes('/uploaders/')) return 'logic';
  return 'other';
}

function isLogLine(line) {
  return /\b(?:log|logger)\.(?:debug|info|warn|error)\s*\(|\bconsole\.(?:debug|info|warn|error|log)\s*\(/.test(line);
}

function classifyModule(file) {
  if (file.includes('/settings/')) return 'settings';
  if (file.includes('/upload') || file.includes('/uploaders/')) return 'upload';
  if (file.includes('/history/')) return 'history';
  if (file.includes('/linkcheck/') || file.includes('/link-check/')) return 'link-check';
  if (file.includes('/backup-sync/') || file.includes('/backup/')) return 'backup-sync';
  if (file.includes('/dialogs/')) return 'dialog';
  if (file.includes('/layout/')) return 'layout';
  return file.split('/').slice(0, 2).join('/');
}

function defaultPriority(file, line) {
  if (/confirm|acceptLabel|rejectLabel|throw new Error|toast\.error|summary\s*:/.test(line)) return 'P1';
  if (file.includes('/views/') || file.includes('/settings/') || file.includes('/dialogs/')) return 'P2';
  return 'P3';
}

function buildReport(copyRecords, scannedFiles) {
  const bySurface = countBy(copyRecords, (record) => record.surface);
  const byModule = countBy(copyRecords, (record) => record.module);
  const byFile = countBy(copyRecords, (record) => record.file);

  return {
    generatedAt: new Date().toISOString(),
    scannedFiles,
    filesWithCopy: new Set(copyRecords.map((record) => record.file)).size,
    totalCopies: copyRecords.length,
    bySurface,
    byModule,
    topFiles: Object.entries(byFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([file, count]) => ({ file, count })),
    records: copyRecords,
  };
}

function toMarkdown(report) {
  const lines = [
    '# PicNexus 文案审计清单',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 扫描文件：${report.scannedFiles}`,
    `- 含文案文件：${report.filesWithCopy}`,
    `- 文案片段：${report.totalCopies}`,
    '',
    '## Surface Summary',
    '',
    '| Surface | Count |',
    '|---|---:|',
    ...Object.entries(report.bySurface).map(([surface, count]) => `| ${surface} | ${count} |`),
    '',
    '## Module Summary',
    '',
    '| Module | Count |',
    '|---|---:|',
    ...Object.entries(report.byModule).map(([module, count]) => `| ${module} | ${count} |`),
    '',
    '## Top Files',
    '',
    '| File | Count |',
    '|---|---:|',
    ...report.topFiles.map((item) => `| ${item.file} | ${item.count} |`),
    '',
    '## Inventory',
    '',
    '| copyId | surface | module | file | currentCopy | issue | proposedCopy | priority | status |',
    '|---|---|---|---|---|---|---|---|---|',
    ...report.records.map((record) => [
      record.copyId,
      record.surface,
      record.module,
      `${record.file}:${record.line}`,
      escapeCell(record.currentCopy),
      record.issue,
      record.proposedCopy,
      record.priority,
      record.status,
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function countBy(items, getKey) {
  const result = {};
  for (const item of items) {
    const key = getKey(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1]));
}

function createCopyId(file, lineNumber, index) {
  const base = file
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '')
    .toLowerCase();
  return `${base}.l${lineNumber}.${String(index).padStart(4, '0')}`;
}

function escapeCell(value) {
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function dedupe(values) {
  return [...new Set(values)];
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}
