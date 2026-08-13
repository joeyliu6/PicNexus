// WebDAV 备份 profile 的密码加解密
//
// 只服务于备份/同步用的 `config.webdav`。WebDAV 图床（`config.webdav_profiles`）
// 走另一套：密码全程保持密文，只在上传/测试时解密，明文不进 formData。
//
// ⚠️ 加解密必须走 WebDAVClient 的静态方法（内部是 secureStorage），不要 invoke
// Rust 命令。这里曾经调用 `encrypt_webdav_password` / `decrypt_webdav_password`，
// 而这两个命令在 Rust 侧从未存在过——加密每次都抛错，被 catch 吞掉后仍然清空
// 明文，结果是用户每存一次设置，备份密码就被静默清掉一次。
// 单测把这两个不存在的命令 mock 成存在的，所以测试全绿、生产全挂。

import type { WebDAVProfile } from '../../config/types';
import { WebDAVClient } from '../../utils/webdav';
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
          p.password = await WebDAVClient.decryptPassword(p.passwordEncrypted);
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
 * 导致跳过加密、旧密文被回写。现在密文每次都按当前明文重算，多一次开销但
 * 避免静默丢失改动。空 password 视作"保持已加密值不变"。
 *
 * Why 加密失败时保留明文：清空明文而密文又没生成，等于把密码彻底弄丢——
 * 这正是历史上那个 bug 的杀伤力所在。退化成明文是可控的：
 * `WebDAVClient.fromEncryptedConfig` 本来就有明文兜底分支，而 `.settings.dat`
 * 整体是 PNXENC 加密存储的。「明文躺在加密文件里」远好过「密码没了」。
 */
export async function encryptBackupProfiles(profiles: WebDAVProfile[]): Promise<WebDAVProfile[]> {
  return Promise.all(
    (profiles || []).map(async (p) => {
      if (!p.password) {
        // 没填明文：保持已有密文不变，明文字段维持空
        return { ...p, password: '', passwordEncrypted: p.passwordEncrypted };
      }

      try {
        const passwordEncrypted = await WebDAVClient.encryptPassword(p.password);
        return { ...p, password: '', passwordEncrypted };
      } catch (e) {
        log.error('WebDAV 加密失败，保留明文以免密码丢失', e);
        return { ...p };
      }
    })
  );
}
