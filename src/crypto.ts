// 加密存储工具类，使用 Web Crypto API 进行 AES-GCM 加密
// v3.0: 支持备份密码加密模式，可跨电脑恢复配置
import { invoke } from '@tauri-apps/api/core';

/**
 * 加密数据魔数前缀（随机密钥模式，绑定本机）
 */
const ENCRYPTED_MAGIC_PREFIX = 'PNXENC:';

/**
 * 备份密码加密前缀（用户密码派生密钥，可跨机恢复）
 * 数据格式：PNXPWD:Base64(salt(16) + iv(12) + ciphertext)
 */
const PASSWORD_ENCRYPTED_PREFIX = 'PNXPWD:';

/** PBKDF2 迭代次数 */
const PBKDF2_ITERATIONS = 100000;

/** 盐值长度（字节） */
const SALT_LENGTH = 16;

/** IV 长度（字节） */
const IV_LENGTH = 12;

/**
 * 备份密码必须解密的错误
 * 当检测到 PNXPWD 加密数据但无法解密时抛出
 */
export class BackupPasswordRequiredError extends Error {
  constructor(message = '需要输入备份密码才能解密配置') {
    super(message);
    this.name = 'BackupPasswordRequiredError';
  }
}

/**
 * 检查数据是否为随机密钥加密格式
 */
export function isEncryptedData(data: string): boolean {
  return data.startsWith(ENCRYPTED_MAGIC_PREFIX);
}

/**
 * 检查数据是否为备份密码加密格式
 */
export function isPasswordEncryptedData(data: string): boolean {
  return data.startsWith(PASSWORD_ENCRYPTED_PREFIX);
}

/**
 * 检查数据是否为任意加密格式
 */
export function isAnyEncryptedData(data: string): boolean {
  return isEncryptedData(data) || isPasswordEncryptedData(data);
}

/**
 * 将 Base64 字符串转为 Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * 将 Uint8Array 转为 Base64 字符串
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 从密码和盐值派生 AES-GCM 密钥
 * @param extractable 是否允许导出密钥原始字节，默认 false；仅在需要存入钥匙串时传 true
 */
async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  extractable = false
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}

/**
 * 从密码派生密钥的原始字节（用于存入钥匙串）
 */
async function deriveRawKeyFromPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await deriveKeyFromPassword(password, salt, true);
  const rawKey = await window.crypto.subtle.exportKey('raw', key);
  return bytesToBase64(new Uint8Array(rawKey));
}

/**
 * 验证备份密码强度
 * 规则：至少 8 位，必须包含字母和数字
 */
export function validateBackupPassword(password: string): { valid: boolean; message: string } {
  if (password.length < 8) {
    return { valid: false, message: '密码长度至少 8 位' };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个字母' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: '密码必须包含至少一个数字' };
  }
  return { valid: true, message: '' };
}

/**
 * 安全存储类
 * 支持两种加密模式：
 * 1. 随机密钥模式（PNXENC）：密钥由系统钥匙串保护，绑定本机
 * 2. 备份密码模式（PNXPWD）：密钥由用户密码派生，可跨电脑恢复
 */
export class SecureStorage {
  private key: CryptoKey | null = null;
  /** 当前加密模式 */
  private mode: 'random' | 'password' = 'random';
  /** 备份密码的盐值（仅密码模式有值） */
  private passwordSalt: Uint8Array | null = null;

  /**
   * 从 Base64 密钥导入并更新内部状态
   */
  private async applyKey(
    keyB64: string,
    mode: 'random' | 'password',
    salt: Uint8Array | null
  ): Promise<void> {
    this.key = await window.crypto.subtle.importKey(
      'raw',
      base64ToBytes(keyB64) as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    this.mode = mode;
    this.passwordSalt = salt;
  }

  /**
   * 解析 PNXPWD 格式的加密数据，拆出 salt / iv / ciphertext
   */
  private parsePasswordData(encryptedData: string): { salt: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array } {
    const base64Data = encryptedData.startsWith(PASSWORD_ENCRYPTED_PREFIX)
      ? encryptedData.slice(PASSWORD_ENCRYPTED_PREFIX.length)
      : encryptedData;

    const combined = base64ToBytes(base64Data);
    if (combined.length < SALT_LENGTH + IV_LENGTH + 1) {
      throw new Error('加密数据格式无效');
    }

    return {
      salt: combined.slice(0, SALT_LENGTH),
      iv: combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH),
      ciphertext: combined.slice(SALT_LENGTH + IV_LENGTH),
    };
  }

  /**
   * 初始化：从 Rust 端获取密钥并导入为 CryptoKey
   */
  async init(): Promise<void> {
    if (this.key) return;

    try {
      const keyB64 = await invoke<string>('get_or_create_secure_key');
      await this.applyKey(keyB64, 'random', null);
      console.log('[SecureStorage] ✓ 密钥初始化成功');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[SecureStorage] 密钥初始化失败:', errorMsg);
      throw new Error(`密钥初始化失败: ${errorMsg}`);
    }
  }

  /**
   * 强制重新初始化：清除内部缓存后重新从钥匙串加载密钥
   * 用于密钥回滚场景——钥匙串已恢复为旧密钥，但内存状态仍是新密钥
   */
  async forceReinit(): Promise<void> {
    this.key = null;
    this.mode = 'random';
    this.passwordSalt = null;
    await this.init();
  }

  /**
   * 用备份密码初始化（新机器恢复场景）
   * 从加密数据中提取盐值，用密码派生密钥，并存入系统钥匙串
   */
  async initWithPassword(encryptedData: string, password: string): Promise<void> {
    const { salt, iv, ciphertext } = this.parsePasswordData(encryptedData);

    const derivedKey = await deriveKeyFromPassword(password, salt, true);
    try {
      await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        derivedKey,
        ciphertext as BufferSource
      );
    } catch {
      throw new Error('迁移密码不正确');
    }

    // 密码验证通过，导出密钥存入钥匙串
    const rawKey = await window.crypto.subtle.exportKey('raw', derivedKey);
    const derivedKeyB64 = bytesToBase64(new Uint8Array(rawKey));
    await invoke('set_secure_key', { key: derivedKeyB64 });
    await this.applyKey(derivedKeyB64, 'password', salt);

    console.log('[SecureStorage] ✓ 备份密码验证通过，密钥已更新');
  }

  /**
   * 设置备份密码
   * 生成新盐值，派生密钥，替换钥匙串中的密钥
   */
  async setBackupPassword(password: string): Promise<void> {
    const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const derivedKeyB64 = await deriveRawKeyFromPassword(password, salt);

    await invoke('set_secure_key', { key: derivedKeyB64 });
    await this.applyKey(derivedKeyB64, 'password', salt);

    console.log('[SecureStorage] ✓ 备份密码已设置');
  }

  /**
   * 清除备份密码，切回随机密钥模式
   */
  async clearBackupPassword(): Promise<void> {
    const keyBytes = window.crypto.getRandomValues(new Uint8Array(32));
    const keyB64 = bytesToBase64(keyBytes);

    await invoke('set_secure_key', { key: keyB64 });
    await this.applyKey(keyB64, 'random', null);

    console.log('[SecureStorage] ✓ 已切回随机密钥模式');
  }

  /**
   * 检查是否处于备份密码模式
   */
  isPasswordMode(): boolean {
    return this.mode === 'password';
  }

  /**
   * 加密数据
   * 根据当前模式决定使用 PNXENC 还是 PNXPWD 前缀
   */
  async encrypt(text: string): Promise<string> {
    if (!this.key) {
      await this.init();
    }

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));

      const encryptedContent = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        this.key!,
        data
      );

      if (this.mode === 'password' && this.passwordSalt) {
        // 备份密码模式：salt(16) + iv(12) + ciphertext
        const combined = new Uint8Array(
          SALT_LENGTH + IV_LENGTH + encryptedContent.byteLength
        );
        combined.set(this.passwordSalt);
        combined.set(iv, SALT_LENGTH);
        combined.set(new Uint8Array(encryptedContent), SALT_LENGTH + IV_LENGTH);
        return PASSWORD_ENCRYPTED_PREFIX + bytesToBase64(combined);
      }

      // 随机密钥模式：iv(12) + ciphertext
      const combined = new Uint8Array(IV_LENGTH + encryptedContent.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encryptedContent), IV_LENGTH);
      return ENCRYPTED_MAGIC_PREFIX + bytesToBase64(combined);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[SecureStorage] 加密失败:', errorMsg);
      throw new Error(`加密失败: ${errorMsg}`);
    }
  }

  /**
   * 解密数据
   * 自动识别 PNXENC 和 PNXPWD 两种格式
   * 对于 PNXPWD 格式：如果钥匙串密钥无法解密，抛出 BackupPasswordRequiredError
   */
  async decrypt(encryptedData: string): Promise<string> {
    if (!this.key) {
      await this.init();
    }

    try {
      if (encryptedData.startsWith(PASSWORD_ENCRYPTED_PREFIX)) {
        return await this.decryptPasswordData(encryptedData);
      }

      // PNXENC 格式或旧版格式
      let encryptedBase64 = encryptedData;
      if (encryptedData.startsWith(ENCRYPTED_MAGIC_PREFIX)) {
        encryptedBase64 = encryptedData.slice(ENCRYPTED_MAGIC_PREFIX.length);
      }

      const combined = base64ToBytes(encryptedBase64);
      const iv = combined.slice(0, IV_LENGTH);
      const data = combined.slice(IV_LENGTH);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        this.key!,
        data
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (error) {
      // 如果是备份密码错误，直接传递
      if (error instanceof BackupPasswordRequiredError) {
        throw error;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[SecureStorage] 解密失败:', errorMsg);
      throw new Error('数据损坏或密钥不匹配');
    }
  }

  /**
   * 解密 PNXPWD 格式数据
   * 尝试用钥匙串中的密钥解密，失败则抛出 BackupPasswordRequiredError
   */
  private async decryptPasswordData(encryptedData: string): Promise<string> {
    const { salt, iv, ciphertext } = this.parsePasswordData(encryptedData);

    try {
      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        this.key!,
        ciphertext as BufferSource
      );

      // 解密成功，说明钥匙串中的密钥就是密码派生的密钥
      this.mode = 'password';
      this.passwordSalt = salt;

      return new TextDecoder().decode(decryptedBuffer);
    } catch {
      // 钥匙串密钥无法解密（新电脑场景），需要用户输入密码
      throw new BackupPasswordRequiredError();
    }
  }
}

/**
 * 导出单例
 */
export const secureStorage = new SecureStorage();
