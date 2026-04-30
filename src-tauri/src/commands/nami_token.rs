use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::log_utils::{sanitize_text, summarize_text};
use crate::portable;

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
        format!(
            "[NamiToken] sidecar sensitive log redacted ({})",
            summarize_text(line)
        )
    } else {
        sanitize_text(line)
    }
}

#[tauri::command]
pub async fn fetch_nami_token(
    app: tauri::AppHandle,
    cookie: String,
    auth_token: String,
) -> Result<NamiDynamicHeaders, AppError> {
    fetch_nami_token_internal(&app, cookie, auth_token).await
}

pub async fn fetch_nami_token_internal(
    _app: &tauri::AppHandle,
    cookie: String,
    auth_token: String,
) -> Result<NamiDynamicHeaders, AppError> {
    log::info!("[NamiToken] starting sidecar");

    let args = [
        "fetch-token",
        "--cookie",
        &cookie,
        "--auth-token",
        &auth_token,
    ];
    let (output, stderr_output) = portable::run_sidecar("nami-token-fetcher", &args, 45).await?;

    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            log::debug!("{}", sanitize_sidecar_log_line(line));
        }
    }

    let response: SidecarResponse<NamiDynamicHeaders> =
        serde_json::from_str(&output).map_err(|e| {
            AppError::external(format!(
                "解析响应失败: {}. 输出摘要: {}",
                e,
                summarize_text(&output)
            ))
        })?;

    if response.success {
        if let Some(headers) = response.data {
            log::info!("[NamiToken] headers fetched");
            return Ok(headers);
        }
        Err(AppError::external("响应中没有 Headers 数据"))
    } else {
        Err(AppError::external(
            response.error.unwrap_or_else(|| "未知错误".to_string()),
        ))
    }
}
