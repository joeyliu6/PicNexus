// src-tauri/src/commands/smms.rs
// SM.MS 图床上传命令

use reqwest::multipart;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};
use url::Url;

use super::utils::read_file_bytes;
use crate::error::{AppError, IntoAppError};
use crate::log_utils::{safe_path, safe_url, summarize_text};

/// SM.MS 上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct SmmsUploadResult {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

/// SM.MS API 响应
#[derive(Debug, Deserialize)]
struct SmmsResponse {
    success: bool,
    code: String,
    message: String,
    #[serde(rename = "data")]
    data: Option<SmmsData>,
}

/// SM.MS 返回的数据
#[derive(Debug, Deserialize)]
struct SmmsData {
    url: String,
    delete: Option<String>,
    hash: Option<String>,
}

fn repeated_image_url(message: &str) -> Option<String> {
    let url_pattern = regex::Regex::new(r#"https?://[^\s\"'<>]+"#).ok()?;
    let result = url_pattern.find_iter(message).find_map(|matched| {
        let candidate = matched
            .as_str()
            .trim_end_matches(
                &[
                    '.', ',', ';', ':', '!', '?', ')', ']', '}', '。', '，', '；', '：', '！',
                    '？',
                ][..],
            );
        let parsed = Url::parse(candidate).ok()?;
        if matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some() {
            Some(parsed.to_string())
        } else {
            None
        }
    });
    result
}

pub(crate) fn parse_smms_upload_response(
    response_text: &str,
) -> Result<SmmsUploadResult, AppError> {
    let response: SmmsResponse = serde_json::from_str(response_text)
        .map_err(|e| AppError::upload("SM.MS", format!("JSON 解析失败: {}", e)))?;

    if response.code == "image_repeated" {
        let url = repeated_image_url(&response.message)
            .ok_or_else(|| AppError::upload("SM.MS", "重复图片响应中缺少有效 URL"))?;
        return Ok(SmmsUploadResult {
            url,
            delete: None,
            hash: None,
        });
    }

    if !response.success {
        return Err(AppError::upload(
            "SM.MS",
            format!("{}: {}", response.code, response.message),
        ));
    }

    let data = response
        .data
        .ok_or_else(|| AppError::upload("SM.MS", "API 未返回数据"))?;
    Url::parse(&data.url)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
        .ok_or_else(|| AppError::upload("SM.MS", "API 返回了无效 URL"))?;

    Ok(SmmsUploadResult {
        url: data.url,
        delete: data.delete,
        hash: data.hash,
    })
}

/// 文件大小限制：5MB（SM.MS 免费用户限制）
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// 上传文件到 SM.MS
#[tauri::command]
pub async fn upload_to_smms(
    window: Window,
    id: String,
    file_path: String,
    smms_token: String,
) -> Result<SmmsUploadResult, AppError> {
    log::info!("[SM.MS] 开始上传文件: {}", safe_path(&file_path));

    // 发送进度: 0% - 读取文件
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 0,
            "total": 100,
            "step": "读取文件...",
            "step_index": 1,
            "total_steps": 3
        }),
    );

    // 1. 读取文件
    let (buffer, file_size) = read_file_bytes(&file_path, MAX_FILE_SIZE).await?;

    // 2. 验证文件大小（限制 5MB）
    if file_size > MAX_FILE_SIZE {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过 SM.MS 限制 (5MB)",
            file_size as f64 / 1024.0 / 1024.0
        )));
    }

    // 3. 验证文件类型（只允许图片）
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法获取文件名"))?;

    let ext = file_name
        .split('.')
        .next_back()
        .ok_or_else(|| AppError::validation("无法获取文件扩展名"))?
        .to_lowercase();

    if !["jpg", "jpeg", "png", "gif", "bmp", "webp"].contains(&ext.as_str()) {
        return Err(AppError::validation(
            "只支持 JPG、PNG、GIF、BMP、WebP 格式的图片",
        ));
    }

    // 发送进度: 33% - 准备上传
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 33,
            "total": 100,
            "step": "准备上传...",
            "step_index": 2,
            "total_steps": 3
        }),
    );

    // 4. 构建 multipart form
    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str("image/*")
        .into_validation_err_with("无法设置 MIME 类型")?;

    let form = multipart::Form::new().part("smfile", part);

    // 发送进度: 66% - 正在上传
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 66,
            "total": 100,
            "step": "正在上传...",
            "step_index": 3,
            "total_steps": 3
        }),
    );

    // 5. 发送请求到 SM.MS API
    let client = reqwest::Client::new();
    let response = client
        .post("https://sm.ms/api/v2/upload")
        .header("Authorization", smms_token)
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .into_network_err_with("上传请求失败")?;

    // 6. 检查 HTTP 状态码
    let status = response.status();
    if !status.is_success() {
        let response_text = response.text().await.unwrap_or_default();
        log::error!("[SM.MS] API 错误响应: {}", summarize_text(&response_text));
        return match status {
            reqwest::StatusCode::UNAUTHORIZED => Err(AppError::auth("SM.MS Token 无效或已过期")),
            reqwest::StatusCode::TOO_MANY_REQUESTS => {
                Err(AppError::upload("SM.MS", "API 调用频率超限，请稍后重试"))
            }
            reqwest::StatusCode::PAYLOAD_TOO_LARGE => {
                Err(AppError::validation("文件大小超过限制 (5MB)"))
            }
            _ => Err(AppError::upload(
                "SM.MS",
                format!(
                    "上传失败 (HTTP {}): {}",
                    status,
                    summarize_text(&response_text)
                ),
            )),
        };
    }

    // 7. 解析响应
    let response_text = response
        .text()
        .await
        .into_network_err_with("无法读取响应")?;

    log::debug!("[SM.MS] API 响应: {}", summarize_text(&response_text));

    let result = parse_smms_upload_response(&response_text)?;
    log::info!("[SM.MS] 上传成功 - URL: {}", safe_url(&result.url));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_success_response() {
        let result = parse_smms_upload_response(
            r#"{"success":true,"code":"success","message":"ok","data":{"url":"https://s3.sm.ms/a.png","delete":"https://sm.ms/delete/a","hash":"abc"}}"#,
        )
        .expect("normal success should parse");
        assert_eq!(result.url, "https://s3.sm.ms/a.png");
        assert_eq!(result.hash.as_deref(), Some("abc"));
    }

    #[test]
    fn parses_repeated_image_url_from_message() {
        let result = parse_smms_upload_response(
            r#"{"success":false,"code":"image_repeated","message":"Image upload repeated limit, this image exists at https://s3.sm.ms/a.png.","data":null}"#,
        )
        .expect("repeated image should be reusable");
        assert_eq!(result.url, "https://s3.sm.ms/a.png");
        assert!(result.delete.is_none());
    }

    #[test]
    fn rejects_repeated_image_without_valid_url() {
        let error = parse_smms_upload_response(
            r#"{"success":false,"code":"image_repeated","message":"already exists","data":null}"#,
        )
        .expect_err("missing URL must remain an error");
        assert!(error.to_string().contains("有效 URL"));
    }
}
