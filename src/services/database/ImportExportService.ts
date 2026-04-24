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
import { createLogger } from '../../utils/logger';
import {
  COLUMN_COUNT,
  COLUMNS_SQL,
  columnPlaceholders,
  itemToRow,
  rowValues,
} from './DataTransformer';

const log = createLogger('ImportExport');

/** 每批处理的记录数（插入和查询都遵循这个批大小） */
const BATCH_SIZE = 500;

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
 * @returns 导入的记录数
 */
export async function importHistoryFromJson(
  db: Database,
  json: string,
  mergeStrategy: 'replace' | 'merge',
  onProgress?: (current: number, total: number) => void,
): Promise<number> {
  const parsed = JSON.parse(json);

  if (!Array.isArray(parsed)) {
    throw new Error('无效的 JSON 格式：期望数组');
  }

  // 校验每条记录的必需字段，过滤掉格式不合法的数据
  const items = (parsed as HistoryItem[]).filter(item => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.timestamp !== 'number' || item.timestamp <= 0) return false;
    if (typeof item.localFileName !== 'string' || !item.localFileName) return false;
    if (typeof item.primaryService !== 'string' || !item.primaryService) return false;
    if (typeof item.generatedLink !== 'string') return false;
    if (!Array.isArray(item.results)) return false;
    return true;
  });

  if (items.length === 0 && parsed.length > 0) {
    throw new Error('导入数据格式不匹配，请检查文件是否为 PicNexus 导出的历史记录');
  }

  if (items.length < parsed.length) {
    log.warn(`导入校验: ${parsed.length} 条中有 ${parsed.length - items.length} 条格式无效被跳过`);
  }

  // 预处理：确保所有记录都有 ID（在事务外，避免事务中途失败后污染入参）
  for (const item of items) {
    if (!item.id) {
      item.id = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
  }

  // 确定需要导入的记录
  let itemsToImport: HistoryItem[];

  if (mergeStrategy === 'merge') {
    // merge 策略：一次性查询所有已存在的记录（消除 N+1 查询）
    const allIds = items.map((item) => item.id);
    const existingMap = await getExistingRecords(db, allIds);

    // 过滤出需要导入的记录（不存在或时间戳更新）
    itemsToImport = items.filter((item) => {
      const existingTimestamp = existingMap.get(item.id);
      return !existingTimestamp || item.timestamp > existingTimestamp;
    });

    log.info(`merge 策略: ${items.length} 条中有 ${itemsToImport.length} 条需要导入`);
  } else {
    itemsToImport = items;
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

  if (mergeStrategy === 'replace') {
    await deleteRowsNotIn(db, new Set(items.map((item) => item.id)));
  }

  log.info(`导入完成: ${importedCount}/${items.length} 条`);
  return importedCount;
}

/**
 * 删除 history_items 里所有 id 不在 keepIds 集合中的行。
 * 分批执行，避免单条 SQL 参数数量超 SQLite 上限。
 */
async function deleteRowsNotIn(db: Database, keepIds: Set<string>): Promise<void> {
  const existingRows = await db.select<{ id: string }[]>('SELECT id FROM history_items');
  const toDelete = existingRows
    .map((row) => row.id)
    .filter((id) => !keepIds.has(id));

  if (toDelete.length === 0) return;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = toDelete.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');
    await db.execute(
      `DELETE FROM history_items WHERE id IN (${placeholders})`,
      batch
    );
  }
  log.info(`replace 模式: 清理旧记录 ${toDelete.length} 条`);
}

/**
 * 批量查询已存在的记录（用于 merge 策略优化）
 * 一次性查询所有指定 ID 的记录，避免 N+1 查询问题
 */
async function getExistingRecords(db: Database, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) {
    return new Map();
  }

  const result = new Map<string, number>();

  // 分批查询，每批 500 个 ID，避免 SQL 语句过长
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batchIds.map((_, idx) => `$${idx + 1}`).join(',');
    const rows = await db.select<{ id: string; timestamp: number }[]>(
      `SELECT id, timestamp FROM history_items WHERE id IN (${placeholders})`,
      batchIds
    );
    for (const row of rows) {
      result.set(row.id, row.timestamp);
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
