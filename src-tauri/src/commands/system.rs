// src-tauri/src/commands/system.rs
// 系统与本机服务相关命令：打开日志目录、取可执行文件路径、端口探测、
// 编辑器兼容 Server 的状态查询与配置下发

use crate::error::AppError;
use crate::portable;
use crate::server;

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
