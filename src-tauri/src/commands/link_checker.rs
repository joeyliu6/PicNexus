// src-tauri/src/commands/link_checker.rs
// 图片链接检测命令

use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckLinkResult {
    pub link: String,
    pub is_valid: bool,
    pub status_code: Option<u16>,
    pub error: Option<String>,

    // 新增字段
    pub error_type: String,        // "success" | "http_4xx" | "http_5xx" | "timeout" | "network"
    pub suggestion: Option<String>, // 修复建议
    pub response_time: Option<u64>, // 响应时间(毫秒)
}

/// 错误分类和建议生成
fn classify_error(status_code: Option<u16>, error: Option<&reqwest::Error>) -> (String, Option<String>) {
    // HTTP 4xx 错误
    if let Some(code) = status_code {
        if code >= 400 && code < 500 {
            return (
                "http_4xx".to_string(),
                Some("图片已被删除或无权访问，建议从其他有效图床重新上传".to_string())
            );
        } else if code >= 500 {
            return (
                "http_5xx".to_string(),
                Some("图床服务器暂时不可用，建议稍后重试".to_string())
            );
        } else if code >= 200 && code < 300 {
            return ("success".to_string(), None);
        }
    }

    // 网络错误
    if let Some(err) = error {
        if err.is_timeout() {
            return (
                "timeout".to_string(),
                Some("请求超时，可能是网络延迟或图床响应慢".to_string())
            );
        } else if err.is_connect() {
            return (
                "network".to_string(),
                Some("网络连接失败，请检查网络或防火墙设置".to_string())
            );
        }
    }

    // 默认
    ("network".to_string(), Some("未知错误".to_string()))
}

/// 检测单个图片链接是否有效
///
/// 使用 HEAD 请求检测链接，减少流量消耗
/// 超时设置为 10 秒，避免长时间等待
#[tauri::command]
pub async fn check_image_link(
    link: String,
    http_client: tauri::State<'_, crate::HttpClient>
) -> Result<CheckLinkResult, String> {
    eprintln!("[链接检测] 检测链接: {}", link);

    // 验证 URL 格式
    if link.trim().is_empty() {
        return Ok(CheckLinkResult {
            link,
            is_valid: false,
            status_code: None,
            error: Some("链接为空".to_string()),
            error_type: "network".to_string(),
            suggestion: Some("链接为空".to_string()),
            response_time: None,
        });
    }

    // 记录开始时间
    let start_time = Instant::now();

    // 发送 HEAD 请求（不下载图片内容，仅检查状态）
    match http_client.0
        .head(&link)
        .timeout(std::time::Duration::from_secs(10))  // 10秒超时
        .send()
        .await
    {
        Ok(response) => {
            let elapsed = start_time.elapsed().as_millis() as u64;
            let status = response.status();
            let status_code = status.as_u16();
            let is_valid = status.is_success();  // 2xx 状态码

            let (error_type, suggestion) = classify_error(Some(status_code), None);

            eprintln!("[链接检测] {} - HTTP {} ({}ms)",
                if is_valid { "✓" } else { "✗" },
                status_code,
                elapsed
            );

            Ok(CheckLinkResult {
                link,
                is_valid,
                status_code: Some(status_code),
                error: if !is_valid {
                    Some(format!("HTTP {}", status_code))
                } else {
                    None
                },
                error_type,
                suggestion,
                response_time: Some(elapsed),
            })
        }
        Err(err) => {
            let elapsed = start_time.elapsed().as_millis() as u64;

            let error_msg = if err.is_timeout() {
                "请求超时".to_string()
            } else if err.is_connect() {
                "连接失败".to_string()
            } else {
                err.to_string()
            };

            let (error_type, suggestion) = classify_error(None, Some(&err));

            eprintln!("[链接检测] ✗ 失败: {} ({}ms)", error_msg, elapsed);

            Ok(CheckLinkResult {
                link,
                is_valid: false,
                status_code: None,
                error: Some(error_msg),
                error_type,
                suggestion,
                response_time: Some(elapsed),
            })
        }
    }
}

/// 从 URL 下载图片到临时目录
///
/// 用于重新上传功能：从有效图床下载图片，然后重新上传到失效图床
#[tauri::command]
pub async fn download_image_from_url(
    url: String,
    http_client: tauri::State<'_, crate::HttpClient>
) -> Result<String, String> {
    eprintln!("[下载图片] 开始下载: {}", url);

    // 发送 GET 请求下载图片
    let response = http_client.0
        .get(&url)
        .timeout(std::time::Duration::from_secs(30))  // 30秒超时
        .send()
        .await
        .map_err(|e| {
            eprintln!("[下载图片] ✗ 请求失败: {}", e);
            format!("下载失败: {}", e)
        })?;

    if !response.status().is_success() {
        let status = response.status();
        eprintln!("[下载图片] ✗ HTTP错误: {}", status);
        return Err(format!("下载失败: HTTP {}", status.as_u16()));
    }

    // 读取响应内容
    let bytes = response.bytes().await.map_err(|e| {
        eprintln!("[下载图片] ✗ 读取内容失败: {}", e);
        format!("读取内容失败: {}", e)
    })?;

    eprintln!("[下载图片] ✓ 下载成功，大小: {} bytes", bytes.len());

    // 创建临时文件
    let temp_dir = std::env::temp_dir();
    let file_name = format!("weibo_reupload_{}.jpg", chrono::Local::now().timestamp());
    let temp_path = temp_dir.join(file_name);

    // 写入文件
    std::fs::write(&temp_path, bytes).map_err(|e| {
        eprintln!("[下载图片] ✗ 写入文件失败: {}", e);
        format!("写入文件失败: {}", e)
    })?;

    let path_str = temp_path.to_string_lossy().to_string();
    eprintln!("[下载图片] ✓ 已保存到: {}", path_str);

    Ok(path_str)
}
