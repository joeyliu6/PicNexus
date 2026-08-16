// src-tauri/src/commands/webdav_upload.rs
// WebDAV 图床上传
//
// 为什么不复用 main.rs 的 `webdav_request`：那个命令的 body 是 `Option<String>`，
// 只能传文本。图片是二进制，塞进 String 会被 UTF-8 编码破坏；而走前端转 base64
// 又会让内存占用翻倍。所以图片上传单独走这里，直接在 Rust 侧读文件并二进制 PUT。

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};
use tokio::time::Duration;

use super::utils::probe_upload_file_size;
use crate::error::AppError;
use crate::log_utils::safe_path;
use crate::url_policy::validate_webdav_url_for_request;
use crate::HttpClient;

/// 文件大小限制：50MB
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

/// 单次 WebDAV 请求超时
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 短操作（PROPFIND / MKCOL / DELETE）超时
const SHORT_TIMEOUT: Duration = Duration::from_secs(15);

/// 1×1 透明 PNG，用作连接测试的探针图片
const PROBE_PNG_BASE64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/// 认证失败的统一文案
///
/// 与前端 `src/utils/webdav.ts` 的同名常量保持逐字一致：备份链路在前端拦、
/// 图床链路在 Rust 拦，是同一件事的两个拦截点，说两种话用户会以为撞上了两个故障。
/// 这条一致性由 `scripts/check-cross-language-constants.mjs` 在 lint 阶段守着。
const WEBDAV_AUTH_FAILED_MESSAGE: &str = "认证失败，请检查用户名和密码";

/// 服务端只接受 Digest 时的专属文案
///
/// Why 单独一条而不是并进上面那句：前端的 `webdav_request` 只回 `{status, body}`，
/// 拿不到响应头，判不了认证方案。所以这句是 Rust 独有的，不进跨语言配对。
const WEBDAV_DIGEST_ONLY_MESSAGE: &str =
    "服务端要求 Digest 认证，PicNexus 暂不支持。请在服务端启用 Basic 认证（多数 NAS 可切换），或改用支持 Basic 的服务。";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDAVUploadResult {
    /// 上传后的公开访问 URL（已按模板渲染）
    pub url: String,
    /// 相对于 WebDAV 端点的远程路径，**已 percent-encode**
    ///
    /// 编码只在 Rust 侧做这一次：前端拿到的就是最终形态，直接填进模板即可。
    /// 两边各编码一次会导致 `%20` 变成 `%2520`，中文/空格文件名就会 404。
    pub remote_path: String,
    /// 文件名（未编码，用于日志与历史记录展示）
    pub file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDAVTestResult {
    pub success: bool,
    pub message: String,
}

// ==================== 路径与 URL 处理 ====================

/// 按路径段分别做 percent-encode，再用 `/` 拼回
///
/// 直接对整条路径调用 `urlencoding::encode` 会把分隔符 `/` 也编码成 `%2F`，
/// 服务端就会把它当成文件名的一部分而不是目录层级。
fn encode_path_segments(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            if segment.is_empty() {
                String::new()
            } else {
                urlencoding::encode(segment).into_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 规范化目录路径：去掉首尾多余斜杠，返回形如 `a/b` 的相对路径（可能为空）
fn normalize_dir(path: &str) -> String {
    path.trim().trim_matches('/').to_string()
}

/// 拼接 WebDAV 端点与相对路径
fn join_url(base: &str, relative: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    let relative = relative.trim_start_matches('/');
    if relative.is_empty() {
        base.to_string()
    } else {
        format!("{}/{}", base, relative)
    }
}

/// 按扩展名推断 Content-Type
fn guess_content_type(file_name: &str) -> &'static str {
    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        _ => "application/octet-stream",
    }
}

/// 渲染公开链接模板
///
/// 支持变量：`{domain}` `{path}` `{filename}`
/// - `{path}` 是已编码的完整远程路径（含目录）
/// - `{filename}` 是已编码的文件名
pub fn render_public_url(
    template: &str,
    public_domain: &str,
    encoded_path: &str,
    encoded_file_name: &str,
) -> String {
    let domain = public_domain.trim().trim_end_matches('/');
    let path = encoded_path.trim_start_matches('/');

    template
        .replace("{domain}", domain)
        .replace("{path}", path)
        .replace("{filename}", encoded_file_name)
}

/// 服务端在 401 里声明的认证方案
///
/// Why 用 `get_all` 而不是 `get`：RFC 7235 允许 `WWW-Authenticate` 以**多个同名 header**
/// 出现（Basic 一条、Digest 一条），`get` 只返回第一条。若服务端把 Digest 排在前面，
/// 只看第一条就会把「两种都支持」误判成「只支持 Digest」——于是密码真填错的用户
/// 被告知去改服务端认证方式，正好是本次要消灭的那种错误引导。
#[derive(Debug, Default, PartialEq, Eq)]
struct AuthChallenge {
    has_basic: bool,
    has_digest: bool,
}

impl AuthChallenge {
    /// 只有「提供 Digest 且不提供 Basic」才判定为撞上 Digest
    ///
    /// `!has_basic` 这个守卫让判据朝安全方向失败：拿不准时退回通用文案，
    /// 而不是把一个密码填错的用户支去折腾服务端配置。
    fn is_digest_only(&self) -> bool {
        self.has_digest && !self.has_basic
    }
}

fn parse_auth_challenge(headers: &reqwest::header::HeaderMap) -> AuthChallenge {
    let mut challenge = AuthChallenge::default();

    for value in headers.get_all(reqwest::header::WWW_AUTHENTICATE) {
        let Ok(raw) = value.to_str() else { continue };
        // 一条 header 里可以逗号分隔多个 challenge：`Basic realm="x", Digest realm="y"`。
        // 每段取首个空白前的 token 作为方案名，避免把 realm 内容（如 realm="Basic Zone"）当成方案。
        for part in raw.split(',') {
            let scheme = part.trim().split_whitespace().next().unwrap_or("");
            if scheme.eq_ignore_ascii_case("basic") {
                challenge.has_basic = true;
            } else if scheme.eq_ignore_ascii_case("digest") {
                challenge.has_digest = true;
            }
        }
    }

    challenge
}

/// 把 HTTP 状态码翻译成用户看得懂的失败原因
///
/// `headers` 传响应头（拿得到就传），用于在 401 时区分「密码错」与「服务端要 Digest」。
/// 传 `None` 或服务端没声明方案时，一律退回通用文案。
fn describe_status(status: u16, headers: Option<&reqwest::header::HeaderMap>) -> String {
    match status {
        // Why 只有 401 读 challenge：403 是「认过了但没权限」，不带认证方案协商，
        // 对它读 WWW-Authenticate 只会误报。
        401 if headers.is_some_and(|h| parse_auth_challenge(h).is_digest_only()) => {
            WEBDAV_DIGEST_ONLY_MESSAGE.to_string()
        }
        401 | 403 => WEBDAV_AUTH_FAILED_MESSAGE.to_string(),
        404 => "路径不存在，请检查远程路径配置".to_string(),
        405 => "服务器不允许该操作，请检查路径是否为目录".to_string(),
        409 => "父目录不存在，无法创建".to_string(),
        413 => "文件过大，超出服务器限制".to_string(),
        507 => "存储空间不足，WebDAV 服务器空间已满".to_string(),
        s if s >= 500 => format!("服务器错误 (HTTP {})，WebDAV 服务器可能暂时不可用", s),
        s => format!("请求失败: HTTP {}", s),
    }
}

fn map_request_error(err: reqwest::Error) -> AppError {
    if err.is_connect() {
        AppError::webdav("无法连接到 WebDAV 服务器，请检查 URL 或网络")
    } else if err.is_timeout() {
        AppError::webdav("WebDAV 请求超时")
    } else {
        AppError::webdav(format!("WebDAV 请求失败: {}", err))
    }
}

fn basic_auth(username: &str, password: &str) -> String {
    format!("Basic {}", STANDARD.encode(format!("{}:{}", username, password)))
}

fn is_ok_status(status: u16) -> bool {
    (200..300).contains(&status)
}

// ==================== WebDAV 操作 ====================

/// 递归创建远程目录
///
/// 幂等判定沿用前端 WebDAVClient 的规则：201 创建成功、405 已存在、301/302 重定向
/// 都算通过。中间某级失败不直接中断——部分服务器对已存在目录返回非标准状态码，
/// 最终能否写入由后续 PUT 说了算。
async fn ensure_remote_dir(
    client: &reqwest::Client,
    base_url: &str,
    dir: &str,
    auth: &str,
) -> Result<(), AppError> {
    let dir = normalize_dir(dir);
    if dir.is_empty() {
        return Ok(());
    }

    let mkcol = reqwest::Method::from_bytes(b"MKCOL")
        .map_err(|_| AppError::webdav("无法构造 MKCOL 请求"))?;

    let mut current = String::new();
    for segment in dir.split('/').filter(|s| !s.is_empty()) {
        current.push_str(&urlencoding::encode(segment));
        current.push('/');

        let url = join_url(base_url, &current);
        let response = client
            .request(mkcol.clone(), &url)
            .header("Authorization", auth)
            .timeout(SHORT_TIMEOUT)
            .send()
            .await
            .map_err(map_request_error)?;

        let status = response.status().as_u16();
        if is_ok_status(status) || matches!(status, 301 | 302 | 405) {
            continue;
        }

        // 401/403 是确定性失败，早退比让 PUT 再撞一次墙更有信息量
        if matches!(status, 401 | 403) {
            return Err(AppError::webdav(describe_status(
                status,
                Some(response.headers()),
            )));
        }

        log::warn!("[WebDAV] 创建目录返回 HTTP {}，继续尝试上传: {}", status, url);
    }

    Ok(())
}

/// 二进制 PUT 上传
async fn put_binary(
    client: &reqwest::Client,
    url: &str,
    auth: &str,
    body: Vec<u8>,
    content_type: &str,
) -> Result<(), AppError> {
    let response = client
        .put(url)
        .header("Authorization", auth)
        .header("Content-Type", content_type)
        .header("Overwrite", "T")
        .timeout(REQUEST_TIMEOUT)
        .body(body)
        .send()
        .await
        .map_err(map_request_error)?;

    let status = response.status().as_u16();
    if !is_ok_status(status) {
        return Err(AppError::webdav(describe_status(
            status,
            Some(response.headers()),
        )));
    }

    Ok(())
}

/// 以文件流 PUT 上传，不把整份文件读进内存
///
/// Why 显式带 Content-Length：`reqwest::Body::from(File)` 内部是 `wrap_stream`，
/// 长度未知，hyper 会退回 `Transfer-Encoding: chunked`。部分 WebDAV 服务端对
/// chunked PUT 支持不佳（会 411 或直接截断），所以这里手动补上长度让它走定长编码。
/// `put_file_stream_sends_content_length_not_chunked` 测试就是盯着这条不变量的。
async fn put_file_stream(
    client: &reqwest::Client,
    url: &str,
    auth: &str,
    file_path: &str,
    file_size: u64,
    content_type: &str,
) -> Result<(), AppError> {
    let file = tokio::fs::File::open(file_path)
        .await
        .map_err(|e| AppError::file_io(format!("打开文件失败: {}", e)))?;

    let response = client
        .put(url)
        .header("Authorization", auth)
        .header("Content-Type", content_type)
        .header(reqwest::header::CONTENT_LENGTH, file_size)
        .header("Overwrite", "T")
        .timeout(REQUEST_TIMEOUT)
        .body(reqwest::Body::from(file))
        .send()
        .await
        .map_err(map_request_error)?;

    let status = response.status().as_u16();
    if !is_ok_status(status) {
        return Err(AppError::webdav(describe_status(
            status,
            Some(response.headers()),
        )));
    }

    Ok(())
}

fn emit_progress(window: &Window, id: &str, progress: u32, step: &str, index: u32, total: u32) {
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": progress,
            "total": 100,
            "step": step,
            "step_index": index,
            "total_steps": total
        }),
    );
}

// ==================== Tauri 命令 ====================

/// 上传图片到 WebDAV 图床
#[tauri::command]
#[allow(clippy::too_many_arguments)] // 与前端 WebDAVStorageProfile 字段一一对应
pub async fn upload_to_webdav(
    window: Window,
    id: String,
    file_path: String,
    url: String,
    username: String,
    password: String,
    remote_path: String,
    public_domain: String,
    public_url_template: String,
    http_client: tauri::State<'_, HttpClient>,
) -> Result<WebDAVUploadResult, AppError> {
    log::info!("[WebDAV] 开始上传文件: {}", safe_path(&file_path));

    // 1. 校验地址（WebDAV 策略：允许局域网，拒绝链路本地与公网明文 HTTP）
    validate_webdav_url_for_request(&url).await?;
    if public_domain.trim().is_empty() {
        return Err(AppError::config(
            "公开访问域名不能为空——WebDAV 端点通常需要认证，无法直接作为图片链接",
        ));
    }
    validate_webdav_url_for_request(&public_domain).await?;

    emit_progress(&window, &id, 0, "读取文件...", 1, 3);

    // 2. 只探文件大小，内容留给流式 PUT 按需从磁盘读
    let file_size = probe_upload_file_size(&file_path, MAX_FILE_SIZE).await?;
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法解析文件名"))?
        .to_string();

    log::debug!("[WebDAV] 文件大小: {} bytes", file_size);

    let client = &http_client.0;
    let auth = basic_auth(&username, &password);
    let dir = normalize_dir(&remote_path);

    emit_progress(&window, &id, 30, "创建远程目录...", 2, 3);

    // 3. 建目录
    ensure_remote_dir(client, &url, &dir, &auth).await?;

    emit_progress(&window, &id, 60, "正在上传...", 3, 3);

    // 4. 二进制 PUT
    let encoded_file_name = urlencoding::encode(&file_name).into_owned();
    let encoded_path = if dir.is_empty() {
        encoded_file_name.clone()
    } else {
        format!("{}/{}", encode_path_segments(&dir), encoded_file_name)
    };
    let target_url = join_url(&url, &encoded_path);

    put_file_stream(
        client,
        &target_url,
        &auth,
        &file_path,
        file_size,
        guess_content_type(&file_name),
    )
    .await?;

    log::info!("[WebDAV] 上传成功 - 路径: {}", encoded_path);

    // 5. 按模板生成公开链接
    let public_url = render_public_url(
        &public_url_template,
        &public_domain,
        &encoded_path,
        &encoded_file_name,
    );

    Ok(WebDAVUploadResult {
        url: public_url,
        remote_path: encoded_path,
        file_name,
    })
}

/// 测试 WebDAV 图床配置
///
/// 与普通的"连得上吗"不同，这里还要回答"生成的链接别人能不能打开"：
/// 传一张探针图上去，再**匿名**访问公开链接。带上 Authorization 就测不出
/// 匿名可达性了——那正是用户最容易配错、也最难自查的一环。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn test_webdav_storage(
    url: String,
    username: String,
    password: String,
    remote_path: String,
    public_domain: String,
    public_url_template: String,
    http_client: tauri::State<'_, HttpClient>,
) -> Result<WebDAVTestResult, AppError> {
    validate_webdav_url_for_request(&url).await?;
    if public_domain.trim().is_empty() {
        return Err(AppError::config("公开访问域名不能为空"));
    }
    validate_webdav_url_for_request(&public_domain).await?;

    let client = &http_client.0;
    let auth = basic_auth(&username, &password);
    let dir = normalize_dir(&remote_path);

    // 1. PROPFIND 探目录可达性
    let propfind = reqwest::Method::from_bytes(b"PROPFIND")
        .map_err(|_| AppError::webdav("无法构造 PROPFIND 请求"))?;
    let probe_dir_url = join_url(&url, &encode_path_segments(&dir));
    let response = client
        .request(propfind, &probe_dir_url)
        .header("Authorization", &auth)
        .header("Depth", "0")
        .timeout(SHORT_TIMEOUT)
        .send()
        .await
        .map_err(map_request_error)?;

    let status = response.status().as_u16();
    // 404 说明目录还没建，后面 MKCOL 会补上，不算失败
    if !is_ok_status(status) && status != 207 && status != 404 {
        return Err(AppError::webdav(describe_status(
            status,
            Some(response.headers()),
        )));
    }

    // 2. 上传探针图
    let probe_name = format!(".picnexus-probe-{}.png", std::process::id());
    let encoded_probe_name = urlencoding::encode(&probe_name).into_owned();
    let encoded_path = if dir.is_empty() {
        encoded_probe_name.clone()
    } else {
        format!("{}/{}", encode_path_segments(&dir), encoded_probe_name)
    };

    ensure_remote_dir(client, &url, &dir, &auth).await?;

    let probe_bytes = STANDARD
        .decode(PROBE_PNG_BASE64)
        .map_err(|_| AppError::webdav("探针图片解码失败"))?;

    put_binary(
        client,
        &join_url(&url, &encoded_path),
        &auth,
        probe_bytes,
        "image/png",
    )
    .await
    .map_err(|err| AppError::webdav(format!("上传失败：{}", err)))?;

    // 3. 匿名 GET 公开链接
    let probe_url = render_public_url(
        &public_url_template,
        &public_domain,
        &encoded_path,
        &encoded_probe_name,
    );

    let public_result = client
        .get(&probe_url)
        .timeout(SHORT_TIMEOUT)
        .send()
        .await;

    // 4. 无论公开链接是否可达，都清理探针文件
    let cleanup = client
        .delete(join_url(&url, &encoded_path))
        .header("Authorization", &auth)
        .timeout(SHORT_TIMEOUT)
        .send()
        .await;
    if let Err(err) = cleanup {
        log::warn!("[WebDAV] 探针文件清理失败，可手动删除 {}: {}", probe_name, err);
    }

    // 5. 判定公开可达性
    match public_result {
        Ok(res) => {
            let status = res.status().as_u16();
            let content_type = res
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();

            if !is_ok_status(status) {
                return Ok(WebDAVTestResult {
                    success: false,
                    message: format!(
                        "图片已上传，但公开链接打不开 (HTTP {})——请检查「公开访问域名」和 URL 模板",
                        status
                    ),
                });
            }

            if !content_type.starts_with("image/") {
                return Ok(WebDAVTestResult {
                    success: false,
                    message: format!(
                        "公开链接返回的不是图片 (Content-Type: {})——多半是模板指向了登录页或分享页",
                        if content_type.is_empty() { "未知" } else { &content_type }
                    ),
                });
            }

            Ok(WebDAVTestResult {
                success: true,
                message: "连接成功，公开链接可正常访问".to_string(),
            })
        }
        Err(err) => Ok(WebDAVTestResult {
            success: false,
            message: format!(
                "图片已上传，但公开链接无法访问（{}）——请检查「公开访问域名」和 URL 模板",
                if err.is_timeout() {
                    "请求超时".to_string()
                } else if err.is_connect() {
                    "无法连接".to_string()
                } else {
                    err.to_string()
                }
            ),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 流式 PUT 必须走定长编码，不能退回 chunked
    ///
    /// 光看 reqwest 文档判断不了这件事：`Body::from(File)` 内部是 wrap_stream，
    /// 长度未知，只有显式补 Content-Length 才会让 hyper 走定长。这里起一个真实的
    /// 本地 HTTP 服务端，直接检查线上发出去的 header——不是推断，是实测。
    #[tokio::test]
    async fn put_file_stream_sends_content_length_not_chunked() {
        use axum::{routing::any, Router};
        use std::sync::{Arc, Mutex};

        #[derive(Default)]
        struct Captured {
            content_length: Option<String>,
            transfer_encoding: Option<String>,
            body_len: usize,
        }

        let captured: Arc<Mutex<Captured>> = Arc::new(Mutex::new(Captured::default()));
        let sink = captured.clone();

        let app = Router::new().route(
            "/upload.png",
            any(move |headers: axum::http::HeaderMap, body: axum::body::Bytes| {
                let sink = sink.clone();
                async move {
                    let header = |name: &str| {
                        headers
                            .get(name)
                            .and_then(|v| v.to_str().ok())
                            .map(str::to_string)
                    };
                    *sink.lock().expect("捕获锁") = Captured {
                        content_length: header("content-length"),
                        transfer_encoding: header("transfer-encoding"),
                        body_len: body.len(),
                    };
                    axum::http::StatusCode::CREATED
                }
            }),
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定本地端口失败");
        let addr = listener.local_addr().expect("获取本地地址失败");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        // 造一个跨越多个读取块的文件，确保确实走了流式路径
        let payload = vec![7u8; 256 * 1024];
        let path = std::env::temp_dir()
            .join(format!("picnexus_webdav_stream_{}.png", std::process::id()));
        std::fs::write(&path, &payload).expect("写入临时文件失败");

        let result = put_file_stream(
            &reqwest::Client::new(),
            &format!("http://{}/upload.png", addr),
            "Basic dGVzdDp0ZXN0",
            path.to_str().expect("临时路径应为合法 UTF-8"),
            payload.len() as u64,
            "image/png",
        )
        .await;

        let _ = std::fs::remove_file(&path);
        server.abort();

        result.expect("流式 PUT 应成功");

        let captured = captured.lock().expect("捕获锁");
        assert_eq!(
            captured.content_length.as_deref(),
            Some(payload.len().to_string().as_str()),
            "必须带上准确的 Content-Length",
        );
        assert_eq!(
            captured.transfer_encoding, None,
            "不能退回 chunked——部分 WebDAV 服务端不接受 chunked PUT",
        );
        assert_eq!(captured.body_len, payload.len(), "服务端应收到完整内容");
    }

    #[test]
    fn encode_path_segments_keeps_slashes() {
        assert_eq!(encode_path_segments("a/b/c"), "a/b/c");
        // 分隔符不能被编码成 %2F，否则服务端会当成文件名的一部分
        assert!(!encode_path_segments("a/b").contains("%2F"));
    }

    #[test]
    fn encode_path_segments_escapes_spaces_and_cjk() {
        assert_eq!(encode_path_segments("my folder"), "my%20folder");
        assert_eq!(encode_path_segments("图片"), "%E5%9B%BE%E7%89%87");
        assert_eq!(
            encode_path_segments("我的 图片/截图"),
            "%E6%88%91%E7%9A%84%20%E5%9B%BE%E7%89%87/%E6%88%AA%E5%9B%BE"
        );
    }

    #[test]
    fn encode_path_segments_preserves_empty_segments() {
        assert_eq!(encode_path_segments(""), "");
        assert_eq!(encode_path_segments("a//b"), "a//b");
    }

    #[test]
    fn normalize_dir_strips_surrounding_slashes() {
        assert_eq!(normalize_dir("/images/"), "images");
        assert_eq!(normalize_dir("images"), "images");
        assert_eq!(normalize_dir("  /a/b/  "), "a/b");
        assert_eq!(normalize_dir("/"), "");
        assert_eq!(normalize_dir(""), "");
    }

    #[test]
    fn join_url_handles_slash_combinations() {
        assert_eq!(join_url("https://d.com/dav", "a.png"), "https://d.com/dav/a.png");
        assert_eq!(join_url("https://d.com/dav/", "a.png"), "https://d.com/dav/a.png");
        assert_eq!(join_url("https://d.com/dav/", "/a.png"), "https://d.com/dav/a.png");
        assert_eq!(join_url("https://d.com/dav", ""), "https://d.com/dav");
    }

    #[test]
    fn render_public_url_substitutes_all_variables() {
        assert_eq!(
            render_public_url("{domain}/{path}", "https://cdn.example.com", "img/a.png", "a.png"),
            "https://cdn.example.com/img/a.png"
        );
        // OpenList / Alist 形态
        assert_eq!(
            render_public_url("{domain}/d/pic/{path}", "https://ol.example.com/", "img/a.png", "a.png"),
            "https://ol.example.com/d/pic/img/a.png"
        );
        // 只用文件名的场景（公开域名已直接指向图片目录）
        assert_eq!(
            render_public_url("{domain}/{filename}", "https://cdn.example.com", "img/a.png", "a.png"),
            "https://cdn.example.com/a.png"
        );
    }

    #[test]
    fn render_public_url_keeps_encoded_path_intact() {
        // 模板渲染不得二次编码：%20 变成 %2520 就会 404
        let rendered = render_public_url(
            "{domain}/{path}",
            "https://cdn.example.com",
            "img/my%20photo.png",
            "my%20photo.png",
        );
        assert_eq!(rendered, "https://cdn.example.com/img/my%20photo.png");
        assert!(!rendered.contains("%2520"));
    }

    #[test]
    fn guess_content_type_covers_common_images() {
        assert_eq!(guess_content_type("a.png"), "image/png");
        assert_eq!(guess_content_type("a.JPG"), "image/jpeg");
        assert_eq!(guess_content_type("a.jpeg"), "image/jpeg");
        assert_eq!(guess_content_type("a.webp"), "image/webp");
        assert_eq!(guess_content_type("a.unknown"), "application/octet-stream");
        assert_eq!(guess_content_type("noext"), "application/octet-stream");
    }

    #[test]
    fn describe_status_maps_documented_failures() {
        assert!(describe_status(401, None).contains("认证失败"));
        assert!(describe_status(403, None).contains("认证失败"));
        assert!(describe_status(404, None).contains("路径不存在"));
        assert!(describe_status(507, None).contains("空间"));
        assert!(describe_status(502, None).contains("服务器错误"));
    }

    /// 按给定的若干条 `WWW-Authenticate` 头造一个 HeaderMap
    ///
    /// 用 `append` 而非 `insert`：要造出「多个同名 header」这个正是本判据要处理的形态。
    fn challenge_headers(values: &[&str]) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        for value in values {
            headers.append(
                reqwest::header::WWW_AUTHENTICATE,
                reqwest::header::HeaderValue::from_str(value).unwrap(),
            );
        }
        headers
    }

    #[test]
    fn digest_only_401_points_at_digest_instead_of_password() {
        let headers = challenge_headers(&["Digest realm=\"nas\", qop=\"auth\", nonce=\"abc\""]);
        let msg = describe_status(401, Some(&headers));
        assert!(msg.contains("Digest"), "应指向 Digest，实际: {}", msg);
        assert!(
            !msg.contains("检查用户名和密码"),
            "不该再引导用户核对密码: {}",
            msg
        );
    }

    #[test]
    fn basic_offered_keeps_password_wording() {
        // 服务端只要提供了 Basic，401 就是真的密码错——不能扯 Digest
        for values in [
            vec!["Basic realm=\"nas\""],
            // 同一条 header 里逗号分隔两种方案
            vec!["Basic realm=\"nas\", Digest realm=\"nas\", qop=\"auth\""],
            // 两条同名 header，Digest 排在前面：`get()` 只看第一条会在这里误判
            vec!["Digest realm=\"nas\", qop=\"auth\"", "Basic realm=\"nas\""],
        ] {
            let headers = challenge_headers(&values);
            let msg = describe_status(401, Some(&headers));
            assert_eq!(msg, WEBDAV_AUTH_FAILED_MESSAGE, "误判于: {:?}", values);
        }
    }

    #[test]
    fn digest_detection_is_case_insensitive() {
        for value in ["digest realm=\"x\"", "DIGEST realm=\"x\"", "DiGeSt realm=\"x\""] {
            let headers = challenge_headers(&[value]);
            assert!(
                describe_status(401, Some(&headers)).contains("Digest"),
                "大小写变体未识别: {}",
                value
            );
        }
    }

    #[test]
    fn realm_text_is_not_mistaken_for_a_scheme() {
        // realm 内容里出现 "Basic" 不代表服务端支持 Basic——只取每段首个 token
        let headers = challenge_headers(&["Digest realm=\"Basic Zone\", qop=\"auth\""]);
        assert!(describe_status(401, Some(&headers)).contains("Digest"));
    }

    #[test]
    fn status_403_never_reads_the_challenge() {
        // 403 是「认过了但没权限」，不带方案协商；对它读 WWW-Authenticate 只会误报
        let headers = challenge_headers(&["Digest realm=\"nas\""]);
        assert_eq!(
            describe_status(403, Some(&headers)),
            WEBDAV_AUTH_FAILED_MESSAGE
        );
    }

    #[test]
    fn missing_or_unknown_challenge_falls_back_to_password_wording() {
        let empty = reqwest::header::HeaderMap::new();
        assert_eq!(
            describe_status(401, Some(&empty)),
            WEBDAV_AUTH_FAILED_MESSAGE
        );

        // 未知方案（如 Negotiate）不该被当成 Digest
        let negotiate = challenge_headers(&["Negotiate"]);
        assert_eq!(
            describe_status(401, Some(&negotiate)),
            WEBDAV_AUTH_FAILED_MESSAGE
        );
    }

    /// 真机 HTTP 栈下，两条同名 `WWW-Authenticate` 必须都能被看到
    ///
    /// Why 光有 HeaderMap 单测不够：那是我们自己 `append` 出来的形态。这条要证明的是
    /// **reqwest / hyper 不会把重复的同名 header 合并或只保留一条**——如果它合并了，
    /// `get_all()` 拿到的就和 `get()` 一样，多 header 的判据在真机上静默失效，
    /// 而单测依然全绿。服务端把 Basic 和 Digest 拆两条发是 RFC 7235 允许的形态。
    #[tokio::test]
    async fn duplicate_challenge_headers_survive_the_http_stack() {
        use axum::{routing::any, Router};

        let app = Router::new().route(
            "/dav",
            any(|| async {
                axum::response::Response::builder()
                    .status(axum::http::StatusCode::UNAUTHORIZED)
                    // Digest 在前、Basic 在后：只看第一条的实现会在这里误判
                    .header("WWW-Authenticate", "Digest realm=\"nas\", qop=\"auth\"")
                    .header("WWW-Authenticate", "Basic realm=\"nas\"")
                    .body(axum::body::Body::empty())
                    .expect("构造响应失败")
            }),
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定本地端口失败");
        let addr = listener.local_addr().expect("获取本地地址失败");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let response = reqwest::Client::new()
            .get(format!("http://{}/dav", addr))
            .send()
            .await
            .expect("请求失败");

        let challenge = parse_auth_challenge(response.headers());
        server.abort();

        assert!(challenge.has_digest, "应看到 Digest");
        assert!(
            challenge.has_basic,
            "第二条 header 里的 Basic 被吞了——多 header 判据在真机上会失效"
        );
        assert!(!challenge.is_digest_only());
        assert_eq!(
            describe_status(401, Some(response.headers())),
            WEBDAV_AUTH_FAILED_MESSAGE
        );
    }

    #[test]
    fn basic_auth_preserves_credentials() {
        let auth = basic_auth("user ", " pass ");
        let decoded = String::from_utf8(
            STANDARD
                .decode(auth.strip_prefix("Basic ").unwrap())
                .unwrap(),
        )
        .unwrap();
        assert_eq!(decoded, "user : pass ");
    }
}
