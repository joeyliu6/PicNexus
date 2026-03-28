// src-tauri/src/server/mod.rs
// PicGo 兼容 HTTP Server
// 监听 127.0.0.1:{port}，提供 POST /upload 接口
// 兼容 Typora、Obsidian 等编辑器的图片上传

pub mod upload_handler;

use axum::{Router, routing::{get, post}};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

pub use upload_handler::ServerUploadConfig;

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
    config: Arc<Mutex<Option<ServerUploadConfig>>>,
) -> Result<(), String> {
    let app = Router::new()
        .route("/upload", post(upload_handler::handle_upload))
        .route("/upload/file", post(upload_handler::handle_file_upload))
        .route("/status", get(upload_handler::handle_status))
        .with_state(config)
        .layer(CorsLayer::permissive());

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
