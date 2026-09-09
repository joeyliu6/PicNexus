// src-tauri/src/commands/r2.rs
// Cloudflare R2 上传命令
// v2.10: 迁移到 AppError 统一错误类型

use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::{primitives::ByteStream, Client, Config};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{Emitter, Window};
use tokio::time::{timeout, Duration};

use super::utils::probe_upload_file_size;
use crate::error::AppError;
use crate::log_utils::safe_path;

/// 文件大小限制：50MB
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

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
#[allow(clippy::too_many_arguments)] // Tauri IPC 参数与前端上传配置一一对应，保留现有调用面。
pub async fn upload_to_r2(
    window: Window,
    id: String,
    file_path: String,
    account_id: String,
    access_key_id: String,
    secret_access_key: String,
    bucket_name: String,
    key: String,
) -> Result<R2UploadResult, AppError> {
    log::info!("[R2] 开始上传: {} -> {}", safe_path(&file_path), key);

    // 1. 检查文件是否存在
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::file_io(format!("文件不存在: {}", file_path)));
    }

    // 2. 只探文件大小，内容留给流式 PUT 按需从磁盘读
    let file_size = probe_upload_file_size(&file_path, MAX_FILE_SIZE).await?;

    log::debug!("[R2] 文件大小: {} bytes", file_size);

    // 3. 发送初始进度
    emit_progress(&window, &id, 0, file_size);

    // 4. 构建 S3 客户端
    let endpoint = format!("https://{}.r2.cloudflarestorage.com", account_id);
    log::debug!("[R2] 端点: {}", endpoint);

    let credentials = Credentials::new(&access_key_id, &secret_access_key, None, None, "r2");

    let config = Config::builder()
        .endpoint_url(&endpoint)
        .credentials_provider(credentials)
        .region(Region::new("auto"))
        .build();

    let client = Client::from_conf(config);

    // 5. 检测 MIME 类型
    let content_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    log::debug!("[R2] Content-Type: {}", content_type);

    // 6. 以文件流作为请求体
    //
    // Why: 原实现 read_to_end 把整份文件驻留在内存里（且没有大小上限）。
    // 多图床并发上传时，每个服务各持有一份完整副本，是内存峰值的主要来源。
    // ByteStream::from_path 让 SDK 按需从磁盘读取，并自动带上正确的 Content-Length。
    let body = ByteStream::from_path(path)
        .await
        .map_err(|e| AppError::file_io(format!("读取文件失败: {}", e)))?;

    // 发送 50% 进度（文件已就绪，即将发出请求）
    emit_progress(&window, &id, file_size / 2, file_size);

    // 8. 上传到 R2（设置 2 分钟超时）
    log::debug!("[R2] 开始上传到存储桶: {}", bucket_name);

    let upload_timeout = Duration::from_secs(120);

    let result = timeout(upload_timeout, async {
        client
            .put_object()
            .bucket(&bucket_name)
            .key(&key)
            .body(body)
            .content_type(&content_type)
            .send()
            .await
    })
    .await
    .map_err(|_| AppError::storage("R2 上传超时: 网络连接不稳定或文件过大，请稍后重试"))?
    .map_err(|e| {
        let error_msg = format!("R2 上传失败: {}", e);
        log::error!("[R2] 错误: {}", error_msg);

        // 转换为更友好的错误提示
        if error_msg.contains("NoSuchBucket") {
            return AppError::storage(format!("存储桶不存在: {}", bucket_name));
        } else if error_msg.contains("AccessDenied") || error_msg.contains("InvalidAccessKeyId") {
            return AppError::auth(
                "R2 认证失败: 请检查 Account ID、Access Key ID 和 Secret Access Key",
            );
        } else if error_msg.contains("SignatureDoesNotMatch") {
            return AppError::auth("R2 签名错误: 请检查 Secret Access Key 是否正确");
        } else if error_msg.contains("timeout") {
            return AppError::storage("R2 上传超时: 网络连接不稳定，请重试");
        }

        AppError::storage(error_msg)
    })?;

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    log::info!("[R2] 上传成功！ETag: {:?}", result.e_tag());

    Ok(R2UploadResult {
        e_tag: result.e_tag().map(|s| s.to_string()),
        size: file_size,
    })
}

/// 辅助函数：发送进度事件
fn emit_progress(window: &Window, id: &str, progress: u64, total: u64) {
    let _ = window.emit(
        "upload://progress",
        ProgressPayload {
            id: id.to_string(),
            progress,
            total,
        },
    );
}

// ── 连接测试 ──────────────────────────────────────────────────────────
//
// Why 与上面的 `upload_to_r2` 走两套 HTTP 栈：上传用 aws-sdk-s3，连接测试用
// 全局 `HttpClient` + 手搓 SigV4。测试只发一个 ListObjectsV2，为它再建一个
// SDK client 反而更重，而 SigV4 的签名步骤在这里是可读的。两条链路都属于 R2
// 这一个服务，所以同住一个文件。

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::HttpClient;

type HmacSha256 = Hmac<Sha256>;

#[derive(serde::Deserialize, Clone)]
pub struct R2Config {
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "accessKeyId")]
    access_key_id: String,
    #[serde(rename = "secretAccessKey")]
    secret_access_key: String,
    #[serde(rename = "bucketName")]
    bucket_name: String,
    #[allow(dead_code)]
    path: String,
    #[allow(dead_code)]
    #[serde(rename = "publicDomain")]
    public_domain: String,
}

#[tauri::command]
pub async fn test_r2_connection(
    config: R2Config,
    http_client: tauri::State<'_, HttpClient>,
) -> Result<String, AppError> {
    if config.account_id.is_empty()
        || config.access_key_id.is_empty()
        || config.secret_access_key.is_empty()
        || config.bucket_name.is_empty()
    {
        return Err(AppError::config(
            "配置不完整: AccountID、KeyID、Secret 和 Bucket 均为必填项。",
        ));
    }

    let endpoint_url = format!(
        "https://{}.r2.cloudflarestorage.com/{}",
        config.account_id, config.bucket_name
    );

    let now = chrono::Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();

    let region = "auto";
    let service = "s3";
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
    let canonical_uri = format!("/{}", config.bucket_name);
    let canonical_querystring = "";
    let canonical_headers = format!(
        "host:{}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{}\n",
        host, datetime_str
    );
    let signed_headers = "host;x-amz-content-sha256;x-amz-date";
    let payload_hash = "UNSIGNED-PAYLOAD";

    let canonical_request = format!(
        "HEAD\n{}\n{}\n{}\n{}\n{}",
        canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
    );

    let mut hasher = Sha256::new();
    hasher.update(canonical_request.as_bytes());
    let canonical_request_hash = hex::encode(hasher.finalize());

    let credential_scope = format!("{}/{}/{}/aws4_request", date_str, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        datetime_str, credential_scope, canonical_request_hash
    );

    let k_date = hmac_sha256(
        format!("AWS4{}", config.secret_access_key).as_bytes(),
        date_str.as_bytes(),
    );
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key_id, credential_scope, signed_headers, signature
    );

    match http_client
        .0
        .head(&endpoint_url)
        .header("Host", host)
        .header("x-amz-date", datetime_str)
        .header("x-amz-content-sha256", payload_hash)
        .header("Authorization", authorization_header)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                Ok("R2 连接成功！".to_string())
            } else if status == reqwest::StatusCode::NOT_FOUND {
                Err(AppError::storage(format!(
                    "存储桶 (Bucket) '{}' 未找到",
                    config.bucket_name
                )))
            } else if status == reqwest::StatusCode::FORBIDDEN {
                Err(AppError::auth(
                    "R2 认证失败: Access Key ID 或 Secret Access Key 无效，或权限不足",
                ))
            } else {
                Err(AppError::storage(format!("连接失败: HTTP {}", status)))
            }
        }
        Err(err) => {
            if err.is_connect() {
                Err(AppError::storage("无法连接到 R2 服务器，请检查网络连接"))
            } else if err.is_timeout() {
                Err(AppError::storage("请求超时"))
            } else {
                Err(AppError::storage(format!("连接失败: {}", err)))
            }
        }
    }
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}
