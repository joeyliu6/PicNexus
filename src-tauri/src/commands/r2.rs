// src-tauri/src/commands/r2.rs
// Cloudflare R2 上传命令

use tauri::Window;
use serde::{Serialize, Deserialize};
use std::path::Path;
use aws_sdk_s3::{Client, Config, primitives::ByteStream};
use aws_sdk_s3::config::{Credentials, Region};
use tokio::fs::File;
use tokio::io::AsyncReadExt;

#[derive(Serialize, Deserialize)]
pub struct R2UploadResult {
    e_tag: Option<String>,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    id: String,
    progress: u64,
    total: u64,
}

/// 上传文件到 Cloudflare R2
///
/// # 参数
/// - `window`: Tauri 窗口句柄（用于发送进度事件）
/// - `id`: 上传任务唯一标识符
/// - `file_path`: 文件的绝对路径
/// - `account_id`: Cloudflare 账户 ID
/// - `access_key_id`: R2 访问密钥 ID
/// - `secret_access_key`: R2 访问密钥
/// - `bucket_name`: 存储桶名称
/// - `key`: 对象存储 Key（文件在 R2 中的路径）
#[tauri::command]
pub async fn upload_to_r2(
    window: Window,
    id: String,
    file_path: String,
    account_id: String,
    access_key_id: String,
    secret_access_key: String,
    bucket_name: String,
    key: String,
) -> Result<R2UploadResult, String> {
    println!("[R2] 开始上传: {} -> {}", file_path, key);

    // 1. 检查文件是否存在
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }

    // 2. 获取文件大小
    let file_size = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("读取文件元数据失败: {}", e))?
        .len();

    println!("[R2] 文件大小: {} bytes", file_size);

    // 3. 发送初始进度
    emit_progress(&window, &id, 0, file_size);

    // 4. 构建 S3 客户端
    let endpoint = format!("https://{}.r2.cloudflarestorage.com", account_id);
    println!("[R2] 端点: {}", endpoint);

    let credentials = Credentials::new(
        &access_key_id,
        &secret_access_key,
        None,
        None,
        "r2"
    );

    let config = Config::builder()
        .endpoint_url(&endpoint)
        .credentials_provider(credentials)
        .region(Region::new("auto"))
        .build();

    let client = Client::from_conf(config);

    // 5. 检测 MIME 类型
    let content_type = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .to_string();

    println!("[R2] Content-Type: {}", content_type);

    // 6. 读取文件
    let mut file = File::open(&path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    // 发送 50% 进度（文件已读取）
    emit_progress(&window, &id, file_size / 2, file_size);

    // 7. 创建 ByteStream
    let body = ByteStream::from(buffer);

    // 8. 上传到 R2
    println!("[R2] 开始上传到存储桶: {}", bucket_name);

    let result = client
        .put_object()
        .bucket(&bucket_name)
        .key(&key)
        .body(body)
        .content_type(&content_type)
        .send()
        .await
        .map_err(|e| {
            let error_msg = format!("R2 上传失败: {}", e);
            println!("[R2] 错误: {}", error_msg);

            // 转换为更友好的错误提示
            if error_msg.contains("NoSuchBucket") {
                return format!("R2 存储桶不存在: {}", bucket_name);
            } else if error_msg.contains("AccessDenied") || error_msg.contains("InvalidAccessKeyId") {
                return "R2 认证失败: 请检查 Account ID、Access Key ID 和 Secret Access Key".to_string();
            } else if error_msg.contains("SignatureDoesNotMatch") {
                return "R2 签名错误: 请检查 Secret Access Key 是否正确".to_string();
            } else if error_msg.contains("timeout") {
                return "R2 上传超时: 网络连接不稳定，请重试".to_string();
            }

            error_msg
        })?;

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    println!("[R2] 上传成功！ETag: {:?}", result.e_tag());

    Ok(R2UploadResult {
        e_tag: result.e_tag().map(|s| s.to_string()),
        size: file_size,
    })
}

/// 辅助函数：发送进度事件
fn emit_progress(window: &Window, id: &str, progress: u64, total: u64) {
    let _ = window.emit("upload://progress", ProgressPayload {
        id: id.to_string(),
        progress,
        total,
    });
}
