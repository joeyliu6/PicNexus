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
        match std::fs::read_to_string(config_path)
            .ok()
            .and_then(|json| parse_cli_config_json(&json).ok())
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

        let config_json = match std::fs::read_to_string(&config_path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[PicNexus] 读取配置文件失败: {}", e);
                std::process::exit(1);
            }
        };

        let loaded_config = match parse_cli_config_json(&config_json) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[PicNexus] {}", e);
                eprintln!("[PicNexus] 请在 PicNexus 设置中重新保存图床配置");
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
