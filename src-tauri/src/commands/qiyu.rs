// src-tauri/src/commands/qiyu.rs
// 七鱼图床上传命令
// 基于网易七鱼客服系统的 NOS 对象存储
// 自动获取 Token，无需手动配置

use tauri::Window;
use serde::Serialize;
use reqwest::Client;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use std::time::{SystemTime, UNIX_EPOCH, Duration};

use super::qiyu_token::fetch_qiyu_token;

#[derive(Debug, Serialize)]
pub struct QiyuUploadResult {
    pub url: String,
    pub size: u64,
}

// 注意：API 响应格式为 {"requestId": "...", "offset": ..., "context": "...", "callbackRetMsg": "..."}
// 我们只需检查 HTTP 200 状态码即可判断上传成功，无需解析响应内容

#[tauri::command]
pub async fn upload_to_qiyu(
    window: Window,
    id: String,
    file_path: String,
) -> Result<QiyuUploadResult, String> {
    println!("[Qiyu] 开始上传文件: {}", file_path);

    // 发送步骤1进度：获取上传凭证 (0%)
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 0,
        "total": 100,
        "step": "获取上传凭证中...",
        "step_index": 1,
        "total_steps": 2
    }));

    // 1. 自动获取新的 Token（每次上传都获取新的，确保 Object 路径唯一）
    println!("[Qiyu] 正在获取上传凭证...");
    let token_info = fetch_qiyu_token().await?;
    let qiyu_token = &token_info.token;
    let object_path = &token_info.object_path;
    println!("[Qiyu] Token 获取成功，Object 路径: {}", object_path);

    // 3. 读取文件
    let mut file = File::open(&file_path).await
        .map_err(|e| format!("无法打开文件: {}", e))?;

    let file_size = file.metadata().await
        .map_err(|e| format!("无法获取文件元数据: {}", e))?
        .len();

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).await
        .map_err(|e| format!("无法读取文件: {}", e))?;

    // 4. 验证文件类型（只允许图片）
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?;

    let ext = file_name.split('.').last()
        .ok_or("无法获取文件扩展名")?
        .to_lowercase();

    // 获取 Content-Type
    let content_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("只支持 JPG、PNG、GIF、WebP 格式的图片".to_string()),
    };

    // 5. 构建上传 URL
    let upload_url = format!(
        "https://cdn-nimup-chunk.qiyukf.net/nim/{}?offset=0&complete=true&version=1.0",
        urlencoding::encode(&object_path)
    );
    println!("[Qiyu] 上传 URL: {}", upload_url);

    // 发送步骤2进度：上传文件 (50%)
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 50,
        "total": 100,
        "step": "上传文件中...",
        "step_index": 2,
        "total_steps": 2
    }));

    // 6. 发送上传请求（直接 POST 二进制数据）
    // 注意：使用标准 TLS 验证，确保通信安全
    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .post(&upload_url)
        .header("Content-Type", content_type)
        .header("x-nos-token", qiyu_token.as_str())
        .body(buffer)
        .send()
        .await
        .map_err(|e| format!("上传请求失败: {}", e))?;

    // 7. 检查响应状态
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("上传失败 (HTTP {}): {}", status, body));
    }

    // 8. 记录响应（仅用于调试，不解析 JSON）
    // API 响应格式: {"requestId": "...", "offset": ..., "context": "...", "callbackRetMsg": "..."}
    // HTTP 200 即视为成功
    let response_text = response.text().await
        .map_err(|e| format!("无法读取响应: {}", e))?;
    println!("[Qiyu] API 响应: {}", response_text);

    // 9. 构建 CDN URL (使用当前时间戳作为 createTime)
    let create_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("无法获取时间戳: {}", e))?
        .as_millis();

    let cdn_url = format!(
        "https://xlx03.cdn.qiyukf.net/{}?createTime={}",
        object_path,
        create_time
    );

    println!("[Qiyu] 上传成功: {}", cdn_url);

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    Ok(QiyuUploadResult {
        url: cdn_url,
        size: file_size,
    })
}
