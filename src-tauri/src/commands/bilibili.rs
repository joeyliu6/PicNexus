// src-tauri/src/commands/bilibili.rs
// 哔哩哔哩图床上传命令

use tauri::Window;
use serde::{Deserialize, Serialize};
use reqwest::multipart;
use regex::Regex;

use crate::error::{AppError, IntoAppError};
use super::utils::read_file_bytes;

/// 哔哩哔哩上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct BilibiliUploadResult {
    pub url: String,
    pub size: u64,
}

/// 哔哩哔哩上传 API 响应结构
#[derive(Debug, Deserialize)]
struct BilibiliApiResponse {
    code: i32,
    data: Option<String>,
    message: Option<String>,
}

/// 哔哩哔哩用户导航 API 响应结构（用于验证 Cookie）
#[derive(Debug, Deserialize)]
struct BilibiliNavResponse {
    code: i32,
    message: Option<String>,
    data: Option<BilibiliNavData>,
}

#[derive(Debug, Deserialize)]
struct BilibiliNavData {
    #[serde(rename = "isLogin")]
    is_login: bool,
    uname: Option<String>,
}

/// 从完整 Cookie 中提取 SESSDATA 和 bili_jct
fn extract_bilibili_cookies(cookie: &str) -> Result<(String, String), AppError> {
    let sessdata_re = Regex::new(r"SESSDATA=([^;]+)")
        .into_external_err_with("正则表达式编译失败")?;
    let csrf_re = Regex::new(r"bili_jct=([^;]+)")
        .into_external_err_with("正则表达式编译失败")?;

    let sessdata = sessdata_re.captures(cookie)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| AppError::auth("Cookie 中缺少 SESSDATA 字段"))?;

    let csrf = csrf_re.captures(cookie)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| AppError::auth("Cookie 中缺少 bili_jct (csrf) 字段"))?;

    Ok((sessdata, csrf))
}

/// 测试哔哩哔哩 Cookie 是否有效（使用用户导航 API，无需上传图片）
#[tauri::command]
pub async fn test_bilibili_connection(bilibili_cookie: String) -> Result<String, AppError> {
    log::info!("[Bilibili] 测试 Cookie 有效性...");

    // 检查 Cookie 非空
    if bilibili_cookie.trim().is_empty() {
        return Err(AppError::validation("Cookie 不能为空"));
    }

    // 提取并验证 Cookie 字段
    let (sessdata, _csrf) = extract_bilibili_cookies(&bilibili_cookie)?;
    log::info!("[Bilibili] Cookie 包含必要字段 SESSDATA 和 bili_jct");

    // 使用用户导航 API 验证登录状态（不需要上传图片）
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.bilibili.com/x/web-interface/nav")
        .header("Cookie", format!("SESSDATA={}", sessdata))
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .into_network_err_with("请求失败")?;

    let response_text = response.text().await
        .into_network_err_with("无法读取响应")?;

    log::debug!("[Bilibili] 导航 API 响应: {} bytes", response_text.len());

    // 解析响应
    let nav_response: BilibiliNavResponse = serde_json::from_str(&response_text)
        .map_err(|_| AppError::auth("Cookie 无效或已过期（无法解析响应）"))?;

    // 检查登录状态
    if nav_response.code == 0 {
        if let Some(data) = nav_response.data {
            if data.is_login {
                let username = data.uname.unwrap_or_else(|| "未知用户".to_string());
                log::info!("[Bilibili] Cookie 有效（用户: {}）", username);
                return Ok(format!("Cookie 验证通过（用户: {}）", username));
            }
        }
        // code=0 但未登录
        Err(AppError::auth("Cookie 无效：未登录状态"))
    } else {
        // code != 0，通常是 -101 表示未登录
        let msg = nav_response.message.unwrap_or_else(|| "未知错误".to_string());
        Err(AppError::auth(format!("Cookie 无效: {} (code: {})", msg, nav_response.code)))
    }
}

/// 上传图片到哔哩哔哩
#[tauri::command]
pub async fn upload_to_bilibili(
    _window: Window,
    _id: String,
    file_path: String,
    bilibili_cookie: String,
) -> Result<BilibiliUploadResult, AppError> {
    log::info!("[Bilibili] 开始上传文件: {}", file_path);

    // 1. 提取 SESSDATA 和 csrf
    let (sessdata, csrf) = extract_bilibili_cookies(&bilibili_cookie)?;

    // 2. 读取文件
    let (buffer, file_size) = read_file_bytes(&file_path).await?;

    // 3. 检查文件大小（哔哩哔哩限制 10MB）
    const MAX_SIZE: u64 = 10 * 1024 * 1024; // 10MB
    if file_size > MAX_SIZE {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过哔哩哔哩限制 (10MB)",
            file_size as f64 / 1024.0 / 1024.0
        )));
    }

    // 4. 获取文件名和扩展名
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法获取文件名"))?;

    let ext = file_name.split('.').last()
        .ok_or_else(|| AppError::validation("无法获取文件扩展名"))?
        .to_lowercase();

    // 5. 验证文件类型
    if !["jpg", "jpeg", "png", "gif", "webp"].contains(&ext.as_str()) {
        return Err(AppError::validation("只支持 JPG、PNG、GIF、WebP 格式的图片"));
    }

    // 6. 确定 MIME 类型
    let mime_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };

    // 7. 构建 multipart form
    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .into_validation_err_with("无法设置 MIME 类型")?;

    let form = multipart::Form::new()
        .part("file", part)
        .text("csrf", csrf);

    // 8. 发送请求
    let client = reqwest::Client::new();
    let response = client
        .post("https://mall.bilibili.com/mall-up-c/common/image")
        .header("Cookie", format!("SESSDATA={}", sessdata))
        .header("Referer", "https://mall.bilibili.com/")
        .header("Origin", "https://mall.bilibili.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(form)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .into_network_err_with("请求失败")?;

    // 9. 解析响应
    let response_text = response.text().await
        .into_network_err_with("无法读取响应")?;

    log::debug!("[Bilibili] API 响应: {}", response_text);

    let api_response: BilibiliApiResponse = serde_json::from_str(&response_text)
        .map_err(|e| AppError::upload("哔哩哔哩", format!("JSON 解析失败: {} (响应: {})", e, response_text)))?;

    // 10. 检查上传结果
    if api_response.code != 0 {
        let msg = api_response.message.unwrap_or_else(|| "未知错误".to_string());
        return Err(AppError::upload_with_code("哔哩哔哩", api_response.code, msg));
    }

    let image_url = api_response.data
        .ok_or_else(|| AppError::upload("哔哩哔哩", "API 未返回图片链接"))?;

    // 11. 处理 URL（添加协议前缀）
    let final_url = if image_url.starts_with("//") {
        format!("https:{}", image_url)
    } else if !image_url.starts_with("http") {
        format!("https://{}", image_url)
    } else {
        image_url
    };

    log::info!("[Bilibili] 上传成功: {}", final_url);

    Ok(BilibiliUploadResult {
        url: final_url,
        size: file_size,
    })
}
