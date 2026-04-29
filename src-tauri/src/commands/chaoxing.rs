// src-tauri/src/commands/chaoxing.rs
// 超星图床上传命令

use tauri::Window;
use serde::{Deserialize, Serialize};
use reqwest::multipart;

use crate::error::{AppError, IntoAppError};
use super::utils::read_file_bytes;

/// 超星上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct ChaoxingUploadResult {
    pub url: String,
    pub size: u64,
}

/// 超星 API 响应结构
#[derive(Debug, Deserialize)]
struct ChaoxingApiResponse {
    status: Option<bool>,
    url: Option<String>,
    msg: Option<String>,
}

/// 测试超星 Cookie 是否有效
#[tauri::command]
pub async fn test_chaoxing_connection(chaoxing_cookie: String) -> Result<String, AppError> {
    log::info!("[Chaoxing] 测试 Cookie 有效性...");

    // 检查 Cookie 非空
    if chaoxing_cookie.trim().is_empty() {
        return Err(AppError::validation("Cookie 不能为空"));
    }

    // 检查是否包含必要字段 _uid
    if !chaoxing_cookie.contains("_uid=") {
        return Err(AppError::auth("Cookie 缺少必要字段 _uid，请确认已登录"));
    }

    log::info!("[Chaoxing] Cookie 包含必要字段 _uid");

    // 最小的 1x1 透明 PNG（67 字节）
    let minimal_png: Vec<u8> = vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    ];

    // 构建 multipart form
    let part = multipart::Part::bytes(minimal_png)
        .file_name("test.png".to_string())
        .mime_str("image/png")
        .into_validation_err_with("无法设置 MIME 类型")?;

    let form = multipart::Form::new().part("attrFile", part);

    // 发送请求
    let client = reqwest::Client::new();
    let response = client
        .post("https://notice.chaoxing.com/pc/files/uploadNoticeFile")
        .header("Cookie", &chaoxing_cookie)
        .header("Referer", "https://notice.chaoxing.com/")
        .header("Origin", "https://notice.chaoxing.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(form)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .into_network_err_with("请求失败")?;

    let response_text = response.text().await
        .into_network_err_with("无法读取响应")?;

    log::debug!("[Chaoxing] 测试响应: {} bytes", response_text.len());

    // 检查是否返回 HTML（Cookie 失效的典型特征）
    if response_text.contains("<!DOCTYPE html>") || response_text.contains("<html") {
        return Err(AppError::auth("Cookie 已过期或无效，请重新登录"));
    }

    // 解析响应
    let api_response: ChaoxingApiResponse = serde_json::from_str(&response_text)
        .map_err(|_| AppError::auth("Cookie 无效或已过期（无法解析响应）"))?;

    if api_response.status == Some(true) && api_response.url.is_some() {
        log::info!("[Chaoxing] Cookie 有效（测试上传成功）");
        Ok("Cookie 验证通过".to_string())
    } else {
        let msg = api_response.msg.unwrap_or_else(|| "未知错误".to_string());
        Err(AppError::auth(format!("Cookie 无效: {}", msg)))
    }
}

/// 上传图片到超星图床
#[tauri::command]
pub async fn upload_to_chaoxing(
    _window: Window,
    _id: String,
    file_path: String,
    chaoxing_cookie: String,
) -> Result<ChaoxingUploadResult, AppError> {
    log::info!("[Chaoxing] 开始上传文件: {}", file_path);

    // 1. 检查 Cookie
    if chaoxing_cookie.trim().is_empty() {
        return Err(AppError::validation("Cookie 不能为空"));
    }

    // 2. 读取文件
    let (buffer, file_size) = read_file_bytes(&file_path).await?;

    // 3. 检查文件大小（超星限制 200MB）
    const MAX_SIZE: u64 = 200 * 1024 * 1024; // 200MB
    if file_size > MAX_SIZE {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过超星限制 (200MB)",
            file_size as f64 / 1024.0 / 1024.0
        )));
    }

    // 4. 获取文件名和扩展名
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法获取文件名"))?;

    let ext = file_name.split('.').next_back()
        .ok_or_else(|| AppError::validation("无法获取文件扩展名"))?
        .to_lowercase();

    // 5. 验证文件类型
    if !["jpg", "jpeg", "png", "gif", "webp", "bmp"].contains(&ext.as_str()) {
        return Err(AppError::validation("只支持 JPG、PNG、GIF、WebP、BMP 格式的图片"));
    }

    // 6. 确定 MIME 类型
    let mime_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    };

    // 7. 构建 multipart form（超星使用 attrFile 作为字段名）
    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .into_validation_err_with("无法设置 MIME 类型")?;

    let form = multipart::Form::new().part("attrFile", part);

    // 8. 发送请求（超星支持大文件，超时设为 120 秒）
    let client = reqwest::Client::new();
    let response = client
        .post("https://notice.chaoxing.com/pc/files/uploadNoticeFile")
        .header("Cookie", &chaoxing_cookie)
        .header("Referer", "https://notice.chaoxing.com/")
        .header("Origin", "https://notice.chaoxing.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(form)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .into_network_err_with("请求失败")?;

    // 9. 解析响应
    let response_text = response.text().await
        .into_network_err_with("无法读取响应")?;

    log::debug!("[Chaoxing] API 响应: {}", response_text);

    // 检查是否返回 HTML（Cookie 失效的典型特征）
    if response_text.contains("<!DOCTYPE html>") || response_text.contains("<html") {
        return Err(AppError::auth("Cookie 已过期或无效，请重新登录"));
    }

    let api_response: ChaoxingApiResponse = serde_json::from_str(&response_text)
        .map_err(|e| AppError::upload("超星", format!("JSON 解析失败: {} (响应: {})", e, response_text)))?;

    // 10. 检查上传结果
    if api_response.status != Some(true) {
        let msg = api_response.msg.unwrap_or_else(|| "未知错误".to_string());
        return Err(AppError::upload("超星", msg));
    }

    let image_url = api_response.url
        .ok_or_else(|| AppError::upload("超星", "API 未返回图片链接"))?;

    // 11. 去掉 URL 中的查询参数
    let final_url = image_url.split('?').next().unwrap_or(&image_url).to_string();

    log::info!("[Chaoxing] 上传成功: {}", final_url);

    Ok(ChaoxingUploadResult {
        url: final_url,
        size: file_size,
    })
}
