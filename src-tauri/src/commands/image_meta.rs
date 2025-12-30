// src-tauri/src/commands/image_meta.rs
// 图片元数据提取命令
// 性能优化：使用 imagesize crate 只读取图片头部字节，避免完整解码

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::AppError;

/// 图片元数据结构（简化版）
/// 用于前端 Justified Layout 布局和历史记录存储
/// 移除了 color_type 和 has_alpha 字段，因为实际使用中不需要
#[derive(Serialize)]
pub struct ImageMetadata {
    /// 图片宽度（像素）
    pub width: u32,
    /// 图片高度（像素）
    pub height: u32,
    /// 宽高比（width / height）
    pub aspect_ratio: f64,
    /// 文件大小（字节）
    pub file_size: u64,
    /// 图片格式（jpg, png, webp, gif, bmp 等）
    pub format: String,
}

/// 获取图片元数据
///
/// 性能优化：使用 imagesize crate 只读取图片头部（通常 16-64 字节），
/// 而不是使用 image::open() 完整解码整个图片。
/// 对于 50MB 的大图，性能从 2-5 秒提升到 <10ms。
///
/// # 参数
/// - `file_path`: 图片文件的绝对路径
///
/// # 返回
/// - `Ok(ImageMetadata)`: 图片元数据
/// - `Err(AppError)`: 文件读取或图片解析错误
#[tauri::command]
pub fn get_image_metadata(file_path: String) -> Result<ImageMetadata, AppError> {
    let path = Path::new(&file_path);

    // 1. 检查文件是否存在
    if !path.exists() {
        return Err(AppError::file_io(format!("文件不存在: {}", file_path)));
    }

    // 2. 获取文件大小（从文件系统元数据）
    let file_size = fs::metadata(path)
        .map_err(|e| AppError::file_io(format!("读取文件元数据失败: {}", e)))?
        .len();

    // 3. 从文件扩展名推断格式
    let format = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_else(|| "unknown".to_string());

    // 4. 使用 imagesize crate 只读取头部字节获取尺寸
    // 这是核心优化：避免完整解码图片
    let size = imagesize::size(path).map_err(|e| {
        let error_msg = e.to_string();
        if error_msg.contains("unsupported") || error_msg.contains("format") {
            AppError::validation(format!("不支持的图片格式: {}", format))
        } else if error_msg.contains("corrupt") || error_msg.contains("invalid") {
            AppError::validation("图片文件已损坏或格式无效")
        } else {
            AppError::file_io(format!("无法读取图片尺寸: {}", e))
        }
    })?;

    let width = size.width as u32;
    let height = size.height as u32;

    // 5. 计算宽高比（避免除以零）
    let aspect_ratio = if height > 0 {
        width as f64 / height as f64
    } else {
        1.0
    };

    Ok(ImageMetadata {
        width,
        height,
        aspect_ratio,
        file_size,
        format,
    })
}
