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

/// 启动 HTTP Server
/// 返回 Err 表示端口绑定失败（通常是端口被占用）
pub async fn start_server(
    port: u16,
    config: Arc<Mutex<Option<ServerUploadConfig>>>,
) -> Result<(), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("无法绑定端口 {}（可能已被占用）: {}", port, e))?;

    log::info!("[Server] ✓ 编辑器兼容 Server 已启动，监听 http://127.0.0.1:{}", port);

    let app = Router::new()
        .route("/upload", post(upload_handler::handle_upload))
        .route("/upload/file", post(upload_handler::handle_file_upload))
        .route("/status", get(upload_handler::handle_status))
        .with_state(config)
        .layer(CorsLayer::permissive());

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("Server 运行失败: {}", e))?;

    Ok(())
}
