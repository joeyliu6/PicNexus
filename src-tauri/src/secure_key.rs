// src-tauri/src/secure_key.rs
//! 系统钥匙串密钥管理 + `cli-config.json` 的信封加密
//!
//! ## 为什么需要这个模块
//!
//! `cli-config.json` 是留给「没有 GUI 进程」的三条链路（CLI 直传 / Typora 子进程 /
//! Obsidian）读取的图床配置。它们解不开 `.settings.dat`（那份由前端 WebCrypto 加密，
//! 密钥在 GUI 内存里），所以历史实现是把**解密后的明文凭证**原样落盘——GitHub token、
//! 各家 OSS 的 secret key、全部 cookie，以及 WebDAV 的 NAS 账号密码。
//!
//! ## 为什么「密钥分发」不是问题
//!
//! 曾经的判断是「要加密得先解决 CLI 独立进程怎么拿到密钥」。这个判断是错的：
//! 系统钥匙串的访问控制单位是**用户账号**，而 CLI 进程与 GUI 跑在同一个账号下，
//! 于是它直接 `Entry::get_password()` 就能拿到同一把密钥，根本不需要「分发」。
//! 这也正是 `gh` / `docker` / VS Code 的做法。
//!
//! ## 为什么是「信封加密」而不是把凭证直接塞进钥匙串
//!
//! Windows 凭据管理器单条凭据的 blob 上限只有 2560 字节（`CRED_MAX_CREDENTIAL_BLOB_SIZE`），
//! 配几个图床就会撑爆。所以走标准信封：**钥匙串只存 32 字节主密钥，文件用它加密**。
//!
//! ## 这层加密防得住什么、防不住什么
//!
//! - ✅ 文件离开本机后作废：被网盘同步、混进备份包、随日志发出去、换机拷贝
//! - ✅ 同机器上的**其他用户账号**（配合 Unix 0600 与 Windows 默认 ACL）
//! - ❌ **以当前用户身份运行的恶意程序**——它同样能问钥匙串要到密钥
//!
//! 最后一条是所有本机凭证存储的共同上限，不是本实现的缺陷：VS Code 被演示过恶意扩展
//! 可以读走全部 secret，微软的结论是「这是不做扩展沙箱的必然结果」，不予修复。
//!
//! ## 刻意避开的两个业界实现坑
//!
//! Electron `safeStorage`（VS Code 在用）踩过两个坑，这里都绕开了：
//!
//! 1. 它用 AES-128-CBC + **硬编码 IV**（16 个空格），同样的明文加出来密文一样，
//!    不解密光比对密文就能推断信息。这里用 **AES-256-GCM + 每次随机 nonce**，
//!    且 GCM 自带完整性校验，文件被篡改会解密失败而不是解出垃圾。
//! 2. 它在 Linux 缺钥匙串时**静默降级**到近乎无加密的模式，用户毫不知情。
//!    这里降级必须是响的：调用方拿到 [`ConfigWriteMode::Plaintext`] 后会打 warn 日志
//!    并向前端上报，由设置页提示用户。

use crate::error::AppError;
use crate::portable;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::Entry;
use rand::Rng;

/// 钥匙串条目标识（与 `.settings.dat` 共用同一把密钥，不要改动）
const SERVICE_NAME: &str = "us.picnex.app.secure";
const KEY_NAME: &str = "config_encryption_key";

/// 加密态 `cli-config.json` 的魔数前缀
///
/// 明文 JSON 必然以 `{` 开头，所以只看首字符就能区分两种格式，
/// 老版本写下的明文文件仍然读得动（见 [`decrypt_config`]）。
pub const CLI_CONFIG_MAGIC: &str = "PNXCLI1:";

/// AES-GCM 标准 nonce 长度
const NONCE_LEN: usize = 12;
/// AES-256 密钥长度
const KEY_LEN: usize = 32;

/// `cli-config.json` 实际的落盘形态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigWriteMode {
    /// 已用钥匙串密钥加密
    Encrypted,
    /// 拿不到钥匙串，退回明文（必须向用户告警）
    Plaintext,
}

// ──────────────────────────────────────────────
// 密钥获取
// ──────────────────────────────────────────────

/// 读取现有主密钥；不存在时生成并保存一把新的
///
/// 便携版把密钥明文放在 exe 旁边的 `secure-key` 文件里——这是 `.settings.dat` 早就
/// 存在的取舍（便携版的前提就是「拔下 U 盘带走全部数据」，密钥进钥匙串会破坏这个前提）。
/// 对 `cli-config.json` 而言意味着便携版下这层加密**基本等于没有**，钥匙就躺在旁边。
/// 这一点在文档里如实标注，不假装解决了。
pub fn load_or_create_key() -> Result<String, AppError> {
    if let Some(key_path) = portable::secure_key_path() {
        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::file_io(format!("无法创建便携数据目录: {}", e)))?;
        }

        if key_path.exists() {
            let key = std::fs::read_to_string(&key_path)
                .map_err(|e| AppError::file_io(format!("无法读取便携密钥: {}", e)))?
                .trim()
                .to_string();
            if !key.is_empty() {
                log::debug!("[密钥管理] 从便携数据目录读取现有密钥");
                return Ok(key);
            }
        }

        log::debug!("[密钥管理] 生成新的便携密钥");
        let new_key = generate_key_b64();
        std::fs::write(&key_path, &new_key)
            .map_err(|e| AppError::file_io(format!("无法保存便携密钥: {}", e)))?;
        return Ok(new_key);
    }

    let entry = keyring_entry()?;

    match entry.get_password() {
        Ok(key) => {
            log::debug!("[密钥管理] 从钥匙串读取现有密钥");
            Ok(key)
        }
        Err(_) => {
            log::debug!("[密钥管理] 生成新的加密密钥");
            let new_key = generate_key_b64();
            entry
                .set_password(&new_key)
                .map_err(|e| AppError::external(format!("无法保存密钥到系统钥匙串: {}", e)))?;
            log::debug!("[密钥管理] ✓ 新密钥已保存到系统钥匙串");
            Ok(new_key)
        }
    }
}

/// 只读取现有主密钥，**绝不创建**
///
/// 供 CLI 读取路径与「轮转前抢救旧密文」使用。这两处若在密钥缺失时顺手新建一把，
/// 会造成比读不到更糟的后果：`.settings.dat` 用的还是旧密钥，新建的这把会把它一起锁死。
pub fn load_existing_key() -> Option<String> {
    if let Some(key_path) = portable::secure_key_path() {
        let key = std::fs::read_to_string(&key_path).ok()?.trim().to_string();
        return if key.is_empty() { None } else { Some(key) };
    }

    Entry::new(SERVICE_NAME, KEY_NAME)
        .ok()?
        .get_password()
        .ok()
        .filter(|k| !k.is_empty())
}

/// 覆盖主密钥（备份密码模式下前端会用派生密钥轮转它）
pub fn store_key(key: &str) -> Result<(), AppError> {
    if let Some(key_path) = portable::secure_key_path() {
        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::file_io(format!("无法创建便携数据目录: {}", e)))?;
        }
        std::fs::write(&key_path, key)
            .map_err(|e| AppError::file_io(format!("无法更新便携密钥: {}", e)))?;
        log::debug!("[密钥管理] ✓ 密钥已更新到便携数据目录");
        return Ok(());
    }

    keyring_entry()?
        .set_password(key)
        .map_err(|e| AppError::external(format!("无法更新密钥到系统钥匙串: {}", e)))?;

    log::debug!("[密钥管理] ✓ 密钥已更新到系统钥匙串");
    Ok(())
}

fn keyring_entry() -> Result<Entry, AppError> {
    Entry::new(SERVICE_NAME, KEY_NAME)
        .map_err(|e| AppError::external(format!("无法访问系统钥匙串: {}", e)))
}

fn generate_key_b64() -> String {
    let mut key_bytes = [0u8; KEY_LEN];
    rand::thread_rng().fill(&mut key_bytes);
    STANDARD.encode(key_bytes)
}

// ──────────────────────────────────────────────
// 信封加密
// ──────────────────────────────────────────────

/// 判断一份磁盘内容是不是加密格式
pub fn is_encrypted(raw: &str) -> bool {
    raw.trim_start().starts_with(CLI_CONFIG_MAGIC)
}

/// 用主密钥加密配置 JSON，产出 `PNXCLI1:<base64(nonce || 密文+tag)>`
pub fn encrypt_config(plain: &str, key_b64: &str) -> Result<String, AppError> {
    let cipher = build_cipher(key_b64)?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|_| AppError::config("CLI 配置加密失败".to_string()))?;

    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(format!("{}{}", CLI_CONFIG_MAGIC, STANDARD.encode(&combined)))
}

/// 解密配置内容；**没有魔数前缀时原样返回**，兼容老版本写下的明文文件
pub fn decrypt_config(raw: &str, key_b64: &str) -> Result<String, AppError> {
    let trimmed = raw.trim_start();
    let Some(payload) = trimmed.strip_prefix(CLI_CONFIG_MAGIC) else {
        return Ok(raw.to_string());
    };

    let combined = STANDARD
        .decode(payload.trim())
        .map_err(|_| AppError::config("CLI 配置密文格式无效（非法 Base64）".to_string()))?;

    if combined.len() <= NONCE_LEN {
        return Err(AppError::config("CLI 配置密文已损坏（长度不足）".to_string()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let cipher = build_cipher(key_b64)?;

    let plain = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| {
            AppError::config(
                "CLI 配置解密失败——密钥不匹配或文件已损坏。\
                 常见原因是修改过备份密码（会轮转加密密钥）；\
                 打开 PicNexus 设置页即可自动重新生成"
                    .to_string(),
            )
        })?;

    String::from_utf8(plain)
        .map_err(|_| AppError::config("CLI 配置解密后不是合法 UTF-8".to_string()))
}

fn build_cipher(key_b64: &str) -> Result<Aes256Gcm, AppError> {
    let key_bytes = STANDARD
        .decode(key_b64.trim())
        .map_err(|_| AppError::config("主密钥格式无效：非法 Base64".to_string()))?;

    if key_bytes.len() != KEY_LEN {
        return Err(AppError::config(format!(
            "主密钥长度无效：期望 {} 字节，实际 {} 字节",
            KEY_LEN,
            key_bytes.len()
        )));
    }

    Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|_| AppError::config("无法用主密钥初始化加密器".to_string()))
}

/// 把文件权限收紧到「仅当前用户可读写」
///
/// Unix 下默认 0644，同机其它用户能直接读，这是真实存在的洞；Windows 下 `%APPDATA%`
/// 继承的 ACL 本来就只授予本人 / SYSTEM / Administrators，无需额外处理。
pub fn restrict_file_permissions(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
            log::warn!("[CLI Config] 无法收紧文件权限（{}）: {}", path.display(), e);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 32 字节全 0 密钥的 Base64，测试专用
    fn test_key() -> String {
        STANDARD.encode([7u8; KEY_LEN])
    }

    #[test]
    fn encrypt_then_decrypt_roundtrips() {
        let key = test_key();
        let plain = r#"{"services":{"webdav:a":{"password":"nas-secret"}}}"#;

        let encrypted = encrypt_config(plain, &key).expect("加密应成功");
        assert!(encrypted.starts_with(CLI_CONFIG_MAGIC));
        assert!(
            !encrypted.contains("nas-secret"),
            "密文里不应残留明文密码"
        );

        let decrypted = decrypt_config(&encrypted, &key).expect("解密应成功");
        assert_eq!(decrypted, plain);
    }

    /// 刻意避开 Electron safeStorage 的硬编码 IV 坑：同明文两次加密必须产出不同密文
    #[test]
    fn same_plaintext_produces_different_ciphertext() {
        let key = test_key();
        let plain = r#"{"services":{}}"#;

        let a = encrypt_config(plain, &key).expect("加密应成功");
        let b = encrypt_config(plain, &key).expect("加密应成功");

        assert_ne!(a, b, "随机 nonce 应让两次密文不同");
        assert_eq!(decrypt_config(&a, &key).unwrap(), plain);
        assert_eq!(decrypt_config(&b, &key).unwrap(), plain);
    }

    /// 老版本写下的明文文件必须继续读得动，否则升级会让 CLI 直接罢工
    #[test]
    fn plaintext_config_is_passed_through() {
        let plain = r#"{"services":{"jd":{"type":"jd"}}}"#;
        assert!(!is_encrypted(plain));
        assert_eq!(decrypt_config(plain, &test_key()).unwrap(), plain);
    }

    #[test]
    fn wrong_key_fails_with_actionable_message() {
        let encrypted = encrypt_config(r#"{"a":1}"#, &test_key()).expect("加密应成功");
        let other_key = STANDARD.encode([9u8; KEY_LEN]);

        let err = decrypt_config(&encrypted, &other_key).expect_err("换密钥应解不开");
        let msg = format!("{}", err);
        assert!(msg.contains("备份密码"), "报错要指出常见原因，实际: {}", msg);
    }

    /// GCM 的完整性校验：密文被改过要解密失败，而不是解出一段垃圾
    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = test_key();
        let encrypted = encrypt_config(r#"{"a":1}"#, &key).expect("加密应成功");

        let payload = encrypted.strip_prefix(CLI_CONFIG_MAGIC).unwrap();
        let mut bytes = STANDARD.decode(payload).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        let tampered = format!("{}{}", CLI_CONFIG_MAGIC, STANDARD.encode(&bytes));

        assert!(decrypt_config(&tampered, &key).is_err());
    }

    #[test]
    fn malformed_payloads_are_rejected() {
        let key = test_key();

        assert!(decrypt_config(&format!("{}!!!not-base64!!!", CLI_CONFIG_MAGIC), &key).is_err());
        // 只有 nonce、没有密文
        let short = STANDARD.encode([0u8; NONCE_LEN]);
        assert!(decrypt_config(&format!("{}{}", CLI_CONFIG_MAGIC, short), &key).is_err());
    }

    #[test]
    fn invalid_key_lengths_are_rejected() {
        let plain = r#"{"a":1}"#;
        assert!(encrypt_config(plain, &STANDARD.encode([0u8; 16])).is_err());
        assert!(encrypt_config(plain, "not-base64!!!").is_err());
    }

    /// 用**真实的系统钥匙串**跑一遍往返，验证这台机器上 keyring 确实可用
    ///
    /// 默认 `#[ignore]`：CI 与无头环境往往没有 Secret Service，不该因此挂掉。
    /// 排查「用户说 CLI 解不开配置」时手动跑：
    /// `cargo test -- --ignored --nocapture real_keychain_is_usable`
    ///
    /// 刻意只用 `load_existing_key`（不用 `load_or_create_key`）：这个测试不该有副作用，
    /// 更不该在钥匙串里凭空造一把密钥出来。
    #[test]
    #[ignore]
    fn real_keychain_is_usable() {
        let Some(key) = load_existing_key() else {
            println!("跳过：本机钥匙串里还没有主密钥（应用没跑过？）");
            return;
        };

        assert_eq!(
            load_existing_key().as_deref(),
            Some(key.as_str()),
            "两次读取应拿到同一把密钥"
        );

        let plain = r#"{"services":{"webdav:x":{"password":"nas-secret"}}}"#;
        let encrypted = encrypt_config(plain, &key).expect("用真实密钥加密应成功");
        assert_eq!(decrypt_config(&encrypted, &key).unwrap(), plain);

        println!("✓ 真实钥匙串往返成功（主密钥 {} 字符 Base64）", key.len());
    }
}
