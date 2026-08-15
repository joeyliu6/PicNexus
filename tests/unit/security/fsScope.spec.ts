import { beforeEach, describe, expect, it } from 'vitest';
import { getInvokeMock, resetTauriMocks } from '../helpers/tauriMock';
import { allowUserPaths } from '@/security/fsScope';

beforeEach(() => {
  resetTauriMocks();
});

describe('allowUserPaths', () => {
  it('每个路径各申请一次授权', async () => {
    getInvokeMock().mockResolvedValue(undefined);

    await allowUserPaths(['C:/docs/a.md', 'D:/notes']);

    expect(getInvokeMock()).toHaveBeenCalledWith('allow_user_path', { path: 'C:/docs/a.md' });
    expect(getInvokeMock()).toHaveBeenCalledWith('allow_user_path', { path: 'D:/notes' });
  });

  it('空数组不发起调用', async () => {
    getInvokeMock().mockResolvedValue(undefined);

    await allowUserPaths([]);

    expect(getInvokeMock()).not.toHaveBeenCalled();
  });

  /**
   * 授权失败不能抛
   *
   * 静态 scope 已覆盖的路径本来就不需要这一步；真没权限时紧随其后的
   * stat / readFile 会给出更贴近现场的报错。在这里抛只会把真正的原因盖住。
   */
  it('单个路径授权失败不影响其余路径，也不向外抛', async () => {
    getInvokeMock().mockImplementation(async (_cmd, args) => {
      if ((args as { path: string }).path === 'C:/bad') throw new Error('scope 写入失败');
      return undefined;
    });

    await expect(allowUserPaths(['C:/bad', 'C:/good'])).resolves.toBeUndefined();
    expect(getInvokeMock()).toHaveBeenCalledWith('allow_user_path', { path: 'C:/good' });
  });
});
