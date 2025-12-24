// src-tauri/src/commands/nami.rs
// 纳米图床上传命令
// 使用火山引擎 TOS 对象存储，需要 TOS4-HMAC-SHA256 签名

use tauri::{Window, Emitter, Manager};
use serde::{Deserialize, Serialize};
use reqwest::Client;
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use sha1::{Sha1, Digest as Sha1Digest};
use sha2::Sha256;
use hmac::{Hmac, Mac};
use chrono::Utc;

use super::nami_token::fetch_nami_token_internal;

type HmacSha256 = Hmac<Sha256>;

const TOS_HOST: &str = "n-so.tos-cn-shanghai.volces.com";
const TOS_REGION: &str = "tos-cn-shanghai";
const TOS_SERVICE: &str = "tos";
const CDN_BASE: &str = "https://bfns.zhaomi.cn";

#[derive(Debug, Serialize)]
pub struct NamiUploadResult {
    pub url: String,
    pub size: u64,
    pub instant: bool,  // 是否秒传
}

#[derive(Debug, Deserialize)]
struct STSCredentials {
    access_key: String,
    secret_access_key: String,
    session_token: String,
    #[allow(dead_code)]
    expire_in: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct STSResponse {
    code: i32,
    data: Option<STSCredentials>,
    msg: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct InitMultipartResponse {
    #[serde(rename = "UploadId")]
    upload_id: String,
}

/// 计算文件 SHA1 哈希（取前40位hex）
fn calculate_file_hash(buffer: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(buffer);
    let result = hasher.finalize();
    hex::encode(result)
}

/// 获取文件 Content-Type
fn get_content_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// TOS4-HMAC-SHA256 签名器
struct TosSigner {
    access_key: String,
    secret_key: String,
    session_token: String,
}

impl TosSigner {
    fn new(access_key: String, secret_key: String, session_token: String) -> Self {
        Self {
            access_key,
            secret_key,
            session_token,
        }
    }

    /// 获取 ISO8601 格式时间戳
    fn get_timestamp() -> String {
        Utc::now().format("%Y%m%dT%H%M%SZ").to_string()
    }

    /// HMAC-SHA256（安全处理，避免 panic）
    fn hmac_sha256(key: &[u8], data: &str) -> Result<Vec<u8>, String> {
        let mut mac = HmacSha256::new_from_slice(key)
            .map_err(|e| format!("HMAC 初始化失败: {}", e))?;
        mac.update(data.as_bytes());
        Ok(mac.finalize().into_bytes().to_vec())
    }

    /// 获取签名密钥 (TOS V4: 直接使用 secretKey，不加前缀)
    fn get_signing_key(&self, date: &str) -> Result<Vec<u8>, String> {
        let k_date = Self::hmac_sha256(self.secret_key.as_bytes(), date)?;
        let k_region = Self::hmac_sha256(&k_date, TOS_REGION)?;
        let k_service = Self::hmac_sha256(&k_region, TOS_SERVICE)?;
        Self::hmac_sha256(&k_service, "request")
    }

    /// 签名请求
    fn sign(&self, method: &str, uri: &str, query_params: &[(&str, &str)]) -> Result<Vec<(String, String)>, String> {
        let timestamp = Self::get_timestamp();
        let date = &timestamp[0..8];

        // 签名 Headers
        let sign_headers = vec![
            ("host", TOS_HOST.to_string()),
            ("x-tos-content-sha256", "UNSIGNED-PAYLOAD".to_string()),
            ("x-tos-date", timestamp.clone()),
            ("x-tos-security-token", self.session_token.clone()),
        ];

        // 构建规范请求
        let canonical_request = self.build_canonical_request(method, uri, query_params, &sign_headers);

        // 构建签名字符串
        let scope = format!("{}/{}/{}/request", date, TOS_REGION, TOS_SERVICE);
        let string_to_sign = self.build_string_to_sign(&timestamp, &scope, &canonical_request);

        // 计算签名（安全处理错误）
        let signing_key = self.get_signing_key(date)?;
        let signature = hex::encode(Self::hmac_sha256(&signing_key, &string_to_sign)?);

        // 构建 Authorization
        let signed_headers_str: String = sign_headers.iter()
            .map(|(k, _)| k.to_string())
            .collect::<Vec<_>>()
            .join(";");

        let authorization = format!(
            "TOS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
            self.access_key, scope, signed_headers_str, signature
        );

        // 返回所有需要的 Headers
        let mut headers = sign_headers.iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect::<Vec<_>>();
        headers.push(("authorization".to_string(), authorization));

        Ok(headers)
    }

    /// 构建规范请求
    fn build_canonical_request(&self, method: &str, uri: &str, query_params: &[(&str, &str)], headers: &[(&str, String)]) -> String {
        // 规范 URI
        let canonical_uri = if uri.is_empty() { "/" } else { uri };

        // 规范查询字符串
        let mut sorted_params: Vec<_> = query_params.to_vec();
        sorted_params.sort_by(|a, b| a.0.cmp(b.0));
        let canonical_query_string: String = sorted_params.iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        // 规范头部
        let mut sorted_headers: Vec<_> = headers.iter()
            .map(|(k, v)| (k.to_lowercase(), v.clone()))
            .collect();
        sorted_headers.sort_by(|a, b| a.0.cmp(&b.0));

        let canonical_headers: String = sorted_headers.iter()
            .map(|(k, v)| format!("{}:{}", k, v))
            .collect::<Vec<_>>()
            .join("\n");

        let signed_headers: String = sorted_headers.iter()
            .map(|(k, _)| k.clone())
            .collect::<Vec<_>>()
            .join(";");

        // TOS4 格式: 需要空行
        format!(
            "{}\n{}\n{}\n{}\n\n{}\nUNSIGNED-PAYLOAD",
            method,
            canonical_uri,
            canonical_query_string,
            canonical_headers,
            signed_headers
        )
    }

    /// 构建签名字符串
    fn build_string_to_sign(&self, timestamp: &str, scope: &str, canonical_request: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(canonical_request.as_bytes());
        let hashed_request = hex::encode(hasher.finalize());

        format!(
            "TOS4-HMAC-SHA256\n{}\n{}\n{}",
            timestamp,
            scope,
            hashed_request
        )
    }
}

/// 检查文件是否已存在（秒传检测）
async fn check_file_exists(client: &Client, file_key: &str) -> bool {
    let url = format!("{}/{}", CDN_BASE, file_key);
    match client.head(&url).timeout(std::time::Duration::from_secs(5)).send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// 获取 STS 临时凭证
async fn get_sts_credentials(
    client: &Client,
    file_key: &str,
    cookie: &str,
    auth_token: &str,
    dynamic_headers: &super::nami_token::NamiDynamicHeaders,
) -> Result<STSCredentials, String> {
    let url = "https://www.n.cn/api/byte/assumerole?appsource=so";

    // 构建请求体
    let body = format!("filename%5B0%5D={}", urlencoding::encode(file_key));

    let response = client
        .post(url)
        .header("authority", "www.n.cn")
        .header("accept", "*/*")
        .header("accept-language", "zh-CN,zh;q=0.9")
        .header("auth-token", auth_token)
        .header("access-token", &dynamic_headers.access_token)
        .header("cloud_src", "video")
        .header("content-type", "application/x-www-form-urlencoded;charset=UTF-8")
        .header("cookie", cookie)
        .header("device-platform", "Web")
        .header("func-ver", "1")
        .header("nami-platform", "Windows")
        .header("origin", "https://www.n.cn")
        .header("referer", "https://www.n.cn/")
        .header("timestamp", &dynamic_headers.timestamp)
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .header("zm-token", &dynamic_headers.zm_token)
        .header("zm-ua", &dynamic_headers.zm_ua)
        .header("zm-ver", "1.2")
        .header("sid", &dynamic_headers.sid)
        .header("mid", &dynamic_headers.mid)
        .header("request-id", &dynamic_headers.request_id)
        .header("header-tid", &dynamic_headers.header_tid)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("STS 请求失败: {}", e))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| format!("读取 STS 响应失败: {}", e))?;

    println!("[Nami] STS 响应: {}", text);

    if !status.is_success() {
        return Err(format!("STS 请求失败 (HTTP {}): {}", status, text));
    }

    let sts_response: STSResponse = serde_json::from_str(&text)
        .map_err(|e| format!("解析 STS 响应失败: {}", e))?;

    if sts_response.code != 0 {
        return Err(format!("STS 返回错误: {}", sts_response.msg.unwrap_or_default()));
    }

    sts_response.data.ok_or_else(|| "STS 响应中没有 data".to_string())
}

/// 初始化分片上传
async fn init_multipart_upload(
    client: &Client,
    credentials: &STSCredentials,
    file_key: &str,
    content_type: &str,
) -> Result<String, String> {
    let signer = TosSigner::new(
        credentials.access_key.clone(),
        credentials.secret_access_key.clone(),
        credentials.session_token.clone(),
    );

    let uri = format!("/{}", file_key);
    let query_params = [("uploads", "")];

    let signed_headers = signer.sign("POST", &uri, &query_params)?;

    // URL 中对路径进行编码
    let encoded_path: String = file_key.split('/').map(|p| urlencoding::encode(p).to_string()).collect::<Vec<_>>().join("/");
    let url = format!("https://{}{}?uploads=", TOS_HOST, format!("/{}", encoded_path));

    let mut request = client.post(&url)
        .header("content-type", content_type)
        .header("content-length", "0");

    for (key, value) in signed_headers {
        request = request.header(&key, &value);
    }

    let response = request.send().await.map_err(|e| format!("初始化上传请求失败: {}", e))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("读取初始化响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!("初始化上传失败 (HTTP {}): {}", status, text));
    }

    // 解析响应获取 UploadId
    // 先尝试 JSON 格式，再尝试 XML 格式（兼容）
    let upload_id = if text.starts_with('{') {
        // JSON 格式响应
        #[derive(Deserialize)]
        struct InitResponse {
            #[serde(rename = "UploadId")]
            upload_id: String,
        }
        let parsed: InitResponse = serde_json::from_str(&text)
            .map_err(|e| format!("解析 JSON UploadId 失败: {} - 原始响应: {}", e, text))?;
        parsed.upload_id
    } else {
        // XML 格式响应（兼容）
        text.split("<UploadId>")
            .nth(1)
            .and_then(|s| s.split("</UploadId>").next())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("无法解析 XML UploadId: {}", text))?
    };

    println!("[Nami] UploadId: {}", upload_id);
    Ok(upload_id)
}

/// 上传分片
async fn upload_part(
    client: &Client,
    credentials: &STSCredentials,
    file_key: &str,
    upload_id: &str,
    part_number: u32,
    data: &[u8],
) -> Result<String, String> {
    let signer = TosSigner::new(
        credentials.access_key.clone(),
        credentials.secret_access_key.clone(),
        credentials.session_token.clone(),
    );

    let uri = format!("/{}", file_key);

    // 需要转换为拥有的值
    let query_params_owned: Vec<(&str, String)> = vec![
        ("partNumber", part_number.to_string()),
        ("uploadId", upload_id.to_string()),
    ];
    let query_params_ref: Vec<(&str, &str)> = query_params_owned.iter()
        .map(|(k, v)| (*k, v.as_str()))
        .collect();

    let signed_headers = signer.sign("PUT", &uri, &query_params_ref)?;

    let encoded_path: String = file_key.split('/').map(|p| urlencoding::encode(p).to_string()).collect::<Vec<_>>().join("/");
    let url = format!("https://{}{}?partNumber={}&uploadId={}", TOS_HOST, format!("/{}", encoded_path), part_number, upload_id);

    let mut request = client.put(&url)
        .header("content-length", data.len().to_string())
        .body(data.to_vec());

    for (key, value) in signed_headers {
        request = request.header(&key, &value);
    }

    let response = request.send().await.map_err(|e| format!("上传分片失败: {}", e))?;
    let status = response.status();

    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("上传分片失败 (HTTP {}): {}", status, text));
    }

    // 获取 ETag
    let etag = response.headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| "响应中没有 ETag".to_string())?;

    println!("[Nami] Part {} ETag: {}", part_number, etag);
    Ok(etag)
}

/// 完成分片上传
async fn complete_multipart_upload(
    client: &Client,
    credentials: &STSCredentials,
    file_key: &str,
    upload_id: &str,
    parts: &[(u32, String)],
) -> Result<(), String> {
    let signer = TosSigner::new(
        credentials.access_key.clone(),
        credentials.secret_access_key.clone(),
        credentials.session_token.clone(),
    );

    let uri = format!("/{}", file_key);
    let query_params = [("uploadId", upload_id)];

    let signed_headers = signer.sign("POST", &uri, &query_params)?;

    // 构建请求体
    let body = serde_json::json!({
        "Parts": parts.iter().map(|(part_number, etag)| {
            serde_json::json!({
                "PartNumber": part_number,
                "ETag": etag,
            })
        }).collect::<Vec<_>>()
    });
    let body_str = body.to_string();

    let encoded_path: String = file_key.split('/').map(|p| urlencoding::encode(p).to_string()).collect::<Vec<_>>().join("/");
    let url = format!("https://{}{}?uploadId={}", TOS_HOST, format!("/{}", encoded_path), upload_id);

    let mut request = client.post(&url)
        .header("content-type", "application/json")
        .header("content-length", body_str.len().to_string())
        .body(body_str);

    for (key, value) in signed_headers {
        request = request.header(&key, &value);
    }

    let response = request.send().await.map_err(|e| format!("完成上传请求失败: {}", e))?;
    let status = response.status();

    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("完成上传失败 (HTTP {}): {}", status, text));
    }

    Ok(())
}

/// 上传到纳米图床
#[tauri::command]
pub async fn upload_to_nami(
    window: Window,
    id: String,
    file_path: String,
    cookie: String,
    auth_token: String,
) -> Result<NamiUploadResult, String> {
    println!("[Nami] 开始上传文件: {}", file_path);

    // 1. 读取文件
    let mut file = File::open(&file_path).await
        .map_err(|e| format!("无法打开文件: {}", e))?;

    let file_size = file.metadata().await
        .map_err(|e| format!("无法获取文件元数据: {}", e))?
        .len();

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).await
        .map_err(|e| format!("无法读取文件: {}", e))?;

    // 2. 获取文件扩展名
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?;

    let ext = file_name.split('.').last()
        .ok_or("无法获取文件扩展名")?
        .to_lowercase();

    // 3. 计算文件哈希
    let hash = calculate_file_hash(&buffer);
    let file_key = format!("web/{}.{}", hash, ext);
    println!("[Nami] 文件哈希: {}, key: {}", hash, file_key);

    // 4. 创建 HTTP 客户端
    // 注意：使用标准 TLS 验证，确保通信安全
    let client = Client::builder()
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 5. 检查文件是否已存在（秒传）
    if check_file_exists(&client, &file_key).await {
        let url = format!("{}/{}", CDN_BASE, file_key);
        println!("[Nami] 文件已存在，秒传成功: {}", url);

        // ✅ 修复: 删除此处的100%事件发送
        // 前端会在收到Ok结果时自动设置100%

        return Ok(NamiUploadResult {
            url,
            size: file_size,
            instant: true,
        });
    }

    // 发送步骤1进度：获取动态Headers (0%)
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 0,
        "total": 100,
        "step": "获取动态Headers中...",
        "step_index": 1,
        "total_steps": 5
    }));

    // 6. 获取动态 Headers
    println!("[Nami] 获取动态 Headers...");
    let dynamic_headers = fetch_nami_token_internal(&window.app_handle(), cookie.clone(), auth_token.clone()).await?;

    // 发送步骤2进度：获取STS凭证 (20%)
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 20,
        "total": 100,
        "step": "获取STS凭证中...",
        "step_index": 2,
        "total_steps": 5
    }));

    // 7. 获取 STS 凭证
    println!("[Nami] 获取 STS 凭证...");
    let credentials = get_sts_credentials(&client, &file_key, &cookie, &auth_token, &dynamic_headers).await?;
    println!("[Nami] STS 凭证获取成功");

    // 发送步骤3进度：初始化分片上传 (40%)
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 40,
        "total": 100,
        "step": "初始化分片上传中...",
        "step_index": 3,
        "total_steps": 5
    }));

    // 8. 初始化分片上传
    let content_type = get_content_type(&ext);
    println!("[Nami] 初始化分片上传...");
    let upload_id = init_multipart_upload(&client, &credentials, &file_key, content_type).await?;

    // 发送步骤4进度：上传分片 (60%)
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 60,
        "total": 100,
        "step": "上传分片中...",
        "step_index": 4,
        "total_steps": 5
    }));

    // 9. 上传分片（单分片）
    println!("[Nami] 上传分片...");
    let etag = upload_part(&client, &credentials, &file_key, &upload_id, 1, &buffer).await?;

    // 发送步骤5进度：完成上传 (80%)
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 80,
        "total": 100,
        "step": "完成上传中...",
        "step_index": 5,
        "total_steps": 5
    }));

    // 10. 完成上传
    println!("[Nami] 完成上传...");
    complete_multipart_upload(&client, &credentials, &file_key, &upload_id, &[(1, etag)]).await?;

    // 11. 返回结果
    let url = format!("{}/{}", CDN_BASE, file_key);
    println!("[Nami] 上传成功: {}", url);

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    Ok(NamiUploadResult {
        url,
        size: file_size,
        instant: false,
    })
}

/// 测试纳米 Cookie 和 Auth-Token 连接
#[tauri::command]
pub async fn test_nami_connection(app: tauri::AppHandle, cookie: String, auth_token: String) -> Result<String, String> {
    println!("[Nami Test] 开始测试连接...");

    // 创建 HTTP 客户端
    // 注意：使用标准 TLS 验证，确保通信安全
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 尝试获取动态 Headers 来验证 Cookie 和 Auth-Token
    println!("[Nami Test] 验证 Cookie 和 Auth-Token...");
    match fetch_nami_token_internal(&app, cookie.clone(), auth_token.clone()).await {
        Ok(dynamic_headers) => {
            println!("[Nami Test] 动态 Headers 获取成功");

            // 进一步验证：尝试创建一个测试的 file_key 并获取 STS 凭证
            let test_file_key = "web/test.png";

            match get_sts_credentials(&client, test_file_key, &cookie, &auth_token, &dynamic_headers).await {
                Ok(_credentials) => {
                    println!("[Nami Test] STS 凭证获取成功，Cookie 和 Auth-Token 有效");
                    Ok("纳米 Cookie 和 Auth-Token 有效，连接成功".to_string())
                },
                Err(e) => {
                    if e.contains("401") || e.contains("403") || e.contains("Unauthorized") {
                        Err("Cookie 或 Auth-Token 已失效，请重新获取".to_string())
                    } else {
                        // STS 请求失败但不一定是认证问题
                        Ok("纳米 Cookie 可能有效，但 STS 请求异常".to_string())
                    }
                }
            }
        },
        Err(e) => {
            if e.contains("401") || e.contains("403") || e.contains("Cookie") {
                Err("Cookie 或 Auth-Token 无效或已过期，请重新获取".to_string())
            } else {
                Err(format!("测试失败: {}", e))
            }
        }
    }
}
