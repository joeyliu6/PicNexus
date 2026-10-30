// 配置与历史记录的格式校验

import type { UserConfig } from './configInterface';
import type { HistoryItem } from './historyTypes';

/**
 * 验证对象是否为有效的 UserConfig 格式
 * 用于防止导入错误格式的数据（如历史记录数据）覆盖配置
 *
 * @param obj 要验证的对象
 * @returns 是否为有效的 UserConfig 格式
 */
export function isValidUserConfig(obj: unknown): obj is UserConfig {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const config = obj as Record<string, unknown>;

  // 1. 不应该是数字索引对象（历史记录数据的特征：{"0": {...}, "1": {...}}）
  const keys = Object.keys(config);
  if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
    return false;
  }

  // 2. 不应该包含历史记录特有的字段
  if ('localFileName' in config || 'results' in config || 'generatedLink' in config) {
    return false;
  }

  // 3. 必须包含 UserConfig 的必要字段（enabledServices 必须是数组）
  if (!Array.isArray(config.enabledServices)) {
    return false;
  }

  // 4. services 如果存在必须是对象
  if (config.services !== undefined && (typeof config.services !== 'object' || config.services === null)) {
    return false;
  }

  return true;
}

/**
 * 验证单个上传结果对象的结构
 */
function isValidUploadResultEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }

  const e = entry as Record<string, unknown>;

  // 必需字段
  if (typeof e.serviceId !== 'string') return false;
  if (e.status !== 'success' && e.status !== 'failed') return false;

  // 可选字段类型检查
  if (e.error !== undefined && typeof e.error !== 'string') return false;

  return true;
}

/**
 * 判断一条记录能否被导入历史库
 *
 * 这是导入链路的**唯一真相源**：本地文件导入（`useBackupLocal.importHistoryLocal`）与
 * 云端下载（`ImportExportService.importHistoryFromJson`）都走它。此前两条路径各有一套谓词，
 * 互有松紧——底层要求 `timestamp > 0`、`localFileName`/`primaryService` 非空却不查 `id`，
 * 而 `isValidHistoryItem` 要求 `id` 非空却放行 `timestamp <= 0` 和空文件名——同一份文件
 * 走两条路会得到不同结论。
 *
 * ⚠️ **刻意不要求 `id`**：`ImportExportService` 明确支持缺 id 的记录并会自动补一个
 * （见该文件「预处理：确保所有记录都有 ID」）。把 id 列为必需会让那段兼容逻辑变成死代码，
 * 手写或第三方导出的历史文件会被整份拒绝。
 *
 * ⚠️ **刻意不做 `results` 逐项深检**：导出侧（`exportHistoryToJson`）不做任何校验，
 * 一旦这里比导出侧严，PicNexus 自己导出的文件就可能导不回来（无损往返被打破）；
 * 更糟的是 replace 模式下被判无效的记录会连带删掉本地同 id 的行。深检留给
 * {@link isValidHistoryItem}——那是「完整 HistoryItem 形状」的判据，用途不同。
 */
export function isImportableHistoryItem(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

  const item = obj as Record<string, unknown>;

  if (typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp) || item.timestamp <= 0) return false;
  if (typeof item.localFileName !== 'string' || !item.localFileName) return false;
  if (typeof item.primaryService !== 'string' || !item.primaryService) return false;
  if (typeof item.generatedLink !== 'string') return false;
  if (!Array.isArray(item.results)) return false;
  // results 条目必须是非空对象：`[null]`/`[5]` 这类脏数据会在 DataTransformer 派生存量列时
  // 被 isUsableMirror(null) 访问 r.status 触发 TypeError——导入无事务包裹，超过一个批
  // （500 条）就会先写几批再崩，留下部分导入的残局。
  // ⚠️ 只拒非对象；不做 `{serviceId,status}` 的完整形状深检（那会打破导出/导入的无损往返）。
  for (const entry of item.results) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  }

  return true;
}

/**
 * 验证对象是否为**完整**的 HistoryItem（含 id 与 results 逐项深检）
 *
 * 与 {@link isImportableHistoryItem} 的分工：这里判的是「形状完整、可以当 HistoryItem 用」，
 * 那里判的是「可以往历史库里写」。导入链路请用后者，不要用本函数——见其 doc 里的两条 ⚠️。
 */
export function isValidHistoryItem(obj: unknown): obj is HistoryItem {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const item = obj as Record<string, unknown>;

  // 必需字段检查
  if (typeof item.id !== 'string' || item.id.trim().length === 0) return false;
  if (typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp)) return false;
  if (typeof item.localFileName !== 'string') return false;
  if (typeof item.primaryService !== 'string') return false;
  if (typeof item.generatedLink !== 'string') return false;

  // results 数组深度验证
  if (!Array.isArray(item.results)) return false;
  if (!item.results.every(isValidUploadResultEntry)) return false;

  // 可选字段类型检查
  if (item.filePath !== undefined && typeof item.filePath !== 'string') return false;
  if (item.isFavorited !== undefined && typeof item.isFavorited !== 'boolean') return false;
  if (
    item.favoriteUpdatedAt !== undefined
    && (typeof item.favoriteUpdatedAt !== 'number' || !Number.isFinite(item.favoriteUpdatedAt))
  ) {
    return false;
  }
  if (item.favoriteUpdatedBy !== undefined && typeof item.favoriteUpdatedBy !== 'string') return false;

  return true;
}
