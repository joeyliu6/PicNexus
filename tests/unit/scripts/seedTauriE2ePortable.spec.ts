// 真机走查用的种子记录（scripts/seed-tauri-e2e-portable.mjs）要是应用认的形状：
// 每条上传结果都算「可用镜像」，三个派生列与应用写库时算出来的一样。形状对不上时，链接检测、补充备份都看不到这些记录
import { describe, expect, it } from 'vitest';
import type { HistoryItem } from '@/config/types';
import { deriveResultColumns } from '@/services/database/DataTransformer';
import { isUsableMirror } from '@/utils/historyResults';

interface SeedRow {
  generatedLink: string;
  results: string;
  successCount: number;
  successfulServiceIds: string;
}

// 脚本是没有类型的 .mjs：路径放进变量里动态 import，类型在这里写明
const SEED_SCRIPT = '../../../scripts/seed-tauri-e2e-portable.mjs';

describe('seed-tauri-e2e-portable', () => {
  it('writes upload results the app counts as usable, with the derived columns the app computes', async () => {
    const { buildRows } = (await import(/* @vite-ignore */ SEED_SCRIPT)) as { buildRows: () => SeedRow[] };
    const rows = buildRows();

    expect(rows).toHaveLength(6);
    for (const row of rows) {
      const results = JSON.parse(row.results) as HistoryItem['results'];
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(isUsableMirror)).toBe(true);
      expect(results[0].result?.url).toBe(row.generatedLink);
      const app = deriveResultColumns(results);
      expect({ count: row.successCount, ids: row.successfulServiceIds }).toEqual({ count: app.success_count, ids: app.successful_service_ids });
    }
  });
});
