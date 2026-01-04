// src-tauri/src/commands/imgur.rs
// Imgur 图床上传命令

use tauri::{Window, Emitter};
use serde::{Deserialize, Serialize};
use reqwest::multipart;

use crate::error::{AppError, IntoAppError};
use super::utils::read_file_bytes;

/// Imgur 上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct ImgurUploadResult {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_hash: Option<String>,
}

/// Imgur API 响应
#[derive(Debug, Deserialize)]
struct ImgurResponse {
    success: bool,
    data: Option<ImgurData>,
    #[serde(skip)]
    status: i32,
}

/// Imgur 返回的数据
#[derive(Debug, Deserialize)]
struct ImgurData {
    link: String,
    deletehash: String,
}

/// 文件大小限制：20MB（图片）或 200MB（GIF）
const MAX_FILE_SIZE_IMAGE: u64 = 20 * 1024 * 1024;
const MAX_FILE_SIZE_GIF: u64 = 200 * 1024 * 1024;

/// 上传文件到 Imgur
#[tauri::command]
pub async fn upload_to_imgur(
    window: Window,
    id: String,
    file_path: String,
    imgur_client_id: String,
    imgur_client_secret: Option<String>,
) -> Result<ImgurUploadResult, AppError> {
    println!("[Imgur] 开始上传文件: {}", file_path);

    // 发送进度: 0% - 读取文件
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 0,
        "total": 100,
        "step": "读取文件...",
        "step_index": 1,
        "total_steps": 3
    }));

    // 1. 读取文件
    let (buffer, file_size) = read_file_bytes(&file_path).await?;

    // 2. 获取文件名并验证文件类型
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法获取文件名"))?;

    let ext = file_name.split('.').last()
        .ok_or_else(|| AppError::validation("无法获取文件扩展名"))?
        .to_lowercase();

    // 3. 验证文件类型
    let is_gif = ext == "gif";
    let max_size = if is_gif { MAX_FILE_SIZE_GIF } else { MAX_FILE_SIZE_IMAGE };

    if file_size > max_size {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过 Imgur 限制 ({:.0}MB)",
            file_size as f64 / 1024.0 / 1024.0,
            max_size as f64 / 1024.0 / 1024.0
        )));
    }

    if !["jpg", "jpeg", "png", "gif", "apng", "tiff", "bmp", "webp"].contains(&ext.as_str()) {
        return Err(AppError::validation("只支持 JPG、PNG、GIF、WebP、APNG、TIFF、BMP 格式的图片"));
    }

    // 发送进度: 33% - 准备上传
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 33,
        "total": 100,
        "step": "准备上传...",
        "step_index": 2,
        "total_steps": 3
    }));

    // 4. 构建 multipart form
    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str("image/*")
        .into_validation_err_with("无法设置 MIME 类型")?;

    let mut form_builder = multipart::Form::new()
        .part("image", part);

    // 如果提供了 Client Secret，添加到 form 中
    if let Some(secret) = imgur_client_secret {
        form_builder = form_builder.text("client_secret", secret);
    }

    // 发送进度: 66% - 正在上传
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 66,
        "total": 100,
        "step": "正在上传...",
        "step_index": 3,
        "total_steps": 3
    }));

    // 5. 发送请求到 Imgur API
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.imgur.com/3/image")
        .header("Authorization", format!("Client-ID {}", imgur_client_id))
        .multipart(form_builder)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .into_network_err_with("上传请求失败")?;

    // 6. 解析响应
    let response_text = response.text().await
        .into_network_err_with("无法读取响应")?;

    println!("[Imgur] API 响应: {}", response_text);

    let imgur_response: ImgurResponse = serde_json::from_str(&response_text)
        .map_err(|e| AppError::upload("Imgur", format!("JSON 解析失败: {}", e)))?;

    // 7. 检查上传结果
    if !imgur_response.success {
        return Err(AppError::upload("Imgur", "上传失败，请检查 Client ID 是否正确"));
    }

    let data = imgur_response.data
        .ok_or_else(|| AppError::upload("Imgur", "API 未返回数据"))?;

    println!("[Imgur] 上传成功 - URL: {}", data.link);

    Ok(ImgurUploadResult {
        url: data.link,
        delete_hash: Some(data.deletehash),
    })
}
