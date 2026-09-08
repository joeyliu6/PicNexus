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
} from '@/security/crypto';

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

function useLastStoredSecureKeyForReads(): string {
  const setKeyCall = [...invokeMock.mock.calls]
    .reverse()
    .find(([cmd]) => cmd === 'set_secure_key');
  const key = (setKeyCall?.[1] as { key?: string } | undefined)?.key;
  if (!key) throw new Error('set_secure_key was not called before secure key read remock');

  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_or_create_secure_key') return Promise.resolve(key);
    return Promise.resolve(undefined);
  });
  return key;
}

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

    it('verifyBackupPassword 正确密码返回 true，且不写入钥匙串', async () => {
      await storage.setBackupPassword('Password123');
      const storedKey = useLastStoredSecureKeyForReads();
      invokeMock.mockClear();

      await expect(storage.verifyBackupPassword('Password123')).resolves.toBe(true);

      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith('get_or_create_secure_key');
      expect(invokeMock).not.toHaveBeenCalledWith('set_secure_key', { key: storedKey });
    });

    it('verifyBackupPassword 错误密码返回 false', async () => {
      await storage.setBackupPassword('Password123');
      useLastStoredSecureKeyForReads();

      await expect(storage.verifyBackupPassword('WrongPass1')).resolves.toBe(false);
    });
  });

  // --- clearBackupPassword ---

  describe('clearBackupPassword()', () => {
    it('随机密钥模式下 verifyBackupPassword 返回 false', async () => {
      await expect(storage.verifyBackupPassword('Password123')).resolves.toBe(false);
    });

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

    it('清除后 verifyBackupPassword 返回 false', async () => {
      await storage.setBackupPassword('Password123');
      await storage.clearBackupPassword();

      await expect(storage.verifyBackupPassword('Password123')).resolves.toBe(false);
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

/**
 * P0-1 回归：主窗口（main）与托盘常驻窗口（tray）各有一份独立的 SecureStorage 单例，
 * 但共享同一套系统钥匙串（这里用一个可写的 `keychain` 变量模拟 get_or_create_secure_key /
 * set_secure_key 这对 IPC 命令的真实语义——谁调用 set_secure_key，钥匙串就变成谁写的那把）。
 *
 * 复现与修法见 docs/audits/scan-config-mirror-2026-09-07.md P0-1：
 * 主窗口换密钥后，托盘手里还是旧的 CryptoKey，直到它自己也 forceReinit() 一次为止。
 */
describe('P0-1 回归：托盘常驻窗口的密钥轮换', () => {
  function mockSharedKeychain(initial: string): { get current(): string } {
    const state = { key: initial };
    // 形参不标注类型：invoke 的第二参是 InvokeArgs，写窄了会被 strictFunctionTypes 判为不兼容
    invokeMock.mockImplementation((cmd, args) => {
      if (cmd === 'get_or_create_secure_key') return Promise.resolve(state.key);
      if (cmd === 'set_secure_key') {
        state.key = (args as { key: string }).key;
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
    return {
      get current() { return state.key; },
    };
  }

  it('复现前提：托盘不刷新的话，换密码后它仍会用旧密钥加密（PNXENC 而不是 PNXPWD）', async () => {
    mockSharedKeychain(TEST_KEY_B64);
    const main = new SecureStorage();
    const tray = new SecureStorage();
    await main.init();
    await tray.init(); // 托盘启动时读了一次，缓存了旧的随机密钥

    await main.setBackupPassword('Password123'); // 钥匙串 → 口令派生密钥

    // 托盘还没收到任何通知，写盘用的还是旧密钥、旧格式
    const staleWrite = await tray.encrypt('tray edit before fix');
    expect(staleWrite.startsWith('PNXENC:')).toBe(true);
  });

  it('修法生效：托盘 forceReinit() + 一次真实解密后，写盘的格式和密钥都和主窗口一致', async () => {
    mockSharedKeychain(TEST_KEY_B64);
    const main = new SecureStorage();
    const tray = new SecureStorage();
    await main.init();
    await tray.init();

    await main.setBackupPassword('Password123');
    const passwordEncryptedConfig = await main.encrypt('config after password'); // 换密钥后主窗口立刻重新加密写回

    // 对应 TrayMenuWindow.handleSecureKeyRotated：先 forceReinit() 拿新密钥字节，
    // 再靠 refreshTrayState() → readFreshConfig() 触发的这次真实解密回填 password 模式
    await tray.forceReinit();
    await tray.decrypt(passwordEncryptedConfig);

    const trayWrite = await tray.encrypt('tray edit after fix');
    expect(trayWrite.startsWith('PNXPWD:')).toBe(true);
    // 不只是格式对了，密钥字节也确实一致——用主窗口能正常解开托盘写的内容
    await expect(main.decrypt(trayWrite)).resolves.toBe('tray edit after fix');
  });

  it('顺序踩坑点：forceReinit() 本身不会回填 password 模式，必须紧接着一次真实解密才行', async () => {
    mockSharedKeychain(TEST_KEY_B64);
    const main = new SecureStorage();
    const tray = new SecureStorage();
    await main.init();
    await tray.init();

    await main.setBackupPassword('Password123');
    const passwordEncrypted = await main.encrypt('config after password');

    await tray.forceReinit();
    // forceReinit() 内部把 mode 硬编码回 'random'——密钥字节已经对了，但标签还没跟上
    expect(tray.isPasswordMode()).toBe(false);

    // 对应 TrayMenuWindow.handleSecureKeyRotated 里紧接着的 refreshTrayState() → 一次真实解密
    await expect(tray.decrypt(passwordEncrypted)).resolves.toBe('config after password');
    expect(tray.isPasswordMode()).toBe(true);

    // 顺序对了之后，托盘自己再写盘就会正确标成 PNXPWD，不会退化回 PNXENC
    const trayWrite = await tray.encrypt('tray edit');
    expect(trayWrite.startsWith('PNXPWD:')).toBe(true);
  });
});
