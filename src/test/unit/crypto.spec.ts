import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  isEncryptedData,
  isPasswordEncryptedData,
  isAnyEncryptedData,
  validateBackupPassword,
  decryptWithPassword,
  BackupPasswordRequiredError,
  SecureStorage,
} from '../../crypto';

// --- 测试辅助 ---

const invokeMock = vi.mocked(invoke);

/** 生成固定的 32 字节测试密钥（Base64） */
function makeTestKeyB64(): string {
  const bytes = new Uint8Array(32).fill(0x42);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const TEST_KEY_B64 = makeTestKeyB64();

// ─── 纯函数 ─────────────────────────────────────────────────────────────────

describe('isEncryptedData', () => {
  it('PNXENC: 前缀 → true', () => {
    expect(isEncryptedData('PNXENC:abc123')).toBe(true);
  });

  it('PNXPWD: 前缀 → false', () => {
    expect(isEncryptedData('PNXPWD:abc123')).toBe(false);
  });

  it('普通文本 → false', () => {
    expect(isEncryptedData('{"key":"value"}')).toBe(false);
  });
});

describe('isPasswordEncryptedData', () => {
  it('PNXPWD: 前缀 → true', () => {
    expect(isPasswordEncryptedData('PNXPWD:abc123')).toBe(true);
  });

  it('PNXENC: 前缀 → false', () => {
    expect(isPasswordEncryptedData('PNXENC:abc123')).toBe(false);
  });
});

describe('isAnyEncryptedData', () => {
  it('PNXENC → true', () => {
    expect(isAnyEncryptedData('PNXENC:abc')).toBe(true);
  });

  it('PNXPWD → true', () => {
    expect(isAnyEncryptedData('PNXPWD:abc')).toBe(true);
  });

  it('明文 → false', () => {
    expect(isAnyEncryptedData('plain text')).toBe(false);
  });
});

describe('validateBackupPassword', () => {
  it('少于 8 位 → invalid', () => {
    const result = validateBackupPassword('Abc1');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('8 位');
  });

  it('无数字 → invalid', () => {
    const result = validateBackupPassword('AbcdefgH');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('数字');
  });

  it('8 位且含数字 → valid', () => {
    const result = validateBackupPassword('Password1');
    expect(result.valid).toBe(true);
    expect(result.message).toBe('');
  });

  it('恰好 8 位边界 → valid', () => {
    expect(validateBackupPassword('1234567A').valid).toBe(true);
  });
});

// ─── decryptWithPassword（独立函数，不依赖 SecureStorage 实例） ───────────────

describe('decryptWithPassword', () => {
  it('正确密码可以解密', async () => {
    invokeMock.mockResolvedValue(undefined);
    const s = new SecureStorage();
    await s.setBackupPassword('Password123');
    const encrypted = await s.encrypt('hello world');

    const result = await decryptWithPassword(encrypted, 'Password123');
    expect(result).toBe('hello world');
  });

  it('错误密码抛出"迁移密码不正确"', async () => {
    invokeMock.mockResolvedValue(undefined);
    const s = new SecureStorage();
    await s.setBackupPassword('Password123');
    const encrypted = await s.encrypt('hello world');

    await expect(decryptWithPassword(encrypted, 'WrongPass1')).rejects.toThrow('迁移密码不正确');
  });
});

// ─── SecureStorage ───────────────────────────────────────────────────────────

describe('SecureStorage', () => {
  let storage: SecureStorage;

  beforeEach(() => {
    storage = new SecureStorage();
    invokeMock.mockReset();
    // 默认行为：get_or_create_secure_key 返回测试密钥，set_secure_key 返回 undefined
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_or_create_secure_key') return Promise.resolve(TEST_KEY_B64);
      return Promise.resolve(undefined);
    });
  });

  // --- init ---

  describe('init()', () => {
    it('首次调用触发一次 invoke', async () => {
      await storage.init();
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith('get_or_create_secure_key');
    });

    it('已初始化后再调用不触发 invoke', async () => {
      await storage.init();
      await storage.init();
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });

    it('并发调用只触发一次 invoke（防竞态核心测试）', async () => {
      await Promise.all([storage.init(), storage.init(), storage.init()]);
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });

    it('失败后重置 initPromise，允许重试', async () => {
      invokeMock
        .mockRejectedValueOnce(new Error('keychain 不可用'))
        .mockResolvedValueOnce(TEST_KEY_B64);

      await expect(storage.init()).rejects.toThrow('密钥初始化失败');
      // 失败后 initPromise 已清空，第二次应成功
      await expect(storage.init()).resolves.toBeUndefined();
    });
  });

  // --- forceReinit ---

  describe('forceReinit()', () => {
    it('清除内存状态后重新调用 invoke', async () => {
      await storage.init();
      expect(invokeMock).toHaveBeenCalledTimes(1);

      await storage.forceReinit();
      expect(invokeMock).toHaveBeenCalledTimes(2);
    });
  });

  // --- 随机密钥模式加密/解密 ---

  describe('encrypt/decrypt（随机密钥模式）', () => {
    it('加密结果带 PNXENC: 前缀', async () => {
      const encrypted = await storage.encrypt('test payload');
      expect(encrypted).toMatch(/^PNXENC:/);
    });

    it('加密 → 解密往返正确', async () => {
      const plaintext = '{"token":"abc123","host":"example.com"}';
      const encrypted = await storage.encrypt(plaintext);
      const decrypted = await storage.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypt 未初始化时自动调用 init', async () => {
      await storage.encrypt('auto init check');
      expect(invokeMock).toHaveBeenCalledWith('get_or_create_secure_key');
    });

    it('每次加密产生不同密文（随机 IV）', async () => {
      const a = await storage.encrypt('same data');
      const b = await storage.encrypt('same data');
      expect(a).not.toBe(b);
    });
  });

  // --- 备份密码模式 ---

  describe('setBackupPassword / 备份密码模式', () => {
    it('设置密码后 isPasswordMode() 为 true', async () => {
      expect(storage.isPasswordMode()).toBe(false);
      await storage.setBackupPassword('Password123');
      expect(storage.isPasswordMode()).toBe(true);
    });

    it('加密结果带 PNXPWD: 前缀', async () => {
      await storage.setBackupPassword('Password123');
      const encrypted = await storage.encrypt('secret');
      expect(encrypted).toMatch(/^PNXPWD:/);
    });

    it('加密 → 解密往返正确', async () => {
      await storage.setBackupPassword('Password123');
      const plaintext = '{"api_key":"super_secret_value"}';
      const encrypted = await storage.encrypt(plaintext);
      const decrypted = await storage.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });

  // --- clearBackupPassword ---

  describe('clearBackupPassword()', () => {
    it('清除后 isPasswordMode() 变为 false', async () => {
      await storage.setBackupPassword('Password123');
      await storage.clearBackupPassword();
      expect(storage.isPasswordMode()).toBe(false);
    });

    it('清除后加密回到 PNXENC: 前缀', async () => {
      await storage.setBackupPassword('Password123');
      await storage.clearBackupPassword();
      const encrypted = await storage.encrypt('back to random');
      expect(encrypted).toMatch(/^PNXENC:/);
    });
  });

  // --- initWithPassword ---

  describe('initWithPassword()', () => {
    it('正确密码初始化后能解密数据', async () => {
      // 源机器：设置备份密码，加密数据
      const s1 = new SecureStorage();
      await s1.setBackupPassword('Password123');
      const encrypted = await s1.encrypt('cross-machine data');

      // 新机器：用密码初始化
      const s2 = new SecureStorage();
      await s2.initWithPassword(encrypted, 'Password123');
      const decrypted = await s2.decrypt(encrypted);
      expect(decrypted).toBe('cross-machine data');
    });

    it('错误密码抛出"迁移密码不正确"', async () => {
      await storage.setBackupPassword('Password123');
      const encrypted = await storage.encrypt('data');

      const s2 = new SecureStorage();
      await expect(s2.initWithPassword(encrypted, 'WrongPass1')).rejects.toThrow('迁移密码不正确');
    });
  });

  // --- 错误场景 ---

  describe('decrypt() 错误场景', () => {
    it('用随机密钥解密 PNXPWD 数据 → BackupPasswordRequiredError', async () => {
      // s1 用密码加密
      const s1 = new SecureStorage();
      await s1.setBackupPassword('Password123');
      const encrypted = await s1.encrypt('protected');

      // s2 用不同的随机密钥解密 → 应抛出 BackupPasswordRequiredError
      const s2 = new SecureStorage();
      // 返回与 s1 完全不同的合法 32 字节密钥
      const differentKey = (() => {
        const b = new Uint8Array(32).fill(0x99);
        let bin = '';
        for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
        return btoa(bin);
      })();
      invokeMock.mockResolvedValue(differentKey);
      await expect(s2.decrypt(encrypted)).rejects.toThrow(BackupPasswordRequiredError);
    });

    it('损坏的 PNXENC 数据 → "数据损坏或密钥不匹配"', async () => {
      await storage.init();
      await expect(storage.decrypt('PNXENC:notvalidbase64!!!')).rejects.toThrow('数据损坏或密钥不匹配');
    });

    it('数据太短的 PNXPWD 数据 → 抛出', async () => {
      await storage.init();
      // Base64 编码 "ab"（长度不足 salt+iv+ciphertext）
      await expect(storage.decrypt('PNXPWD:' + btoa('ab'))).rejects.toThrow();
    });
  });
});
