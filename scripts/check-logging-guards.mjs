import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const checks = [
  {
    label: 'app console usage',
    dir: 'src',
    extensions: new Set(['.ts', '.vue']),
    skip: file => file.includes(`${path.sep}test${path.sep}`) || file.endsWith('.spec.ts'),
    patterns: [/console\.(log|warn|error|debug|info)\s*\(/],
  },
  {
    label: 'sidecar console usage',
    dir: 'sidecar',
    extensions: new Set(['.ts']),
    skip: file => file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}dist${path.sep}`),
    patterns: [/console\.(log|warn|error|debug|info)\s*\(/],
  },
  {
    label: 'raw Rust log output',
    dir: path.join('src-tauri', 'src'),
    extensions: new Set(['.rs']),
    skip: () => false,
    patterns: [
      /原始输出/,
      /原始响应/,
      /format!\([^)]*响应:\s*\{\}"\s*,\s*(response_text|output|text)/,
      /log::(debug|info|warn|error)!\([^)]*API 响应:\s*\{\}"\s*,\s*(response_text|output|text)/,
    ],
  },
];

const failures = [];

for (const check of checks) {
  const base = path.join(root, check.dir);
  if (!fs.existsSync(base)) continue;
  for (const file of walk(base)) {
    if (!check.extensions.has(path.extname(file))) continue;
    if (check.skip(file)) continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (check.patterns.some(pattern => pattern.test(line))) {
        failures.push(`${check.label}: ${path.relative(root, file)}:${index + 1}: ${trimmed}`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error('Logging guard check failed:\n' + failures.join('\n'));
  process.exit(1);
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
