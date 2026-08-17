// src-tauri/src/cli.rs
// CLI 上传分发器
//
// 工作流：
//   picnexus.exe --service r2 /path/to/img.jpg
//   -> 读取 cli-config.json -> 按 serviceId 选择图床 -> 上传 -> stdout 输出 URL
//
// Typora 自定义命令模式：
//   picnexus.exe --profile typora /path/to/img.jpg

use crate::portable;
use crate::secure_key;
use crate::server::upload_handler::{upload_single_file, ServerUploadConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Tauri 的 bundle identifier（与 tauri.conf.json 中的 identifier 一致）
const APP_IDENTIFIER: &str = "us.picnex.app";
const TYPORA_PROFILE: &str = "typora";

/// 获取应用数据目录（与 Tauri 使用的路径一致）
fn get_app_data_dir() -> Option<std::path::PathBuf> {
    if let Some(dir) = portable::portable_data_dir() {
        return Some(dir);
    }

    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(|p| std::path::PathBuf::from(p).join(APP_IDENTIFIER))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(|p| {
            std::path::PathBuf::from(p)
                .join("Library")
                .join("Application Support")
                .join(APP_IDENTIFIER)
        })
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var("XDG_DATA_HOME")
            .ok()
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|p| std::path::PathBuf::from(p).join(".local").join("share"))
            })
            .map(|p| p.join(APP_IDENTIFIER))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliProfile {
    Cli,
    Typora,
}

/// CLI 参数解析结果
#[derive(Debug, PartialEq, Eq)]
pub enum CliAction {
    /// 正常上传文件
    Upload {
        files: Vec<String>,
        json_output: bool,
        service_id: Option<String>,
        profile: CliProfile,
    },
    /// 显示帮助
    Help,
    /// 显示版本
    Version,
    /// 参数错误
    Error(String),
    /// 不是 CLI 模式，继续启动 GUI
    None,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CliConfigFile {
    #[serde(default)]
    pub services: HashMap<String, ServerUploadConfig>,
    #[serde(default)]
    pub profiles: HashMap<String, ServerUploadConfig>,
}

enum LoadedCliConfig {
    Multi(CliConfigFile),
    Legacy(ServerUploadConfig),
}

/// 解析 CLI 参数
pub fn parse_cli_args() -> CliAction {
    parse_cli_args_from(std::env::args().skip(1))
}

pub fn parse_cli_args_from<I, S>(args: I) -> CliAction
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let args: Vec<String> = args.into_iter().map(Into::into).collect();
    if args.is_empty() {
        return CliAction::None;
    }

    let mut json_output = false;
    let mut service_id: Option<String> = None;
    let mut profile = CliProfile::Cli;
    let mut files: Vec<String> = Vec::new();
    let mut parsing_options = true;
    let mut idx = 0;

    while idx < args.len() {
        let arg = &args[idx];

        if parsing_options && arg == "--" {
            parsing_options = false;
            idx += 1;
            continue;
        }

        if parsing_options {
            match arg.as_str() {
                "--help" | "-h" => return CliAction::Help,
                "--version" | "-V" => return CliAction::Version,
                "--json" => {
                    json_output = true;
                    idx += 1;
                    continue;
                }
                "--service" | "-s" => {
                    let Some(value) = args.get(idx + 1) else {
                        return CliAction::Error("--service 需要图床名".to_string());
                    };
                    if value.starts_with('-') {
                        return CliAction::Error("--service 需要图床名".to_string());
                    }
                    service_id = Some(value.clone());
                    idx += 2;
                    continue;
                }
                "--profile" => {
                    let Some(value) = args.get(idx + 1) else {
                        return CliAction::Error("--profile 需要 profile 名称".to_string());
                    };
                    profile = match value.as_str() {
                        "cli" => CliProfile::Cli,
                        "typora" => CliProfile::Typora,
                        _ => {
                            return CliAction::Error(format!(
                                "未知 profile: {}。支持的 profile: cli, typora",
                                value
                            ));
                        }
                    };
                    idx += 2;
                    continue;
                }
                _ if arg.starts_with('-') => {
                    return CliAction::Error(format!("未知参数: {}", arg));
                }
                _ => {}
            }
        }

        files.push(arg.clone());
        idx += 1;
    }

    if files.is_empty() {
        if json_output || service_id.is_some() || profile != CliProfile::Cli {
            return CliAction::Error("请提供文件路径".to_string());
        }
        return CliAction::None;
    }

    CliAction::Upload {
        files,
        json_output,
        service_id,
        profile,
    }
}

/// 显示帮助信息
pub fn print_help() {
    let version = env!("CARGO_PKG_VERSION");
    eprintln!("PicNexus v{} - 图床上传工具", version);
    eprintln!();
    eprintln!("用法:");
    eprintln!("  picnexus --service <图床名> <文件路径...>       上传图片到指定图床");
    eprintln!("  picnexus --service <图床名> --json <文件...>    以 JSON 格式输出结果");
    eprintln!("  picnexus --profile typora <文件...>             Typora 专用上传配置");
    eprintln!("  picnexus --help                                显示帮助信息");
    eprintln!("  picnexus --version                             显示版本号");
    eprintln!();
    eprintln!("示例:");
    eprintln!("  picnexus --service r2 ./image.png");
    eprintln!("  picnexus --service smms --json ./a.png ./b.jpg");
    eprintln!("  picnexus --service custom_s3:profile-1 ./image.png");
    eprintln!("  picnexus --service webdav:profile-1 ./image.png");
    eprintln!();
    eprintln!("配置:");
    eprintln!("  请先打开 PicNexus GUI，在设置中配置图床并保存。CLI 会使用导出的可用图床配置。");
}

/// 显示版本号
pub fn print_version() {
    println!("PicNexus v{}", env!("CARGO_PKG_VERSION"));
}

/// JSON 输出结构
#[derive(Serialize)]
struct JsonResult {
    success: bool,
    results: Vec<JsonFileResult>,
}

#[derive(Serialize)]
struct JsonFileResult {
    file: String,
    url: Option<String>,
    error: Option<String>,
}

/// 把磁盘上的 `cli-config.json` 还原成明文 JSON
///
/// 加密态（`PNXCLI1:` 前缀）需要从系统钥匙串取主密钥解开——CLI 与 GUI 跑在同一个用户
/// 账号下，钥匙串按账号授权，所以这里能拿到 GUI 写入时用的同一把密钥。
/// 明文态（老版本写下的文件，或钥匙串不可用时的降级产物）原样返回，保证升级不断链。
fn decrypt_cli_config(raw: &str) -> Result<String, String> {
    if !secure_key::is_encrypted(raw) {
        return Ok(raw.to_string());
    }

    let key = secure_key::load_existing_key().ok_or_else(|| {
        "配置文件已加密，但无法从系统钥匙串取出密钥。\n\
         [PicNexus] 若这是新机器或钥匙串被重置，请打开 PicNexus 设置页重新保存图床配置"
            .to_string()
    })?;

    decrypt_cli_config_with_key(raw, &key)
}

/// 用**指定密钥**解密，密钥获取与解密分开是为了让解密逻辑能被单测直接覆盖
fn decrypt_cli_config_with_key(raw: &str, key: &str) -> Result<String, String> {
    if !secure_key::is_encrypted(raw) {
        return Ok(raw.to_string());
    }
    secure_key::decrypt_config(raw, key).map_err(|e| format!("{}", e))
}

/// 把磁盘原文（可能加密）还原并解析成配置
///
/// Why 独立成函数：「先解密、再解析」这个顺序原本在两处各写了一遍，
/// `format_missing_service_message` 那份**漏了解密**。于是 `cli-config.json` 改成加密落盘后，
/// 用户执行不带 `--service` 的 `picnexus` 会被告知「无法读取可用图床，请重新保存配置」——
/// 而配置本身完全正常。更糟的是这条建议是死循环：重新保存写出的仍是加密文件。
/// 收敛成一处后，两条路径不可能再分叉。
fn parse_cli_config_from_raw(raw: &str, key: Option<&str>) -> Result<LoadedCliConfig, String> {
    let json = match key {
        Some(key) => decrypt_cli_config_with_key(raw, key)?,
        None => decrypt_cli_config(raw)?,
    };
    parse_cli_config_json(&json)
}

fn parse_cli_config_json(config_json: &str) -> Result<LoadedCliConfig, String> {
    let value: serde_json::Value =
        serde_json::from_str(config_json).map_err(|e| format!("配置文件格式错误: {}", e))?;

    if value.get("services").is_some() || value.get("profiles").is_some() {
        let config: CliConfigFile =
            serde_json::from_value(value).map_err(|e| format!("CLI 配置格式无效: {}", e))?;
        return Ok(LoadedCliConfig::Multi(config));
    }

    let legacy: ServerUploadConfig =
        serde_json::from_value(value).map_err(|e| format!("旧版 CLI 配置格式无效: {}", e))?;
    Ok(LoadedCliConfig::Legacy(legacy))
}

fn service_id_for_config(config: &ServerUploadConfig) -> &'static str {
    match config {
        ServerUploadConfig::Jd => "jd",
        ServerUploadConfig::Github { .. } => "github",
        ServerUploadConfig::Smms { .. } => "smms",
        ServerUploadConfig::Imgur { .. } => "imgur",
        ServerUploadConfig::Weibo { .. } => "weibo",
        ServerUploadConfig::Bilibili { .. } => "bilibili",
        ServerUploadConfig::Nowcoder { .. } => "nowcoder",
        ServerUploadConfig::Chaoxing { .. } => "chaoxing",
        ServerUploadConfig::Zhihu { .. } => "zhihu",
        ServerUploadConfig::R2 { .. } => "r2",
        ServerUploadConfig::Tencent { .. } => "tencent",
        ServerUploadConfig::Aliyun { .. } => "aliyun",
        ServerUploadConfig::Qiniu { .. } => "qiniu",
        ServerUploadConfig::Upyun { .. } => "upyun",
        ServerUploadConfig::CustomS3 { .. } => "custom_s3",
        // Why 不是真的复合 ID：这个函数只服务"旧版单图床 cli-config.json"的兼容读取
        // （`save_cli_config` 早就只写 Multi 格式了），WebDAV 从来没有过旧版单图床配置，
        // 这条分支纯粹是为了让 match 穷尽——和 CustomS3 的处理方式一致。
        ServerUploadConfig::Webdav { .. } => "webdav",
        ServerUploadConfig::Nami { .. } => "nami",
        ServerUploadConfig::Qiyu => "qiyu",
    }
}

fn available_services(config: &LoadedCliConfig) -> Vec<String> {
    let mut services = match config {
        LoadedCliConfig::Multi(config) => config.services.keys().cloned().collect::<Vec<_>>(),
        LoadedCliConfig::Legacy(config) => vec![service_id_for_config(config).to_string()],
    };
    services.sort();
    services
}

fn format_available_services(config: &LoadedCliConfig) -> String {
    let services = available_services(config);
    if services.is_empty() {
        "当前没有可用图床。请先在 PicNexus 设置中配置并保存图床。".to_string()
    } else {
        format!("可用图床: {}", services.join(", "))
    }
}

fn format_missing_service_message(config_path: &std::path::Path) -> String {
    let available = if config_path.exists() {
        // 必须走 parse_cli_config_from_raw（内含解密），不能直接 parse：
        // 配置默认是加密落盘的，少这一步会把「格式正常但已加密」误报成「读不出来」
        match std::fs::read_to_string(config_path)
            .ok()
            .and_then(|raw| parse_cli_config_from_raw(&raw, None).ok())
        {
            Some(config) => format_available_services(&config),
            None => "无法读取可用图床。请在 PicNexus 设置中重新保存图床配置。".to_string(),
        }
    } else {
        "当前没有可用图床。请先在 PicNexus 设置中配置并保存图床。".to_string()
    };

    format!(
        "缺少 --service <图床名>。\n{}\n示例: picnexus --service r2 image.png",
        available
    )
}

fn resolve_upload_config(
    loaded: &LoadedCliConfig,
    profile: CliProfile,
    service_id: Option<&str>,
) -> Result<ServerUploadConfig, String> {
    match profile {
        CliProfile::Typora => match loaded {
            LoadedCliConfig::Multi(config) => {
                config.profiles.get(TYPORA_PROFILE).cloned().ok_or_else(|| {
                    "Typora 上传配置不存在，请先在 PicNexus 设置中配置 Typora 图床并保存"
                        .to_string()
                })
            }
            LoadedCliConfig::Legacy(config) => Ok(config.clone()),
        },
        CliProfile::Cli => {
            let Some(service_id) = service_id else {
                return Err(format!(
                    "缺少 --service <图床名>。\n{}\n示例: picnexus --service r2 image.png",
                    format_available_services(loaded)
                ));
            };

            match loaded {
                LoadedCliConfig::Multi(config) => {
                    config.services.get(service_id).cloned().ok_or_else(|| {
                        format!(
                            "未知或未配置的图床: {}\n{}",
                            service_id,
                            format_available_services(loaded)
                        )
                    })
                }
                LoadedCliConfig::Legacy(config) => {
                    if service_id == service_id_for_config(config) {
                        Ok(config.clone())
                    } else {
                        Err(format!(
                            "未知或未配置的图床: {}\n{}",
                            service_id,
                            format_available_services(loaded)
                        ))
                    }
                }
            }
        }
    }
}

fn format_upload_failure_message(
    idx: usize,
    total: usize,
    file_name: &str,
    service_label: &str,
    error: &str,
) -> String {
    format!(
        "[PicNexus] ✗ 失败 ({}/{}): {} -> {} - {}",
        idx + 1,
        total,
        file_name,
        service_label,
        error
    )
}

/// CLI 上传模式主入口
pub fn run_cli_upload(
    file_paths: Vec<String>,
    json_output: bool,
    service_id: Option<String>,
    profile: CliProfile,
) {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("[PicNexus] 初始化失败: {}", e);
            std::process::exit(1);
        }
    };

    runtime.block_on(async {
        let config_path = match get_app_data_dir() {
            Some(dir) => dir.join("cli-config.json"),
            None => {
                eprintln!("[PicNexus] 无法确定应用数据目录");
                std::process::exit(1);
            }
        };

        if profile == CliProfile::Cli && service_id.is_none() {
            eprintln!(
                "[PicNexus] {}",
                format_missing_service_message(&config_path)
            );
            std::process::exit(1);
        }

        if !config_path.exists() {
            eprintln!("[PicNexus] 未找到配置文件: {}", config_path.display());
            eprintln!("[PicNexus] 请先打开 PicNexus，在设置中配置图床并保存。");
            std::process::exit(1);
        }

        let raw_config = match std::fs::read_to_string(&config_path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[PicNexus] 读取配置文件失败: {}", e);
                std::process::exit(1);
            }
        };

        // 与 format_missing_service_message 共用同一个入口，两条路径不会再在
        // 「要不要先解密」上分叉
        let loaded_config = match parse_cli_config_from_raw(&raw_config, None) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[PicNexus] {}", e);
                std::process::exit(1);
            }
        };

        let config = match resolve_upload_config(&loaded_config, profile, service_id.as_deref()) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[PicNexus] {}", e);
                std::process::exit(1);
            }
        };

        let service_label = match profile {
            CliProfile::Cli => service_id
                .as_deref()
                .unwrap_or(service_id_for_config(&config)),
            CliProfile::Typora => TYPORA_PROFILE,
        };
        let total = file_paths.len();
        let mut any_failed = false;
        let mut json_results: Vec<JsonFileResult> = Vec::new();

        for (idx, file_path) in file_paths.iter().enumerate() {
            let file_name = std::path::Path::new(file_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| file_path.clone());

            if !json_output {
                eprintln!(
                    "[PicNexus] 正在上传 ({}/{}): {} -> {} ...",
                    idx + 1,
                    total,
                    file_name,
                    service_label
                );
            }

            match upload_single_file(file_path, &config).await {
                Ok(url) => {
                    if !json_output {
                        eprintln!("[PicNexus] ✓ 成功 ({}/{}): {}", idx + 1, total, file_name);
                        println!("{}", url);
                    }
                    json_results.push(JsonFileResult {
                        file: file_name,
                        url: Some(url),
                        error: None,
                    });
                }
                Err(e) => {
                    eprintln!(
                        "{}",
                        format_upload_failure_message(idx, total, &file_name, service_label, &e)
                    );
                    json_results.push(JsonFileResult {
                        file: file_name,
                        url: None,
                        error: Some(e),
                    });
                    any_failed = true;
                }
            }
        }

        if json_output {
            let result = JsonResult {
                success: !any_failed,
                results: json_results,
            };
            println!(
                "{}",
                serde_json::to_string_pretty(&result).unwrap_or_default()
            );
        }

        if any_failed {
            std::process::exit(1);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_path(name: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "picnexus-{name}-{}-{unique}.json",
            std::process::id()
        ))
    }

    /// 测试专用密钥（32 字节 Base64），不碰真实钥匙串
    fn fixture_key() -> String {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        STANDARD.encode([3u8; 32])
    }

    fn sample_config_json() -> &'static str {
        r#"{"services":{"r2":{"type":"r2","account_id":"a","access_key_id":"k","secret_access_key":"s","bucket_name":"b","path":"","public_domain":""},"jd":{"type":"jd"}},"profiles":{}}"#
    }

    /// 回归：加密态的配置也必须解析得出可用图床列表
    ///
    /// `format_missing_service_message` 曾经直接 parse 磁盘原文、漏掉解密那一步。
    /// `cli-config.json` 改成加密落盘后，用户执行不带 `--service` 的 `picnexus`
    /// 会被告知「无法读取可用图床，请重新保存配置」——而配置本身完全正常，
    /// 且那条建议是死循环（重新保存写出的仍是加密文件）。
    #[test]
    fn parses_encrypted_config_not_just_plaintext() {
        let key = fixture_key();
        let encrypted = crate::secure_key::encrypt_config(sample_config_json(), &key)
            .expect("加密 fixture 应成功");
        assert!(crate::secure_key::is_encrypted(&encrypted));

        let loaded = parse_cli_config_from_raw(&encrypted, Some(&key))
            .expect("加密配置必须能解析出来");

        let listed = format_available_services(&loaded);
        assert!(listed.contains("r2"), "应列出 r2，实际: {listed}");
        assert!(listed.contains("jd"), "应列出 jd，实际: {listed}");
        assert!(
            !listed.contains("无法读取"),
            "配置正常时不该退回通用错误文案: {listed}"
        );
    }

    /// 旧版明文配置仍要读得动（升级不断链）
    #[test]
    fn parses_plaintext_config_for_backward_compatibility() {
        let loaded = parse_cli_config_from_raw(sample_config_json(), Some(&fixture_key()))
            .expect("明文配置应原样解析");
        assert!(format_available_services(&loaded).contains("r2"));
    }

    /// 密钥不匹配时要给出可操作的错误，而不是笼统的解析失败
    #[test]
    fn wrong_key_surfaces_actionable_error() {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let encrypted = crate::secure_key::encrypt_config(sample_config_json(), &fixture_key())
            .expect("加密应成功");
        let other_key = STANDARD.encode([9u8; 32]);

        let err = match parse_cli_config_from_raw(&encrypted, Some(&other_key)) {
            Err(e) => e,
            Ok(_) => panic!("换密钥应解不开"),
        };
        assert!(err.contains("备份密码"), "错误应指出常见原因，实际: {err}");
    }

    #[test]
    fn parse_upload_requires_explicit_service_for_cli_profile() {
        let action = parse_cli_args_from(["image.png"]);

        assert_eq!(
            action,
            CliAction::Upload {
                files: vec!["image.png".to_string()],
                json_output: false,
                service_id: None,
                profile: CliProfile::Cli,
            }
        );
    }

    #[test]
    fn parse_upload_with_service_and_json() {
        let action = parse_cli_args_from(["--json", "--service", "smms", "a.png", "b.jpg"]);

        assert_eq!(
            action,
            CliAction::Upload {
                files: vec!["a.png".to_string(), "b.jpg".to_string()],
                json_output: true,
                service_id: Some("smms".to_string()),
                profile: CliProfile::Cli,
            }
        );
    }

    #[test]
    fn parse_upload_with_r2_service() {
        let action = parse_cli_args_from(["--service", "r2", "a.png"]);

        assert_eq!(
            action,
            CliAction::Upload {
                files: vec!["a.png".to_string()],
                json_output: false,
                service_id: Some("r2".to_string()),
                profile: CliProfile::Cli,
            }
        );
    }

    #[test]
    fn parse_upload_with_typora_profile() {
        let action = parse_cli_args_from(["--profile", "typora", "a.png"]);

        assert_eq!(
            action,
            CliAction::Upload {
                files: vec!["a.png".to_string()],
                json_output: false,
                service_id: None,
                profile: CliProfile::Typora,
            }
        );
    }

    #[test]
    fn parse_rejects_missing_service_value() {
        assert!(matches!(
            parse_cli_args_from(["--service"]),
            CliAction::Error(message) if message.contains("--service")
        ));
    }

    #[test]
    fn parse_rejects_unknown_profile() {
        assert!(matches!(
            parse_cli_args_from(["--profile", "other", "a.png"]),
            CliAction::Error(message) if message.contains("未知 profile")
        ));
    }

    #[test]
    fn resolve_multi_config_by_service() {
        let raw = r#"{
            "services": {
                "jd": { "type": "jd" },
                "smms": { "type": "smms", "token": "token" }
            }
        }"#;
        let loaded = parse_cli_config_json(raw).expect("config should parse");
        let resolved = resolve_upload_config(&loaded, CliProfile::Cli, Some("smms"))
            .expect("smms should resolve");

        assert!(matches!(resolved, ServerUploadConfig::Smms { .. }));
    }

    #[test]
    fn resolve_multi_config_by_webdav_composite_service_id() {
        // 与前端 makeWebDAVId 产出的 `webdav:<profileId>` 复合 ID 对齐
        let raw = r#"{
            "services": {
                "webdav:profile-1": {
                    "type": "webdav",
                    "url": "https://dav.example.com/dav",
                    "username": "user",
                    "password": "pw",
                    "remote_path": "/images/",
                    "public_domain": "https://cdn.example.com",
                    "public_url_template": "{domain}/{path}",
                    "lan_http_confirmed": false
                }
            }
        }"#;
        let loaded = parse_cli_config_json(raw).expect("config should parse");
        let resolved = resolve_upload_config(&loaded, CliProfile::Cli, Some("webdav:profile-1"))
            .expect("webdav:profile-1 should resolve");

        assert!(matches!(resolved, ServerUploadConfig::Webdav { .. }));
    }

    #[test]
    fn resolve_rejects_unknown_service() {
        let raw = r#"{ "services": { "r2": {
            "type": "r2",
            "account_id": "account",
            "access_key_id": "access",
            "secret_access_key": "secret",
            "bucket_name": "bucket",
            "path": "images",
            "public_domain": "https://cdn.example.com"
        } } }"#;
        let loaded = parse_cli_config_json(raw).expect("config should parse");
        let err = resolve_upload_config(&loaded, CliProfile::Cli, Some("smms"))
            .expect_err("unknown service should fail");

        assert!(err.contains("smms"));
        assert!(err.contains("r2"));
    }

    #[test]
    fn resolve_requires_service_for_cli_profile() {
        let raw = r#"{ "services": { "jd": { "type": "jd" } } }"#;
        let loaded = parse_cli_config_json(raw).expect("config should parse");
        let err = resolve_upload_config(&loaded, CliProfile::Cli, None)
            .expect_err("missing service should fail");

        assert!(err.contains("--service"));
        assert!(err.contains("jd"));
    }

    #[test]
    fn missing_service_message_lists_available_services_when_config_exists() {
        let path = temp_config_path("missing-service");
        std::fs::write(
            &path,
            r#"{
                "services": {
                    "jd": { "type": "jd" },
                    "r2": {
                        "type": "r2",
                        "account_id": "account",
                        "access_key_id": "access",
                        "secret_access_key": "secret",
                        "bucket_name": "bucket",
                        "path": "images",
                        "public_domain": "https://cdn.example.com"
                    }
                }
            }"#,
        )
        .expect("temp config should be writable");

        let message = format_missing_service_message(&path);
        let _ = std::fs::remove_file(&path);

        assert!(message.contains("缺少 --service"));
        assert!(message.contains("jd"));
        assert!(message.contains("r2"));
        assert!(message.contains("picnexus --service r2 image.png"));
    }

    #[test]
    fn missing_service_message_still_shows_example_without_config_file() {
        let path = temp_config_path("no-config");
        let message = format_missing_service_message(&path);

        assert!(message.contains("缺少 --service"));
        assert!(message.contains("当前没有可用图床"));
        assert!(message.contains("picnexus --service r2 image.png"));
    }

    #[test]
    fn upload_failure_message_includes_service_and_reason_for_stderr() {
        let message = format_upload_failure_message(0, 1, "a.png", "smms", "token invalid");

        assert!(message.contains("smms"));
        assert!(message.contains("token invalid"));
    }

    #[test]
    fn resolve_typora_profile() {
        let raw = r#"{
            "profiles": {
                "typora": { "type": "jd" }
            },
            "services": {}
        }"#;
        let loaded = parse_cli_config_json(raw).expect("config should parse");
        let resolved = resolve_upload_config(&loaded, CliProfile::Typora, None)
            .expect("typora profile should resolve");

        assert!(matches!(resolved, ServerUploadConfig::Jd));
    }

    #[test]
    fn resolve_legacy_config_as_requested_service() {
        let loaded =
            parse_cli_config_json(r#"{ "type": "jd" }"#).expect("legacy config should parse");
        let resolved = resolve_upload_config(&loaded, CliProfile::Cli, Some("jd"))
            .expect("legacy service should resolve when service id matches");

        assert!(matches!(resolved, ServerUploadConfig::Jd));
    }
}
