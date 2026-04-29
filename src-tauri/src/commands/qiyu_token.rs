// src-tauri/src/commands/qiyu_token.rs
// 七鱼图床 Token 自动获取模块
// 使用 Sidecar (Node.js + Puppeteer) 从七鱼页面获取上传凭证
// v2.10: 迁移到 AppError 统一错误类型

use serde::{Deserialize, Serialize};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::time::{timeout, Duration};

use crate::error::{AppError, IntoAppError};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QiyuToken {
    pub token: String,
    pub object_path: String,
    pub expires: i64,
}

#[derive(Debug, Deserialize)]
struct SidecarResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CheckChromeData {
    installed: bool,
    path: Option<String>,
    name: Option<String>,
}

fn sanitize_sidecar_log_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let has_sensitive_marker = ["upload ", "x-nos-token", "nos token"]
        .iter()
        .any(|marker| lower.contains(marker));

    if has_sensitive_marker {
        "[QiyuToken] sidecar 敏感日志已脱敏".to_string()
    } else {
        line.to_string()
    }
}

/// 检测系统是否安装了 Chrome 浏览器
#[tauri::command]
pub async fn check_chrome_installed(app: tauri::AppHandle) -> Result<bool, AppError> {
    log::debug!("[QiyuToken] 检测 Chrome 安装状态");

    let sidecar = app
        .shell()
        .sidecar("qiyu-token-fetcher")
        .into_external_err_with("创建 sidecar 失败")?;

    let (mut rx, _child) = sidecar
        .args(["check-chrome"])
        .spawn()
        .into_external_err_with("启动 sidecar 失败")?;

    let mut output = String::new();
    let mut stderr_output = String::new();

    // 添加 45 秒超时控制
    let result = timeout(Duration::from_secs(45), async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    output.push_str(&String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    stderr_output.push_str(&String::from_utf8_lossy(&line));
                    stderr_output.push('\n');
                }
                CommandEvent::Terminated(status) => {
                    log::debug!("[QiyuToken] Sidecar 退出，状态: {:?}", status);
                }
                _ => {}
            }
        }
    })
    .await;

    // 检查是否超时
    if result.is_err() {
        return Err(AppError::network(
            "检测 Chrome 超时（45秒），请检查网络连接",
        ));
    }

    // 输出 stderr 日志
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            log::debug!("{}", sanitize_sidecar_log_line(line));
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<CheckChromeData> = serde_json::from_str(&output)
        .map_err(|e| AppError::external(format!("解析响应失败: {}. 原始输出: {}", e, output)))?;

    if response.success {
        if let Some(data) = response.data {
            if data.installed {
                if let (Some(name), Some(path)) = (&data.name, &data.path) {
                    log::debug!("[QiyuToken] 检测到 {}: {}", name, path);
                }
                return Ok(true);
            }
        }
        log::warn!("[QiyuToken] 未检测到 Chrome 或 Edge");
        Ok(false)
    } else {
        Err(AppError::external(
            response.error.unwrap_or_else(|| "未知错误".to_string()),
        ))
    }
}

/// 检查七鱼图床是否可用（完整检测）
/// 通过实际获取 Token 来验证上传能力
#[tauri::command]
pub async fn check_qiyu_available(app: tauri::AppHandle) -> bool {
    let start_time = std::time::Instant::now();

    match fetch_qiyu_token_internal(&app).await {
        Ok(_) => {
            log::info!("[Qiyu] 可用性检测通过，耗时: {:?}", start_time.elapsed());
            true
        }
        Err(e) => {
            log::error!(
                "[Qiyu] 可用性检测失败: {}，耗时: {:?}",
                e,
                start_time.elapsed()
            );
            false
        }
    }
}

/// 从七鱼页面获取新的上传 Token
#[tauri::command]
pub async fn fetch_qiyu_token(app: tauri::AppHandle) -> Result<QiyuToken, AppError> {
    fetch_qiyu_token_internal(&app).await
}

/// 内部函数：从七鱼页面获取新的上传 Token
pub async fn fetch_qiyu_token_internal(app: &tauri::AppHandle) -> Result<QiyuToken, AppError> {
    log::debug!("[QiyuToken] 启动 Sidecar 获取 Token");

    let sidecar = app
        .shell()
        .sidecar("qiyu-token-fetcher")
        .into_external_err_with("创建 sidecar 失败")?;

    let (mut rx, _child) = sidecar
        .args(["fetch-token"])
        .spawn()
        .into_external_err_with("启动 sidecar 失败")?;

    let mut output = String::new();
    let mut stderr_output = String::new();

    // 添加 45 秒超时控制
    let result = timeout(Duration::from_secs(45), async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    output.push_str(&String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    stderr_output.push_str(&String::from_utf8_lossy(&line));
                    stderr_output.push('\n');
                }
                CommandEvent::Terminated(status) => {
                    log::debug!("[QiyuToken] Sidecar 退出，状态: {:?}", status);
                }
                _ => {}
            }
        }
    })
    .await;

    // 检查是否超时
    if result.is_err() {
        return Err(AppError::network(
            "获取 Token 超时（45秒），请检查网络连接或稍后重试",
        ));
    }

    // 输出 stderr 日志（包含进度信息）
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            log::debug!("{}", sanitize_sidecar_log_line(line));
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<QiyuToken> = serde_json::from_str(&output)
        .map_err(|e| AppError::external(format!("解析响应失败: {}. 原始输出: {}", e, output)))?;

    if response.success {
        if let Some(token) = response.data {
            return Ok(token);
        }
        Err(AppError::upload("七鱼", "响应中没有 Token 数据"))
    } else {
        Err(AppError::upload(
            "七鱼",
            response.error.unwrap_or_else(|| "未知错误".to_string()),
        ))
    }
}
