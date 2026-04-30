// src-tauri/src/cli.rs
// CLI 上传分发器
//
// 工作流：
//   picnexus.exe /path/to/img1.jpg /path/to/img2.jpg
//   → 读取 cli-config.json → 上传 → 输出 URL（一行一个）→ 退出
//
// Typora 自定义命令模式：偏好设置 → 图像 → 上传服务 → 自定义命令 → 填入 PicNexus 可执行文件路径

use crate::portable;
use crate::server::upload_handler::{upload_single_file, ServerUploadConfig};

/// Tauri 的 bundle identifier（与 tauri.conf.json 中的 identifier 一致）
const APP_IDENTIFIER: &str = "us.picnex.app";

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

/// CLI 参数解析结果
pub enum CliAction {
    /// 正常上传文件
    Upload {
        files: Vec<String>,
        json_output: bool,
    },
    /// 显示帮助
    Help,
    /// 显示版本
    Version,
    /// 不是 CLI 模式，继续启动 GUI
    None,
}

/// 解析 CLI 参数
pub fn parse_cli_args() -> CliAction {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return CliAction::None;
    }

    // 检查 flags
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return CliAction::Help;
    }
    if args.iter().any(|a| a == "--version" || a == "-V") {
        return CliAction::Version;
    }

    let json_output = args.iter().any(|a| a == "--json");

    let file_args: Vec<String> = args
        .iter()
        .filter(|a| !a.starts_with('-'))
        .filter(|a| std::path::Path::new(a.as_str()).is_file())
        .cloned()
        .collect();

    if file_args.is_empty() {
        return CliAction::None;
    }

    CliAction::Upload {
        files: file_args,
        json_output,
    }
}

/// 显示帮助信息
pub fn print_help() {
    let version = env!("CARGO_PKG_VERSION");
    eprintln!("PicNexus v{} — 图床上传工具", version);
    eprintln!();
    eprintln!("用法:");
    eprintln!("  picnexus <文件路径...>       上传图片到默认图床");
    eprintln!("  picnexus --json <文件...>    以 JSON 格式输出结果");
    eprintln!("  picnexus --help              显示帮助信息");
    eprintln!("  picnexus --version           显示版本号");
    eprintln!();
    eprintln!("Typora 集成:");
    eprintln!("  偏好设置 → 图像 → 上传服务 → 自定义命令");
    eprintln!("  填入本程序的完整路径即可");
    eprintln!();
    eprintln!("配置:");
    eprintln!("  请先打开 PicNexus GUI，在「设置 → 通用 → 编辑器兼容」中选择图床并保存。");
}

/// 显示版本号
pub fn print_version() {
    println!("PicNexus v{}", env!("CARGO_PKG_VERSION"));
}

/// JSON 输出结构
#[derive(serde::Serialize)]
struct JsonResult {
    success: bool,
    results: Vec<JsonFileResult>,
}

#[derive(serde::Serialize)]
struct JsonFileResult {
    file: String,
    url: Option<String>,
    error: Option<String>,
}

/// CLI 上传模式主入口
pub fn run_cli_upload(file_paths: Vec<String>, json_output: bool) {
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

        if !config_path.exists() {
            eprintln!("[PicNexus] 未找到配置文件: {}", config_path.display());
            eprintln!(
                "[PicNexus] 请先打开 PicNexus，在「设置 → 通用 → 编辑器兼容」中配置默认图床并保存"
            );
            std::process::exit(1);
        }

        let config_json = match std::fs::read_to_string(&config_path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[PicNexus] 读取配置文件失败: {}", e);
                std::process::exit(1);
            }
        };

        let config: ServerUploadConfig = match serde_json::from_str(&config_json) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[PicNexus] 配置文件格式错误: {}", e);
                eprintln!("[PicNexus] 请在 PicNexus 设置中重新配置并保存");
                std::process::exit(1);
            }
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
                    "[PicNexus] 正在上传 ({}/{}): {} ...",
                    idx + 1,
                    total,
                    file_name
                );
            }

            match upload_single_file(file_path, &config).await {
                Ok(url) => {
                    if !json_output {
                        eprintln!(
                            "[PicNexus] \u{2713} 成功 ({}/{}): {}",
                            idx + 1,
                            total,
                            file_name
                        );
                    }
                    // Typora 格式：stdout 输出 URL
                    if !json_output {
                        println!("{}", url);
                    }
                    json_results.push(JsonFileResult {
                        file: file_name,
                        url: Some(url),
                        error: None,
                    });
                }
                Err(e) => {
                    if !json_output {
                        eprintln!(
                            "[PicNexus] \u{2717} 失败 ({}/{}): {} — {}",
                            idx + 1,
                            total,
                            file_name,
                            e
                        );
                    }
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
