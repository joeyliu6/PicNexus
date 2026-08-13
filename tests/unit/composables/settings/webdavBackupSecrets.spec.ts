import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WebDAVProfile } from '@/config/types';
import {
  decryptBackupProfiles,
  encryptBackupProfiles,
} from '@/composables/settings/webdavBackupSecrets';

// mock 的是**真实存在**的模块导出。此前 useSettingsForm.spec 伪造了两个
// Rust 侧从未实现的 Tauri 命令（encrypt_webdav_password / decrypt_webdav_password），
// 测试因此全绿而生产每次保存都静默清空备份密码。
vi.mock('@/utils/webdav', () => ({
  WebDAVClient: {
    encryptPassword: vi.fn(async (password: string) => `cipher(${password})`),
    decryptPassword: vi.fn(async (encrypted: string) => {
      if (encrypted === 'bad-cipher') throw new Error('decrypt failed');
      return encrypted.replace(/^cipher\((.*)\)$/, '$1');
    }),
  },
}));

const { WebDAVClient } = await import('@/utils/webdav');

function makeProfile(over: Partial<WebDAVProfile> = {}): WebDAVProfile {
  return {
    id: 'dav-1',
    name: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    username: 'me',
    remotePath: '/PicNexus/',
    ...over,
  } as WebDAVProfile;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('encryptBackupProfiles', () => {
  it('encrypts the plaintext and clears it from the persisted profile', async () => {
    const [saved] = await encryptBackupProfiles([makeProfile({ password: 'secret' })]);

    expect(saved.passwordEncrypted).toBe('cipher(secret)');
    expect(saved.password).toBe('');
  });

  it('re-encrypts on every save so password edits are not silently dropped', async () => {
    // 旧实现的条件是 `password && !passwordEncrypted`：加载过的 profile 两个字段
    // 都有值，改密码时永远跳过加密、把旧密文原样回写。
    const [saved] = await encryptBackupProfiles([
      makeProfile({ password: 'new-secret', passwordEncrypted: 'cipher(old-secret)' }),
    ]);

    expect(saved.passwordEncrypted).toBe('cipher(new-secret)');
  });

  it('keeps the existing ciphertext untouched when no plaintext was entered', async () => {
    const [saved] = await encryptBackupProfiles([
      makeProfile({ password: '', passwordEncrypted: 'cipher(kept)' }),
    ]);

    expect(saved.passwordEncrypted).toBe('cipher(kept)');
    expect(WebDAVClient.encryptPassword).not.toHaveBeenCalled();
  });

  // 核心回归护栏：这正是用户实际踩的数据丢失
  it('never leaves both password fields empty when encryption fails', async () => {
    vi.mocked(WebDAVClient.encryptPassword).mockRejectedValueOnce(new Error('boom'));

    // 首次配置：没有任何旧密文可以退守
    const [saved] = await encryptBackupProfiles([makeProfile({ password: 'first-secret' })]);

    expect(saved.password || saved.passwordEncrypted).toBeTruthy();
    expect(saved.password).toBe('first-secret');
  });

  it('keeps the old ciphertext as well when encryption fails on an edit', async () => {
    vi.mocked(WebDAVClient.encryptPassword).mockRejectedValueOnce(new Error('boom'));

    const [saved] = await encryptBackupProfiles([
      makeProfile({ password: 'new-secret', passwordEncrypted: 'cipher(old)' }),
    ]);

    expect(saved.password).toBe('new-secret');
    expect(saved.passwordEncrypted).toBe('cipher(old)');
  });

  it('tolerates an empty or missing profile list', async () => {
    await expect(encryptBackupProfiles([])).resolves.toEqual([]);
    await expect(
      encryptBackupProfiles(undefined as unknown as WebDAVProfile[])
    ).resolves.toEqual([]);
  });
});

describe('decryptBackupProfiles', () => {
  it('restores the plaintext for editing in the settings form', async () => {
    const [loaded] = await decryptBackupProfiles([
      makeProfile({ passwordEncrypted: 'cipher(secret)' }),
    ]);

    expect(loaded.password).toBe('secret');
  });

  it('does not overwrite a plaintext the user is already editing', async () => {
    const [loaded] = await decryptBackupProfiles([
      makeProfile({ password: 'being-typed', passwordEncrypted: 'cipher(secret)' }),
    ]);

    expect(loaded.password).toBe('being-typed');
    expect(WebDAVClient.decryptPassword).not.toHaveBeenCalled();
  });

  // 一条坏记录不能卡死整个设置页加载
  it('blanks the password and keeps going when one record fails to decrypt', async () => {
    const loaded = await decryptBackupProfiles([
      makeProfile({ id: 'bad', passwordEncrypted: 'bad-cipher' }),
      makeProfile({ id: 'good', passwordEncrypted: 'cipher(ok)' }),
    ]);

    expect(loaded[0].password).toBe('');
    expect(loaded[1].password).toBe('ok');
  });
});
