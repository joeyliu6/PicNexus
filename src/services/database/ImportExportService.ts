/**
 * 导入导出服务
 *
 * 从 HistoryDatabase 提取的 JSON 备份还原逻辑：
 * - exportHistoryToJson: 流式导出全部记录为 JSON 字符串
 * - importHistoryFromJson: 批量导入 JSON（支持 merge / replace 两种策略）
 *
 * 被本地备份和 WebDAV 同步共同使用。SQL 和业务逻辑与原 HistoryDatabase 完全一致。
 */

import type Database from '@tauri-apps/plugin-sql';
import type { HistoryItem } from '../../config/types';
import { isImportableHistoryItem } from '../../config/types';
import { createLogger } from '../../utils/logger';
import {
  COLUMN_COUNT,
  COLUMNS_SQL,
  columnPlaceholders,
  itemToRow,
  rowToItem,
  rowValues,
  type HistoryItemRow,
} from './DataTransformer';
import { hasHistoryItemChanged, mergeHistoryItem } from './HistoryMerge';

const log = createLogger('ImportExport');

/** 每批处理的记录数（插入和查询都遵循这个批大小） */
const BATCH_SIZE = 500;

/**
 * 导入结果
 *
 * Why 不再只回一个数字：调用方要报给用户的「新增 N 条 / 合并 M 条」此前是各算各的
 * （`countAfter - countBefore` 的全表计数差、`cloudItems.length - addedCount` 的原始条数差），
 * 既会把「更新」误报成「新增」，也会把「格式无效被跳过」的记录算进「已合并」。
 * 这些数只有导入过程自己数得准，一次性回全。
 */
export interface HistoryImportResult {
  /** 解析出的原始条数（含被跳过的） */
  total: number;
  /** 实际写库条数 = added + updated */
  imported: number;
  /** 其中本地原本没有的条数 */
  added: number;
  /** 其中覆盖了已有记录的条数 */
  updated: number;
  /** 因格式不合法被跳过的条数 */
  skipped: number;
}

/**
 * 流式数据源：由调用方注入（通常绑定 HistoryDatabase.getAllStream），
 * 避免 ImportExportService 反向依赖 HistoryDatabase 单例。
 */
export type StreamSource = (batchSize: number) => AsyncGenerator<HistoryItem[]>;

/**
 * 导出所有记录为 JSON 字符串
 * 使用流式读取降低内存峰值压力
 */
export async function exportHistoryToJson(streamSource: StreamSource): Promise<string> {
  const items: HistoryItem[] = [];
  // 分批读取，每批 1000 条，降低内存峰值
  for await (const batch of streamSource(1000)) {
    items.push(...batch);
  }
  return JSON.stringify(items, null, 2);
}

/**
 * 从 JSON 导入记录（高性能批量导入）
 *
 * 优化说明：
 * - 使用批量插入替代逐条插入，大幅提升性能
 * - merge 策略使用一次性查询替代 N+1 查询
 * - 支持进度回调，便于 UI 显示导入进度
 *
 * @param db 已初始化的数据库连接
 * @param json JSON 字符串
 * @param mergeStrategy 合并策略：replace 覆盖，merge 合并（相同 ID 保留较新的）
 * @param onProgress 可选的进度回调 (current, total) => void
 * @returns 导入统计，见 {@link HistoryImportResult}
 */
export async function importHistoryFromJson(
  db: Database,
  json: string,
  mergeStrategy: 'replace' | 'merge',
  onProgress?: (current: number, total: number) => void,
): Promise<HistoryImportResult> {
  const parsed = JSON.parse(json);

  if (!Array.isArray(parsed)) {
    throw new Error('无效的 JSON 格式：期望数组');
  }

  // Why: replace 模式遇到空数组会走到 deleteRowsNotIn(空 keepIds) 把本地全表清空，
  // 这是一条没有任何拦截的"删库"路径（云端文件被手工编辑成 [] 即触发）。
  // merge 模式遇到空数组是无操作，无需拦截。
  if (parsed.length === 0 && mergeStrategy === 'replace') {
    throw new Error('云端数据为空数组，已拒绝覆盖本地（防止误清空）');
  }

  // 校验 + 去重一遍完成：
  // - `isImportableHistoryItem` 过滤非法记录（含 results 里带 null 的脏条目）。
  // - 同一 id 在载荷里出现多次（第三方手写/被合并过的文件）时，用内容合并折叠成一条——
  //   否则重复条目会被重复计进 added/imported（撒谎），而 INSERT OR REPLACE 最终只留一行，
  //   且 SQLite 对多行同 id 保留的是**最后一行**，输入序「新后旧」会让旧记录覆盖新记录。
  //   按 timestamp/收藏版本合并后结果与输入顺序无关。
  const items: HistoryItem[] = [];
  const mergedById = new Map<string, HistoryItem>();
  let invalidCount = 0;
  for (const raw of parsed as unknown[]) {
    if (!isImportableHistoryItem(raw)) {
      invalidCount += 1;
      continue;
    }
    const item = raw as HistoryItem;
    if (item.id) {
      const existing = mergedById.get(item.id);
      if (existing) mergedById.set(item.id, mergeHistoryItem(existing, item));
      else mergedById.set(item.id, item);
    } else {
      items.push(item);
    }
  }
  for (const merged of mergedById.values()) {
    items.push(merged);
  }

  if (items.length === 0 && parsed.length > 0) {
    throw new Error('导入数据格式不匹配，请检查文件是否为 PicNexus 导出的历史记录');
  }

  if (invalidCount > 0) {
    log.warn(`导入校验: ${parsed.length} 条中有 ${invalidCount} 条格式无效被跳过`);
  }

  // 预处理：确保所有记录都有 ID（在事务外，避免事务中途失败后污染入参）
  for (const item of items) {
    if (!item.id) {
      item.id = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
  }

  // 确定需要导入的记录
  let itemsToImport: HistoryItem[];
  // 「新增」= 本地原本没有这个 id。只有导入过程数得准：调用方用
  // `countAfter - countBefore` 的全表计数差会被同期的正常上传污染（云端同步锁不锁本地上传）。
  let addedCount = 0;

  if (mergeStrategy === 'merge') {
    // merge 策略：一次性查询所有已存在的记录（消除 N+1 查询）
    const allIds = items.map((item) => item.id);
    const existingMap = await getExistingRecordsById(db, allIds);

    // 过滤出需要导入的记录。历史内容按 timestamp 合并，收藏状态按独立版本合并。
    itemsToImport = items.flatMap((item) => {
      const existing = existingMap.get(item.id);
      if (!existing) {
        addedCount += 1;
        return [item];
      }

      const merged = mergeHistoryItem(existing, item);
      return hasHistoryItemChanged(existing, merged) ? [merged] : [];
    });

    log.info(`merge 策略: ${items.length} 条中有 ${itemsToImport.length} 条需要导入`);
  } else {
    itemsToImport = items;
  }

  // Why: replace 模式必须在 import 开始前先快照旧 id 集合，导入完成后只删除
  // "旧集合 - 导入集合" 的差集。原实现在 import 完后 SELECT 全表来算差集，
  // 期间任何外部 historyDB.insert（例如用户边下载边继续上传图片）写入的新 id
  // 会被误判为"导入集没有"而被一并 DELETE，造成数据丢失。
  const oldIdsSnapshot: Set<string> | null =
    mergeStrategy === 'replace'
      ? new Set(
          (await db.select<{ id: string }[]>('SELECT id FROM history_items')).map((r) => r.id),
        )
      : null;

  if (mergeStrategy === 'replace' && oldIdsSnapshot) {
    // replace 模式下 itemsToImport 就是全部合法记录，「新增」= 快照里没有的那些
    addedCount = items.reduce((n, item) => (oldIdsSnapshot.has(item.id) ? n : n + 1), 0);
  }

  // 注意：tauri-plugin-sql 基于 sqlx 连接池，每次 execute 都借用不同连接，
  // BEGIN/COMMIT 无法跨调用生效（见 plugins-workspace #886），所以不能用事务包裹。
  //
  // replace 模式的安全策略：先全部 INSERT OR REPLACE 入库，全部成功后再 DELETE 掉
  // "老库里有但导入集里没有"的记录。中途失败时老数据仍在，只是多了些被覆写的新行，
  // 比"先 DELETE 后 INSERT"中途失败导致彻底丢数据安全得多。
  let importedCount = 0;
  for (let i = 0; i < itemsToImport.length; i += BATCH_SIZE) {
    const batch = itemsToImport.slice(i, i + BATCH_SIZE);
    await batchUpsert(db, batch);
    importedCount += batch.length;
    onProgress?.(importedCount, itemsToImport.length);
  }

  if (mergeStrategy === 'replace' && oldIdsSnapshot) {
    // Why 认领范围要覆盖整份 parsed，而不只是过滤后的 items：
    // 一条云端记录没通过上面的校验，只说明「这条读不懂」，不代表「云端已经删了它」。
    // 若只认领 items 的 id，本地那条**完好**的同 id 记录会落进删除集被 DELETE 掉——
    // 它既没被 INSERT 覆盖过（压根没进 itemsToImport），也没有任何提示，是纯粹的数据丢失。
    // 只有「云端整份数据里彻底没出现过的 id」才该删，replace 语义照样成立。
    const importIdSet = new Set<string>(items.map((item) => item.id));
    for (const raw of parsed as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const rawId = (raw as { id?: unknown }).id;
      // 归一化成字符串：本地 id 从 SQLite 出来恒为 string，云端若写成数字 123
      // 而本地存的是 '123'，不归一化就仍会被误删。
      if (typeof rawId === 'string' && rawId) importIdSet.add(rawId);
      else if (typeof rawId === 'number' && Number.isFinite(rawId)) importIdSet.add(String(rawId));
    }
    const toDelete = [...oldIdsSnapshot].filter((id) => !importIdSet.has(id));
    await deleteByIds(db, toDelete);
  }

  // skipped = 触犯谓词的条数。不能用 `parsed.length - items.length`——去重后合法同 id
  // 记录合并成一条，那个差值会把重复也算成跳过。
  const skippedCount = invalidCount;
  const updatedCount = itemsToImport.length - addedCount;
  log.info(
    `导入完成: ${importedCount}/${items.length} 条（新增 ${addedCount}，更新 ${updatedCount}，跳过 ${skippedCount}）`,
  );

  return {
    total: parsed.length,
    imported: importedCount,
    added: addedCount,
    updated: updatedCount,
    skipped: skippedCount,
  };
}

/**
 * 按 id 列表分批 DELETE，避免单条 SQL 参数数量超 SQLite 上限。
 */
async function deleteByIds(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');
    await db.execute(
      `DELETE FROM history_items WHERE id IN (${placeholders})`,
      batch
    );
  }
  log.info(`replace 模式: 清理旧记录 ${ids.length} 条`);
}

/**
 * 批量查询已存在的记录（用于 merge 策略优化）
 * 一次性查询所有指定 ID 的记录，避免 N+1 查询问题
 */
async function getExistingRecordsById(db: Database, ids: string[]): Promise<Map<string, HistoryItem>> {
  if (ids.length === 0) {
    return new Map();
  }

  const result = new Map<string, HistoryItem>();

  // 分批查询，每批 500 个 ID，避免 SQL 语句过长
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batchIds.map((_, idx) => `$${idx + 1}`).join(',');
    const rows = await db.select<HistoryItemRow[]>(
      `SELECT * FROM history_items WHERE id IN (${placeholders})`,
      batchIds
    );
    for (const row of rows) {
      result.set(row.id, rowToItem(row));
    }
  }

  return result;
}

/**
 * 批量插入或更新记录（高性能批量操作）
 * 使用单条 SQL 语句插入多条记录，显著提升导入性能
 */
async function batchUpsert(db: Database, items: HistoryItem[]): Promise<void> {
  if (items.length === 0) return;

  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  let paramIndex = 1;

  for (const item of items) {
    const row = itemToRow(item);
    rowPlaceholders.push(`(${columnPlaceholders(paramIndex)})`);
    paramIndex += COLUMN_COUNT;
    values.push(...rowValues(row));
  }

  await db.execute(
    `INSERT OR REPLACE INTO history_items (${COLUMNS_SQL}) VALUES ${rowPlaceholders.join(', ')}`,
    values
  );
}
