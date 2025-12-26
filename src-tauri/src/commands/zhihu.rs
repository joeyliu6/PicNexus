// src-tauri/src/commands/zhihu.rs
// 知乎图床上传命令
// v2.10: 迁移到 AppError 统一错误类型
//
// 上传流程:
// 1. 计算图片 MD5 Hash
// 2. POST api.zhihu.com/images 获取上传凭证
// 3. 判断 state (1=已存在, 0=需要上传)
// 4. 如果需要上传: PUT 到阿里云 OSS + 通知完成
// 5. 轮询图片状态直到处理完成
// 6. URL 标准化为 https://picx.zhimg.com/v2-{hash}.webp

use tauri::Window;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use std::time::Duration;
use md5::{Md5, Digest};
use hmac::{Hmac, Mac};
use sha1::Sha1;
use base64::{Engine, engine::general_purpose::STANDARD};
use regex::Regex;

use crate::error::AppError;

type HmacSha1 = Hmac<Sha1>;

/// 最大重试次数
const MAX_UPLOAD_RETRIES: u32 = 3;

#[derive(Debug, Serialize, Deserialize)]
pub struct ZhihuUploadResult {
    pub url: String,
    pub size: u64,
}

// 上传凭证响应
#[derive(Debug, Deserialize)]
struct UploadCredentialsResponse {
    upload_token: Option<UploadToken>,
    upload_file: UploadFile,
}

#[derive(Debug, Deserialize)]
struct UploadToken {
    access_id: String,
    access_key: String,
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct UploadFile {
    image_id: String,
    object_key: Option<String>,
    state: i32,
}

// 图片状态响应
#[derive(Debug, Deserialize)]
struct ImageStatusResponse {
    status: Option<String>,
    url: Option<String>,
    original_src: Option<String>,
}

/// 计算图片 MD5 Hash
fn calculate_md5(data: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

/// 计算 OSS 签名
fn calculate_oss_signature(
    access_key: &str,
    content_type: &str,
    date: &str,
    security_token: &str,
    object_key: &str,
) -> Result<String, AppError> {
    // StringToSign 格式:
    // PUT\n
    // \n                           (Content-MD5 为空)
    // image/png\n
    // Wed, 04 Dec 2024 05:00:00 GMT\n
    // x-oss-date:Wed, 04 Dec 2024 05:00:00 GMT\n
    // x-oss-security-token:{token}\n
    // /zhihu-pics/{object_key}

    let string_to_sign = format!(
        "PUT\n\n{}\n{}\nx-oss-date:{}\nx-oss-security-token:{}\n/zhihu-pics/{}",
        content_type, date, date, security_token, object_key
    );

    let mut mac = HmacSha1::new_from_slice(access_key.as_bytes())
        .map_err(|e| AppError::external(format!("HMAC 初始化失败: {}", e)))?;
    mac.update(string_to_sign.as_bytes());

    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}

/// 获取 RFC 2822 格式的日期
fn get_rfc2822_date() -> String {
    use chrono::Utc;
    Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string()
}

/// URL 标准化
/// 将任意知乎图片 URL 转换为标准格式: https://picx.zhimg.com/v2-{hash}.webp
fn normalize_image_url(url: &str) -> String {
    let re = Regex::new(r"v2-[a-f0-9]+").unwrap();
    if let Some(captures) = re.find(url) {
        format!("https://picx.zhimg.com/{}.webp", captures.as_str())
    } else {
        url.to_string()
    }
}

/// 获取 MIME 类型
fn get_mime_type(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    }
}

#[tauri::command]
pub async fn upload_to_zhihu(
    _window: Window,
    _id: String,
    file_path: String,
    zhihu_cookie: String,
) -> Result<ZhihuUploadResult, AppError> {
    let mut last_error: Option<AppError> = None;

    for attempt in 0..=MAX_UPLOAD_RETRIES {
        if attempt > 0 {
            let delay = attempt * 2;  // 2, 4, 6 秒
            println!("[Zhihu] 第 {} 次重试，等待 {} 秒...", attempt, delay);
            tokio::time::sleep(Duration::from_secs(delay as u64)).await;
        }

        match upload_to_zhihu_inner(&file_path, &zhihu_cookie).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                // 只对"图片处理超时"错误进行重试
                let error_str = format!("{}", e);
                if error_str.contains("图片处理超时") && attempt < MAX_UPLOAD_RETRIES {
                    println!("[Zhihu] 上传超时，准备重试...");
                    last_error = Some(e);
                    continue;
                }
                return Err(e);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| AppError::upload("知乎", format!("上传失败，已重试 {} 次", MAX_UPLOAD_RETRIES))))
}

/// 内部上传函数
async fn upload_to_zhihu_inner(
    file_path: &str,
    zhihu_cookie: &str,
) -> Result<ZhihuUploadResult, AppError> {
    println!("[Zhihu] 开始上传文件: {}", file_path);

    // 1. 读取文件
    let mut file = File::open(&file_path).await
        .map_err(|e| AppError::file_io(format!("无法打开文件: {}", e)))?;

    let file_size = file.metadata().await
        .map_err(|e| AppError::file_io(format!("无法获取文件元数据: {}", e)))?
        .len();

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).await
        .map_err(|e| AppError::file_io(format!("无法读取文件: {}", e)))?;

    // 2. 验证文件类型（只允许图片）
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法获取文件名"))?;

    let ext = file_name.split('.').last()
        .ok_or_else(|| AppError::validation("无法获取文件扩展名"))?
        .to_lowercase();

    if !["jpg", "jpeg", "png", "gif", "webp"].contains(&ext.as_str()) {
        return Err(AppError::validation("只支持 JPG、PNG、GIF、WebP 格式的图片"));
    }

    let content_type = get_mime_type(&ext);

    // 3. 计算图片 MD5
    let image_hash = calculate_md5(&buffer);
    println!("[Zhihu] 图片 MD5: {}", image_hash);

    // 4. 获取上传凭证
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::network(format!("创建 HTTP 客户端失败: {}", e)))?;

    let credentials_response = client
        .post("https://api.zhihu.com/images")
        .header("Cookie", zhihu_cookie)
        .header("Content-Type", "application/json")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://www.zhihu.com/")
        .header("Origin", "https://www.zhihu.com")
        .json(&serde_json::json!({
            "image_hash": image_hash,
            "source": "pin"
        }))
        .send()
        .await
        .map_err(|e| AppError::network(format!("获取上传凭证失败: {}", e)))?;

    let credentials_text = credentials_response.text().await
        .map_err(|e| AppError::network(format!("读取凭证响应失败: {}", e)))?;

    println!("[Zhihu] 凭证响应: {}", credentials_text);

    let credentials: UploadCredentialsResponse = serde_json::from_str(&credentials_text)
        .map_err(|e| AppError::upload("知乎", format!("解析凭证失败: {} (响应: {})", e, credentials_text)))?;

    let image_id = credentials.upload_file.image_id.clone();
    println!("[Zhihu] Image ID: {}, State: {}", image_id, credentials.upload_file.state);

    // 5. 判断 state
    let final_url = if credentials.upload_file.state == 1 {
        // 图片已存在，直接查询状态获取 URL
        println!("[Zhihu] 图片已存在，跳过上传");
        poll_image_status(&client, &zhihu_cookie, &image_id, 30).await?
    } else {
        // 需要上传到 OSS
        let upload_token = credentials.upload_token
            .ok_or_else(|| AppError::upload("知乎", "state=0 但未返回 upload_token"))?;
        let object_key = credentials.upload_file.object_key
            .ok_or_else(|| AppError::upload("知乎", "state=0 但未返回 object_key"))?;

        println!("[Zhihu] 开始上传到 OSS: {}", object_key);

        // 5.1 上传到 OSS
        let date = get_rfc2822_date();
        let signature = calculate_oss_signature(
            &upload_token.access_key,
            content_type,
            &date,
            &upload_token.access_token,
            &object_key,
        )?;

        let authorization = format!("OSS {}:{}", upload_token.access_id, signature);

        let oss_url = format!("https://zhihu-pics-upload.zhimg.com/{}", object_key);

        let oss_response = client
            .put(&oss_url)
            .header("Content-Type", content_type)
            .header("Authorization", &authorization)
            .header("x-oss-date", &date)
            .header("x-oss-security-token", &upload_token.access_token)
            .body(buffer.clone())
            .send()
            .await
            .map_err(|e| AppError::network(format!("OSS 上传失败: {}", e)))?;

        let oss_status = oss_response.status();
        if !oss_status.is_success() {
            let oss_error = oss_response.text().await.unwrap_or_default();
            return Err(AppError::upload("知乎", format!("OSS 上传失败 ({}): {}", oss_status, oss_error)));
        }

        println!("[Zhihu] OSS 上传成功");

        // 5.2 通知知乎上传完成
        let notify_response = client
            .put(&format!("https://api.zhihu.com/images/{}/uploading_status", image_id))
            .header("Cookie", zhihu_cookie)
            .header("Content-Type", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header("Referer", "https://www.zhihu.com/")
            .header("Origin", "https://www.zhihu.com")
            .json(&serde_json::json!({
                "upload_result": "success"
            }))
            .send()
            .await
            .map_err(|e| AppError::network(format!("通知上传完成失败: {}", e)))?;

        if !notify_response.status().is_success() {
            let notify_error = notify_response.text().await.unwrap_or_default();
            println!("[Zhihu] 通知上传完成失败: {}", notify_error);
            // 继续轮询，可能服务端已经处理完成
        }

        println!("[Zhihu] 开始轮询图片状态...");

        // 5.3 轮询图片状态
        poll_image_status(&client, &zhihu_cookie, &image_id, 30).await?
    };

    // 6. 标准化 URL
    let normalized_url = normalize_image_url(&final_url);
    println!("[Zhihu] 上传成功: {}", normalized_url);

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    Ok(ZhihuUploadResult {
        url: normalized_url,
        size: file_size,
    })
}

/// 轮询图片状态
async fn poll_image_status(
    client: &Client,
    cookie: &str,
    image_id: &str,
    max_attempts: u32,
) -> Result<String, AppError> {
    for attempt in 0..max_attempts {
        tokio::time::sleep(Duration::from_secs(1)).await;

        let response = client
            .get(&format!("https://api.zhihu.com/images/{}", image_id))
            .header("Cookie", cookie)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header("Referer", "https://www.zhihu.com/")
            .send()
            .await
            .map_err(|e| AppError::network(format!("查询图片状态失败: {}", e)))?;

        let response_text = response.text().await
            .map_err(|e| AppError::network(format!("读取状态响应失败: {}", e)))?;

        let status: ImageStatusResponse = serde_json::from_str(&response_text)
            .map_err(|e| AppError::upload("知乎", format!("解析状态响应失败: {} (响应: {})", e, response_text)))?;

        println!("[Zhihu] 轮询 #{}: status={:?}", attempt + 1, status.status);

        if status.status.as_deref() != Some("processing") {
            // 处理完成，提取 URL
            if let Some(url) = status.url.or(status.original_src) {
                return Ok(url);
            } else {
                return Err(AppError::upload("知乎", format!("图片处理完成但未返回 URL (响应: {})", response_text)));
            }
        }
    }

    Err(AppError::upload("知乎", "图片处理超时"))
}

/// 测试知乎 Cookie 连接
#[tauri::command]
pub async fn test_zhihu_connection(zhihu_cookie: String) -> Result<String, AppError> {

    // 创建 1x1 透明 PNG 测试图片 (68 bytes)
    let test_image = vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
        8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 153, 99, 0, 1, 0, 0, 5,
        0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ];

    // 计算 MD5
    let image_hash = calculate_md5(&test_image);

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::network(format!("创建 HTTP 客户端失败: {}", e)))?;

    // 尝试获取上传凭证来验证 Cookie
    let response = client
        .post("https://api.zhihu.com/images")
        .header("Cookie", zhihu_cookie)
        .header("Content-Type", "application/json")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .header("Referer", "https://www.zhihu.com/")
        .header("Origin", "https://www.zhihu.com")
        .json(&serde_json::json!({
            "image_hash": image_hash,
            "source": "pin"
        }))
        .send()
        .await
        .map_err(|e| AppError::network(format!("请求失败: {}", e)))?;

    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if status.is_success() {
        // 尝试解析响应以验证格式正确
        if let Ok(_) = serde_json::from_str::<UploadCredentialsResponse>(&response_text) {
            Ok("Cookie 验证通过".to_string())
        } else {
            Ok("知乎 Cookie 可能有效，但响应格式异常".to_string())
        }
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        Err(AppError::auth("Cookie 已失效或无效，请重新获取"))
    } else {
        Err(AppError::upload("知乎", format!("测试失败 (HTTP {}): {}", status, response_text)))
    }
}
