/**
 * 为 Tauri E2E 验收准备 portable 隔离数据目录
 *
 * `tests/tauri-e2e/scan-history-fix-acceptance.tauri.e2e.cjs` 依赖
 * `src-tauri/target/debug/data/` 下的 `portable.json` + seed 过 6 条 `e2e-*` 记录的
 * `history.db`。这套数据当初是临时脚本造的、跑完就删了，仓库里没留下任何可重建的东西——
 * 于是那条验收 spec 从 2026-08-22 之后就再也没法直接跑（会卡在 waitForDataRows(6)）。
 * 本脚本把它补回来。
 *
 * ── portable 模式是什么 ──
 * `src-tauri/src/portable.rs` 看到数据目录里有 `portable.json` 就把**全部**数据
 * （history.db / .settings.dat / logs / 主密钥）落到该目录，完全不碰真实用户数据。
 * 顺带一个好处：密钥走文件而不是系统钥匙串，无头环境也能起。
 *
 * ⚠️ 验收后必须 `--clean`，否则以后 `tauri dev` 会静默进入 portable 模式读错数据。
 *
 * ── 建表语句从哪来 ──
 * 运行时从 `src/services/database/SchemaManager.ts` 里把 `createTablesAndIndexes`
 * 的 DDL 抽出来用，**不在本文件里抄第二份**。抄一份的代价是它会随 schema 演进静默漂移，
 * 而这种漂移只会在验收时以"莫名其妙的 SQL 错误"暴露出来。抽取失败就直接报错退出，
 * 不做任何猜测性兜底。
 *
 * （已核对：`CREATE TABLE` 里已经包含 `runMigrations` 会 ADD COLUMN 的全部列，
 * 迁移只服务于升级老库，所以新建库只跑 DDL 就是完整的。）
 *
 * ── 用法 ──
 *   node scripts/seed-tauri-e2e-portable.mjs           # 建目录 + portable.json + 6 条记录
 *   node scripts/seed-tauri-e2e-portable.mjs --clean   # 删掉整个 target/debug/data
 *
 *   完整验收流程：
 *   1. node scripts/seed-tauri-e2e-portable.mjs
 *   2. PICNEXUS_ACCEPTANCE=1 npm run test:tauri:e2e
 *   3. node scripts/seed-tauri-e2e-portable.mjs --clean
 *
 * 写库那一步交给 `scripts/apply-sqlite-seed.py`：Node 20（本项目 CI 与类型声明的目标版本）
 * 没有内置 sqlite，而验收 spec 本来就依赖 PATH 里的 python，所以不引入新依赖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src-tauri', 'target', 'debug', 'data');
const dbPath = path.join(dataDir, 'history.db');
const markerPath = path.join(dataDir, 'portable.json');
const schemaSource = path.join(root, 'src', 'services', 'database', 'SchemaManager.ts');

/** 从 SchemaManager.ts 的 createTablesAndIndexes 里抽出全部 DDL 语句 */
function extractDdlStatements() {
  const source = fs.readFileSync(schemaSource, 'utf8');

  const start = source.indexOf('export async function createTablesAndIndexes');
  if (start === -1) {
    throw new Error(
      `在 ${path.relative(root, schemaSource)} 里找不到 createTablesAndIndexes——`
      + '函数被改名或搬走了，请同步更新本脚本的抽取逻辑（不要在这里抄一份 DDL）。',
    );
  }

  // 函数体结束于下一个顶格 `}`
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end === -1 ? undefined : end);

  const statements = [...body.matchAll(/db\.execute\(\s*`([\s\S]*?)`\s*\)/g)].map(
    (match) => match[1].trim(),
  );

  if (!statements.some((sql) => /CREATE TABLE[\s\S]*history_items/i.test(sql))) {
    throw new Error(
      'DDL 抽取结果里没有 history_items 建表语句——SchemaManager 的写法变了'
      + '（比如 db.execute 的参数不再是模板字符串）。请更新抽取逻辑后重试。',
    );
  }

  return statements;
}

/**
 * 按 DataTransformer.deriveResultColumns 的口径派生三个存储列。
 * 判据是 isUsableMirror：success 且拿得到 url。口径与那边不一致会让
 * 批量迁移的 SQL 预筛选放进迁不动的记录。
 */
function deriveResultColumns(results) {
  const successful = results.filter(
    (r) => r != null && typeof r === 'object' && r.success === true && Boolean(r.url),
  );
  return {
    results: JSON.stringify(results),
    successCount: successful.length,
    successfulServiceIds: JSON.stringify(successful.map((r) => r.serviceId)),
  };
}

/** 6 条记录：id 固定为 e2e-001..006，时间戳递减以保证列表顺序稳定 */
function buildRows() {
  const baseTimestamp = 1_724_300_000_000; // 2024-08-22 前后的固定值，绝不用 Date.now()
  return Array.from({ length: 6 }, (_, index) => {
    const seq = String(index + 1).padStart(3, '0');
    const url = `https://example.invalid/e2e/${seq}.png`;
    const results = [{ serviceId: 'smms', success: true, url }];
    const derived = deriveResultColumns(results);

    return {
      id: `e2e-${seq}`,
      timestamp: baseTimestamp - index * 60_000,
      localFileName: `e2e-${seq}.png`,
      filePath: null,
      primaryService: 'smms',
      generatedLink: url,
      ...derived,
    };
  });
}

function clean() {
  if (!fs.existsSync(dataDir)) {
    console.log(`已经是干净的：${path.relative(root, dataDir)} 不存在`);
    return;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`✅ 已删除 ${path.relative(root, dataDir)}`);
  console.log('   （不删的话，以后 tauri dev 会静默进入 portable 模式读错数据）');
}

/** 依次试 python / python3，返回第一个能跑起来的 */
function resolvePython() {
  for (const candidate of ['python', 'python3']) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const COLUMNS = [
  'id', 'timestamp', 'local_file_name', 'local_file_name_lower', 'file_path',
  'primary_service', 'results', 'generated_link',
  'width', 'height', 'aspect_ratio', 'file_size', 'format', 'color_type', 'has_alpha',
  'success_count', 'successful_service_ids',
];

function seed() {
  const python = resolvePython();
  if (!python) {
    console.error(
      'PATH 里找不到 python / python3。写库这一步依赖 Python 自带的 sqlite3 模块'
      + '（Node 20 没有内置 sqlite），验收 spec 本身也依赖它。',
    );
    process.exit(1);
  }

  const ddl = extractDdlStatements();

  fs.mkdirSync(dataDir, { recursive: true });
  // portable.json 的内容不重要，portable.rs 只看它存不存在
  fs.writeFileSync(markerPath, `${JSON.stringify({ portable: true }, null, 2)}\n`, 'utf8');

  const rows = buildRows().map((row) => [
    row.id,
    row.timestamp,
    row.localFileName,
    row.localFileName.toLowerCase(),
    row.filePath,
    row.primaryService,
    row.results,
    row.generatedLink,
    800,
    600,
    800 / 600,
    12_345,
    'png',
    'unknown',
    0,
    row.successCount,
    row.successfulServiceIds,
  ]);

  const payloadPath = path.join(dataDir, 'seed-payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify({ ddl, columns: COLUMNS, rows }), 'utf8');

  const applier = path.join(root, 'scripts', 'apply-sqlite-seed.py');
  const result = spawnSync(python, [applier, dbPath, payloadPath], { encoding: 'utf8' });
  fs.rmSync(payloadPath, { force: true });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || '写库失败，且没有拿到错误输出');
    process.exit(1);
  }

  const count = result.stdout.trim();
  console.log(`✅ ${path.relative(root, markerPath)}（portable 标记）`);
  console.log(`✅ ${path.relative(root, dbPath)}：${ddl.length} 条 DDL，${count} 条 e2e-* 记录`);
  console.log('');
  console.log('接着跑：PICNEXUS_ACCEPTANCE=1 npm run test:tauri:e2e');
  console.log('跑完务必：node scripts/seed-tauri-e2e-portable.mjs --clean');
}

if (process.argv.includes('--clean')) {
  clean();
} else {
  seed();
}
