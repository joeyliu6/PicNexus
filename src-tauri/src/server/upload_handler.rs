// src-tauri/src/server/upload_handler.rs
// HTTP Server 和 CLI 模式的统一上传处理器
// 支持全部 16 个图床服务（Nami/Qiyu 需要 Puppeteer，仅 GUI 模式可用）

use axum::{extract::State, Json};
use axum::body::Bytes;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use reqwest::multipart;

// S3 SDK
use aws_sdk_s3::{Client as S3Client, Config as S3Config};
use aws_sdk_s3::config::{Credentials as S3Credentials, Region as S3Region};
use aws_sdk_s3::primitives::ByteStream;

// 密码学
use md5::{Md5, Digest};
use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// 错误响应预览最大字节数（用于失败日志/错误信息截断）
const ERROR_RESPONSE_PREVIEW_LEN: usize = 200;

/// UTF-8 安全的字符串预览：按字节数截断，但保证不切在多字节字符中间
///
/// `&s[..n]` 在 n 落到 UTF-8 多字节字符内部时会 panic。本函数先向前
/// 回退到最近的字符边界，确保切片合法，避免响应含中文时主线程崩溃。
fn safe_preview(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

// ==================== 配置枚举 ====================

/// Server/CLI 专用图床配置
/// 前端通过 update_server_config / save_cli_config 命令序列化后传入
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerUploadConfig {
    // ── 无需认证 ─────────────────────────────────
    /// 京东图床（无需认证）
    Jd,

    // ── API Token 类 ──────────────────────────────
    /// GitHub 图床
    Github {
        token: String,
        owner: String,
        repo: String,
        branch: String,
        path: String,
    },
    /// SM.MS 图床
    Smms { token: String },
    /// Imgur 图床
    Imgur { client_id: String },

    // ── Cookie 类 ─────────────────────────────────
    /// 微博图床
    Weibo { cookie: String },
    /// 哔哩哔哩图床
    Bilibili { cookie: String },
    /// 牛客网图床
    Nowcoder { cookie: String },
    /// 超星图床
    Chaoxing { cookie: String },
    /// 知乎图床
    Zhihu { cookie: String },

    // ── S3 私有存储 ───────────────────────────────
    /// Cloudflare R2
    R2 {
        account_id: String,
        access_key_id: String,
        secret_access_key: String,
        bucket_name: String,
        path: String,
        public_domain: String,
    },
    /// 腾讯云 COS
    Tencent {
        secret_id: String,
        secret_key: String,
        region: String,
        bucket: String,
        path: String,
        public_domain: String,
    },
    /// 阿里云 OSS
    Aliyun {
        access_key_id: String,
        access_key_secret: String,
        region: String,
        bucket: String,
        path: String,
        public_domain: String,
    },
    /// 七牛云
    Qiniu {
        access_key: String,
        secret_key: String,
        region: String,
        bucket: String,
        custom_domain: String,
        path: String,
    },
    /// 又拍云
    Upyun {
        operator: String,
        password: String,
        bucket: String,
        public_domain: String,
    },

    // ── 需要 Puppeteer（仅 GUI 模式） ─────────────
    /// Nami 图床（需要 Puppeteer sidecar，仅 GUI 模式可用）
    Nami {
        cookie: String,
        auth_token: String,
    },
    /// 奇遇图床（需要 Puppeteer sidecar，仅 GUI 模式可用）
    Qiyu,
}

// ==================== 请求/响应结构 ====================

/// PicGo 兼容的上传请求格式
/// 支持 {"list": ["/path/to/img.jpg"]} 格式
#[derive(Debug, Deserialize)]
pub struct UploadRequest {
    pub list: Option<Vec<String>>,
}

/// PicGo 兼容的上传响应格式
#[derive(Serialize)]
pub struct UploadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

// ==================== 主处理器 ====================

/// POST /upload 处理器（PicGo 协议兼容）
pub async fn handle_upload(
    State(config): State<Arc<Mutex<Option<ServerUploadConfig>>>>,
    Json(req): Json<UploadRequest>,
) -> Json<UploadResponse> {
    let config_guard = config.lock().await;
    let Some(config) = config_guard.as_ref() else {
        return Json(UploadResponse {
            success: false,
            result: None,
            message: Some("Server 未配置图床，请在「常规设置 → 编辑器兼容 Server」中选择默认图床".to_string()),
        });
    };

    let file_paths = req.list.unwrap_or_default();
    if file_paths.is_empty() {
        return Json(UploadResponse {
            success: false,
            result: None,
            message: Some("请求中 list 字段为空，请提供文件路径".to_string()),
        });
    }

    // 安全：限制只允许上传图片文件，防止任意文件泄露
    let allowed_extensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "tiff", "tif", "avif"];

    let mut urls = Vec::new();
    for path in &file_paths {
        // 校验文件扩展名
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !allowed_extensions.contains(&ext.as_str()) {
            return Json(UploadResponse {
                success: false,
                result: None,
                message: Some(format!("不支持的文件类型 '{}': 仅允许图片格式 ({})", path, allowed_extensions.join(", "))),
            });
        }

        match upload_single_file(path, config).await {
            Ok(url) => {
                log::info!("[Server] ✓ 上传成功: {}", url);
                urls.push(url);
            }
            Err(e) => {
                log::warn!("[Server] ✗ 上传失败 ({}): {}", path, e);
                return Json(UploadResponse {
                    success: false,
                    result: None,
                    message: Some(format!("上传失败: {}", e)),
                });
            }
        }
    }

    Json(UploadResponse {
        success: true,
        result: Some(urls),
        message: None,
    })
}

// ==================== 状态端点 ====================

/// 服务状态响应
#[derive(Serialize)]
pub struct StatusResponse {
    pub app: String,
    pub version: String,
    pub service: Option<String>,
    #[serde(rename = "serviceName")]
    pub service_name: Option<String>,
    pub ready: bool,
}

/// GET /status 处理器
pub async fn handle_status(
    State(config): State<Arc<Mutex<Option<ServerUploadConfig>>>>,
) -> Json<StatusResponse> {
    let config_guard = config.lock().await;
    let (service, service_name, ready) = match config_guard.as_ref() {
        Some(cfg) => {
            let (id, name) = get_service_info(cfg);
            (Some(id.to_string()), Some(name.to_string()), true)
        }
        None => (None, None, false),
    };

    Json(StatusResponse {
        app: "PicNexus".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        service,
        service_name,
        ready,
    })
}

fn get_service_info(config: &ServerUploadConfig) -> (&str, &str) {
    match config {
        ServerUploadConfig::Jd => ("jd", "京东图床"),
        ServerUploadConfig::Github { .. } => ("github", "GitHub"),
        ServerUploadConfig::Smms { .. } => ("smms", "SM.MS"),
        ServerUploadConfig::Imgur { .. } => ("imgur", "Imgur"),
        ServerUploadConfig::Weibo { .. } => ("weibo", "微博"),
        ServerUploadConfig::Bilibili { .. } => ("bilibili", "哔哩哔哩"),
        ServerUploadConfig::Nowcoder { .. } => ("nowcoder", "牛客"),
        ServerUploadConfig::Chaoxing { .. } => ("chaoxing", "超星"),
        ServerUploadConfig::Zhihu { .. } => ("zhihu", "知乎"),
        ServerUploadConfig::R2 { .. } => ("r2", "Cloudflare R2"),
        ServerUploadConfig::Tencent { .. } => ("tencent", "腾讯云 COS"),
        ServerUploadConfig::Aliyun { .. } => ("aliyun", "阿里云 OSS"),
        ServerUploadConfig::Qiniu { .. } => ("qiniu", "七牛云"),
        ServerUploadConfig::Upyun { .. } => ("upyun", "又拍云"),
        ServerUploadConfig::Nami { .. } => ("nami", "纳米图床"),
        ServerUploadConfig::Qiyu => ("qiyu", "七鱼图床"),
    }
}

// ==================== 文件内容上传端点 ====================

/// POST /upload/file 处理器
/// 接收二进制文件内容（而非文件路径），写入临时文件后上传
/// Header: Content-Type = image/png 等, X-Filename = 原始文件名
pub async fn handle_file_upload(
    State(config): State<Arc<Mutex<Option<ServerUploadConfig>>>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let config_guard = config.lock().await;
    let Some(cfg) = config_guard.as_ref() else {
        return (
            StatusCode::OK,
            Json(UploadResponse {
                success: false,
                result: None,
                message: Some("Server 未配置图床".to_string()),
            }),
        );
    };

    if body.is_empty() {
        return (
            StatusCode::OK,
            Json(UploadResponse {
                success: false,
                result: None,
                message: Some("请求体为空，请发送图片二进制数据".to_string()),
            }),
        );
    }

    let filename = headers
        .get("X-Filename")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| urlencoding::decode(s).ok())
        .map(|s| s.into_owned())
        .unwrap_or_else(|| {
            let ext = headers
                .get("Content-Type")
                .and_then(|v| v.to_str().ok())
                .and_then(|ct| ct.strip_prefix("image/"))
                .unwrap_or("png");
            format!("upload_{}.{}", chrono::Utc::now().timestamp_millis(), ext)
        });

    let temp_dir = std::env::temp_dir().join("picnexus_uploads");
    if let Err(e) = std::fs::create_dir_all(&temp_dir) {
        return (
            StatusCode::OK,
            Json(UploadResponse {
                success: false,
                result: None,
                message: Some(format!("无法创建临时目录: {}", e)),
            }),
        );
    }

    // 安全：只取纯文件名，防止路径穿越攻击（如 ../../etc/passwd）
    let safe_filename = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("upload.png")
        .to_string();
    let temp_path = temp_dir.join(&safe_filename);
    if let Err(e) = std::fs::write(&temp_path, &body) {
        return (
            StatusCode::OK,
            Json(UploadResponse {
                success: false,
                result: None,
                message: Some(format!("无法写入临时文件: {}", e)),
            }),
        );
    }

    let result = upload_single_file(temp_path.to_str().unwrap_or(""), cfg).await;
    let _ = std::fs::remove_file(&temp_path);

    match result {
        Ok(url) => {
            log::info!("[Server] ✓ 文件上传成功: {}", url);
            (
                StatusCode::OK,
                Json(UploadResponse {
                    success: true,
                    result: Some(vec![url]),
                    message: None,
                }),
            )
        }
        Err(e) => {
            log::warn!("[Server] ✗ 文件上传失败: {}", e);
            (
                StatusCode::OK,
                Json(UploadResponse {
                    success: false,
                    result: None,
                    message: Some(format!("上传失败: {}", e)),
                }),
            )
        }
    }
}

// ==================== 分发器 ====================

/// 统一上传入口（Server 和 CLI 模式共用）
pub async fn upload_single_file(file_path: &str, config: &ServerUploadConfig) -> Result<String, String> {
    let canonical = std::fs::canonicalize(file_path)
        .map_err(|e| format!("无法解析文件路径 '{}': {}", file_path, e))?;

    if !canonical.is_file() {
        return Err(format!("'{}' 不是有效的文件", file_path));
    }

    match config {
        ServerUploadConfig::Jd => server_upload_jd(&canonical).await,
        ServerUploadConfig::Github { token, owner, repo, branch, path } => {
            server_upload_github(&canonical, token, owner, repo, branch, path).await
        }
        ServerUploadConfig::Smms { token } => server_upload_smms(&canonical, token).await,
        ServerUploadConfig::Imgur { client_id } => server_upload_imgur(&canonical, client_id).await,
        ServerUploadConfig::Weibo { cookie } => server_upload_weibo(&canonical, cookie).await,
        ServerUploadConfig::Bilibili { cookie } => server_upload_bilibili(&canonical, cookie).await,
        ServerUploadConfig::Nowcoder { cookie } => server_upload_nowcoder(&canonical, cookie).await,
        ServerUploadConfig::Chaoxing { cookie } => server_upload_chaoxing(&canonical, cookie).await,
        ServerUploadConfig::Zhihu { cookie } => server_upload_zhihu(&canonical, cookie).await,
        ServerUploadConfig::R2 { account_id, access_key_id, secret_access_key, bucket_name, path, public_domain } => {
            server_upload_r2(&canonical, account_id, access_key_id, secret_access_key, bucket_name, path, public_domain).await
        }
        ServerUploadConfig::Tencent { secret_id, secret_key, region, bucket, path, public_domain } => {
            server_upload_tencent(&canonical, secret_id, secret_key, region, bucket, path, public_domain).await
        }
        ServerUploadConfig::Aliyun { access_key_id, access_key_secret, region, bucket, path, public_domain } => {
            server_upload_aliyun(&canonical, access_key_id, access_key_secret, region, bucket, path, public_domain).await
        }
        ServerUploadConfig::Qiniu { access_key, secret_key, region, bucket, custom_domain, path } => {
            server_upload_qiniu(&canonical, access_key, secret_key, region, bucket, custom_domain, path).await
        }
        ServerUploadConfig::Upyun { operator, password, bucket, public_domain } => {
            server_upload_upyun(&canonical, operator, password, bucket, public_domain).await
        }
        ServerUploadConfig::Nami { .. } => {
            Err("Nami 图床不支持外部编辑器模式（需要浏览器自动化获取凭证）。请在 PicNexus 设置中切换为京东、SM.MS 等支持该模式的图床".to_string())
        }
        ServerUploadConfig::Qiyu => {
            Err("七鱼图床不支持外部编辑器模式（需要浏览器自动化获取凭证）。请在 PicNexus 设置中切换为京东、SM.MS 等支持该模式的图床".to_string())
        }
    }
}

// ==================== 辅助函数 ====================

/// 构建对象存储 Key（路径 + 文件名）
fn build_upload_key(upload_path: &str, file_name: &str) -> String {
    let path = upload_path.trim().trim_matches('/');
    if path.is_empty() {
        file_name.to_string()
    } else {
        format!("{}/{}", path, file_name)
    }
}

/// 从 Cookie 字符串中提取指定字段值（如 SESSDATA=xxx; 中的 xxx）
fn extract_cookie_field<'a>(cookie: &'a str, prefix: &str) -> Option<&'a str> {
    let start = cookie.find(prefix)? + prefix.len();
    let rest = &cookie[start..];
    let end = rest.find(';').unwrap_or(rest.len());
    Some(rest[..end].trim())
}

/// 简单 XML 标签内容提取（用于微博响应解析）
fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)?;
    Some(xml[start..start + end].trim().to_string())
}

/// 创建通用 S3 客户端
fn create_s3_client(endpoint: &str, access_key: &str, secret_key: &str, region: &str) -> S3Client {
    let creds = S3Credentials::new(access_key, secret_key, None, None, "PicNexus");
    let config = S3Config::builder()
        .endpoint_url(endpoint)
        .region(S3Region::new(region.to_string()))
        .credentials_provider(creds)
        .force_path_style(true)
        .build();
    S3Client::from_conf(config)
}

/// 通用 S3 上传流程
async fn s3_put_object(
    client: &S3Client,
    bucket: &str,
    key: &str,
    buffer: Vec<u8>,
) -> Result<(), String> {
    let body = ByteStream::from(buffer);
    tokio::time::timeout(
        std::time::Duration::from_secs(120),
        client.put_object().bucket(bucket).key(key).body(body).send(),
    )
    .await
    .map_err(|_| "上传超时（120秒）".to_string())?
    .map_err(|e| format!("S3 上传失败: {}", e))?;
    Ok(())
}

// ==================== 各图床上传实现 ====================

// ── 京东图床 ──────────────────────────────────────────

async fn server_upload_jd(path: &std::path::Path) -> Result<String, String> {
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?;

    let ext = file_name.split('.').last().unwrap_or("jpg").to_lowercase();
    if !["jpg", "jpeg", "png", "gif"].contains(&ext.as_str()) {
        return Err(format!("京东图床不支持 .{} 格式，仅支持 JPG、PNG、GIF", ext));
    }

    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    if buffer.len() as u64 > 15 * 1024 * 1024 {
        return Err(format!("文件过大 ({:.1}MB)，京东图床限制 15MB", buffer.len() as f64 / 1024.0 / 1024.0));
    }

    let aid_info = jd_get_aid().await?;
    let normalized_name = format!("{}.{}", file_name.trim_end_matches(&format!(".{}", ext)), ext);

    let part = multipart::Part::bytes(buffer)
        .file_name(normalized_name)
        .mime_str("image/*")
        .map_err(|e| format!("MIME 设置失败: {}", e))?;

    let form = multipart::Form::new()
        .part("upload", part)
        .text("appId", "im.customer")
        .text("aid", aid_info.0)
        .text("clientType", "comet")
        .text("pin", aid_info.1);

    let client = reqwest::Client::new();
    let resp = client
        .post("https://file-dd.jd.com/file/uploadImg.action")
        .header("Accept", "application/json, text/plain, */*")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Origin", "https://jdcs.jd.com")
        .header("Referer", "https://jdcs.jd.com/chat/index.action?venderId=1&appId=jd.waiter&customerAppId=im.customer&entry=jd_web_EnterpriseZC")
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    if json["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(format!("京东图床返回错误: code={}", json["code"]));
    }

    let raw_url = json["path"].as_str().ok_or("响应缺少 path 字段")?;
    Ok(raw_url.replace("dd-static.jd.com/ddimgp", "img30.360buyimg.com/imgzone"))
}

async fn jd_get_aid() -> Result<(String, String), String> {
    let url = "https://api.m.jd.com/client.action?functionId=getAidInfo&body=%7B%22aidClientType%22%3A%22comet%22%2C%22aidClientVersion%22%3A%22comet%20-v1.0.0%22%2C%22appId%22%3A%22im.customer%22%2C%22os%22%3A%22comet%22%2C%22entry%22%3A%22jd_web_EnterpriseZC%22%2C%22reqSrc%22%3A%22s_comet%22%2C%22siteId%22%3A-1%2C%22customerAppId%22%3A%22im.customer%22%7D&appid=wh5&client=wh5&clientVersion=1.0.0&loginType=3&callback=jsonp1";

    let text = reqwest::Client::new()
        .get(url)
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://jdcs.jd.com/chat/index.action?venderId=1&appId=jd.waiter&customerAppId=im.customer&entry=jd_web_EnterpriseZC")
        .send()
        .await
        .map_err(|e| format!("获取 JD aid 失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取 JD aid 响应失败: {}", e))?;

    let json_str = text.trim()
        .strip_prefix("jsonp1(")
        .and_then(|s| s.strip_suffix(")"))
        .ok_or("JD aid JSONP 格式异常")?;

    let json: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JD aid JSON 解析失败: {}", e))?;

    Ok((
        json["aid"].as_str().unwrap_or("").to_string(),
        json["pin"].as_str().unwrap_or("").to_string(),
    ))
}

// ── GitHub 图床 ───────────────────────────────────────

async fn server_upload_github(
    path: &std::path::Path,
    token: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    upload_path: &str,
) -> Result<String, String> {
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?;

    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    if buffer.len() as u64 > 25 * 1024 * 1024 {
        return Err(format!("文件过大 ({:.1}MB)，GitHub API 限制 25MB", buffer.len() as f64 / 1024.0 / 1024.0));
    }

    let content = STANDARD.encode(&buffer);
    let remote_path = format!("{}/{}", upload_path.trim_end_matches('/'), file_name);
    let encoded_path = remote_path.split('/')
        .map(|seg| urlencoding::encode(seg).into_owned())
        .collect::<Vec<_>>()
        .join("/");

    let url = format!("https://api.github.com/repos/{}/{}/contents/{}", owner, repo, encoded_path);
    let body = serde_json::json!({
        "message": format!("Upload {} via PicNexus Server", file_name),
        "content": content,
        "branch": branch,
    });

    let resp = reqwest::Client::new()
        .put(&url)
        .header("Authorization", format!("token {}", token))
        .header("User-Agent", "PicNexus")
        .header("Accept", "application/vnd.github.v3+json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return match status {
            s if s == reqwest::StatusCode::UNAUTHORIZED => Err("GitHub Token 无效或已过期".to_string()),
            s if s == reqwest::StatusCode::FORBIDDEN => Err("GitHub API 频率限制，请稍后再试".to_string()),
            s if s == reqwest::StatusCode::NOT_FOUND => Err("GitHub 仓库或分支不存在".to_string()),
            _ => Err(format!("GitHub API 失败 (HTTP {})", status)),
        };
    }

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    let download_url = json["content"]["download_url"]
        .as_str()
        .ok_or("响应缺少 download_url 字段")?;

    Ok(download_url.to_string())
}

// ── SM.MS 图床 ────────────────────────────────────────

async fn server_upload_smms(path: &std::path::Path, token: &str) -> Result<String, String> {
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?;

    let ext = file_name.split('.').last().unwrap_or("jpg").to_lowercase();
    if !["jpg", "jpeg", "png", "gif", "bmp", "webp"].contains(&ext.as_str()) {
        return Err(format!("SM.MS 不支持 .{} 格式", ext));
    }

    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    if buffer.len() as u64 > 5 * 1024 * 1024 {
        return Err(format!("文件过大 ({:.1}MB)，SM.MS 限制 5MB", buffer.len() as f64 / 1024.0 / 1024.0));
    }

    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str("image/*")
        .map_err(|e| format!("MIME 设置失败: {}", e))?;

    let resp = reqwest::Client::new()
        .post("https://sm.ms/api/v2/upload")
        .header("Authorization", token)
        .multipart(multipart::Form::new().part("smfile", part))
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return match status {
            s if s == reqwest::StatusCode::UNAUTHORIZED => Err("SM.MS Token 无效或已过期".to_string()),
            _ => Err(format!("SM.MS API 失败 (HTTP {})", status)),
        };
    }

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    if !json["success"].as_bool().unwrap_or(false) {
        return Err(format!("SM.MS 上传失败: {}: {}",
            json["code"].as_str().unwrap_or(""),
            json["message"].as_str().unwrap_or("未知错误")));
    }

    Ok(json["data"]["url"].as_str().ok_or("响应缺少 url 字段")?.to_string())
}

// ── Imgur 图床 ────────────────────────────────────────

async fn server_upload_imgur(path: &std::path::Path, client_id: &str) -> Result<String, String> {
    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let encoded = STANDARD.encode(&buffer);

    let resp = reqwest::Client::new()
        .post("https://api.imgur.com/3/image")
        .header("Authorization", format!("Client-ID {}", client_id))
        .form(&[("image", encoded.as_str()), ("type", "base64")])
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return match status {
            s if s == reqwest::StatusCode::UNAUTHORIZED || s == reqwest::StatusCode::FORBIDDEN => {
                Err("Imgur Client ID 无效".to_string())
            }
            s if s.as_u16() == 429 => Err("Imgur API 频率限制，请稍后再试".to_string()),
            _ => Err(format!("Imgur API 失败 (HTTP {}): {}", status, text)),
        };
    }

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    if !json["success"].as_bool().unwrap_or(false) {
        return Err(format!("Imgur 上传失败: {}", json["data"]["error"].as_str().unwrap_or("未知错误")));
    }

    Ok(json["data"]["link"].as_str().ok_or("响应缺少 link 字段")?.to_string())
}

// ── 微博图床 ──────────────────────────────────────────

async fn server_upload_weibo(path: &std::path::Path, cookie: &str) -> Result<String, String> {
    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let total_len = buffer.len() as u64;
    let url = "https://picupload.weibo.com/interface/pic_upload.php?s=xml&ori=1&data=1&rotate=0&wm=&app=miniblog&mime=image/jpeg";

    let resp = reqwest::Client::new()
        .post(url)
        .header("Cookie", cookie)
        .header("Content-Length", total_len)
        .header("Content-Type", "application/octet-stream")
        .header("Referer", "https://photo.weibo.com/")
        .header("Origin", "https://photo.weibo.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36")
        .body(buffer)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if text.contains("<data>100006</data>") {
        return Err("微博 Cookie 已过期（错误码：100006）".to_string());
    }

    let pid = extract_xml_tag(&text, "pid")
        .ok_or_else(|| format!("微博响应中未找到 pid 字段（响应：{}）", safe_preview(&text, ERROR_RESPONSE_PREVIEW_LEN)))?;

    Ok(format!("https://tvax1.sinaimg.cn/large/{}.jpg", pid))
}

// ── 哔哩哔哩图床 ──────────────────────────────────────

async fn server_upload_bilibili(path: &std::path::Path, cookie: &str) -> Result<String, String> {
    let sessdata = extract_cookie_field(cookie, "SESSDATA=")
        .ok_or("哔哩哔哩 Cookie 缺少 SESSDATA 字段")?
        .to_string();
    let csrf = extract_cookie_field(cookie, "bili_jct=")
        .ok_or("哔哩哔哩 Cookie 缺少 bili_jct 字段")?
        .to_string();

    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let ext = file_name.split('.').last().unwrap_or("jpg").to_lowercase();
    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    if buffer.len() as u64 > 10 * 1024 * 1024 {
        return Err(format!("文件过大 ({:.1}MB)，哔哩哔哩限制 10MB", buffer.len() as f64 / 1024.0 / 1024.0));
    }

    let mime_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };

    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|e| format!("MIME 设置失败: {}", e))?;

    let form = multipart::Form::new().part("file", part).text("csrf", csrf);

    let resp = reqwest::Client::new()
        .post("https://mall.bilibili.com/mall-up-c/common/image")
        .header("Cookie", format!("SESSDATA={}", sessdata))
        .header("Referer", "https://mall.bilibili.com/")
        .header("Origin", "https://mall.bilibili.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(form)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    if json["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(format!("哔哩哔哩上传失败: code={}, msg={}",
            json["code"], json["message"].as_str().unwrap_or("未知错误")));
    }

    let image_url = json["data"].as_str().ok_or("响应缺少 data 字段")?;
    let final_url = if image_url.starts_with("//") {
        format!("https:{}", image_url)
    } else if !image_url.starts_with("http") {
        format!("https://{}", image_url)
    } else {
        image_url.to_string()
    };

    Ok(final_url)
}

// ── 牛客网图床 ────────────────────────────────────────

async fn server_upload_nowcoder(path: &std::path::Path, cookie: &str) -> Result<String, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("获取时间戳失败: {}", e))?
        .as_millis();

    let url = format!("https://www.nowcoder.com/uploadImage?type=1&_={}", timestamp);

    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str("image/*")
        .map_err(|e| format!("MIME 设置失败: {}", e))?;

    let resp = reqwest::Client::new()
        .post(&url)
        .header("Cookie", cookie)
        .header("Referer", "https://www.nowcoder.com/creation/write/article")
        .header("Origin", "https://www.nowcoder.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(multipart::Form::new().part("file", part))
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    if json["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(format!("牛客上传失败: {}", json["msg"].as_str().unwrap_or("未知错误")));
    }

    let image_url = json["url"].as_str().ok_or("响应缺少 url 字段")?;
    let https_url = if image_url.starts_with("http://") {
        image_url.replacen("http://", "https://", 1)
    } else {
        image_url.to_string()
    };

    // 去除 CDN 压缩路径（/compress/mwXXX/）
    let final_url = if let Some(pos) = https_url.find("/compress/") {
        let after = &https_url[pos + "/compress/".len()..];
        if let Some(next) = after.find('/') {
            format!("{}{}", &https_url[..pos], &after[next..])
        } else {
            https_url
        }
    } else {
        https_url
    };

    Ok(final_url)
}

// ── 超星图床 ──────────────────────────────────────────

async fn server_upload_chaoxing(path: &std::path::Path, cookie: &str) -> Result<String, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let ext = file_name.split('.').last().unwrap_or("jpg").to_lowercase();
    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let mime_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    };

    let part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|e| format!("MIME 设置失败: {}", e))?;

    let resp = reqwest::Client::new()
        .post("https://notice.chaoxing.com/pc/files/uploadNoticeFile")
        .header("Cookie", cookie)
        .header("Referer", "https://notice.chaoxing.com/")
        .header("Origin", "https://notice.chaoxing.com")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
        .multipart(multipart::Form::new().part("attrFile", part))
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let text = resp.text().await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if text.contains("<!DOCTYPE html>") || text.contains("<html") {
        return Err("超星 Cookie 已过期或无效，请重新登录".to_string());
    }

    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    if json["status"].as_bool() != Some(true) {
        return Err(format!("超星上传失败: {}", json["msg"].as_str().unwrap_or("未知错误")));
    }

    let image_url = json["url"].as_str().ok_or("响应缺少 url 字段")?;
    // 去掉 URL 查询参数
    let final_url = image_url.split('?').next().unwrap_or(image_url).to_string();

    Ok(final_url)
}

// ── 知乎图床 ──────────────────────────────────────────

async fn server_upload_zhihu(path: &std::path::Path, cookie: &str) -> Result<String, String> {
    let buffer = tokio::fs::read(path).await
        .map_err(|e| format!("读取文件失败: {}", e))?;

    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let ext = file_name.split('.').last().unwrap_or("jpg").to_lowercase();
    let content_type = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };

    // 计算图片 MD5
    let mut hasher = Md5::new();
    hasher.update(&buffer);
    let image_hash = hex::encode(hasher.finalize());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 获取上传凭证
    let credentials_resp = client
        .post("https://api.zhihu.com/images")
        .header("Cookie", cookie)
        .header("Content-Type", "application/json")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://www.zhihu.com/")
        .header("Origin", "https://www.zhihu.com")
        .json(&serde_json::json!({"image_hash": image_hash, "source": "pin"}))
        .send()
        .await
        .map_err(|e| format!("获取知乎上传凭证失败: {}", e))?;

    let credentials_text = credentials_resp.text().await
        .map_err(|e| format!("读取凭证响应失败: {}", e))?;

    let credentials: serde_json::Value = serde_json::from_str(&credentials_text)
        .map_err(|e| format!("解析知乎凭证失败: {} (响应: {})", e, safe_preview(&credentials_text, ERROR_RESPONSE_PREVIEW_LEN)))?;

    let image_id = credentials["upload_file"]["image_id"]
        .as_str()
        .ok_or("知乎响应缺少 image_id")?
        .to_string();

    let state = credentials["upload_file"]["state"].as_i64().unwrap_or(0);

    if state != 1 {
        // 需要上传到 OSS
        let access_id = credentials["upload_token"]["access_id"].as_str().ok_or("知乎响应缺少 access_id")?.to_string();
        let access_key = credentials["upload_token"]["access_key"].as_str().ok_or("知乎响应缺少 access_key")?.to_string();
        let access_token = credentials["upload_token"]["access_token"].as_str().ok_or("知乎响应缺少 access_token")?.to_string();
        let object_key = credentials["upload_file"]["object_key"].as_str().ok_or("知乎响应缺少 object_key")?.to_string();

        // 构造 OSS 签名
        let date = chrono::Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string();
        let string_to_sign = format!(
            "PUT\n\n{}\n{}\nx-oss-date:{}\nx-oss-security-token:{}\n/zhihu-pics/{}",
            content_type, date, date, access_token, object_key
        );

        let mut mac = HmacSha1::new_from_slice(access_key.as_bytes())
            .map_err(|e| format!("HMAC 初始化失败: {}", e))?;
        mac.update(string_to_sign.as_bytes());
        let signature = STANDARD.encode(mac.finalize().into_bytes());
        let authorization = format!("OSS {}:{}", access_id, signature);

        let oss_url = format!("https://zhihu-pics-upload.zhimg.com/{}", object_key);
        let oss_resp = client
            .put(&oss_url)
            .header("Content-Type", content_type)
            .header("Authorization", &authorization)
            .header("x-oss-date", &date)
            .header("x-oss-security-token", &access_token)
            .body(buffer)
            .send()
            .await
            .map_err(|e| format!("知乎 OSS 上传失败: {}", e))?;

        if !oss_resp.status().is_success() {
            let err = oss_resp.text().await.unwrap_or_default();
            return Err(format!("知乎 OSS 上传失败: {}", err));
        }

        // 通知知乎上传完成
        let _ = client
            .put(&format!("https://api.zhihu.com/images/{}/uploading_status", image_id))
            .header("Cookie", cookie)
            .header("Content-Type", "application/json")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Referer", "https://www.zhihu.com/")
            .header("Origin", "https://www.zhihu.com")
            .json(&serde_json::json!({"upload_result": "success"}))
            .send()
            .await;
    }

    // 轮询图片状态（最多 30 次）
    for _ in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let status_resp = client
            .get(&format!("https://api.zhihu.com/images/{}", image_id))
            .header("Cookie", cookie)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .header("Referer", "https://www.zhihu.com/")
            .send()
            .await
            .map_err(|e| format!("查询知乎图片状态失败: {}", e))?;

        let status_text = status_resp.text().await
            .map_err(|e| format!("读取状态响应失败: {}", e))?;

        let status: serde_json::Value = serde_json::from_str(&status_text)
            .map_err(|e| format!("解析状态响应失败: {}", e))?;

        if status["status"].as_str() != Some("processing") {
            let url = status["url"].as_str()
                .or_else(|| status["original_src"].as_str())
                .ok_or("知乎图片处理完成但未返回 URL")?;

            // 标准化 URL → https://picx.zhimg.com/v2-{hash}.webp
            let re = regex::Regex::new(r"v2-[a-f0-9]+").unwrap();
            let normalized = if let Some(m) = re.find(url) {
                format!("https://picx.zhimg.com/{}.webp", m.as_str())
            } else {
                url.to_string()
            };
            return Ok(normalized);
        }
    }

    Err("知乎图片处理超时（30秒）".to_string())
}

// ── Cloudflare R2 ─────────────────────────────────────

async fn server_upload_r2(
    path: &std::path::Path,
    account_id: &str,
    access_key_id: &str,
    secret_access_key: &str,
    bucket_name: &str,
    upload_path: &str,
    public_domain: &str,
) -> Result<String, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let key = build_upload_key(upload_path, file_name);
    let buffer = tokio::fs::read(path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let endpoint = format!("https://{}.r2.cloudflarestorage.com", account_id);
    let client = create_s3_client(&endpoint, access_key_id, secret_access_key, "auto");
    s3_put_object(&client, bucket_name, &key, buffer).await?;

    let url = if public_domain.is_empty() {
        format!("{}/{}/{}", endpoint, bucket_name, key)
    } else {
        format!("{}/{}", public_domain.trim_end_matches('/'), key)
    };
    Ok(url)
}

// ── 腾讯云 COS ────────────────────────────────────────

async fn server_upload_tencent(
    path: &std::path::Path,
    secret_id: &str,
    secret_key: &str,
    region: &str,
    bucket: &str,
    upload_path: &str,
    public_domain: &str,
) -> Result<String, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let key = build_upload_key(upload_path, file_name);
    let buffer = tokio::fs::read(path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let endpoint = format!("https://cos.{}.myqcloud.com", region);
    let client = create_s3_client(&endpoint, secret_id, secret_key, region);
    s3_put_object(&client, bucket, &key, buffer).await?;

    let url = if public_domain.is_empty() {
        format!("https://{}.cos.{}.myqcloud.com/{}", bucket, region, key)
    } else {
        format!("{}/{}", public_domain.trim_end_matches('/'), key)
    };
    Ok(url)
}

// ── 阿里云 OSS ────────────────────────────────────────

async fn server_upload_aliyun(
    path: &std::path::Path,
    access_key_id: &str,
    access_key_secret: &str,
    region: &str,
    bucket: &str,
    upload_path: &str,
    public_domain: &str,
) -> Result<String, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let key = build_upload_key(upload_path, file_name);
    let buffer = tokio::fs::read(path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let endpoint = format!("https://oss-{}.aliyuncs.com", region);
    let client = create_s3_client(&endpoint, access_key_id, access_key_secret, region);
    s3_put_object(&client, bucket, &key, buffer).await?;

    let url = if public_domain.is_empty() {
        format!("https://{}.oss-{}.aliyuncs.com/{}", bucket, region, key)
    } else {
        format!("{}/{}", public_domain.trim_end_matches('/'), key)
    };
    Ok(url)
}

// ── 七牛云 ────────────────────────────────────────────

async fn server_upload_qiniu(
    path: &std::path::Path,
    access_key: &str,
    secret_key: &str,
    region: &str,
    bucket: &str,
    custom_domain: &str,
    upload_path: &str,
) -> Result<String, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let key = build_upload_key(upload_path, file_name);
    let buffer = tokio::fs::read(path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let endpoint = format!("https://s3-{}.qiniucs.com", region);
    let client = create_s3_client(&endpoint, access_key, secret_key, region);
    s3_put_object(&client, bucket, &key, buffer).await?;

    if custom_domain.is_empty() {
        return Err("七牛云需要配置自定义域名才能获取访问 URL".to_string());
    }
    Ok(format!("{}/{}", custom_domain.trim_end_matches('/'), key))
}

// ── 又拍云 ────────────────────────────────────────────

async fn server_upload_upyun(
    path: &std::path::Path,
    operator: &str,
    password: &str,
    bucket: &str,
    public_domain: &str,
) -> Result<String, String> {
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("无法获取文件名")?;
    let buffer = tokio::fs::read(path).await.map_err(|e| format!("读取文件失败: {}", e))?;

    let auth = STANDARD.encode(format!("{}:{}", operator, password));
    let remote_path = format!("/{}/{}", bucket, file_name);
    let upload_url = format!("https://v0.api.upyun.com{}", remote_path);

    let resp = reqwest::Client::new()
        .put(&upload_url)
        .header("Authorization", format!("Basic {}", auth))
        .header("Content-Length", buffer.len())
        .header("Content-Type", "image/*")
        .body(buffer)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return match status {
            s if s == reqwest::StatusCode::UNAUTHORIZED => Err("又拍云认证失败: 请检查操作员账号和密码".to_string()),
            s if s == reqwest::StatusCode::NOT_FOUND => Err(format!("又拍云服务空间不存在: {}", bucket)),
            _ => Err(format!("又拍云上传失败 (HTTP {})", status)),
        };
    }

    let url = if public_domain.is_empty() {
        format!("https://v0.api.upyun.com{}", remote_path)
    } else {
        format!("{}/{}", public_domain.trim_end_matches('/'), file_name)
    };
    Ok(url)
}
