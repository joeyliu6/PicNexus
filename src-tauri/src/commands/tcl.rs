// src-tauri/src/commands/tcl.rs
// TCL 图床上传命令

use tauri::Window;
use serde::{Deserialize, Serialize};
use reqwest::multipart;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct TCLUploadResult {
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
struct TCLApiResponse {
    code: i32,
    msg: String,
    data: Option<String>,
}

#[tauri::command]
pub async fn upload_to_tcl(
    _window: Window,
    _id: String,
    file_path: String,
) -> Result<TCLUploadResult, String> {
    println!("[TCL] 开始上传文件: {}", file_path);

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

    if !["jpg", "jpeg", "png", "gif", "heic", "mp4", "mov"].contains(&ext.as_str()) {
        return Err("只支持 JPG、JPEG、PNG、GIF、HEIC、MP4、MOV 格式".to_string());
    }

    // 注意：暂不验证文件大小限制，因为限制还不确定

    // 3. 构建 multipart form
    // 将扩展名转为小写（TCL API 不支持大写扩展名）
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

    // 4. 发送请求到 TCL API
    let client = reqwest::Client::new();
    let response = client
        .post("https://service2.tcl.com/api.php/Center/uploadQiniu")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    // 5. 解析响应
    let response_text = response.text().await
        .map_err(|e| format!("无法读取响应: {}", e))?;

    println!("[TCL] API 响应: {}", response_text);

    let api_response: TCLApiResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // 6. 检查上传结果
    if api_response.code != 1 && api_response.msg != "success" {
        return Err(format!("TCL API 返回错误: {}", api_response.msg));
    }

    let data_url = api_response.data
        .ok_or("API 未返回图片链接")?;

    // 7. 提取 URL（去掉 ?e= 参数）
    let clean_url = if let Some(pos) = data_url.find("?e=") {
        &data_url[..pos]
    } else {
        &data_url
    };

    // 8. 将 http 转换为 https
    let https_url = if clean_url.starts_with("http://") {
        clean_url.replacen("http://", "https://", 1)
    } else {
        clean_url.to_string()
    };

    println!("[TCL] 上传成功: {}", https_url);

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    Ok(TCLUploadResult {
        url: https_url,
        size: file_size,
    })
}
