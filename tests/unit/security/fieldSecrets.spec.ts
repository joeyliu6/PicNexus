import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 假密码机：密文长成 `PNXENC:<钥匙>|<明文>`
 *
 * 真前缀是故意的——`collectSecretSlots` 用真的 `isAnyEncryptedData` 判定，
 * 换成随便一个前缀的话遍历逻辑就没被测到。
 */
const cipher = vi.hoisted(() => {
  const state = { key: 'old-key' };

  return {
    state,
    encrypt: vi.fn(async (text: string) => `PNXENC:${state.key}|${text}`),
    decrypt: vi.fn(async (data: string) => {
      const body = data.slice('PNXENC:'.length);
      const separator = body.indexOf('|');
      if (separator < 0) throw new Error('数据损坏或密钥不匹配');
      if (body.slice(0, separator) !== state.key) throw new Error('数据损坏或密钥不匹配');
      return body.slice(separator + 1);
    }),
  };
});

vi.mock('@/security/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/security/crypto')>();
  return {
    ...actual,
    secureStorage: { encrypt: cipher.encrypt, decrypt: cipher.decrypt },
  };
});

import { rekeyFieldSecrets, purgeOrphanFieldSecrets } from '@/security/fieldSecrets';

/** 用某把钥匙造一段密文 */
function encryptedWith(key: string, plaintext: string): string {
  return `PNXENC:${key}|${plaintext}`;
}

/** 两处字段级密文：图床 profile 一个、备份 profile 一个 */
function makeSnapshot(key = 'old-key') {
  return {
    config: {
      webdav_profiles: [
        { id: 'p1', name: '我的 OpenList', url: 'https://dav.example.com', passwordEncrypted: encryptedWith(key, 'hosting-pw') },
      ],
      webdav: {
        activeId: 'b1',
        profiles: [
          { id: 'b1', name: '坚果云', url: 'https://dav.jianguoyun.com/dav/', passwordEncrypted: encryptedWith(key, 'backup-pw') },
        ],
      },
      smms: { token: 'plain-token-not-encrypted' },
    },
    analytics_data: { clientId: 'client-1' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cipher.state.key = 'old-key';
});

describe('rekeyFieldSecrets', () => {
  it('decrypts every inner ciphertext before the key swap and re-encrypts with the new key', async () => {
    const snapshot = makeSnapshot();

    const report = await rekeyFieldSecrets([snapshot], async () => {
      cipher.state.key = 'new-key';
    });

    expect(report).toEqual({ migrated: 2, orphans: [] });

    // 判据是"新钥匙解得开"，不是"字符串变了"——后者换个实现就假通过
    const hosting = snapshot.config.webdav_profiles[0].passwordEncrypted;
    const backup = snapshot.config.webdav.profiles[0].passwordEncrypted;
    await expect(cipher.decrypt(hosting)).resolves.toBe('hosting-pw');
    await expect(cipher.decrypt(backup)).resolves.toBe('backup-pw');
  });

  it('leaves plaintext fields untouched', async () => {
    const snapshot = makeSnapshot();

    await rekeyFieldSecrets([snapshot], async () => {
      cipher.state.key = 'new-key';
    });

    expect(snapshot.config.smms.token).toBe('plain-token-not-encrypted');
    expect(snapshot.analytics_data.clientId).toBe('client-1');
  });

  it('walks every snapshot passed in', async () => {
    const config = makeSnapshot();
    const syncStatus = { records: { r1: { token: encryptedWith('old-key', 'sync-secret') } } };

    const report = await rekeyFieldSecrets([config, syncStatus], async () => {
      cipher.state.key = 'new-key';
    });

    expect(report.migrated).toBe(3);
    await expect(cipher.decrypt(syncStatus.records.r1.token)).resolves.toBe('sync-secret');
  });

  it('keeps ciphertext that the old key cannot open and reports it as an orphan', async () => {
    const snapshot = makeSnapshot();
    const stranger = encryptedWith('a-key-nobody-has', 'lost-forever');
    snapshot.config.webdav_profiles[0].passwordEncrypted = stranger;

    const report = await rekeyFieldSecrets([snapshot], async () => {
      cipher.state.key = 'new-key';
    });

    expect(report.migrated).toBe(1);
    expect(report.orphans).toEqual(['config.webdav_profiles[0].passwordEncrypted']);
    // 原样保留，不制造二次伤害
    expect(snapshot.config.webdav_profiles[0].passwordEncrypted).toBe(stranger);
  });

  it('leaves no half-rekeyed snapshot when re-encryption fails after the swap', async () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);
    cipher.encrypt.mockRejectedValueOnce(new Error('加密失败'));

    await expect(
      rekeyFieldSecrets([snapshot], async () => { cipher.state.key = 'new-key'; })
    ).rejects.toThrow('加密失败');

    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('propagates a failing swap without touching the snapshot', async () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);

    await expect(
      rekeyFieldSecrets([snapshot], async () => { throw new Error('钥匙串写入失败'); })
    ).rejects.toThrow('钥匙串写入失败');

    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe('purgeOrphanFieldSecrets', () => {
  it('clears undecryptable ciphertext and names the profile it belonged to', async () => {
    const snapshot = makeSnapshot();
    snapshot.config.webdav_profiles[0].passwordEncrypted = encryptedWith('gone', 'lost');
    snapshot.config.webdav.profiles[0].passwordEncrypted = encryptedWith('gone', 'lost-too');

    const cleared = await purgeOrphanFieldSecrets(snapshot);

    expect(cleared).toEqual(['WebDAV 图床「我的 OpenList」', 'WebDAV 备份「坚果云」']);
    expect(snapshot.config.webdav_profiles[0].passwordEncrypted).toBe('');
    expect(snapshot.config.webdav.profiles[0].passwordEncrypted).toBe('');
  });

  it('leaves readable ciphertext alone and reports nothing', async () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);

    await expect(purgeOrphanFieldSecrets(snapshot)).resolves.toEqual([]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('only clears the broken entry when a snapshot mixes both', async () => {
    const snapshot = makeSnapshot();
    snapshot.config.webdav.profiles[0].passwordEncrypted = encryptedWith('gone', 'lost');

    const cleared = await purgeOrphanFieldSecrets(snapshot);

    expect(cleared).toEqual(['WebDAV 备份「坚果云」']);
    await expect(
      cipher.decrypt(snapshot.config.webdav_profiles[0].passwordEncrypted)
    ).resolves.toBe('hosting-pw');
  });
});
