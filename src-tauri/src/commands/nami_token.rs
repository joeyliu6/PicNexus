// src-tauri/src/commands/nami_token.rs
// 纳米图床 Token 自动获取模块
// 使用 Sidecar (Node.js + Puppeteer) 从纳米页面获取动态 Headers
// v2.10: 迁移到 AppError 统一错误类型

use serde::{Deserialize, Serialize};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

use crate::error::{AppError, IntoAppError};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NamiDynamicHeaders {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "zmToken")]
    pub zm_token: String,
    #[serde(rename = "zmUa")]
    pub zm_ua: String,
    pub timestamp: String,
    pub sid: String,
    pub mid: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "headerTid")]
    pub header_tid: String,
}

#[derive(Debug, Deserialize)]
struct SidecarResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

fn sanitize_sidecar_log_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let has_sensitive_marker = [
        "upload ",
        "access-token",
        "accesstoken",
        "zm-token",
        "zmtoken",
        "auth-token",
        "authtoken",
        "--cookie",
        "cookie:",
    ]
    .iter()
    .any(|marker| lower.contains(marker));

    if has_sensitive_marker {
        "[NamiToken] sidecar 敏感日志已脱敏".to_string()
    } else {
        line.to_string()
    }
}

/// 从纳米页面获取动态 Headers (Tauri command)
#[tauri::command]
pub async fn fetch_nami_token(
    app: tauri::AppHandle,
    cookie: String,
    auth_token: String
) -> Result<NamiDynamicHeaders, AppError> {
    fetch_nami_token_internal(&app, cookie, auth_token).await
}

/// 从纳米页面获取动态 Headers (内部函数)
pub async fn fetch_nami_token_internal(
    app: &tauri::AppHandle,
    cookie: String,
    auth_token: String
) -> Result<NamiDynamicHeaders, AppError> {
    log::info!("[NamiToken] 开始获取动态 Headers (Sidecar)");

    let sidecar = app.shell()
        .sidecar("nami-token-fetcher")
        .into_external_err_with("创建 sidecar 失败")?;

    let (mut rx, _child) = sidecar
        .args(["fetch-token", "--cookie", &cookie, "--auth-token", &auth_token])
        .spawn()
        .into_external_err_with("启动 sidecar 失败")?;

    let mut output = String::new();
    let mut stderr_output = String::new();

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
                log::debug!("[NamiToken] Sidecar 退出，状态: {:?}", status);
            }
            _ => {}
        }
    }

    // 输出 stderr 日志（包含进度信息）
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            log::debug!("{}", sanitize_sidecar_log_line(line));
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<NamiDynamicHeaders> = serde_json::from_str(&output)
        .map_err(|e| AppError::external(format!("解析响应失败: {}. 原始输出: {}", e, output)))?;

    if response.success {
        if let Some(headers) = response.data {
            log::info!("[NamiToken] Headers 获取成功");
            return Ok(headers);
        }
        Err(AppError::external("响应中没有 Headers 数据"))
    } else {
        Err(AppError::external(response.error.unwrap_or_else(|| "未知错误".to_string())))
    }
}
