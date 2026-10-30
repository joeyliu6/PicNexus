// 导入所有 barrel 文件以纳入覆盖率统计
// 目的：验证 index.ts 导出无副作用错误；不做行为断言
import { describe, it, expect } from 'vitest';

describe('barrel exports', () => {
  it('src/services/database/index.ts', async () => {
    await expect(import('@/services/database/index')).resolves.toBeDefined();
  });
});
