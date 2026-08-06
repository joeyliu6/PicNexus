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

use super::utils::read_file_bytes;
use crate::error::AppError;
use crate::log_utils::safe_path;
use crate::url_policy::validate_webdav_url;

/// 文件大小限制：50MB
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

/// 单次 WebDAV 请求超时
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 短操作（PROPFIND / MKCOL / DELETE）超时
const SHORT_TIMEOUT: Duration = Duration::from_secs(15);

/// 1×1 透明 PNG，用作连接测试的探针图片
const PROBE_PNG_BASE64: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

#[derive(Debug, Serialize, Deserialize)]
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
pub struct WebDAVTestResult {
    pub success: bool,
    pub message: String,
    /// 探针图片的公开 URL，便于用户自查
    pub probe_url: Option<String>,
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

/// 把 HTTP 状态码翻译成用户看得懂的失败原因
fn describe_status(status: u16) -> String {
    match status {
        401 | 403 => "认证失败，请检查用户名和密码".to_string(),
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
    format!(
        "Basic {}",
        STANDARD.encode(format!("{}:{}", username.trim(), password.trim()))
    )
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
            return Err(AppError::webdav(describe_status(status)));
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
        return Err(AppError::webdav(describe_status(status)));
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
) -> Result<WebDAVUploadResult, AppError> {
    log::info!("[WebDAV] 开始上传文件: {}", safe_path(&file_path));

    // 1. 校验地址（WebDAV 策略：允许局域网，拒绝链路本地与公网明文 HTTP）
    validate_webdav_url(&url)?;
    if public_domain.trim().is_empty() {
        return Err(AppError::config(
            "公开访问域名不能为空——WebDAV 端点通常需要认证，无法直接作为图片链接",
        ));
    }
    validate_webdav_url(&public_domain)?;

    emit_progress(&window, &id, 0, "读取文件...", 1, 3);

    // 2. 读取文件
    let (buffer, file_size) = read_file_bytes(&file_path, MAX_FILE_SIZE).await?;
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法解析文件名"))?
        .to_string();

    log::debug!("[WebDAV] 文件大小: {} bytes", file_size);

    let client = reqwest::Client::new();
    let auth = basic_auth(&username, &password);
    let dir = normalize_dir(&remote_path);

    emit_progress(&window, &id, 30, "创建远程目录...", 2, 3);

    // 3. 建目录
    ensure_remote_dir(&client, &url, &dir, &auth).await?;

    emit_progress(&window, &id, 60, "正在上传...", 3, 3);

    // 4. 二进制 PUT
    let encoded_file_name = urlencoding::encode(&file_name).into_owned();
    let encoded_path = if dir.is_empty() {
        encoded_file_name.clone()
    } else {
        format!("{}/{}", encode_path_segments(&dir), encoded_file_name)
    };
    let target_url = join_url(&url, &encoded_path);

    put_binary(
        &client,
        &target_url,
        &auth,
        buffer,
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
) -> Result<WebDAVTestResult, AppError> {
    validate_webdav_url(&url)?;
    if public_domain.trim().is_empty() {
        return Err(AppError::config("公开访问域名不能为空"));
    }
    validate_webdav_url(&public_domain)?;

    let client = reqwest::Client::new();
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
        return Err(AppError::webdav(describe_status(status)));
    }

    // 2. 上传探针图
    let probe_name = format!(".picnexus-probe-{}.png", std::process::id());
    let encoded_probe_name = urlencoding::encode(&probe_name).into_owned();
    let encoded_path = if dir.is_empty() {
        encoded_probe_name.clone()
    } else {
        format!("{}/{}", encode_path_segments(&dir), encoded_probe_name)
    };

    ensure_remote_dir(&client, &url, &dir, &auth).await?;

    let probe_bytes = STANDARD
        .decode(PROBE_PNG_BASE64)
        .map_err(|_| AppError::webdav("探针图片解码失败"))?;

    put_binary(
        &client,
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
                    probe_url: Some(probe_url),
                });
            }

            if !content_type.starts_with("image/") {
                return Ok(WebDAVTestResult {
                    success: false,
                    message: format!(
                        "公开链接返回的不是图片 (Content-Type: {})——多半是模板指向了登录页或分享页",
                        if content_type.is_empty() { "未知" } else { &content_type }
                    ),
                    probe_url: Some(probe_url),
                });
            }

            Ok(WebDAVTestResult {
                success: true,
                message: "连接成功，公开链接可正常访问".to_string(),
                probe_url: Some(probe_url),
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
            probe_url: Some(probe_url),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(describe_status(401).contains("认证失败"));
        assert!(describe_status(403).contains("认证失败"));
        assert!(describe_status(404).contains("路径不存在"));
        assert!(describe_status(507).contains("空间"));
        assert!(describe_status(502).contains("服务器错误"));
    }
}
