// src-tauri/src/commands/utils.rs
// 通用工具函数命令

use std::path::Path;

/**
 * 检查文件是否存在
 *
 * @param path 文件路径
 * @return 文件是否存在
 */
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}
