// 配置与历史记录的格式校验

import type { UserConfig } from './configInterface';

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
 * 判断一条记录能否被导入历史库
 *
 * 这是导入链路的**唯一判据**：本地文件导入（`backupFiles.ts`）与云端同步（`HistorySync.ts`）
 * 都经 `ImportExportService.importHistoryFromJson` 走它，同一份文件走哪条路结论都一样。
 *
 * ⚠️ **刻意不要求 `id`**：`ImportExportService` 明确支持缺 id 的记录并会自动补一个
 * （见该文件「预处理：确保所有记录都有 ID」）。把 id 列为必需会让那段兼容逻辑变成死代码，
 * 手写或第三方导出的历史文件会被整份拒绝。
 *
 * ⚠️ **刻意不做 `results` 逐项深检**：导出侧（`exportHistoryToJson`）不做任何校验，
 * 一旦这里比导出侧严，PicNexus 自己导出的文件就可能导不回来（无损往返被打破）；
 * 更糟的是 replace 模式下被判无效的记录会连带删掉本地同 id 的行。
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
