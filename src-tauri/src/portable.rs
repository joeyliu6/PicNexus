use std::path::PathBuf;
use std::process::Stdio;

use crate::error::AppError;
use tauri::Manager;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PORTABLE_DATA_DIR: &str = "data";
const PORTABLE_MARKER: &str = "portable.json";

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
}

pub fn portable_root() -> Option<PathBuf> {
    let dir = exe_dir()?;
    let marker = dir.join(PORTABLE_DATA_DIR).join(PORTABLE_MARKER);
    marker.exists().then_some(dir)
}

pub fn is_portable() -> bool {
    portable_root().is_some()
}

pub fn portable_data_dir() -> Option<PathBuf> {
    portable_root().map(|root| root.join(PORTABLE_DATA_DIR))
}

pub fn user_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    if let Some(dir) = portable_data_dir() {
        return Ok(dir);
    }

    app.path()
        .app_data_dir()
        .map_err(|e| AppError::file_io(format!("无法获取应用数据目录: {}", e)))
}

pub fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    if let Some(dir) = portable_data_dir() {
        return Ok(dir.join("logs"));
    }

    app.path()
        .app_log_dir()
        .map_err(|e| AppError::file_io(format!("无法获取日志目录: {}", e)))
}

pub fn history_db_url() -> String {
    match portable_data_dir() {
        Some(dir) => format!("sqlite:{}", dir.join("history.db").display()),
        None => "sqlite:history.db".to_string(),
    }
}

pub fn secure_key_path() -> Option<PathBuf> {
    portable_data_dir().map(|dir| dir.join("secure-key"))
}

pub fn sidecar_path(base_name: &str) -> Option<PathBuf> {
    let exe_dir = exe_dir()?;

    let exe_name = if cfg!(windows) {
        format!("{base_name}.exe")
    } else {
        base_name.to_string()
    };

    let bin_path = exe_dir.join("bin").join(&exe_name);
    if bin_path.exists() {
        return Some(bin_path);
    }

    let root_path = exe_dir.join(exe_name);
    root_path.exists().then_some(root_path)
}

pub async fn run_sidecar(
    base_name: &str,
    args: &[&str],
    timeout_secs: u64,
) -> Result<(String, String), AppError> {
    let path = sidecar_path(base_name)
        .ok_or_else(|| AppError::external(format!("未找到 sidecar: {}", base_name)))?;

    let mut command = tokio::process::Command::new(&path);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        command.output(),
    )
    .await
    .map_err(|_| AppError::network(format!("sidecar 超时: {}", base_name)))?
    .map_err(|e| AppError::external(format!("启动 sidecar 失败: {} ({})", base_name, e)))?;

    log::debug!("[Sidecar] {} exited: {:?}", base_name, output.status.code());

    Ok((
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    ))
}
