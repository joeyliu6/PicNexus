import fs from 'node:fs';
import path from 'node:path';

const coveragePath = path.resolve('coverage/coverage-summary.json');

const thresholds = {
  'src/composables/useGlobalShortcut.ts': { lines: 35, statements: 35, functions: 35, branches: 30 },
  'src/composables/useClipboardImage.ts': { lines: 35, statements: 35, functions: 35, branches: 30 },
  'src/composables/useCompressionTask.ts': { lines: 35, statements: 35, functions: 35, branches: 30 },
  'src/composables/useImageLoadManager.ts': { lines: 35, statements: 35, functions: 35, branches: 30 },
  'src/uploaders/nami/NamiUploader.ts': { lines: 35, statements: 35, functions: 35, branches: 30 },
  'src/uploaders/imgur/ImgurUploader.ts': { lines: 35, statements: 35, functions: 35, branches: 30 },
};

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!fs.existsSync(coveragePath)) {
  fail(`未找到覆盖率摘要文件: ${coveragePath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const entries = Object.entries(summary).filter(([file]) => file !== 'total');
const normalizedEntries = entries.map(([file, data]) => [path.normalize(file).toLowerCase(), data]);

let hasFailure = false;

const metrics = ['lines', 'statements', 'functions', 'branches'];

for (const [relativePath, threshold] of Object.entries(thresholds)) {
  const normalizedTarget = path.normalize(relativePath).toLowerCase();
  const match = normalizedEntries.find(([file]) => file.endsWith(normalizedTarget));
  if (!match) {
    fail(`覆盖率摘要中未找到关键文件: ${relativePath}`);
    hasFailure = true;
    continue;
  }

  const [, data] = match;
  for (const metric of metrics) {
    const actual = data[metric]?.pct ?? 0;
    const required = threshold[metric];
    if (actual < required) {
      fail(`关键文件覆盖率不足: ${relativePath} ${metric}=${actual}% < ${required}%`);
      hasFailure = true;
    }
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log('关键文件覆盖率检查通过。');
