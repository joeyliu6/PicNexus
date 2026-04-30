// src-tauri/src/commands/clipboard.rs
// 剪贴板图片处理命令
// v2.10: 迁移到 AppError 统一错误类型

use arboard::Clipboard;
use image::ImageFormat;
use std::io::Cursor;
use std::path::Path;

use crate::error::AppError;
use crate::log_utils::safe_path;

const CLIPBOARD_TEMP_PREFIX: &str = "clipboard_image_";
const CLIPBOARD_TEMP_EXTENSION: &str = "png";

fn is_clipboard_temp_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if !file_name.starts_with(CLIPBOARD_TEMP_PREFIX) {
        return false;
    }
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    if !ext.eq_ignore_ascii_case(CLIPBOARD_TEMP_EXTENSION) {
        return false;
    }

    let Some(parent) = path.parent() else {
        return false;
    };
    let Ok(temp_dir) = std::env::temp_dir().canonicalize() else {
        return false;
    };
    let Ok(parent_dir) = parent.canonicalize() else {
        return false;
    };
    parent_dir == temp_dir
}

/// 安全清理本次剪贴板图片临时文件。
///
/// 只允许删除系统临时目录下由 read_clipboard_image 创建的
/// clipboard_image_*.png，避免前端传入任意路径造成误删。
#[tauri::command]
pub fn cleanup_clipboard_temp_file(path: String) -> Result<bool, AppError> {
    let path = Path::new(&path);
    if !is_clipboard_temp_path(path) {
        return Err(AppError::validation(
            "只允许清理 PicNexus 创建的剪贴板临时图片",
        ));
    }
    if !path.exists() {
        return Ok(false);
    }

    std::fs::remove_file(path).map_err(|e| {
        log::warn!(
            "[剪贴板] 删除临时文件失败 {}: {}",
            safe_path(&path.to_string_lossy()),
            e
        );
        AppError::file_io(format!("删除剪贴板临时文件失败: {}", e))
    })?;
    Ok(true)
}

/// 检查剪贴板是否包含图片
#[tauri::command]
pub fn clipboard_has_image() -> Result<bool, AppError> {
    let mut clipboard =
        Clipboard::new().map_err(|e| AppError::clipboard(format!("无法访问剪贴板: {}", e)))?;

    match clipboard.get_image() {
        Ok(_) => Ok(true),
        Err(arboard::Error::ContentNotAvailable) => Ok(false),
        Err(e) => Err(AppError::clipboard(format!("检查剪贴板失败: {}", e))),
    }
}

/// 从剪贴板读取图片并保存为临时文件
///
/// # 返回
/// 返回临时文件的完整路径
#[tauri::command]
pub fn read_clipboard_image() -> Result<String, AppError> {
    log::info!("[剪贴板] 正在读取剪贴板图片...");

    // 获取剪贴板访问
    let mut clipboard =
        Clipboard::new().map_err(|e| AppError::clipboard(format!("无法访问剪贴板: {}", e)))?;

    // 读取图片数据
    let image_data = clipboard.get_image().map_err(|e| match e {
        arboard::Error::ContentNotAvailable => AppError::clipboard("剪贴板中没有图片"),
        _ => AppError::clipboard(format!("读取剪贴板图片失败: {}", e)),
    })?;

    log::debug!(
        "[剪贴板] 读取成功，尺寸: {}x{}",
        image_data.width,
        image_data.height
    );

    // 将 RGBA 数据转换为 PNG 格式
    let rgba_image = image::RgbaImage::from_raw(
        image_data.width as u32,
        image_data.height as u32,
        image_data.bytes.into_owned(),
    )
    .ok_or_else(|| AppError::clipboard("图片数据格式错误"))?;

    // 编码为 PNG
    let mut png_data = Cursor::new(Vec::new());
    rgba_image
        .write_to(&mut png_data, ImageFormat::Png)
        .map_err(|e| AppError::clipboard(format!("PNG 编码失败: {}", e)))?;

    let png_bytes = png_data.into_inner();
    log::debug!("[剪贴板] PNG 编码完成，大小: {} bytes", png_bytes.len());

    // 创建临时文件路径
    let temp_dir = std::env::temp_dir();
    let file_name = format!(
        "{}{}.{}",
        CLIPBOARD_TEMP_PREFIX,
        chrono::Local::now().format("%Y%m%d_%H%M%S_%3f"),
        CLIPBOARD_TEMP_EXTENSION
    );
    let temp_path = temp_dir.join(&file_name);

    // 写入文件
    std::fs::write(&temp_path, png_bytes).map_err(|e| {
        log::error!("[剪贴板] 写入临时文件失败: {}", e);
        AppError::file_io(format!("写入临时文件失败: {}", e))
    })?;

    let path_str = temp_path.to_string_lossy().to_string();
    log::info!("[剪贴板] 图片已保存到临时文件: {}", safe_path(&path_str));

    Ok(path_str)
}

#[cfg(test)]
mod tests {
    use super::{cleanup_clipboard_temp_file, CLIPBOARD_TEMP_PREFIX};

    #[test]
    fn cleanup_clipboard_temp_file_removes_only_owned_temp_png() {
        let path = std::env::temp_dir().join(format!(
            "{}test_{}_{}.png",
            CLIPBOARD_TEMP_PREFIX,
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::write(&path, b"temp").expect("test temp file should be writable");

        let removed = cleanup_clipboard_temp_file(path.to_string_lossy().to_string())
            .expect("owned clipboard temp file should be removable");

        assert!(removed);
        assert!(!path.exists());
    }

    #[test]
    fn cleanup_clipboard_temp_file_rejects_unowned_path() {
        let path = std::env::temp_dir().join("not_clipboard_image.png");
        std::fs::write(&path, b"keep").expect("test temp file should be writable");

        let result = cleanup_clipboard_temp_file(path.to_string_lossy().to_string());

        assert!(result.is_err());
        assert!(path.exists());
        let _ = std::fs::remove_file(path);
    }
}
