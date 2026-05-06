use crate::error::AppError;
use std::path::Path;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

const MAX_TEXT_FILE_BYTES: u64 = 50 * 1024 * 1024;
const OWNED_TEMP_PREFIXES: &[&str] = &["picnexus_url_"];

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDialogFilter {
    name: String,
    extensions: Vec<String>,
}

fn apply_filters<R: Runtime>(
    mut builder: tauri_plugin_dialog::FileDialogBuilder<R>,
    filters: Vec<FileDialogFilter>,
) -> Result<tauri_plugin_dialog::FileDialogBuilder<R>, AppError> {
    for filter in filters {
        if filter.name.trim().is_empty() {
            return Err(AppError::validation("文件类型名称不能为空"));
        }

        let extensions: Vec<&str> = filter
            .extensions
            .iter()
            .map(|ext| ext.trim())
            .filter(|ext| !ext.is_empty())
            .collect();

        if extensions.iter().any(|ext| {
            ext.len() > 16
                || ext.contains(['*', '/', '\\', '\0'])
                || !ext.chars().all(|c| c.is_ascii_alphanumeric())
        }) {
            return Err(AppError::validation("文件扩展名不合法"));
        }

        if !extensions.is_empty() {
            builder = builder.add_filter(filter.name, &extensions);
        }
    }

    Ok(builder)
}

fn selected_path(path: tauri_plugin_dialog::FilePath) -> Result<std::path::PathBuf, AppError> {
    path.into_path()
        .map_err(|e| AppError::file_io(format!("无法解析所选文件路径: {}", e)))
}

fn ensure_text_file_size(path: &Path) -> Result<(), AppError> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| AppError::file_io(format!("无法访问所选文件: {}", e)))?;
    if !metadata.is_file() {
        return Err(AppError::validation("只能读取文件"));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(AppError::validation("文件过大，最多支持 50MB 文本文件"));
    }
    Ok(())
}

#[tauri::command]
pub async fn export_text_file(
    app: AppHandle,
    default_path: String,
    filters: Vec<FileDialogFilter>,
    content: String,
) -> Result<Option<String>, AppError> {
    let default_path = default_path.trim();
    if default_path.is_empty() || default_path.contains(['/', '\\', '\0']) {
        return Err(AppError::validation("默认文件名不合法"));
    }

    let builder = app.dialog().file().set_file_name(default_path);
    let builder = apply_filters(builder, filters)?;
    let Some(path) = builder.blocking_save_file() else {
        return Ok(None);
    };
    let path = selected_path(path)?;

    std::fs::write(&path, content)
        .map_err(|e| AppError::file_io(format!("写入所选文件失败: {}", e)))?;

    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn import_text_file(
    app: AppHandle,
    filters: Vec<FileDialogFilter>,
) -> Result<Option<String>, AppError> {
    let builder = apply_filters(app.dialog().file(), filters)?;
    let Some(path) = builder.blocking_pick_file() else {
        return Ok(None);
    };
    let path = selected_path(path)?;
    ensure_text_file_size(&path)?;

    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| AppError::file_io(format!("读取所选文件失败: {}", e)))
}

fn is_owned_temp_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if !OWNED_TEMP_PREFIXES
        .iter()
        .any(|prefix| file_name.starts_with(prefix))
    {
        return false;
    }

    let Some(parent) = path.parent() else {
        return false;
    };
    let Ok(parent) = parent.canonicalize() else {
        return false;
    };
    let Ok(temp_dir) = std::env::temp_dir().canonicalize() else {
        return false;
    };

    parent == temp_dir
}

#[tauri::command]
pub fn cleanup_owned_temp_file(path: String) -> Result<bool, AppError> {
    let path = Path::new(&path);
    if !is_owned_temp_file(path) {
        return Err(AppError::validation("只允许清理 PicNexus 创建的临时文件"));
    }
    if !path.exists() {
        return Ok(false);
    }

    std::fs::remove_file(path)
        .map(|_| true)
        .map_err(|e| AppError::file_io(format!("删除临时文件失败: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owned_temp_cleanup_rejects_unowned_path() {
        let path = std::env::temp_dir().join("not_picnexus_url_temp.jpg");
        std::fs::write(&path, b"keep").expect("write temp marker");

        let result = cleanup_owned_temp_file(path.to_string_lossy().to_string());

        assert!(result.is_err());
        assert!(path.exists());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn owned_temp_cleanup_removes_picnexus_url_file() {
        let path =
            std::env::temp_dir().join(format!("picnexus_url_{}_test.jpg", std::process::id()));
        std::fs::write(&path, b"temp").expect("write temp marker");

        let removed = cleanup_owned_temp_file(path.to_string_lossy().to_string())
            .expect("owned URL temp file should be removable");

        assert!(removed);
        assert!(!path.exists());
    }
}
