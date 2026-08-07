/**
 * 图片元数据（尺寸）批量写回
 *
 * 独立于 HistoryDatabase.update()：那条路径为了复用 DataTransformer 的归一化规则，
 * 每次都要先 getById 读回整行（含 results / linkCheckStatus 等大字段）再合并。
 * 尺寸修复是典型的"几千条一起刷"场景，逐条读改写会把 IPC 往返和 JSON 解析放大成主要开销。
 */

import type Database from '@tauri-apps/plugin-sql';
import { createLogger } from '../../utils/logger';

const log = createLogger('MetadataQuery');

export interface DimensionUpdate {
  id: string;
  width: number;
  height: number;
  aspectRatio: number;
}

/** 跨批写入失败时携带已提交/已处理进度，调用方据此只回退未落库的批次 */
export class DimensionBatchUpdateError extends Error {
  readonly committedRows: number;
  readonly processedEntries: number;
  readonly cause: unknown;

  constructor(committedRows: number, processedEntries: number, cause: unknown) {
    super(`批量更新失败：已提交 ${committedRows} 行，已处理 ${processedEntries} 条`);
    this.name = 'DimensionBatchUpdateError';
    this.committedRows = committedRows;
    this.processedEntries = processedEntries;
    this.cause = cause;
  }
}

/** 每批更新的记录数，与 batchUpdateLinkCheckStatusQuery 保持一致 */
const BATCH_SIZE = 200;

/**
 * 批量写回图片尺寸
 *
 * 用 CASE/WHEN 把一批记录合并成一条 UPDATE。空值兜底与 itemToRow 一致
 * （width/height 缺省 0，aspectRatio 缺省 1），避免两条写入路径产生不同的行状态。
 *
 * @returns 实际提交的记录数
 */
export async function batchUpdateDimensionsQuery(
  db: Database,
  updates: DimensionUpdate[],
): Promise<number> {
  if (updates.length === 0) return 0;

  let committedRows = 0;
  let processedEntries = 0;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const ids = batch.map((_, j) => `$${j + 1}`).join(',');

    // 每条记录占 3 个值参数，紧跟在 batch.length 个 id 参数之后
    const valueParam = (rowIndex: number, offset: number) =>
      `$${batch.length + rowIndex * 3 + offset}`;
    const caseFor = (offset: number) =>
      batch.map((_, j) => `WHEN id = $${j + 1} THEN ${valueParam(j, offset)}`).join(' ');

    const params = [
      ...batch.map((update) => update.id),
      ...batch.flatMap((update) => [
        update.width ?? 0,
        update.height ?? 0,
        update.aspectRatio ?? 1,
      ]),
    ];

    try {
      const result = await db.execute(
        `UPDATE history_items
         SET width = CASE ${caseFor(1)} END,
             height = CASE ${caseFor(2)} END,
             aspect_ratio = CASE ${caseFor(3)} END
         WHERE id IN (${ids})`,
        params,
      );
      committedRows += result.rowsAffected;
      processedEntries += batch.length;
    } catch (cause) {
      throw new DimensionBatchUpdateError(committedRows, processedEntries, cause);
    }
  }

  log.info(`批量更新 ${updates.length} 条图片尺寸`);
  return committedRows;
}
