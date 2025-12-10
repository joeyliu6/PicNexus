// src-tauri/src/commands/nowcoder.rs
// 牛客图床上传命令

use tauri::Window;
use serde::{Deserialize, Serialize};
use reqwest::multipart;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use std::time::{SystemTime, UNIX_EPOCH};

/// 测试牛客 Cookie 是否有效
#[tauri::command]
pub async fn test_nowcoder_cookie(nowcoder_cookie: String) -> Result<String, String> {
    println!("[Nowcoder] 测试 Cookie 有效性...");

    // 检查 Cookie 是否包含必要字段
    if !nowcoder_cookie.contains("t=") {
        return Err("Cookie 缺少必要的 't' 字段".to_string());
    }

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

    // 构建带时间戳的 URL
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("无法获取时间戳: {}", e))?
        .as_millis();

    let url = format!("https://www.nowcoder.com/uploadImage?type=1&_={}", timestamp);

    // 构建 multipart form
    let part = multipart::Part::bytes(minimal_png)
        .file_name("test.png".to_string())
        .mime_str("image/png")
        .map_err(|e| format!("无法设置 MIME 类型: {}", e))?;

    let form = multipart::Form::new().part("file", part);

    // 发送请求
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Cookie", &nowcoder_cookie)
        .header("Referer", "https://www.nowcoder.com/creation/write/article")
        .header("Origin", "https://www.nowcoder.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let response_text = response.text().await
        .map_err(|e| format!("无法读取响应: {}", e))?;

    println!("[Nowcoder] 测试响应: {}", response_text);

    // 解析响应
    let api_response: NowcoderApiResponse = serde_json::from_str(&response_text)
        .map_err(|_| "Cookie 无效或已过期（无法解析响应）".to_string())?;

    if api_response.code == 0 {
        Ok("Cookie 有效".to_string())
    } else {
        Err(format!("{} (code: {})", api_response.msg.trim(), api_response.code))
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NowcoderUploadResult {
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
struct NowcoderApiResponse {
    code: i32,
    msg: String,
    url: Option<String>,
}

#[tauri::command]
pub async fn upload_to_nowcoder(
    _window: Window,
    _id: String,
    file_path: String,
    nowcoder_cookie: String,
) -> Result<NowcoderUploadResult, String> {
    println!("[Nowcoder] 开始上传文件: {}", file_path);

    // 1. 读取文件
    let mut file = File::open(&file_path).await
        .map_err(|e| format!("无法打开文件: {}", e))?;

    let file_size = file.metadata().await
        .map_err(|e| format!("无法获取文件元数据: {}", e))?
        .len();

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).await
        .map_err(|e| format!("无法读取文件: {}", e))?;

    // 2. 验证文件类型（只允许图片）
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?;

    let ext = file_name.split('.').last()
        .ok_or("无法获取文件扩展名")?
        .to_lowercase();

    if !["jpg", "jpeg", "png", "gif"].contains(&ext.as_str()) {
        return Err("只支持 JPG、PNG、GIF 格式的图片".to_string());
    }

    // 3. 构建带时间戳的 URL
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("无法获取时间戳: {}", e))?
        .as_millis();

    let url = format!("https://www.nowcoder.com/uploadImage?type=1&_={}", timestamp);

    // 4. 构建 multipart form
    // 将扩展名转为小写（避免服务器不支持大写扩展名）
    let normalized_file_name = if let Some(dot_pos) = file_name.rfind('.') {
        format!("{}.{}", &file_name[..dot_pos], ext)
    } else {
        file_name.to_string()
    };

    let part = multipart::Part::bytes(buffer)
        .file_name(normalized_file_name)
        .mime_str("image/*")
        .map_err(|e| format!("无法设置 MIME 类型: {}", e))?;

    let form = multipart::Form::new()
        .part("file", part);

    // 5. 发送请求到牛客 API（带必须的 Headers）
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Cookie", &nowcoder_cookie)
        .header("Referer", "https://www.nowcoder.com/creation/write/article")
        .header("Origin", "https://www.nowcoder.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    // 6. 解析响应
    let response_text = response.text().await
        .map_err(|e| format!("无法读取响应: {}", e))?;

    println!("[Nowcoder] API 响应: {}", response_text);

    let api_response: NowcoderApiResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("JSON 解析失败: {} (响应: {})", e, response_text))?;

    // 7. 检查上传结果
    if api_response.code != 0 {
        return Err(format!("牛客 API 返回错误: {} (code: {})", api_response.msg, api_response.code));
    }

    let image_url = api_response.url
        .ok_or("API 未返回图片链接")?;

    // 8. 将 http 转换为 https
    let https_url = if image_url.starts_with("http://") {
        image_url.replacen("http://", "https://", 1)
    } else {
        image_url
    };

    // 9. 移除压缩路径，获取原图链接
    // 牛客会自动压缩大图，URL 中包含 compress/mw1000/ 等路径
    // 例如: https://uploadfiles.nowcoder.com/compress/mw1000/images/...
    // 移除后: https://uploadfiles.nowcoder.com/images/...
    let final_url = if let Some(compress_pos) = https_url.find("/compress/") {
        // 找到 /compress/ 后面的下一个 /
        let after_compress = &https_url[compress_pos + "/compress/".len()..];
        if let Some(next_slash) = after_compress.find('/') {
            // 拼接: 前半部分 + 后半部分（跳过 /compress/mwXXX 部分）
            format!("{}{}", &https_url[..compress_pos], &after_compress[next_slash..])
        } else {
            https_url
        }
    } else {
        https_url
    };

    println!("[Nowcoder] 上传成功: {}", final_url);

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    Ok(NowcoderUploadResult {
        url: final_url,
        size: file_size,
    })
}
