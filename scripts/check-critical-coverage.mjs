import fs from 'node:fs';
import path from 'node:path';

const coveragePath = path.resolve('coverage/coverage-summary.json');

// 逐文件覆盖率棘轮。
//
// 为什么需要这一层：vitest.config.ts 的 glob thresholds 是**聚合**比较，
// 一整组文件的均值过线即通过，单个洼地文件会被组内高覆盖文件掩盖。
// 这里是逐文件断言，专门盯住会被均值藏起来的文件。
//
// 棘轮策略：阈值只反映「当前已经达到的水平」，用来防回退，不代表目标值。
// 覆盖率提升后可以再往上抬；除非确有正当理由，不要下调。
//
// ⚠️ 每个条目必须写全 lines / statements / functions / branches 四项。
// 漏写会被下面的 assertCompleteThresholds 直接拦住——因为 `实际值 < undefined`
// 恒为 false，漏写的指标会静默地完全不检查。
const thresholds = {
  // 存量高覆盖文件：阈值 = 当前值 − 5pp（向下取整），锁住已有成果。
  'src/composables/useGlobalShortcut.ts': { lines: 81, statements: 81, functions: 95, branches: 56 },
  'src/composables/useClipboardImage.ts': { lines: 92, statements: 92, functions: 95, branches: 77 },
  'src/composables/useCompressionTask.ts': { lines: 95, statements: 95, functions: 95, branches: 62 },
  'src/composables/useImageLoadManager.ts': { lines: 91, statements: 91, functions: 95, branches: 83 },
  'src/uploaders/nami/NamiUploader.ts': { lines: 92, statements: 92, functions: 95, branches: 83 },
  'src/uploaders/imgur/ImgurUploader.ts': { lines: 95, statements: 95, functions: 95, branches: 89 },
  // 2026-08-13 补完 UploadQueueManager 单测后从下面的「低覆盖」组毕业：
  // 8.44/8.44/10/100(分母 2) → 100/100/100/97.27(分母 110)。
  // branches 分母从 2 涨到 110，旧的 100% 是假象，这里按实测新值重新定线。
  // 剩余 3 个未覆盖分支是取不到的防御性兜底（UploadQueue.ts:332 的 latestItem 三元、
  // :416-418 的 weiboProgress/r2Progress `?? 0`），不为凑数造畸形数据。
  'src/core/UploadQueue.ts': { lines: 95, statements: 95, functions: 95, branches: 92 },
  // 2026-08-13 补完 createResultOps 单测后从下面的「低覆盖」组毕业：
  // 8.42/8.42/20/100(分母 1) → 100/100/100/100(分母 83)。
  // branches 分母从 1 涨到 83，旧的 100% 正是注释预告的假象；这次真分支全覆盖，
  // 阈值按实测新值重新定线，没有沿用旧数字。
  'src/composables/history/useHistoryResultOps.ts': { lines: 95, statements: 95, functions: 95, branches: 95 },

  // 低覆盖核心文件：阈值略低于当前值，只防继续下滑，补测试是独立任务。
  //
  // ⚠️ branches 设 0：该文件的 branches 现值是 100%，但分母只有 0——那是
  // 「几乎没有分支被 v8 记录到」的假象，不是真覆盖。一旦真补了测试、分母变大，
  // branches 百分比反而会掉，任何接近 100 的阈值都会立刻误报。
  'src/composables/timeline/useTimelineDragAndSkeleton.ts': { lines: 3, statements: 3, functions: 0, branches: 0 },
};

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!fs.existsSync(coveragePath)) {
  fail(`未找到覆盖率摘要文件: ${coveragePath}`);
  process.exit(1);
}

const metrics = ['lines', 'statements', 'functions', 'branches'];

// 名单自检：漏写任一指标会让该指标静默失效（`实际值 < undefined` 恒为 false），
// 等于棘轮没装上。宁可在这里硬失败，也不要让守卫悄悄放空。
let thresholdsInvalid = false;
for (const [relativePath, threshold] of Object.entries(thresholds)) {
  const missing = metrics.filter((metric) => typeof threshold[metric] !== 'number');
  if (missing.length > 0) {
    fail(`关键文件阈值配置不完整: ${relativePath} 缺少 ${missing.join(' / ')}`);
    thresholdsInvalid = true;
  }
}
if (thresholdsInvalid) {
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const entries = Object.entries(summary).filter(([file]) => file !== 'total');
const normalizedEntries = entries.map(([file, data]) => [path.normalize(file).toLowerCase(), data]);

let hasFailure = false;

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
