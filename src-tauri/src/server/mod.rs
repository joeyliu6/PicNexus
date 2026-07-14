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
}
