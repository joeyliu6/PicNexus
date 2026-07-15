// 导入所有 barrel 文件以纳入覆盖率统计
// 目的：验证 index.ts 导出无副作用错误；不做行为断言
import { describe, it, expect } from 'vitest';

describe('barrel exports', () => {
  it('src/core/index.ts', async () => {
    await expect(import('@/core/index')).resolves.toBeDefined();
  });

  it('src/services/database/index.ts', async () => {
    await expect(import('@/services/database/index')).resolves.toBeDefined();
  });

  it('src/uploaders/base/index.ts', async () => {
    const mod = await import('@/uploaders/base/index');
    expect(mod.BaseUploader).toBeDefined();
    expect(mod.UploaderFactory).toBeDefined();
  });

  it('各图床 index.ts 导出 *Uploader', async () => {
    const modules = await Promise.all([
      import('@/uploaders/weibo/index'),
      import('@/uploaders/r2/index'),
      import('@/uploaders/jd/index'),
      import('@/uploaders/nowcoder/index'),
      import('@/uploaders/qiyu/index'),
      import('@/uploaders/zhihu/index'),
      import('@/uploaders/nami/index'),
      import('@/uploaders/bilibili/index'),
      import('@/uploaders/chaoxing/index'),
      import('@/uploaders/smms/index'),
      import('@/uploaders/github/index'),
      import('@/uploaders/imgur/index'),
      import('@/uploaders/tencent/index'),
      import('@/uploaders/aliyun/index'),
      import('@/uploaders/qiniu/index'),
      import('@/uploaders/upyun/index'),
      import('@/uploaders/custom-s3/index'),
    ]);
    for (const mod of modules) {
      // 任一导出都能证明 barrel 被执行
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }
  });
});
