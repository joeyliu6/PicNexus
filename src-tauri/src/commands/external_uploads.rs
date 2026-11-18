// src-tauri/src/commands/external_uploads.rs
// 主界面取「待入库」的软件外上传、写进历史库后删掉。收件箱本身见 crate::external_uploads。

use crate::error::AppError;
use crate::external_uploads::{self, ExternalUpload};
use crate::portable;

/// 列出还没写进历史库的软件外上传（按时间先后）
#[tauri::command]
pub fn list_external_uploads(app: tauri::AppHandle) -> Result<Vec<ExternalUpload>, AppError> {
    external_uploads::list_entries(&portable::user_data_dir(&app)?).map_err(AppError::file_io)
}

/// 删掉已经写进历史库的那几条
#[tauri::command]
pub fn remove_external_uploads(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), AppError> {
    external_uploads::remove_entries(&portable::user_data_dir(&app)?, &ids).map_err(AppError::file_io)
}
