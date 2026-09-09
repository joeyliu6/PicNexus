// src-tauri/src/commands/app_paths.rs
// 应用数据路径查询命令：便携模式判定、用户数据目录、历史库路径
//
// 三条命令都只是 `portable` 模块的薄封装，路径规则的真相在 `crate::portable`。

use crate::error::AppError;
use crate::portable;

#[tauri::command]
pub fn is_portable_mode() -> bool {
    portable::is_portable()
}

#[tauri::command]
pub fn get_user_data_dir(app: tauri::AppHandle) -> Result<String, AppError> {
    Ok(portable::user_data_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_history_db_path() -> String {
    portable::history_db_url()
}
