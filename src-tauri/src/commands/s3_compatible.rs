// src-tauri/src/commands/s3_compatible.rs
// S3 兼容存储通用上传模块
// 支持腾讯云 COS、阿里云 OSS、七牛云、又拍云

use tauri::{Window, Emitter};
use serde::{Deserialize, Serialize};
use aws_sdk_s3::{Client, Config};
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;

use crate::error::AppError;
use super::utils::read_file_bytes;

/// S3 兼容上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct S3UploadResult {
    pub url: String,
    pub key: String,
}

/// 上传文件到 S3 兼容存储
#[tauri::command]
pub async fn upload_to_s3_compatible(
    window: Window,
    id: String,
    file_path: String,
    endpoint: String,
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    key: String,
    public_domain: String,
) -> Result<S3UploadResult, AppError> {
    println!("[S3兼容] 开始上传文件: {}", file_path);

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

    println!("[S3兼容] 文件大小: {} bytes", file_size);

    // 发送进度: 33% - 创建客户端
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 33,
        "total": 100,
        "step": "创建客户端...",
        "step_index": 2,
        "total_steps": 3
    }));

    // 2. 创建 S3 客户端
    let credentials = Credentials::new(
        &access_key,
        &secret_key,
        None,
        None,
        "PicNexus",
    );

    let config = Config::builder()
        .endpoint_url(&endpoint)
        .region(Region::new(region.clone()))
        .credentials_provider(credentials)
        .force_path_style(true)  // 使用路径风格，兼容性更好
        .build();

    let client = Client::from_conf(config);

    // 发送进度: 66% - 正在上传
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 66,
        "total": 100,
        "step": "正在上传...",
        "step_index": 3,
        "total_steps": 3
    }));

    // 3. 上传文件
    let body = ByteStream::from(buffer);

    client
        .put_object()
        .bucket(&bucket)
        .key(&key)
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::upload("S3兼容", format!("上传失败: {}", e)))?;

    println!("[S3兼容] 上传成功 - Key: {}", key);

    // 4. 构建公开访问 URL
    let url = if public_domain.is_empty() {
        format!("{}/{}/{}", endpoint, bucket, key)
    } else {
        // 移除 public_domain 末尾的斜杠
        let domain = public_domain.trim_end_matches('/');
        format!("{}/{}", domain, key)
    };

    Ok(S3UploadResult {
        url,
        key,
    })
}

/// AWS URI 编码（用于签名规范化）
/// 根据 AWS 规范：A-Z a-z 0-9 - . _ ~ 不编码，其他使用 %XX 编码
fn aws_uri_encode_path(path: &str) -> String {
    path.split('/')
        .map(|segment| aws_uri_encode(segment, false))
        .collect::<Vec<_>>()
        .join("/")
}

fn aws_uri_encode(input: &str, encode_slash: bool) -> String {
    let mut encoded = String::with_capacity(input.len() * 3);

    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            b'/' if !encode_slash => {
                encoded.push('/');
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }

    encoded
}

/// 列出 S3 兼容存储的对象
#[tauri::command]
pub async fn list_s3_objects(
    endpoint: String,
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    prefix: Option<String>,
    max_keys: Option<u32>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let credentials = Credentials::new(
        &access_key,
        &secret_key,
        None,
        None,
        "PicNexus",
    );

    let config = Config::builder()
        .endpoint_url(&endpoint)
        .region(Region::new(region.clone()))
        .credentials_provider(credentials)
        .force_path_style(true)
        .build();

    let client = Client::from_conf(config);

    let mut request = client.list_objects_v2().bucket(&bucket);

    if let Some(prefix) = &prefix {
        request = request.prefix(prefix);
    }

    if let Some(max) = max_keys {
        request = request.max_keys(max as i32);
    }

    let response = request.send().await
        .map_err(|e| AppError::storage(format!("列出对象失败: {}", e)))?;

    let objects: Vec<serde_json::Value> = response
        .contents()
        .iter()
        .map(|obj| {
            let last_modified = obj.last_modified()
                .map(|d| d.to_string())
                .unwrap_or_default();

            serde_json::json!({
                "key": obj.key().unwrap_or(""),
                "size": obj.size().unwrap_or(0),
                "last_modified": last_modified,
            })
        })
        .collect();

    Ok(objects)
}

/// 删除 S3 兼容存储的对象
#[tauri::command]
pub async fn delete_s3_object(
    endpoint: String,
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    key: String,
) -> Result<String, AppError> {
    let credentials = Credentials::new(
        &access_key,
        &secret_key,
        None,
        None,
        "PicNexus",
    );

    let config = Config::builder()
        .endpoint_url(&endpoint)
        .region(Region::new(region.clone()))
        .credentials_provider(credentials)
        .force_path_style(true)
        .build();

    let client = Client::from_conf(config);

    client
        .delete_object()
        .bucket(&bucket)
        .key(&key)
        .send()
        .await
        .map_err(|e| AppError::storage(format!("删除对象失败: {}", e)))?;

    Ok(format!("成功删除: {}", key))
}

/// 批量删除 S3 兼容存储的对象
#[tauri::command]
pub async fn delete_s3_objects(
    endpoint: String,
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    keys: Vec<String>,
) -> Result<serde_json::Value, AppError> {
    let credentials = Credentials::new(
        &access_key,
        &secret_key,
        None,
        None,
        "PicNexus",
    );

    let config = Config::builder()
        .endpoint_url(&endpoint)
        .region(Region::new(region.clone()))
        .credentials_provider(credentials)
        .force_path_style(true)
        .build();

    let client = Client::from_conf(config);

    let mut success_keys: Vec<String> = Vec::new();
    let mut failed_keys: Vec<String> = Vec::new();

    for key in keys {
        match client.delete_object().bucket(&bucket).key(&key).send().await {
            Ok(_) => success_keys.push(key),
            Err(e) => {
                eprintln!("[S3兼容] 删除失败 {}: {}", key, e);
                failed_keys.push(key);
            }
        }
    }

    Ok(serde_json::json!({
        "success": success_keys,
        "failed": failed_keys
    }))
}
