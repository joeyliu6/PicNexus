// src-tauri/src/commands/system.rs
// 系统与本机服务相关命令：打开日志目录、取可执行文件路径、端口探测、
// 编辑器兼容 Server 的状态查询与配置下发

use crate::error::AppError;
use crate::portable;
use crate::server;
use crate::{HttpClient, ServerState};
use std::sync::Arc;

/// 打开日志目录
#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> Result<(), AppError> {
    let log_dir = portable::log_dir(&app)?;
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| AppError::file_io(format!("无法创建日志目录: {}", e)))?;
    opener::open(&log_dir).map_err(|e| AppError::file_io(format!("无法打开日志目录: {}", e)))?;
    Ok(())
}

/// 返回当前可执行文件的绝对路径（用于 Typora 自定义命令配置提示）
#[tauri::command]
pub fn get_executable_path() -> Result<String, AppError> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| AppError::file_io(format!("无法获取可执行文件路径: {}", e)))
}

#[tauri::command]
pub async fn check_port_free(port: u16) -> bool {
    server::is_port_free(port).await
}

/// 从 Rust 侧探测编辑器兼容 Server 的 `/status`，返回原始 JSON 文本
///
/// Why 不让前端直接 `fetch('http://127.0.0.1:<port>/status')`：`/status` 故意不带
/// `Access-Control-Allow-Origin`（防止任意网页探测本机是否在跑 PicNexus，见
/// `server::tests::public_status_does_not_emit_cors_headers`），设置页 webview 与该端口
/// 不同源，浏览器会把这次 fetch 当成跨域请求直接拦掉——`npm run tauri dev` 下前端跑在
/// `localhost:1420`，打包后 webview 走自定义协议，两种情况都命中同一条 CORS 规则。
/// Rust 侧发起的请求不经过浏览器，天然不受 CORS 约束。
#[tauri::command]
pub async fn check_editor_server_status(
    port: u16,
    http_client: tauri::State<'_, HttpClient>,
) -> Result<String, AppError> {
    let response = http_client
        .0
        .get(format!("http://127.0.0.1:{}/status", port))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| AppError::network(format!("连接失败: {}", e)))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| AppError::network(format!("读取响应失败: {}", e)))?;

    if !status.is_success() {
        return Err(AppError::network(format!("HTTP {}", status.as_u16())));
    }

    Ok(body)
}

/// 更新编辑器兼容 Server 配置（由前端调用）
///
/// - enabled: 是否启动 Server
/// - port: 监听端口（默认 36799）
/// - service_config_json: Server 专用图床配置的 JSON 字符串（ServerUploadConfig 枚举）
///   格式示例: {"type":"jd"} | {"type":"github","token":"...","owner":"...","repo":"...","branch":"main","path":"images/"}
///   传 null 时清空配置（Server 收到请求会提示未配置图床）
#[tauri::command]
pub async fn update_server_config(
    state: tauri::State<'_, ServerState>,
    enabled: bool,
    port: u16,
    service_config_json: Option<String>,
    auth_token: Option<String>,
) -> Result<String, AppError> {
    let normalized_auth_token = auth_token
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty());

    // 1. 更新图床配置
    {
        let mut config = state.upload_config.lock().await;
        if let Some(ref json) = service_config_json {
            match serde_json::from_str::<server::ServerUploadConfig>(json) {
                Ok(parsed) => {
                    *config = Some(parsed);
                    log::info!("[Server] 图床配置已更新");
                }
                Err(e) => {
                    return Err(AppError::config(format!("Server 配置解析失败: {}", e)));
                }
            }
        } else {
            *config = None;
        }
    }
    {
        let mut token = state.auth_token.lock().await;
        *token = normalized_auth_token;
    }

    // 2. 停止当前运行的 Server（如有），等待端口释放
    {
        let abort_handle = {
            let mut handle = state
                .abort_handle
                .lock()
                .map_err(|_| AppError::external("锁定 abort_handle 失败"))?;
            handle.take()
        };
        if let Some(h) = abort_handle {
            h.abort();
            log::info!("[Server] 旧 Server 已停止");
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }

    // 3. 如果 enabled，两阶段启动：先 bind（同步等结果），再 spawn serve
    if enabled {
        let listener = server::bind_server(port)
            .await
            .map_err(AppError::external)?;

        let config_arc = Arc::clone(&state.upload_config);
        let auth_token_arc = Arc::clone(&state.auth_token);
        let task = tokio::task::spawn(async move {
            if let Err(e) = server::run_server(listener, config_arc, auth_token_arc).await {
                log::error!("[Server] 运行失败: {}", e);
            }
        });

        let mut handle = state
            .abort_handle
            .lock()
            .map_err(|_| AppError::external("锁定 abort_handle 失败"))?;
        *handle = Some(task.abort_handle());

        log::info!("[Server] 编辑器兼容 Server 已启动，端口: {}", port);
        Ok(format!("Server 已在端口 {} 启动", port))
    } else {
        log::info!("[Server] 编辑器兼容 Server 已停止");
        Ok("Server 已停止".to_string())
    }
}
