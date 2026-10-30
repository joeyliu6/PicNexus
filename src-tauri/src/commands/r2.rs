// src-tauri/src/commands/r2.rs
// Cloudflare R2 连接测试
//
// R2 的上传走 `s3_compatible.rs` 的 `upload_to_s3_compatible`（aws-sdk-s3）。连接测试用
// 全局 `HttpClient` + 手搓 SigV4：测试只发一个 HEAD 请求，为它再建一个 SDK client 反而更重，
// 而 SigV4 的签名步骤在这里是可读的。

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::error::AppError;
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
