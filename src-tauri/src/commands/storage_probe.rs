// src-tauri/src/commands/storage_probe.rs
// 图床页「测试连接」的对象存储分步检测（交接说明 8.4：依次测 凭证 → 写入 → 公开访问）
//
// 与 `test_s3_connection` 的区别：那条只列一次桶，绿灯只说明凭证能读；这里再传一张探针图、
// 匿名打开它的公开链接、最后删掉探针——「传上去了但链接打不开」是对象存储最常见、也最难自查的
// 配错方式。结果按步骤返回，失败时指到具体字段，图床页据此把那一格标红。
//
// 字段名是通用的（access_key / secret_key / bucket …），前端按图床映射到各自的配置键。

use aws_sdk_s3::primitives::ByteStream;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tokio::time::{timeout, Duration};

use super::s3_compatible::{
    build_s3_endpoint, create_s3_client, describe_sdk_error, non_empty, test_upyun_connection,
    validate_public_domain, S3TestConfig,
};
use super::webdav_upload::PROBE_PNG_BASE64;
use crate::error::AppError;

const STEP_TIMEOUT: Duration = Duration::from_secs(10);

/// 分步检测结果
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageProbeReport {
    pub ok: bool,
    /// 失败在哪一步：credentials / write / public
    pub failed_step: Option<&'static str>,
    /// 指到哪个字段：account_id / access_key / secret_key / bucket / region / endpoint / public_domain
    pub field: Option<&'static str>,
    /// 给用户看的原因（一句话）
    pub message: String,
    /// 这种图床实际验过的步骤（又拍云只验凭证）
    pub steps: Vec<&'static str>,
}

impl StorageProbeReport {
    fn passed(steps: Vec<&'static str>) -> Self {
        Self { ok: true, failed_step: None, field: None, message: String::new(), steps }
    }

    fn failed(step: &'static str, field: Option<&'static str>, message: impl Into<String>, steps: Vec<&'static str>) -> Self {
        Self { ok: false, failed_step: Some(step), field, message: message.into(), steps }
    }
}

const ALL_STEPS: [&str; 3] = ["credentials", "write", "public"];

/// 凭证这一步（列桶）的服务端错误 → 字段 + 原因
fn classify_credentials_error(full: &str, brief: &str) -> (Option<&'static str>, String) {
    if full.contains("InvalidAccessKeyId") {
        (Some("access_key"), "服务商不认识这个 Access Key".to_string())
    } else if full.contains("SignatureDoesNotMatch") {
        (Some("secret_key"), "服务商拒绝了签名".to_string())
    } else if full.contains("NoSuchBucket") {
        (Some("bucket"), "存储桶不存在".to_string())
    } else if full.contains("InvalidBucketName") {
        (Some("bucket"), "存储桶名称不合法".to_string())
    } else if full.contains("AccessDenied") {
        (Some("secret_key"), "没有访问这个存储桶的权限".to_string())
    } else {
        (None, format!("无法连接存储服务（{}）", brief))
    }
}

/// 写入这一步（传探针）的服务端错误 → 原因
fn classify_write_error(full: &str, brief: &str) -> String {
    if full.contains("AccessDenied") {
        "密钥没有写入权限".to_string()
    } else {
        format!("写入失败（{}）", brief)
    }
}

/// 构建约束文件名的出错 → 指到哪个字段
fn field_of_config_error(message: &str) -> Option<&'static str> {
    if message.contains("Account ID") {
        Some("account_id")
    } else if message.contains("Region") {
        Some("region")
    } else if message.contains("Endpoint") {
        Some("endpoint")
    } else {
        None
    }
}

/// 探针的公开链接，与前端各上传器拼链接的规则一致：
/// 填了公开访问域名就用它；腾讯云留空时用 COS 默认域名；自定义 S3 留空时用 Endpoint/桶名；其余必须填
fn probe_public_url(service_id: &str, config: &S3TestConfig, endpoint: &str, bucket: &str, region: &str, key: &str) -> Option<String> {
    if let Some(domain) = non_empty(&config.public_domain) {
        return Some(format!("{}/{}", domain.trim_end_matches('/'), key));
    }
    if service_id == "tencent" {
        return Some(format!("https://{}.cos.{}.myqcloud.com/{}", bucket, region, key));
    }
    if service_id.starts_with("custom_s3") {
        return Some(format!("{}/{}/{}", endpoint.trim_end_matches('/'), bucket, key));
    }
    None
}

/// 探针的对象键：放在用户填的存储路径下（有的密钥只授权了某个前缀）
fn probe_key(path: &Option<String>, stamp: u128) -> String {
    let prefix = non_empty(path)
        .map(|p| p.trim_matches('/').to_string())
        .filter(|p| !p.is_empty())
        .map(|p| format!("{}/", p))
        .unwrap_or_default();
    format!("{}.picnexus-probe-{}.png", prefix, stamp)
}

/// 图床页「测试连接」：对象存储分步检测
#[tauri::command]
pub async fn probe_s3_storage(service_id: String, config: S3TestConfig) -> Result<StorageProbeReport, AppError> {
    log::info!("[存储检测] 开始检测 {}", service_id);

    // 又拍云 REST + S3 两套凭证由原有检测负责，只报凭证一步
    if service_id == "upyun" {
        return Ok(match test_upyun_connection(&config).await {
            Ok(_) => StorageProbeReport::passed(vec!["credentials"]),
            Err(error) => {
                let message = error.message().to_string();
                let field = if message.contains("S3 访问凭证") {
                    Some("s3_access_key")
                } else if message.contains("操作员") {
                    Some("access_key")
                } else if message.contains("服务空间") {
                    Some("bucket")
                } else {
                    None
                };
                StorageProbeReport::failed("credentials", field, message, vec!["credentials"])
            }
        });
    }

    let steps = ALL_STEPS.to_vec();
    let Some(access_key) = non_empty(&config.get_access_key()) else {
        return Ok(StorageProbeReport::failed("credentials", Some("access_key"), "Access Key 不能为空", steps));
    };
    let Some(secret_key) = non_empty(&config.get_secret_key()) else {
        return Ok(StorageProbeReport::failed("credentials", Some("secret_key"), "Secret Key 不能为空", steps));
    };
    let Some(bucket) = non_empty(&config.get_bucket()) else {
        return Ok(StorageProbeReport::failed("credentials", Some("bucket"), "存储桶不能为空", steps));
    };
    let (endpoint, region) = match build_s3_endpoint(&service_id, &config, &bucket) {
        Ok(pair) => pair,
        Err(error) => {
            let message = error.message().to_string();
            return Ok(StorageProbeReport::failed("credentials", field_of_config_error(&message), message, steps));
        }
    };

    let client = create_s3_client(&endpoint, &access_key, &secret_key, &region);

    // 1. 凭证：列一次桶
    match timeout(STEP_TIMEOUT, client.list_objects_v2().bucket(&bucket).max_keys(1).send()).await {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            let described = describe_sdk_error(&error);
            log::warn!("[存储检测] 凭证未通过: {}", described.full);
            let (field, message) = classify_credentials_error(&described.full, &described.brief);
            return Ok(StorageProbeReport::failed("credentials", field, message, steps));
        }
        Err(_) => return Ok(StorageProbeReport::failed("credentials", None, "连接超时，请检查网络后重试", steps)),
    }

    // 公开访问域名先过一遍策略（明文 HTTP 要已确认），免得白传一张探针
    let public_domain = non_empty(&config.public_domain).unwrap_or_default();
    if let Err(error) = validate_public_domain(&public_domain, config.http_domain_confirmed_for.as_deref()) {
        return Ok(StorageProbeReport::failed("public", Some("public_domain"), error.message().to_string(), steps));
    }

    // 2. 写入：传探针图
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let key = probe_key(&config.path, stamp);
    let bytes = STANDARD
        .decode(PROBE_PNG_BASE64)
        .map_err(|_| AppError::storage("探针图片解码失败"))?;
    let put = client
        .put_object()
        .bucket(&bucket)
        .key(&key)
        .body(ByteStream::from(bytes))
        .content_type("image/png")
        .send();
    match timeout(STEP_TIMEOUT, put).await {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            let described = describe_sdk_error(&error);
            log::warn!("[存储检测] 写入未通过: {}", described.full);
            return Ok(StorageProbeReport::failed("write", None, classify_write_error(&described.full, &described.brief), steps));
        }
        Err(_) => return Ok(StorageProbeReport::failed("write", None, "写入超时，请检查网络后重试", steps)),
    }

    // 3. 公开访问：匿名打开探针的公开链接
    let public = match probe_public_url(&service_id, &config, &endpoint, &bucket, &region, &key) {
        None => StorageProbeReport::failed("public", Some("public_domain"), "公开访问域名不能为空", steps.clone()),
        Some(url) => check_public_url(&url, steps.clone()).await,
    };

    // 4. 不论公开链接能否打开，都删掉探针
    if let Err(error) = timeout(STEP_TIMEOUT, client.delete_object().bucket(&bucket).key(&key).send()).await {
        log::warn!("[存储检测] 探针清理超时，可手动删除 {}: {}", key, error);
    }

    if public.ok {
        log::info!("[存储检测] {} 三步均通过", service_id);
    }
    Ok(public)
}

async fn check_public_url(url: &str, steps: Vec<&'static str>) -> StorageProbeReport {
    let client = match reqwest::Client::builder().timeout(STEP_TIMEOUT).build() {
        Ok(client) => client,
        Err(error) => return StorageProbeReport::failed("public", Some("public_domain"), format!("无法发起请求：{}", error), steps),
    };
    match client.get(url).send().await {
        Err(error) => {
            let message = if error.is_timeout() { "公开链接连接超时".to_string() } else { "无法连接公开访问域名".to_string() };
            StorageProbeReport::failed("public", Some("public_domain"), message, steps)
        }
        Ok(response) => {
            let status = response.status().as_u16();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            if !(200..300).contains(&status) {
                StorageProbeReport::failed("public", Some("public_domain"), format!("图片已写入，但公开链接打不开（HTTP {}）", status), steps)
            } else if !content_type.starts_with("image/") {
                StorageProbeReport::failed("public", Some("public_domain"), "公开链接返回的不是图片", steps)
            } else {
                StorageProbeReport::passed(steps)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(json: serde_json::Value) -> S3TestConfig {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn credentials_errors_point_at_a_field() {
        assert_eq!(classify_credentials_error("InvalidAccessKeyId: …", "InvalidAccessKeyId").0, Some("access_key"));
        assert_eq!(classify_credentials_error("SignatureDoesNotMatch: …", "SignatureDoesNotMatch").0, Some("secret_key"));
        assert_eq!(classify_credentials_error("NoSuchBucket: …", "NoSuchBucket").0, Some("bucket"));
        let (field, message) = classify_credentials_error("dispatch failure", "dispatch failure");
        assert_eq!(field, None);
        assert!(message.contains("dispatch failure"));
    }

    #[test]
    fn write_denied_says_no_write_permission() {
        assert_eq!(classify_write_error("AccessDenied: …", "AccessDenied"), "密钥没有写入权限");
    }

    #[test]
    fn config_errors_point_at_the_missing_field() {
        assert_eq!(field_of_config_error("R2 Account ID 不能为空"), Some("account_id"));
        assert_eq!(field_of_config_error("腾讯云 Region 不能为空"), Some("region"));
        assert_eq!(field_of_config_error("自定义 S3 Endpoint 不能为空"), Some("endpoint"));
    }

    #[test]
    fn public_url_follows_the_uploader_rules() {
        let with_domain = config(serde_json::json!({ "publicDomain": "https://img.example.com/" }));
        assert_eq!(
            probe_public_url("r2", &with_domain, "https://x.r2.cloudflarestorage.com", "b", "auto", "p.png").as_deref(),
            Some("https://img.example.com/p.png")
        );
        let empty = config(serde_json::json!({}));
        assert_eq!(
            probe_public_url("tencent", &empty, "https://cos.ap-guangzhou.myqcloud.com", "pics-123", "ap-guangzhou", "p.png").as_deref(),
            Some("https://pics-123.cos.ap-guangzhou.myqcloud.com/p.png")
        );
        assert_eq!(
            probe_public_url("custom_s3:abc", &empty, "https://s3.example.com/", "b", "us-east-1", "p.png").as_deref(),
            Some("https://s3.example.com/b/p.png")
        );
        assert_eq!(probe_public_url("r2", &empty, "e", "b", "auto", "p.png"), None);
    }

    #[test]
    fn probe_key_sits_under_the_configured_path() {
        assert_eq!(probe_key(&Some("/blog/images/".into()), 7), "blog/images/.picnexus-probe-7.png");
        assert_eq!(probe_key(&None, 7), ".picnexus-probe-7.png");
        assert_eq!(probe_key(&Some("  ".into()), 7), ".picnexus-probe-7.png");
    }

    #[tokio::test]
    async fn missing_credentials_fail_at_the_first_step_without_network() {
        let report = probe_s3_storage("r2".into(), config(serde_json::json!({ "accountId": "a" }))).await.unwrap();
        assert_eq!(report.failed_step, Some("credentials"));
        assert_eq!(report.field, Some("access_key"));
        assert_eq!(report.steps, vec!["credentials", "write", "public"]);
    }
}
