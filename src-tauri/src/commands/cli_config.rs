// src-tauri/src/commands/cli_config.rs
// 把 Typora profile 与 CLI services 表落盘成 cli-config.json
//
// 读取侧在 `crate::cli`；密钥轮转时的搬运在 `commands::app_key`。

use std::collections::HashMap;

use crate::error::AppError;
use crate::portable;
use crate::secure_key;
use crate::server;

/// `save_cli_config` 的结果，用于把「有没有降级成明文」回传给设置页
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCliConfigOutcome {
    /// `false` 表示钥匙串不可用、这次是明文落盘，前端需要显式提示用户
    pub encrypted: bool,
}

/// 将 Typora profile 与显式 CLI services 表写入 {app_data_dir}/cli-config.json。
/// CLI 模式启动时直接读取此文件，无需启动 GUI。
///
/// 文件内容用系统钥匙串里的主密钥做 AES-256-GCM 加密（拿不到钥匙串时降级明文并告警），
/// 读取侧见 `cli.rs`；整体设计与边界见 `secure_key` 模块头部注释。
#[tauri::command]
pub async fn save_cli_config(
    app: tauri::AppHandle,
    service_config_json: Option<String>,
    services_config_json: Option<String>,
) -> Result<SaveCliConfigOutcome, AppError> {
    let config_dir = portable::user_data_dir(&app)?;

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| AppError::file_io(format!("无法创建配置目录: {}", e)))?;

    let config_path = config_dir.join("cli-config.json");

    let services: HashMap<String, server::ServerUploadConfig> =
        if let Some(json) = services_config_json {
            serde_json::from_str(&json)
                .map_err(|e| AppError::config(format!("CLI 图床配置格式无效: {}", e)))?
        } else {
            HashMap::new()
        };

    let mut profiles: HashMap<String, server::ServerUploadConfig> = HashMap::new();
    if let Some(json) = service_config_json {
        let typora_config: server::ServerUploadConfig = serde_json::from_str(&json)
            .map_err(|e| AppError::config(format!("Typora 配置格式无效: {}", e)))?;
        profiles.insert("typora".to_string(), typora_config);
    }

    if services.is_empty() && profiles.is_empty() {
        if config_path.exists() {
            std::fs::remove_file(&config_path)
                .map_err(|e| AppError::file_io(format!("删除 cli-config.json 失败: {}", e)))?;
        }
        log::info!("[CLI Config] cli-config.json 已删除");
        // 文件都不存在了，没有明文暴露面，按「已加密」上报避免误报警告
        return Ok(SaveCliConfigOutcome { encrypted: true });
    }

    let payload = serde_json::json!({
        "services": services,
        "profiles": profiles,
    });
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| AppError::config(format!("CLI 配置序列化失败: {}", e)))?;

    // 这份文件装的是**解密后的**凭证明文（各家 OSS secret key、cookie、WebDAV 密码），
    // 所以落盘前用钥匙串里的主密钥再加密一层，详见 secure_key 模块头部注释。
    let (contents, mode) = match secure_key::load_or_create_key()
        .and_then(|key| secure_key::encrypt_config(&json, &key))
    {
        Ok(encrypted) => (encrypted, secure_key::ConfigWriteMode::Encrypted),
        Err(e) => {
            // 降级必须是响的：Electron safeStorage 在 Linux 上静默退回近乎无加密的模式，
            // 让大量用户在毫不知情的状态下裸奔——这里反着来，日志 warn + 回传前端提示。
            log::warn!(
                "[CLI Config] ⚠ 无法访问系统钥匙串（{}），cli-config.json 将以明文写入；\
                 该文件包含图床密钥与 WebDAV 密码，请注意不要外传",
                e
            );
            (json, secure_key::ConfigWriteMode::Plaintext)
        }
    };

    std::fs::write(&config_path, &contents)
        .map_err(|e| AppError::file_io(format!("写入 cli-config.json 失败: {}", e)))?;
    secure_key::restrict_file_permissions(&config_path);

    log::info!(
        "[CLI Config] ✓ cli-config.json 已更新（{}）: {}",
        if mode == secure_key::ConfigWriteMode::Encrypted {
            "已加密"
        } else {
            "明文降级"
        },
        config_path.display()
    );

    Ok(SaveCliConfigOutcome {
        encrypted: mode == secure_key::ConfigWriteMode::Encrypted,
    })
}
