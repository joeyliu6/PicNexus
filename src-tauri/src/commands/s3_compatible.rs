// src-tauri/src/commands/s3_compatible.rs
// S3 兼容存储通用上传模块
// 支持腾讯云 COS、阿里云 OSS、七牛云、又拍云

use tauri::{Window, Emitter};
use serde::{Deserialize, Serialize};
use aws_sdk_s3::{Client, Config};
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use tokio::time::{timeout, Duration};

use crate::error::AppError;
use super::utils::read_file_bytes;

/// S3 兼容上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct S3UploadResult {
    pub url: String,
    pub key: String,
}

/// 创建 S3 客户端（内部复用函数）
fn create_s3_client(
    endpoint: &str,
    access_key: &str,
    secret_key: &str,
    region: &str,
) -> Client {
    let credentials = Credentials::new(
        access_key,
        secret_key,
        None,
        None,
        "PicNexus",
    );

    let config = Config::builder()
        .endpoint_url(endpoint)
        .region(Region::new(region.to_string()))
        .credentials_provider(credentials)
        .force_path_style(true)
        .build();

    Client::from_conf(config)
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
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

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

/// 列出 S3 兼容存储的对象（支持 delimiter 分层）
#[tauri::command]
pub async fn list_s3_objects(
    endpoint: String,
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    prefix: Option<String>,
    delimiter: Option<String>,
    max_keys: Option<u32>,
    continuation_token: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

    let mut request = client.list_objects_v2().bucket(&bucket);

    if let Some(prefix) = &prefix {
        request = request.prefix(prefix);
    }

    // 使用 delimiter 区分文件夹和文件
    if let Some(delim) = &delimiter {
        request = request.delimiter(delim);
    }

    if let Some(max) = max_keys {
        request = request.max_keys(max as i32);
    }

    // 分页：使用 continuation_token 获取下一页
    if let Some(token) = &continuation_token {
        if !token.is_empty() {
            request = request.continuation_token(token);
        }
    }

    let response = request.send().await
        .map_err(|e| AppError::storage(format!("列出对象失败: {}", e)))?;

    // 解析文件列表
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

    // 解析公共前缀（文件夹）
    let prefixes: Vec<String> = response
        .common_prefixes()
        .iter()
        .filter_map(|p| p.prefix().map(|s| s.to_string()))
        .collect();

    // 返回包含 objects 和 prefixes 的结构
    Ok(serde_json::json!({
        "objects": objects,
        "prefixes": prefixes,
        "is_truncated": response.is_truncated().unwrap_or(false),
        "continuation_token": response.next_continuation_token().unwrap_or_default()
    }))
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
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

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
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

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

/// S3 兼容存储测试配置
/// 支持多种字段名映射，兼容不同云服务商的配置格式
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S3TestConfig {
    // R2 专用
    pub account_id: Option<String>,
    // 通用 access key（支持多种命名）
    pub access_key_id: Option<String>,
    pub secret_id: Option<String>,
    pub access_key: Option<String>,
    pub operator: Option<String>,
    // 通用 secret key（支持多种命名）
    pub secret_access_key: Option<String>,
    pub secret_key: Option<String>,
    pub access_key_secret: Option<String>,
    pub password: Option<String>,
    // bucket
    pub bucket_name: Option<String>,
    pub bucket: Option<String>,
    // region
    pub region: Option<String>,
}

impl S3TestConfig {
    fn get_access_key(&self) -> Option<String> {
        self.access_key_id.clone()
            .or_else(|| self.secret_id.clone())
            .or_else(|| self.access_key.clone())
            .or_else(|| self.operator.clone())
    }

    fn get_secret_key(&self) -> Option<String> {
        self.secret_access_key.clone()
            .or_else(|| self.secret_key.clone())
            .or_else(|| self.access_key_secret.clone())
            .or_else(|| self.password.clone())
    }

    fn get_bucket(&self) -> Option<String> {
        self.bucket_name.clone()
            .or_else(|| self.bucket.clone())
    }
}

/// 判断错误是否可重试（网络瞬时错误）
fn is_retriable_error(error_msg: &str) -> bool {
    error_msg.contains("dispatch failure")
        || error_msg.contains("connection reset")
        || error_msg.contains("connection closed")
        || error_msg.contains("timeout")
        || error_msg.contains("hyper")
}

/// 测试 S3 兼容存储连接
/// 根据 service_id 自动构建对应的 endpoint 进行验证
/// 包含重试机制（最多 3 次，指数退避）以应对网络瞬时错误
#[tauri::command]
pub async fn test_s3_connection(
    service_id: String,
    config: S3TestConfig,
) -> Result<String, AppError> {
    println!("[S3测试] 开始测试 {} 连接", service_id);

    let access_key = config.get_access_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Access Key 不能为空"))?;

    let secret_key = config.get_secret_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Secret Key 不能为空"))?;

    let bucket = config.get_bucket()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Bucket 名称不能为空"))?;

    // 又拍云使用 REST API，单独处理
    if service_id == "upyun" {
        return test_upyun_connection(&access_key, &secret_key, &bucket).await;
    }

    // 构建 endpoint 和 region
    let (endpoint, region) = build_s3_endpoint(&service_id, &config, &bucket)?;

    println!("[S3测试] Endpoint: {}, Region: {}, Bucket: {}", endpoint, region, bucket);

    // 重试配置
    const MAX_RETRIES: u32 = 3;
    let test_timeout = Duration::from_secs(15);
    let mut last_error: Option<AppError> = None;

    for attempt in 1..=MAX_RETRIES {
        // 每次尝试创建新的客户端（避免复用失败的连接）
        let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

        let result = timeout(test_timeout, async {
            client
                .list_objects_v2()
                .bucket(&bucket)
                .max_keys(1)
                .send()
                .await
        })
        .await;

        match result {
            Ok(Ok(response)) => {
                let object_count = response.contents().len();
                if attempt > 1 {
                    println!("[S3测试] ✓ {} 连接成功（第 {} 次尝试），存储桶内有 {} 个对象",
                        service_id, attempt, object_count);
                } else {
                    println!("[S3测试] ✓ {} 连接成功，存储桶内有 {} 个对象",
                        service_id, object_count);
                }
                return Ok(format!("{} 连接成功！", get_service_name(&service_id)));
            }
            Ok(Err(e)) => {
                let error_msg = e.to_string();
                println!("[S3测试] 第 {} 次尝试失败: {}", attempt, error_msg);

                // 不可重试的错误（配置错误、认证错误等）直接返回
                if error_msg.contains("NoSuchBucket") {
                    return Err(AppError::storage(format!("存储桶不存在: {}", bucket)));
                }
                if error_msg.contains("AccessDenied") || error_msg.contains("InvalidAccessKeyId") {
                    return Err(AppError::auth("认证失败: 请检查 Access Key 和 Secret Key"));
                }
                if error_msg.contains("SignatureDoesNotMatch") {
                    return Err(AppError::auth("签名错误: 请检查 Secret Key 是否正确"));
                }
                if error_msg.contains("InvalidBucketName") {
                    return Err(AppError::config(format!("无效的存储桶名称: {}", bucket)));
                }

                // 可重试的错误
                if is_retriable_error(&error_msg) && attempt < MAX_RETRIES {
                    let delay = Duration::from_millis(100 * 2u64.pow(attempt - 1));
                    println!("[S3测试] 将在 {:?} 后重试...", delay);
                    tokio::time::sleep(delay).await;
                    last_error = Some(AppError::storage(format!("连接失败: {}", error_msg)));
                    continue;
                }

                return Err(AppError::storage(format!("连接失败: {}", error_msg)));
            }
            Err(_) => {
                println!("[S3测试] 第 {} 次尝试超时", attempt);
                if attempt < MAX_RETRIES {
                    let delay = Duration::from_millis(100 * 2u64.pow(attempt - 1));
                    println!("[S3测试] 将在 {:?} 后重试...", delay);
                    tokio::time::sleep(delay).await;
                    last_error = Some(AppError::storage("连接超时，请检查网络或配置"));
                    continue;
                }
                return Err(AppError::storage("连接超时，请检查网络或配置"));
            }
        }
    }

    // 所有重试都失败
    Err(last_error.unwrap_or_else(|| AppError::storage("连接失败")))
}

/// 根据服务类型构建 S3 endpoint
fn build_s3_endpoint(
    service_id: &str,
    config: &S3TestConfig,
    _bucket: &str,
) -> Result<(String, String), AppError> {
    match service_id {
        "r2" => {
            let account_id = config.account_id.as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("R2 Account ID 不能为空"))?;
            Ok((
                format!("https://{}.r2.cloudflarestorage.com", account_id),
                "auto".to_string(),
            ))
        }
        "tencent" => {
            let region = config.region.as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("腾讯云 Region 不能为空"))?;
            Ok((
                format!("https://cos.{}.myqcloud.com", region),
                region.clone(),
            ))
        }
        "aliyun" => {
            let region = config.region.as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("阿里云 Region 不能为空"))?;
            Ok((
                format!("https://oss-{}.aliyuncs.com", region),
                region.clone(),
            ))
        }
        "qiniu" => {
            let region = config.region.as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("七牛云 Region 不能为空"))?;
            Ok((
                format!("https://s3-{}.qiniucs.com", region),
                region.clone(),
            ))
        }
        _ => Err(AppError::config(format!("不支持的服务类型: {}", service_id))),
    }
}

/// 测试又拍云连接（使用 REST API）
async fn test_upyun_connection(
    operator: &str,
    password: &str,
    bucket: &str,
) -> Result<String, AppError> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let url = format!("https://v0.api.upyun.com/{}/", bucket);
    let auth = STANDARD.encode(format!("{}:{}", operator, password));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Basic {}", auth))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AppError::storage("连接超时")
            } else if e.is_connect() {
                AppError::storage("无法连接到又拍云服务器")
            } else {
                AppError::storage(format!("请求失败: {}", e))
            }
        })?;

    let status = response.status();
    if status.is_success() {
        println!("[S3测试] ✓ 又拍云连接成功");
        return Ok("又拍云连接成功！".to_string());
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::auth("认证失败: 请检查操作员账号和密码"));
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::storage(format!("服务空间不存在: {}", bucket)));
    }
    Err(AppError::storage(format!("连接失败: HTTP {}", status)))
}

/// 获取服务显示名称
fn get_service_name(service_id: &str) -> &str {
    match service_id {
        "r2" => "Cloudflare R2",
        "tencent" => "腾讯云 COS",
        "aliyun" => "阿里云 OSS",
        "qiniu" => "七牛云",
        "upyun" => "又拍云",
        _ => service_id,
    }
}

/// 创建 S3 文件夹
#[tauri::command]
pub async fn create_s3_folder(
    endpoint: String,
    access_key: String,
    secret_key: String,
    region: String,
    bucket: String,
    key: String,
) -> Result<String, AppError> {
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

    let body = ByteStream::from(Vec::new());

    client
        .put_object()
        .bucket(&bucket)
        .key(&key)
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::storage(format!("创建文件夹失败: {}", e)))?;

    Ok(format!("成功创建文件夹: {}", key))
}
