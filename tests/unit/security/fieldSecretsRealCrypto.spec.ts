/**
 * `rekeyFieldSecrets` 的真密码机版本
 *
 * Why 与 `fieldSecrets.spec.ts` 并存而不是替换它：那份用假密码机
 * （`PNXENC:<钥匙>|<明文>` 字符串拼接）测的是遍历顺序、孤儿判定、
 * 「先解开→再换钥→再锁上」的编排，跑得快且仍然有价值。
 * 而 `vi.mock` 是**文件级**的，同一个文件没法既 mock 又不 mock。
 *
 * 这份补的是那份结构上测不到的东西：**换完钥匙，旧密文到底还解不解得开**。
 * 在此之前，「PBKDF2 派生出来的新密钥能解开搬运后的密文」这件事在自动化里
 * 从未跑过一次真的 AES-GCM——假密码机永远会说能。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { rekeyFieldSecrets } from '@/security/fieldSecrets';
import { secureStorage, SecureStorage } from '@/security/crypto';
import { getInvokeMock, resetTauriMocks, setupInvokeHandler } from '../helpers/tauriMock';

/** 固定的 32 字节测试主密钥（Base64） */
function testKey(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * 内存钥匙串：`get_or_create_secure_key` 读它，`set_secure_key` 写它
 *
 * 这是本 spec 唯一被替身掉的东西。加解密全程走真的 WebCrypto。
 */
let keychain = testKey(0x42);

/** 格式合法但 GCM tag 对不上的密文，用来造孤儿 */
const CORRUPT_CIPHERTEXT = `PNXENC:${btoa('0123456789abcdef0123456789abcdef')}`;

/** 两处字段级密文：图床 profile 一个、备份 profile 一个，外加一个不该被碰的明文 */
async function makeSnapshot() {
  return {
    config: {
      webdav_profiles: [
        {
          id: 'p1',
          name: '我的 OpenList',
          passwordEncrypted: await secureStorage.encrypt('hosting-pw'),
        },
      ],
      webdav: {
        profiles: [
          {
            id: 'b1',
            name: '坚果云',
            passwordEncrypted: await secureStorage.encrypt('backup-pw'),
          },
        ],
      },
      // 明文字段（无魔数前缀）必须原样不动
      smms: { token: 'plain-token-not-encrypted' },
    },
  };
}

beforeEach(async () => {
  resetTauriMocks();
  keychain = testKey(0x42);
  setupInvokeHandler(async (cmd, args) => {
    if (cmd === 'get_or_create_secure_key') return keychain;
    if (cmd === 'set_secure_key') {
      keychain = (args as { key: string }).key;
      return undefined;
    }
    return undefined;
  });
  // secureStorage 是模块级单例，上一条用例可能把它切进了密码模式
  await secureStorage.forceReinit();
});

describe('rekeyFieldSecrets · 真 AES-GCM 往返', () => {
  /**
   * ⭐ 本 spec 的核心：设备份密码后，旧密文必须能用新钥匙解回原文
   *
   * 这一条覆盖的是 TODO.md 里那条待验收想证的东西，而且不需要真机——
   * 真机剩下要证的只有「密钥跨进程存活」那一半。
   */
  it('设备份密码后，两处密文都换成 PNXPWD 且解回原文', async () => {
    const snapshot = await makeSnapshot();
    expect(snapshot.config.webdav_profiles[0].passwordEncrypted.startsWith('PNXENC:')).toBe(true);

    const report = await rekeyFieldSecrets([snapshot], () =>
      secureStorage.setBackupPassword('picnexus-2026'),
    );

    expect(report).toEqual({ migrated: 2, orphans: [] });

    const hosting = snapshot.config.webdav_profiles[0].passwordEncrypted;
    const backup = snapshot.config.webdav.profiles[0].passwordEncrypted;

    // 密码模式的密文带 salt，前缀必须换过来
    expect(hosting.startsWith('PNXPWD:')).toBe(true);
    expect(backup.startsWith('PNXPWD:')).toBe(true);

    // 真正的判据：解出来逐字等于原文
    expect(await secureStorage.decrypt(hosting)).toBe('hosting-pw');
    expect(await secureStorage.decrypt(backup)).toBe('backup-pw');
  });

  /** 假密码机测不出这条：它的"重新加密"就算原样抄回去也看不出来 */
  it('搬运后的密文字符串确实变了，不是原样抄回去', async () => {
    const snapshot = await makeSnapshot();
    const before = snapshot.config.webdav_profiles[0].passwordEncrypted;

    await rekeyFieldSecrets([snapshot], () => secureStorage.setBackupPassword('picnexus-2026'));

    expect(snapshot.config.webdav_profiles[0].passwordEncrypted).not.toBe(before);
  });

  /**
   * 模拟「换钥 + 重启」：拿换钥后钥匙串里的那把钥匙，从零起一个实例去解
   *
   * mocked E2E 结构上做不到这件事——它的 `set_secure_key` 是 no-op、
   * `get_or_create_secure_key` 永远返回同一个硬编码常量，换完钥必然解不开。
   * 这里用真钥匙串语义（写进去什么，下次就读出什么）补上这一环。
   */
  it('换钥后新起的实例能解开搬运结果', async () => {
    const snapshot = await makeSnapshot();
    await rekeyFieldSecrets([snapshot], () => secureStorage.setBackupPassword('picnexus-2026'));
    const hosting = snapshot.config.webdav_profiles[0].passwordEncrypted;

    // 全新实例，只能拿到钥匙串里那把（已经是换过的新钥匙）
    const restarted = new SecureStorage();

    expect(await restarted.decrypt(hosting)).toBe('hosting-pw');
  });

  /** 反向路径：清掉备份密码换回随机钥匙，密文回到 PNXENC 且明文不变 */
  it('清除备份密码后密文回到 PNXENC，明文仍然一致', async () => {
    const snapshot = await makeSnapshot();
    await rekeyFieldSecrets([snapshot], () => secureStorage.setBackupPassword('picnexus-2026'));

    const report = await rekeyFieldSecrets([snapshot], () => secureStorage.clearBackupPassword());

    expect(report.migrated).toBe(2);
    const hosting = snapshot.config.webdav_profiles[0].passwordEncrypted;
    expect(hosting.startsWith('PNXENC:')).toBe(true);
    expect(await secureStorage.decrypt(hosting)).toBe('hosting-pw');
  });

  /** 明文字段没有魔数前缀，遍历时就该被跳过 */
  it('明文字段不参与搬运', async () => {
    const snapshot = await makeSnapshot();

    await rekeyFieldSecrets([snapshot], () => secureStorage.setBackupPassword('picnexus-2026'));

    expect(snapshot.config.smms.token).toBe('plain-token-not-encrypted');
  });

  /**
   * 旧钥匙也解不开的密文：原样保留并点名，不能清掉
   *
   * 清掉的话用户连"这里配过东西"都看不出来，只会看到一个空密码框。
   */
  it('解不开的密文进 orphans 且原样保留', async () => {
    const snapshot = await makeSnapshot();
    snapshot.config.webdav.profiles[0].passwordEncrypted = CORRUPT_CIPHERTEXT;

    const report = await rekeyFieldSecrets([snapshot], () =>
      secureStorage.setBackupPassword('picnexus-2026'),
    );

    expect(report.migrated).toBe(1);
    expect(report.orphans).toEqual(['WebDAV 备份「坚果云」']);
    expect(snapshot.config.webdav.profiles[0].passwordEncrypted).toBe(CORRUPT_CIPHERTEXT);
    // 好的那条不受连累
    expect(await secureStorage.decrypt(snapshot.config.webdav_profiles[0].passwordEncrypted)).toBe(
      'hosting-pw',
    );
  });

  /** 换钥动作确实经由 set_secure_key 落到了钥匙串，而不是只改了内存态 */
  it('换钥匙走的是 set_secure_key，且新钥匙与旧的不同', async () => {
    const before = keychain;
    const snapshot = await makeSnapshot();

    await rekeyFieldSecrets([snapshot], () => secureStorage.setBackupPassword('picnexus-2026'));

    const setKeyCalls = getInvokeMock().mock.calls.filter(([cmd]) => cmd === 'set_secure_key');
    expect(setKeyCalls).toHaveLength(1);
    expect(keychain).not.toBe(before);
  });
});
