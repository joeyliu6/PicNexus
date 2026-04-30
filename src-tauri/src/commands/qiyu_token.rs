use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::log_utils::{safe_path, sanitize_text, summarize_text};
use crate::portable;

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
        format!(
            "[QiyuToken] sidecar sensitive log redacted ({})",
            summarize_text(line)
        )
    } else {
        sanitize_text(line)
    }
}

#[tauri::command]
pub async fn check_chrome_installed(_app: tauri::AppHandle) -> Result<bool, AppError> {
    log::debug!("[QiyuToken] checking Chrome installation");

    let (output, stderr_output) =
        portable::run_sidecar("qiyu-token-fetcher", &["check-chrome"], 45).await?;

    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            log::debug!("{}", sanitize_sidecar_log_line(line));
        }
    }

    let response: SidecarResponse<CheckChromeData> =
        serde_json::from_str(&output).map_err(|e| {
            AppError::external(format!(
                "解析响应失败: {}. 输出摘要: {}",
                e,
                summarize_text(&output)
            ))
        })?;

    if response.success {
        if let Some(data) = response.data {
            if data.installed {
                if let (Some(name), Some(path)) = (&data.name, &data.path) {
                    log::debug!("[QiyuToken] detected {}: {}", name, safe_path(path));
                }
                return Ok(true);
            }
        }
        log::warn!("[QiyuToken] Chrome or Edge not detected");
        Ok(false)
    } else {
        Err(AppError::external(
            response.error.unwrap_or_else(|| "未知错误".to_string()),
        ))
    }
}

#[tauri::command]
pub async fn check_qiyu_available(app: tauri::AppHandle) -> bool {
    let start_time = std::time::Instant::now();

    match fetch_qiyu_token_internal(&app).await {
        Ok(_) => {
            log::info!("[Qiyu] available, elapsed: {:?}", start_time.elapsed());
            true
        }
        Err(e) => {
            log::error!("[Qiyu] unavailable: {}, elapsed: {:?}", e, start_time.elapsed());
            false
        }
    }
}

#[tauri::command]
pub async fn fetch_qiyu_token(app: tauri::AppHandle) -> Result<QiyuToken, AppError> {
    fetch_qiyu_token_internal(&app).await
}

pub async fn fetch_qiyu_token_internal(_app: &tauri::AppHandle) -> Result<QiyuToken, AppError> {
    log::debug!("[QiyuToken] starting sidecar");

    let (output, stderr_output) =
        portable::run_sidecar("qiyu-token-fetcher", &["fetch-token"], 45).await?;

    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            log::debug!("{}", sanitize_sidecar_log_line(line));
        }
    }

    let response: SidecarResponse<QiyuToken> = serde_json::from_str(&output).map_err(|e| {
        AppError::external(format!(
            "解析响应失败: {}. 输出摘要: {}",
            e,
            summarize_text(&output)
        ))
    })?;

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
