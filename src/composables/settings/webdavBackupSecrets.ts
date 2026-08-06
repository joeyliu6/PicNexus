// WebDAV 备份 profile 的密码加解密
//
// 只服务于备份/同步用的 `config.webdav`。WebDAV 图床（`config.webdav_profiles`）
// 走另一套：密码全程保持密文，只在上传/测试时解密，明文不进 formData。

import { invoke } from '@tauri-apps/api/core';
import type { WebDAVProfile } from '../../config/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('WebDAVSecrets');

/**
 * 读取时解密：把磁盘上的密文还原成 UI 可编辑的明文
 * 解密失败时置空而非抛错，避免一条坏记录卡死整个设置页加载
 */
export async function decryptBackupProfiles(profiles: WebDAVProfile[]): Promise<WebDAVProfile[]> {
  return Promise.all(
    (profiles || []).map(async (p: WebDAVProfile) => {
      if (p.passwordEncrypted && !p.password) {
        try {
          p.password = await invoke<string>('decrypt_webdav_password', { encrypted: p.passwordEncrypted });
        } catch (e) {
          log.error('WebDAV 解密失败', e);
          p.password = '';
        }
      }
      return p;
    })
  );
}

/**
 * 保存时加密：明文重新加密后落盘，formData 里的明文字段清空
 *
 * Why "只要 password 非空就重新加密"：旧条件 `p.password && !passwordEncrypted`
 * 在"已加载过的 profile 用户改密码"时永远为 false——loadSettings 解密后
 * password / passwordEncrypted 都填了，UI 改 password 时也没清 passwordEncrypted，
 * 导致跳过加密、旧密文被回写。现在密文每次都按当前明文重算，多一次 IPC 但
 * 避免静默丢失改动。空 password 视作"保持已加密值不变"。
 */
export async function encryptBackupProfiles(profiles: WebDAVProfile[]): Promise<WebDAVProfile[]> {
  return Promise.all(
    (profiles || []).map(async (p) => {
      let passwordEncrypted = p.passwordEncrypted;
      if (p.password) {
        try {
          passwordEncrypted = await invoke<string>('encrypt_webdav_password', { password: p.password });
        } catch (e) {
          log.error('WebDAV 加密失败', e);
        }
      }
      return { ...p, password: '', passwordEncrypted };
    })
  );
}
