// src-tauri/src/server/mod.rs
// PicGo 兼容 HTTP Server
// 监听 127.0.0.1:{port}，提供 POST /upload 接口
// 兼容 Typora、Obsidian 等编辑器的图片上传

pub mod upload_handler;

use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderName, Method},
    middleware,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};

pub use upload_handler::ServerUploadConfig;

#[derive(Clone)]
pub struct ServerRuntimeState {
    pub upload_config: Arc<Mutex<Option<ServerUploadConfig>>>,
    pub auth_token: Arc<Mutex<Option<String>>>,
}

fn build_router(state: ServerRuntimeState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-filename"),
            HeaderName::from_static(upload_handler::SERVER_AUTH_TOKEN_HEADER),
        ]);

    let protected_routes = Router::new()
        .route("/upload", post(upload_handler::handle_upload))
        .route(
            "/upload/file",
            post(upload_handler::handle_file_upload).layer(DefaultBodyLimit::max(
                upload_handler::MAX_SERVER_UPLOAD_SIZE,
            )),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            upload_handler::require_upload_auth,
        ))
        .layer(cors);

    Router::new()
        .route("/status", get(upload_handler::handle_status))
        .merge(protected_routes)
        .with_state(state)
}

/// 绑定端口，返回 TcpListener
/// 失败表示端口被占用或无权限
pub async fn bind_server(port: u16) -> Result<TcpListener, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpListener::bind(addr)
        .await
        .map_err(|e| format!("无法绑定端口 {}（可能已被占用）: {}", port, e))
}

/// 在已绑定的 listener 上运行 HTTP Server
pub async fn run_server(
    listener: TcpListener,
    upload_config: Arc<Mutex<Option<ServerUploadConfig>>>,
    auth_token: Arc<Mutex<Option<String>>>,
) -> Result<(), String> {
    let state = ServerRuntimeState {
        upload_config,
        auth_token,
    };
    let app = build_router(state);

    log::info!("[Server] ✓ 编辑器兼容 Server 已启动");

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server 运行失败: {}", e))?;

    Ok(())
}

/// 检测端口是否空闲（尝试 bind 后立即释放）
pub async fn is_port_free(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpListener::bind(addr).await.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{header::ACCESS_CONTROL_ALLOW_ORIGIN, Request, StatusCode},
    };
    use tower::ServiceExt;

    fn test_state() -> ServerRuntimeState {
        ServerRuntimeState {
            upload_config: Arc::new(Mutex::new(None)),
            auth_token: Arc::new(Mutex::new(Some("test-token".to_string()))),
        }
    }

    #[tokio::test]
    async fn public_status_does_not_emit_cors_headers() {
        let response = build_router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/status")
                    .header(header::ORIGIN, "https://example.com")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response
            .headers()
            .get(ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    #[tokio::test]
    async fn protected_upload_preflight_keeps_cors_support() {
        let response = build_router(test_state())
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/upload")
                    .header(header::ORIGIN, "https://example.com")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response
            .headers()
            .get(ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_some());
    }

    // ==================== /upload/file → WebDAV 全链路 ====================
    //
    // Why 这几条值得单独存在：Obsidian 插件走的就是 `/upload/file`（`uploadByContent`），
    // 而此前这条链路只验到 `/status` 能认出 WebDAV 配置，真实的上传 POST 从未跑过，
    // 理由记的是「要么装 Obsidian 真粘一张图，要么拿认证 Token 模拟请求」。
    // 后半句其实不成立——`require_upload_auth` 在请求不带 `Origin` 时直接放行，
    // 而插件恰恰不带（`requestUrl` 不是浏览器 fetch）。真正的障碍只是「Server 得靠 GUI 启动」，
    // 用 `oneshot` 打 Router 就绕过去了：路由、中间件、handler 三段都真实执行。

    /// 假 WebDAV 服务端收到的一次请求
    #[derive(Debug, Clone)]
    struct CapturedRequest {
        method: String,
        path: String,
        authorization: Option<String>,
        body_len: usize,
    }

    type RequestLog = Arc<std::sync::Mutex<Vec<CapturedRequest>>>;

    fn tiny_png() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(1, 1, image::Rgba([0, 0, 0, 0]));
        let mut cursor = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, image::ImageFormat::Png)
            .expect("tiny PNG should encode");
        cursor.into_inner()
    }

    /// 起一个照单全收的假 WebDAV 服务端，把每次请求记进日志
    async fn spawn_fake_webdav() -> (String, RequestLog, tokio::task::JoinHandle<()>) {
        use axum::{extract::State as AxumState, routing::any};

        let log: RequestLog = Arc::new(std::sync::Mutex::new(Vec::new()));

        async fn capture(
            AxumState(log): AxumState<RequestLog>,
            method: Method,
            uri: axum::http::Uri,
            headers: axum::http::HeaderMap,
            body: axum::body::Bytes,
        ) -> StatusCode {
            log.lock().expect("请求日志加锁失败").push(CapturedRequest {
                method: method.to_string(),
                path: uri.path().to_string(),
                authorization: headers
                    .get(header::AUTHORIZATION)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string),
                body_len: body.len(),
            });
            // MKCOL 与 PUT 都回 201：建目录和写文件在 WebDAV 里都算这个
            StatusCode::CREATED
        }

        let app = Router::new()
            .fallback(any(capture))
            .with_state(Arc::clone(&log));

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("绑定本地端口失败");
        let addr = listener.local_addr().expect("获取本地地址失败");
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        (format!("http://{}", addr), log, handle)
    }

    fn webdav_state(endpoint: &str) -> ServerRuntimeState {
        ServerRuntimeState {
            upload_config: Arc::new(Mutex::new(Some(ServerUploadConfig::Webdav {
                url: endpoint.to_string(),
                username: "u".to_string(),
                password: "p".to_string(),
                remote_path: "pics".to_string(),
                public_domain: endpoint.to_string(),
                public_url_template: "{domain}/{path}".to_string(),
                // 回环地址由 url_policy 无条件放行，不需要用户确认明文 HTTP
                lan_http_confirmed: false,
                unique_file_name: true,
            }))),
            auth_token: Arc::new(Mutex::new(Some("test-token".to_string()))),
        }
    }

    /// 「我的 图.png」的 percent-encode 形态，模仿 Obsidian 传中文/空格文件名
    const ENCODED_NAME: &str = "%E6%88%91%E7%9A%84%20%E5%9B%BE.png";
    /// 去掉扩展名的那一段，用来在远端路径里找它
    const ENCODED_STEM: &str = "%E6%88%91%E7%9A%84%20%E5%9B%BE";

    async fn read_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("读取响应体失败");
        serde_json::from_slice(&bytes).expect("响应不是合法 JSON")
    }

    /// Obsidian 的请求形态（裸二进制 + X-Filename，无 Origin 无 token）能一路走到 WebDAV
    #[tokio::test]
    async fn file_upload_reaches_webdav_without_any_token() {
        let (endpoint, log, server) = spawn_fake_webdav().await;
        let png = tiny_png();

        let response = build_router(webdav_state(&endpoint))
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/upload/file")
                    .header(header::CONTENT_TYPE, "image/png")
                    .header("X-Filename", ENCODED_NAME)
                    .body(Body::from(png.clone()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let json = read_json(response).await;
        server.abort();

        assert_eq!(
            json["success"], true,
            "上传失败了，message: {}", json["message"]
        );

        let captured = log.lock().expect("请求日志加锁失败").clone();

        // ① 建目录在前、写文件在后
        assert!(
            captured.iter().any(|r| r.method == "MKCOL" && r.path.contains("pics")),
            "没有先建远程目录，实际请求: {:?}",
            captured
        );
        let put = captured
            .iter()
            .find(|r| r.method == "PUT")
            .expect("没有发出 PUT");

        // ② 凭证真的从 ServerUploadConfig 走到了线上（"u:p" 的 base64）
        assert_eq!(
            put.authorization.as_deref(),
            Some("Basic dTpw"),
            "Authorization 不对，凭证没走通"
        );

        // ③ 图片字节完整送达，不是空 body
        assert_eq!(put.body_len, png.len(), "PUT 的字节数与源文件对不上");

        // ④ 中文与空格被 percent-encode 且没有二次编码；唯一后缀也加上了
        assert!(
            put.path.contains(ENCODED_STEM),
            "远端路径没有正确编码中文/空格: {}",
            put.path
        );
        assert!(
            !put.path.contains("%2520"),
            "路径被二次编码了（%20 变成 %2520），服务端会 404: {}",
            put.path
        );
        assert!(
            put.path != format!("/pics/{}", ENCODED_NAME),
            "文件名没加唯一后缀——Obsidian 粘贴出来的图基本都叫 image.png，会互相覆盖"
        );
        assert!(put.path.ends_with(".png"), "扩展名丢了: {}", put.path);

        // ⑤ 返回给编辑器的公开链接与实际写入位置一致
        let url = json["result"][0].as_str().expect("响应里没有 URL");
        assert_eq!(
            url,
            format!("{}{}", endpoint, put.path),
            "公开链接指向的位置和实际 PUT 的位置对不上"
        );
    }

    /// 免 token 是给非浏览器客户端的精准豁免，不是全放
    ///
    /// 带 `Origin` 就说明请求来自网页，此时必须有 token——否则任意网页都能
    /// 借用户的图床往外传图。
    #[tokio::test]
    async fn browser_origin_without_token_is_still_rejected() {
        let (endpoint, log, server) = spawn_fake_webdav().await;

        let response = build_router(webdav_state(&endpoint))
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/upload/file")
                    .header(header::ORIGIN, "https://evil.example")
                    .header(header::CONTENT_TYPE, "image/png")
                    .header("X-Filename", ENCODED_NAME)
                    .body(Body::from(tiny_png()))
                    .unwrap(),
            )
            .await
            .unwrap();

        let status = response.status();
        let captured = log.lock().expect("请求日志加锁失败").clone();
        server.abort();

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(
            captured.is_empty(),
            "请求被拒了却还是打到了 WebDAV 服务端: {:?}",
            captured
        );
    }
}
