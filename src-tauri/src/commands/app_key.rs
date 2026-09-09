// src-tauri/src/commands/app_key.rs
// 主密钥的读取与轮转命令
//
// 钥匙串读写、加解密的实现都在 `crate::secure_key`，这里只做两件事：
// 校验前端传来的密钥格式，以及在轮转前后搬运 `cli-config.json`——
// 那个文件是用旧密钥加密的，不搬运的话 CLI / Typora / Obsidian 三条链路
// 会在用户改完备份密码后集体解不开配置。

use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::error::AppError;
use crate::portable;
use crate::secure_key;

#[tauri::command]
pub fn get_or_create_secure_key() -> Result<String, AppError> {
    secure_key::load_or_create_key()
}

#[tauri::command]
pub fn set_secure_key(app: tauri::AppHandle, key: String) -> Result<(), AppError> {
    // 校验密钥格式：必须是合法 Base64 且解码后正好 32 字节（AES-256）
    let decoded = STANDARD
        .decode(&key)
        .map_err(|_| AppError::external("密钥格式无效：非法 Base64".to_string()))?;
    if decoded.len() != 32 {
        return Err(AppError::external(format!(
            "密钥长度无效：期望 32 字节，实际 {} 字节",
            decoded.len()
        )));
    }

    // 轮转前先用旧密钥把 cli-config.json 解出来暂存在内存里。
    //
    // Why 非做不可：设置备份密码会把主密钥换成口令派生的新密钥（前端 crypto.ts 有 3 处
    // 调用点），而 cli-config.json 是用旧密钥加密的——不搬运的话，CLI / Typora /
    // Obsidian 三条链路会在用户改完备份密码后集体解不开配置。这里在 Rust 侧做，
    // 比让每个前端调用点各自记得重新下发一次可靠。
    let rescued_config = rescue_cli_config_before_rotation(&app);

    secure_key::store_key(&key)?;

    if let Some((path, plain)) = rescued_config {
        match secure_key::encrypt_config(&plain, &key) {
            Ok(reencrypted) => {
                if let Err(e) = std::fs::write(&path, &reencrypted) {
                    log::warn!("[密钥管理] cli-config.json 换密钥后重写失败: {}", e);
                } else {
                    secure_key::restrict_file_permissions(&path);
                    log::info!("[密钥管理] ✓ cli-config.json 已用新密钥重新加密");
                }
            }
            Err(e) => log::warn!("[密钥管理] cli-config.json 换密钥后重新加密失败: {}", e),
        }
    }

    Ok(())
}

/// 主密钥轮转前，用**旧密钥**把 `cli-config.json` 解成明文暂存
///
/// 返回 `None` 的情况都是不需要搬运：文件不存在、本来就是明文（老版本格式，
/// 换密钥不影响它）、或者旧密钥已经拿不到了（那也没救了，交给设置页下次重新下发）。
fn rescue_cli_config_before_rotation(app: &tauri::AppHandle) -> Option<(PathBuf, String)> {
    let path = portable::user_data_dir(app).ok()?.join("cli-config.json");
    rescue_encrypted_config_at(&path, secure_key::load_existing_key)
}

/// 抢救逻辑的纯函数部分：不碰 Tauri 上下文，也不主动碰钥匙串
///
/// Why 收闭包而不是直接收密钥：文件不存在、或本来就是明文（老版本格式）时根本
/// 不需要旧密钥。直接收密钥就意味着调用方得先取一次，于是每次换钥都白敲一遍系统
/// 钥匙串——在无头 CI 上那是一次必然失败的 Secret Service 调用。
/// 「不需要搬运时不碰钥匙串」这个顺序由 `cli_config_rescue_tests` 钉住。
fn rescue_encrypted_config_at(
    path: &std::path::Path,
    load_old_key: impl FnOnce() -> Option<String>,
) -> Option<(PathBuf, String)> {
    let raw = std::fs::read_to_string(path).ok()?;
    if !secure_key::is_encrypted(&raw) {
        return None;
    }

    let old_key = load_old_key()?;
    match secure_key::decrypt_config(&raw, &old_key) {
        Ok(plain) => Some((path.to_path_buf(), plain)),
        Err(e) => {
            log::warn!("[密钥管理] 轮转前解密 cli-config.json 失败，跳过搬运: {}", e);
            None
        }
    }
}

#[cfg(test)]
mod cli_config_rescue_tests {
    use super::*;
    use std::cell::Cell;

    /// 测试专用密钥：换 seed 就是换一把钥匙
    fn test_key(seed: u8) -> String {
        STANDARD.encode([seed; 32])
    }

    /// 用完即删的临时文件，避免测试之间互相看见对方的残留
    struct TempFile(PathBuf);

    impl TempFile {
        fn new(tag: &str) -> Self {
            TempFile(std::env::temp_dir().join(format!(
                "picnexus_rescue_{}_{}.json",
                std::process::id(),
                tag
            )))
        }

        fn write(&self, contents: &str) {
            std::fs::write(&self.0, contents).expect("写入临时文件失败");
        }

        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    const SAMPLE_CONFIG: &str = r#"{"services":{"webdav:a":{"password":"nas-secret"}}}"#;

    /// 正常路径：密文 + 对得上的旧钥 → 解出明文交给调用方重新加密
    #[test]
    fn encrypted_config_is_rescued_with_the_old_key() {
        let key = test_key(7);
        let file = TempFile::new("encrypted");
        file.write(&secure_key::encrypt_config(SAMPLE_CONFIG, &key).expect("加密应成功"));

        let rescued = rescue_encrypted_config_at(file.path(), || Some(key.clone()));

        let (path, plain) = rescued.expect("密文应当被抢救出来");
        assert_eq!(path, file.path());
        assert_eq!(plain, SAMPLE_CONFIG);
    }

    /// 老版本写下的明文文件不需要搬运 —— 而且**不该为此去敲钥匙串**
    #[test]
    fn plaintext_config_is_skipped_without_touching_the_keychain() {
        let file = TempFile::new("plaintext");
        file.write(SAMPLE_CONFIG);
        let asked = Cell::new(false);

        let rescued = rescue_encrypted_config_at(file.path(), || {
            asked.set(true);
            Some(test_key(7))
        });

        assert!(rescued.is_none(), "明文文件不需要搬运");
        assert!(
            !asked.get(),
            "为一个不需要搬运的文件敲了钥匙串——无头环境下这是一次必然失败的 Secret Service 调用"
        );
    }

    /// 文件根本不存在时同理：先看文件，再谈密钥
    #[test]
    fn missing_file_is_skipped_without_touching_the_keychain() {
        let path = std::env::temp_dir().join(format!(
            "picnexus_rescue_{}_absent.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let asked = Cell::new(false);

        let rescued = rescue_encrypted_config_at(&path, || {
            asked.set(true);
            Some(test_key(7))
        });

        assert!(rescued.is_none());
        assert!(!asked.get(), "文件都不存在，不该去取密钥");
    }

    /// 钥匙串拿不到旧钥：救不回来，但不能 panic（换钥本身还得继续）
    #[test]
    fn unavailable_old_key_is_not_fatal() {
        let file = TempFile::new("nokey");
        file.write(&secure_key::encrypt_config(SAMPLE_CONFIG, &test_key(7)).expect("加密应成功"));

        let rescued = rescue_encrypted_config_at(file.path(), || None);

        assert!(rescued.is_none());
    }

    /// 旧钥对不上（比如密钥已被别的流程换过）：同样只是放弃搬运，不 panic
    #[test]
    fn wrong_old_key_is_not_fatal() {
        let file = TempFile::new("wrongkey");
        file.write(&secure_key::encrypt_config(SAMPLE_CONFIG, &test_key(7)).expect("加密应成功"));

        let rescued = rescue_encrypted_config_at(file.path(), || Some(test_key(9)));

        assert!(rescued.is_none(), "解不开就该跳过，而不是崩掉整个换钥流程");
    }

    /// 端到端的搬运不变量：旧钥加密 → 抢救 → 新钥重写 → 新钥解得开、旧钥再也解不开
    ///
    /// 这条守的是 `set_secure_key` 的完整语义。少了任何一环，用户改完备份密码后
    /// CLI / Typora / Obsidian 三条链路会集体解不开配置。
    #[test]
    fn rescued_plaintext_survives_a_full_key_rotation() {
        let old_key = test_key(7);
        let new_key = test_key(9);
        let file = TempFile::new("rotation");
        file.write(&secure_key::encrypt_config(SAMPLE_CONFIG, &old_key).expect("加密应成功"));

        let (path, plain) = rescue_encrypted_config_at(file.path(), || Some(old_key.clone()))
            .expect("换钥前应当抢救成功");
        let reencrypted = secure_key::encrypt_config(&plain, &new_key).expect("新钥加密应成功");
        std::fs::write(&path, &reencrypted).expect("重写失败");

        let raw = std::fs::read_to_string(file.path()).expect("读取失败");
        assert_eq!(
            secure_key::decrypt_config(&raw, &new_key).expect("新钥应当解得开"),
            SAMPLE_CONFIG
        );
        assert!(
            secure_key::decrypt_config(&raw, &old_key).is_err(),
            "旧钥还能解开，说明根本没重新加密"
        );
    }
}
