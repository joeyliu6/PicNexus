// src-tauri/src/commands/webdav_backup.rs
// 备份链路的 WebDAV：连接测试与通用请求转发
//
// 与 `commands::webdav_upload`（WebDAV 图床）是**两套独立配置、两条独立链路**，
// 不要合并：这里的 `webdav_request` body 是 `Option<String>`，二进制图片塞进去
// 会被 UTF-8 破坏，所以图床的图片上传另走一条二进制 PUT。
// 401/403 的文案判定则刻意共用 `webdav_upload::describe_status`，避免两处各写一份。

use std::collections::HashMap;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::error::AppError;
use crate::url_policy::validate_webdav_url;
use crate::HttpClient;

#[derive(serde::Deserialize, Clone)]
pub struct WebDAVConfig {
    url: String,
    username: String,
    password: String,
    #[allow(dead_code)]
    #[serde(rename = "remotePath")]
    remote_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDAVRequest {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
pub struct WebDAVResponse {
    status: u16,
    body: Option<String>,
}

#[tauri::command]
pub async fn test_webdav_connection(
    config: WebDAVConfig,
    http_client: tauri::State<'_, HttpClient>,
) -> Result<String, AppError> {
    probe_webdav_connection(&http_client.0, &config).await
}

/// 备份 WebDAV 连接测试的核心逻辑（不含 Tauri 上下文）
///
/// Why 从命令里拆出来：命令收 `tauri::State<HttpClient>`，单测造不出那个类型，
/// 于是 401 分支长期没有测试兜着。拆法与 `webdav_upload::upload_to_webdav_core` 一致——
/// 命令壳只负责取出 client 再转调，IPC 签名不变。
async fn probe_webdav_connection(
    client: &reqwest::Client,
    config: &WebDAVConfig,
) -> Result<String, AppError> {
    if config.url.is_empty() || config.username.is_empty() || config.password.is_empty() {
        return Err(AppError::config(
            "配置不完整: URL、用户名和密码均为必填项。",
        ));
    }
    let auth_header = format!(
        "Basic {}",
        STANDARD.encode(format!("{}:{}", config.username, config.password))
    );

    let response = client
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").unwrap(),
            &config.url,
        )
        .header("Authorization", auth_header)
        .header("Depth", "0")
        .send()
        .await;

    match response {
        Ok(res) => {
            let status = res.status();
            let code = status.as_u16();
            if status.is_success() || code == 207 {
                Ok("WebDAV 连接成功！".to_string())
            } else if code == 401 || code == 403 {
                // 与图床链路共用同一个 `describe_status`：401 时读 `WWW-Authenticate`，
                // 服务端只提供 Digest 就换专属文案，不再把认证方式不匹配的用户
                // 支去反复核对本来就没错的密码。
                //
                // 共用而非各写一份，是为了让两条链路的文案不可能漂移——这个位置
                // 此前就漂移成了「认证失败: 用户名或密码错误」（带冒号的另一句）。
                Err(AppError::webdav(
                    super::webdav_upload::describe_status(code, Some(res.headers())),
                ))
            } else if status == reqwest::StatusCode::NOT_FOUND {
                Err(AppError::webdav("URL 未找到，请检查链接是否正确"))
            } else {
                Err(AppError::webdav(format!("服务器返回状态 {}", status)))
            }
        }
        Err(err) => {
            if err.is_connect() {
                Err(AppError::webdav("无法连接到服务器，请检查 URL 或网络"))
            } else if err.is_timeout() {
                Err(AppError::webdav("请求超时"))
            } else {
                Err(AppError::webdav(format!("连接失败: {}", err)))
            }
        }
    }
}

#[tauri::command]
pub async fn webdav_request(
    request: WebDAVRequest,
    http_client: tauri::State<'_, HttpClient>,
) -> Result<WebDAVResponse, AppError> {
    let url = validate_webdav_url(&request.url)?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| AppError::webdav("WebDAV 请求方法无效"))?;
    let propfind = reqwest::Method::from_bytes(b"PROPFIND").unwrap();
    let mkcol = reqwest::Method::from_bytes(b"MKCOL").unwrap();

    if !matches!(method, reqwest::Method::GET | reqwest::Method::PUT)
        && method != propfind
        && method != mkcol
    {
        return Err(AppError::webdav("WebDAV 请求方法不在允许列表中"));
    }

    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(30_000).clamp(1_000, 60_000));
    let mut builder = http_client.0.request(method, url).timeout(timeout);

    if let Some(headers) = request.headers {
        for (name, value) in headers {
            let normalized = name.to_ascii_lowercase();
            if matches!(
                normalized.as_str(),
                "authorization" | "depth" | "overwrite" | "content-type"
            ) {
                builder = builder.header(name, value);
            }
        }
    }

    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|err| {
        if err.is_connect() {
            AppError::webdav("无法连接到 WebDAV 服务器，请检查 URL 或网络")
        } else if err.is_timeout() {
            AppError::webdav("WebDAV 请求超时")
        } else {
            AppError::webdav(format!("WebDAV 请求失败: {}", err))
        }
    })?;

    let status = response.status().as_u16();
    let body = if request.method.eq_ignore_ascii_case("GET") {
        Some(
            response
                .text()
                .await
                .map_err(|err| AppError::webdav(format!("读取 WebDAV 响应失败: {}", err)))?,
        )
    } else {
        None
    };

    Ok(WebDAVResponse { status, body })
}

#[cfg(test)]
mod webdav_connection_tests {
    use super::*;
    use crate::commands::webdav_upload::{
        WEBDAV_AUTH_FAILED_MESSAGE, WEBDAV_DIGEST_ONLY_MESSAGE, WEBDAV_FORBIDDEN_MESSAGE,
    };
    use axum::{routing::any, Router};

    /// 起一个按指定状态码与 `WWW-Authenticate` 应答的假 WebDAV 服务端
    ///
    /// Why 起真 TCP 而不是直接调 `describe_status`：那个函数已经有 HeaderMap 级单测了
    /// （`webdav_upload.rs` 里 7 条）。这里要证明的是**整条链路**——
    /// `probe_webdav_connection` 真的把响应头交给了判定函数，而不是像改动前那样
    /// 手里握着 `res` 却只看了状态码。
    async fn spawn_stub(
        status: u16,
        challenges: &'static [&'static str],
    ) -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().fallback(any(move || async move {
            let mut builder = axum::response::Response::builder()
                .status(axum::http::StatusCode::from_u16(status).expect("状态码非法"));
            for challenge in challenges {
                builder = builder.header("WWW-Authenticate", *challenge);
            }
            builder
                .body(axum::body::Body::empty())
                .expect("构造响应失败")
        }));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定本地端口失败");
        let addr = listener.local_addr().expect("获取本地地址失败");
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        (format!("http://{}/dav", addr), handle)
    }

    /// 跑一次连接测试，返回用户实际看到的那句话
    ///
    /// 取的是 `AppError::WebDAV` 的 message 本体而不是 `to_string()`——后者会被
    /// Display 实现加上分类前缀，逐字断言就对不上了。
    async fn probe(status: u16, challenges: &'static [&'static str]) -> Result<String, String> {
        let (url, server) = spawn_stub(status, challenges).await;
        let config = WebDAVConfig {
            url,
            username: "user".to_string(),
            password: "pass".to_string(),
            remote_path: "/PicNexus".to_string(),
        };

        let result = probe_webdav_connection(&reqwest::Client::new(), &config).await;
        server.abort();

        match result {
            Ok(message) => Ok(message),
            Err(AppError::WebDAV { message }) => Err(message),
            Err(other) => panic!("期望 WebDAV 错误，实际拿到: {:?}", other),
        }
    }

    /// 服务端只给 Digest → 说清楚是认证方式不匹配，别把用户支去核对没错的密码
    #[tokio::test]
    async fn digest_only_401_points_at_digest_instead_of_password() {
        let message = probe(401, &["Digest realm=\"nas\", qop=\"auth\", nonce=\"deadbeef\""])
            .await
            .expect_err("401 应当报错");

        assert_eq!(message, WEBDAV_DIGEST_ONLY_MESSAGE);
    }

    /// realm 里带逗号 —— `3eee955` 修的就是这个，此前从未在真 HTTP 栈上跑过
    ///
    /// 按逗号裸切会把 `Digest realm="NAS, Basic Zone"` 从中间切断，后半截
    /// `Basic Zone"` 让 `has_basic` 翻成 true，**反而遮掉 Digest 判定**，
    /// 退回它本要消灭的那句通用密码提示。
    #[tokio::test]
    async fn comma_inside_quoted_realm_survives_the_http_stack() {
        let message = probe(401, &["Digest realm=\"NAS, Basic Zone\", qop=\"auth\""])
            .await
            .expect_err("401 应当报错");

        assert_eq!(
            message, WEBDAV_DIGEST_ONLY_MESSAGE,
            "带逗号的 realm 被切断了，Digest 判定失效"
        );
    }

    /// 服务端给 Basic → 密码是真错了，说通用文案
    #[tokio::test]
    async fn basic_offered_keeps_password_wording() {
        let message = probe(401, &["Basic realm=\"nas\""])
            .await
            .expect_err("401 应当报错");

        assert_eq!(
            message, WEBDAV_AUTH_FAILED_MESSAGE,
            "这里改动前是「认证失败: 用户名或密码错误」（带冒号的另一句），\
             与图床链路漂移；现在必须与 webdav_upload 共用同一份定义"
        );
    }

    /// 两条同名 header、Digest 在前 → 仍是「两种都支持」，不能误判成 Digest-only
    #[tokio::test]
    async fn duplicate_headers_do_not_trigger_digest_wording() {
        let message = probe(
            401,
            &["Digest realm=\"nas\", qop=\"auth\"", "Basic realm=\"nas\""],
        )
        .await
        .expect_err("401 应当报错");

        assert_eq!(message, WEBDAV_AUTH_FAILED_MESSAGE);
    }

    /// 403 是「认过了但没权限」：既不读 challenge，也不说密码
    #[tokio::test]
    async fn status_403_points_at_permissions_not_password() {
        let message = probe(403, &["Digest realm=\"nas\", qop=\"auth\""])
            .await
            .expect_err("403 应当报错");

        assert_eq!(
            message, WEBDAV_FORBIDDEN_MESSAGE,
            "403 要么读了 WWW-Authenticate 误报成认证方式不匹配，\
             要么并回了 401 的文案、把有权限问题的用户支去改密码"
        );
    }

    /// 207 Multi-Status 是 PROPFIND 的正常成功码 —— 改 401 分支时最容易误伤这条
    #[tokio::test]
    async fn multi_status_207_is_still_a_success() {
        let message = probe(207, &[]).await.expect("207 应当算连接成功");

        assert_eq!(message, "WebDAV 连接成功！");
    }
}
