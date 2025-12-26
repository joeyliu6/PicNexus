// src-tauri/src/commands/tcl.rs
// TCL 图床上传命令
// v2.10: 迁移到 AppError 统一错误类型

use tauri::{Window, Emitter};
use serde::{Deserialize, Serialize};
use reqwest::multipart;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

use crate::error::AppError;

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

/// 检查 TCL 图床是否可用
/// 通过发送 GET 请求到 TCL 服务检测可达性
#[tauri::command]
pub async fn check_tcl_available() -> bool {
    println!("[TCL] 开始可用性检测...");
    let start_time = std::time::Instant::now();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build();

    match client {
        Ok(c) => {
            println!("[TCL] 发送请求到 https://service2.tcl.com/");
            match c.get("https://service2.tcl.com/").send().await {
                Ok(response) => {
                    let status = response.status();
                    let elapsed = start_time.elapsed();
                    let is_available = status.is_success() || status.as_u16() == 404;
                    println!("[TCL] 检测完成 - 状态码: {}, 耗时: {:?}, 结果: {}",
                        status.as_u16(), elapsed, if is_available { "可用" } else { "不可用" });
                    is_available
                }
                Err(e) => {
                    let elapsed = start_time.elapsed();
                    println!("[TCL] 可用性检测失败 - 错误: {}, 耗时: {:?}", e, elapsed);
                    false
                }
            }
        }
        Err(e) => {
            println!("[TCL] 创建 HTTP 客户端失败: {}", e);
            false
        }
    }
}

#[tauri::command]
pub async fn upload_to_tcl(
    window: Window,
    id: String,
    file_path: String,
) -> Result<TCLUploadResult, AppError> {
    println!("[TCL] 开始上传文件: {}", file_path);

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

    if !["jpg", "jpeg", "png", "gif", "heic", "mp4", "mov"].contains(&ext.as_str()) {
        return Err(AppError::validation("只支持 JPG、JPEG、PNG、GIF、HEIC、MP4、MOV 格式"));
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
        .map_err(|e| AppError::validation(format!("无法设置 MIME 类型: {}", e)))?;

    let form = multipart::Form::new()
        .part("file", part);

    // 发送进度: 33% - 正在上传
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 33,
        "total": 100,
        "step": "正在上传...",
        "step_index": 2,
        "total_steps": 3
    }));

    // 4. 发送请求到 TCL API
    let client = reqwest::Client::new();
    let response = client
        .post("https://service2.tcl.com/api.php/Center/uploadQiniu")
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::network(format!("请求失败: {}", e)))?;

    // 发送进度: 66% - 处理响应
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 66,
        "total": 100,
        "step": "处理响应...",
        "step_index": 3,
        "total_steps": 3
    }));

    // 5. 解析响应
    let response_text = response.text().await
        .map_err(|e| AppError::network(format!("无法读取响应: {}", e)))?;

    println!("[TCL] API 响应: {}", response_text);

    let api_response: TCLApiResponse = serde_json::from_str(&response_text)
        .map_err(|e| AppError::upload("TCL", format!("JSON 解析失败: {}", e)))?;

    // 6. 检查上传结果
    if api_response.code != 1 && api_response.msg != "success" {
        return Err(AppError::upload("TCL", format!("API 返回错误: {}", api_response.msg)));
    }

    let data_url = api_response.data
        .ok_or_else(|| AppError::upload("TCL", "API 未返回图片链接"))?;

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
