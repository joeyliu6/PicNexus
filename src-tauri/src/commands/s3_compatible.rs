// src-tauri/src/commands/s3_compatible.rs
// S3 兼容存储通用上传模块
// 支持腾讯云 COS、阿里云 OSS、七牛云、又拍云

use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::{Client, Config};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};
use tokio::time::{timeout, Duration};

use super::utils::{guess_object_content_type, probe_upload_file_size};
use crate::error::AppError;
use crate::log_utils::safe_path;

// ==================== 常量 ====================

/// S3 操作默认超时时间（秒）
const S3_OPERATION_TIMEOUT_SECS: u64 = 30;

/// S3 兼容上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct S3UploadResult {
    pub url: String,
    pub key: String,
}

/// 创建 S3 客户端（内部复用函数）
fn create_s3_client(endpoint: &str, access_key: &str, secret_key: &str, region: &str) -> Client {
    let credentials = Credentials::new(access_key, secret_key, None, None, "PicNexus");

    let config = Config::builder()
        .endpoint_url(endpoint)
        .region(Region::new(region.to_string()))
        .credentials_provider(credentials)
        .force_path_style(true)
        .build();

    Client::from_conf(config)
}

fn validate_https_endpoint(endpoint: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(endpoint)
        .map_err(|_| AppError::config("Endpoint 不是合法的 URL，请输入完整的 https://... 地址"))?;
    if parsed.scheme() != "https" {
        return Err(AppError::config(
            "外部 S3 Endpoint 仅支持 HTTPS，请改用 https:// 地址",
        ));
    }
    Ok(())
}

/// 校验公开访问域名；明文 HTTP 只在用户已对**该主机名**显式确认时放行
///
/// Why 收的是主机名而不是 bool：确认必须跟着域名走。存 bool 的话，用户确认了
/// `http://a.example` 之后改成 `http://b.example`，那个 true 会原样留下，
/// 等于给新域名发了一张没人审过的通行证。前端 `HttpDomainConfirmable` 存的也是主机名，
/// 两侧用同一判据，任何一侧漏了另一侧都还拦得住。
///
/// Why 允许明文 HTTP：又拍云一类图床根本给不出 HTTPS——免费测试域名只有 HTTP，
/// 要 HTTPS 必须绑自有域名而绑域名要备案。一刀切拒绝的结果是这些图床整个不可用。
/// 详见 `docs/audits/upyun-http-domain-2026-08-19.md`。
///
/// Endpoint 不吃这条逃生舱（见 `validate_https_endpoint`）：那条请求带着 AK/SK 签名，
/// 明文传输等于把凭证摊在链路上；公开域名只是取图，风险量级不同。
fn validate_public_domain(public_domain: &str, confirmed_for: Option<&str>) -> Result<(), AppError> {
    let public_domain = public_domain.trim();
    if public_domain.is_empty() {
        return Ok(());
    }

    let parsed = url::Url::parse(public_domain)
        .map_err(|_| AppError::config("公开访问域名不是合法的 URL，请输入完整的 https://... 地址"))?;
    if parsed.scheme() == "https" {
        return Ok(());
    }

    if parsed.scheme() == "http" {
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        let confirmed = confirmed_for.unwrap_or_default().trim().to_ascii_lowercase();
        if !host.is_empty() && host == confirmed {
            return Ok(());
        }
        return Err(AppError::config(
            "公开访问域名是明文 HTTP，需要先在设置页「测试连接」里确认一次才能使用",
        ));
    }

    Err(AppError::config("公开访问域名仅支持 HTTPS，请改用 https:// 地址"))
}

/// 上传文件到 S3 兼容存储
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri IPC 参数与 S3 兼容配置字段一致，避免大改前端调用。
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
    // 用户已确认可走明文 HTTP 的主机名；None = 未确认（fail-closed）
    http_domain_confirmed_for: Option<String>,
) -> Result<S3UploadResult, AppError> {
    log::info!("[S3兼容] 开始上传文件: {}", safe_path(&file_path));
    validate_https_endpoint(&endpoint)?;
    validate_public_domain(&public_domain, http_domain_confirmed_for.as_deref())?;

    // 发送进度: 0% - 读取文件
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 0,
            "total": 100,
            "step": "读取文件...",
            "step_index": 1,
            "total_steps": 3
        }),
    );

    // 1. 检查文件大小（不读内容）
    let file_size = probe_upload_file_size(&file_path, 50 * 1024 * 1024).await?;

    log::debug!("[S3兼容] 文件大小: {} bytes", file_size);

    // 发送进度: 33% - 创建客户端
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 33,
            "total": 100,
            "step": "创建客户端...",
            "step_index": 2,
            "total_steps": 3
        }),
    );

    // 2. 创建 S3 客户端
    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

    // 发送进度: 66% - 正在上传
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 66,
            "total": 100,
            "step": "正在上传...",
            "step_index": 3,
            "total_steps": 3
        }),
    );

    // 3. 上传文件（带超时保护）
    //
    // Why: 用 ByteStream::from_path 而非把整份文件读进 Vec<u8>——SDK 会按需从磁盘读取
    // 并自动带上 Content-Length，避免多图床并发时每个服务各持有一份完整文件副本。
    let body = ByteStream::from_path(&file_path)
        .await
        .map_err(|e| AppError::file_io(format!("读取文件失败: {}", e)))?;

    let content_type = guess_object_content_type(&file_path);
    log::debug!("[S3兼容] Content-Type: {}", content_type);

    timeout(
        Duration::from_secs(S3_OPERATION_TIMEOUT_SECS * 2), // 上传操作给予更长超时
        client
            .put_object()
            .bucket(&bucket)
            .key(&key)
            .body(body)
            .content_type(&content_type)
            .send(),
    )
    .await
    .map_err(|_| {
        AppError::upload(
            "S3兼容",
            format!("上传超时 ({}秒)", S3_OPERATION_TIMEOUT_SECS * 2),
        )
    })?
    .map_err(|e| AppError::upload("S3兼容", format!("上传失败: {}", e)))?;

    log::info!("[S3兼容] 上传成功 - Key: {}", key);

    // 4. 构建公开访问 URL
    let url = if public_domain.is_empty() {
        format!("{}/{}/{}", endpoint, bucket, key)
    } else {
        // 移除 public_domain 末尾的斜杠
        let domain = public_domain.trim().trim_end_matches('/');
        format!("{}/{}", domain, key)
    };

    Ok(S3UploadResult { url, key })
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
    // 自定义 S3 端点（custom_s3 专用）
    pub endpoint: Option<String>,
}

impl S3TestConfig {
    fn get_access_key(&self) -> Option<String> {
        self.access_key_id
            .clone()
            .or_else(|| self.secret_id.clone())
            .or_else(|| self.access_key.clone())
            .or_else(|| self.operator.clone())
    }

    fn get_secret_key(&self) -> Option<String> {
        self.secret_access_key
            .clone()
            .or_else(|| self.secret_key.clone())
            .or_else(|| self.access_key_secret.clone())
            .or_else(|| self.password.clone())
    }

    fn get_bucket(&self) -> Option<String> {
        self.bucket_name.clone().or_else(|| self.bucket.clone())
    }
}

/// 测试 S3 兼容存储连接
/// 根据 service_id 自动构建对应的 endpoint 进行验证
/// 包含重试机制（最多 1 次）以快速反馈配置问题
#[tauri::command]
pub async fn test_s3_connection(
    service_id: String,
    config: S3TestConfig,
) -> Result<String, AppError> {
    log::info!("[S3测试] 开始测试 {} 连接", service_id);

    let access_key = config
        .get_access_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Access Key 不能为空"))?;

    let secret_key = config
        .get_secret_key()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Secret Key 不能为空"))?;

    let bucket = config
        .get_bucket()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::config("Bucket 名称不能为空"))?;

    // 又拍云使用 REST API，单独处理
    if service_id == "upyun" {
        return test_upyun_connection(&access_key, &secret_key, &bucket).await;
    }

    // 构建 endpoint 和 region
    let (endpoint, region) = build_s3_endpoint(&service_id, &config, &bucket)?;

    log::debug!(
        "[S3测试] Endpoint: {}, Region: {}, Bucket: {}",
        endpoint,
        region,
        bucket
    );

    // 单次测试，快速反馈优先
    let test_timeout = Duration::from_secs(10);
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
            log::info!(
                "[S3测试] {} 连接成功，存储桶内有 {} 个对象",
                service_id,
                object_count
            );
            Ok(format!("{} 连接成功！", get_service_name(&service_id)))
        }
        Ok(Err(e)) => {
            let error_msg = e.to_string();
            log::error!("[S3测试] 连接失败: {}", error_msg);

            if error_msg.contains("NoSuchBucket") {
                Err(AppError::storage(format!("存储桶不存在: {}", bucket)))
            } else if error_msg.contains("AccessDenied") || error_msg.contains("InvalidAccessKeyId")
            {
                Err(AppError::auth("认证失败: 请检查 Access Key 和 Secret Key"))
            } else if error_msg.contains("SignatureDoesNotMatch") {
                Err(AppError::auth("签名错误: 请检查 Secret Key 是否正确"))
            } else if error_msg.contains("InvalidBucketName") {
                Err(AppError::config(format!("无效的存储桶名称: {}", bucket)))
            } else {
                Err(AppError::storage(format!("连接失败: {}", error_msg)))
            }
        }
        Err(_) => {
            log::warn!("[S3测试] 连接超时");
            Err(AppError::storage("连接超时，请检查网络或配置"))
        }
    }
}

/// 根据服务类型构建 S3 endpoint
fn build_s3_endpoint(
    service_id: &str,
    config: &S3TestConfig,
    _bucket: &str,
) -> Result<(String, String), AppError> {
    match service_id {
        "r2" => {
            let account_id = config
                .account_id
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("R2 Account ID 不能为空"))?;
            Ok((
                format!("https://{}.r2.cloudflarestorage.com", account_id),
                "auto".to_string(),
            ))
        }
        "tencent" => {
            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("腾讯云 Region 不能为空"))?;
            Ok((
                format!("https://cos.{}.myqcloud.com", region),
                region.clone(),
            ))
        }
        "aliyun" => {
            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("阿里云 Region 不能为空"))?;
            Ok((
                format!("https://oss-{}.aliyuncs.com", region),
                region.clone(),
            ))
        }
        "qiniu" => {
            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("七牛云 Region 不能为空"))?;
            Ok((format!("https://s3-{}.qiniucs.com", region), region.clone()))
        }
        s if s == "custom_s3" || s.starts_with("custom_s3:") => {
            let endpoint = config
                .endpoint
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("自定义 S3 Endpoint 不能为空"))?;

            // 校验 endpoint 是合法的 HTTP(S) URL，防止 SSRF
            let parsed = url::Url::parse(endpoint).map_err(|_| {
                AppError::config("Endpoint 不是合法的 URL，请输入完整的 https://... 地址")
            })?;
            match parsed.scheme() {
                "https" => {}
                "http" => {
                    return Err(AppError::config(
                        "外部 S3 Endpoint 仅支持 HTTPS，请改用 https:// 地址",
                    ))
                }
                _ => return Err(AppError::config("Endpoint 仅支持 https 协议")),
            }
            // 拒绝内网 / 元数据地址（RFC 1918 + link-local + loopback + 云元数据）
            if let Some(host) = parsed.host_str() {
                let is_private = host == "127.0.0.1"
                    || host == "localhost"
                    || host == "[::1]"
                    || host.starts_with("10.")
                    || host.starts_with("192.168.")
                    || host == "169.254.169.254"
                    || host == "metadata.google.internal"
                    || (host.starts_with("172.") && {
                        host.split('.')
                            .nth(1)
                            .and_then(|s| s.parse::<u8>().ok())
                            .is_some_and(|n| (16..=31).contains(&n))
                    });
                if is_private {
                    return Err(AppError::config("Endpoint 不能指向内网或元数据地址"));
                }
            }

            let region = config
                .region
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| AppError::config("自定义 S3 Region 不能为空"))?;
            Ok((endpoint.clone(), region.clone()))
        }
        _ => Err(AppError::config(format!(
            "不支持的服务类型: {}",
            service_id
        ))),
    }
}

/// 测试又拍云连接（使用 REST API）
async fn test_upyun_connection(
    operator: &str,
    password: &str,
    bucket: &str,
) -> Result<String, AppError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

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
        log::info!("[S3测试] 又拍云连接成功");
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
        s if s == "custom_s3" || s.starts_with("custom_s3:") => "自定义 S3 存储",
        _ => service_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom_s3_config(endpoint: &str) -> S3TestConfig {
        S3TestConfig {
            account_id: None,
            access_key_id: Some("ak".to_string()),
            secret_id: None,
            access_key: None,
            operator: None,
            secret_access_key: Some("sk".to_string()),
            secret_key: None,
            access_key_secret: None,
            password: None,
            bucket_name: None,
            bucket: Some("bucket".to_string()),
            region: Some("us-east-1".to_string()),
            endpoint: Some(endpoint.to_string()),
        }
    }

    #[test]
    fn validate_https_endpoint_rejects_http() {
        let err = validate_https_endpoint("http://s3.example.com")
            .expect_err("external HTTP endpoint should be rejected");

        assert!(err.to_string().contains("仅支持 HTTPS"));
    }

    #[test]
    fn validate_public_domain_allows_confirmed_http_only_for_that_host() {
        // 确认过的那个主机名放行
        assert!(validate_public_domain("http://cdn.example.com", Some("cdn.example.com")).is_ok());
        // 大小写与端口不影响判据（判的是主机名）
        assert!(validate_public_domain("http://CDN.Example.com:8080/img", Some("cdn.example.com")).is_ok());

        // 反向判据：确认了 A 不等于放行 B。存 bool 的实现会在这里放行，属于必须拦住的回归
        let err = validate_public_domain("http://other.example.com", Some("cdn.example.com"))
            .unwrap_err()
            .to_string();
        assert!(err.contains("明文 HTTP"), "换个域名必须重新确认，实得: {}", err);

        // 没确认过就拒
        let err = validate_public_domain("http://cdn.example.com", None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("明文 HTTP"), "未确认必须拒绝，实得: {}", err);

        // 非 http/https 一律拒，确认过也不行
        assert!(validate_public_domain("ftp://cdn.example.com", Some("cdn.example.com")).is_err());
    }

    #[test]
    fn validate_public_domain_allows_empty_and_https() {
        assert!(validate_public_domain("", None).is_ok());
        assert!(validate_public_domain(" https://cdn.example.com ", None).is_ok());
    }

    #[test]
    fn build_custom_s3_endpoint_rejects_http() {
        let err = build_s3_endpoint(
            "custom_s3:local",
            &custom_s3_config("http://s3.example.com"),
            "bucket",
        )
        .expect_err("custom S3 endpoint should require HTTPS");

        assert!(err.to_string().contains("仅支持 HTTPS"));
    }

    #[test]
    fn build_custom_s3_endpoint_allows_public_https() {
        let (endpoint, region) = build_s3_endpoint(
            "custom_s3:prod",
            &custom_s3_config("https://s3.example.com"),
            "bucket",
        )
        .expect("public HTTPS custom S3 endpoint should be accepted");

        assert_eq!(endpoint, "https://s3.example.com");
        assert_eq!(region, "us-east-1");
    }
}
