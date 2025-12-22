// src-tauri/src/commands/clipboard.rs
// 剪贴板图片处理命令

use arboard::Clipboard;
use image::ImageOutputFormat;
use std::io::Cursor;

/// 检查剪贴板是否包含图片
#[tauri::command]
pub fn clipboard_has_image() -> Result<bool, String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("无法访问剪贴板: {}", e))?;

    match clipboard.get_image() {
        Ok(_) => Ok(true),
        Err(arboard::Error::ContentNotAvailable) => Ok(false),
        Err(e) => Err(format!("检查剪贴板失败: {}", e)),
    }
}

/// 从剪贴板读取图片并保存为临时文件
///
/// # 返回
/// 返回临时文件的完整路径
#[tauri::command]
pub fn read_clipboard_image() -> Result<String, String> {
    eprintln!("[剪贴板] 正在读取剪贴板图片...");

    // 获取剪贴板访问
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("无法访问剪贴板: {}", e))?;

    // 读取图片数据
    let image_data = clipboard
        .get_image()
        .map_err(|e| match e {
            arboard::Error::ContentNotAvailable => "剪贴板中没有图片".to_string(),
            _ => format!("读取剪贴板图片失败: {}", e),
        })?;

    eprintln!(
        "[剪贴板] 读取成功，尺寸: {}x{}",
        image_data.width, image_data.height
    );

    // 将 RGBA 数据转换为 PNG 格式
    let rgba_image = image::RgbaImage::from_raw(
        image_data.width as u32,
        image_data.height as u32,
        image_data.bytes.into_owned(),
    )
    .ok_or_else(|| "图片数据格式错误".to_string())?;

    // 编码为 PNG
    let mut png_data = Cursor::new(Vec::new());
    rgba_image
        .write_to(&mut png_data, ImageOutputFormat::Png)
        .map_err(|e| format!("PNG 编码失败: {}", e))?;

    let png_bytes = png_data.into_inner();
    eprintln!("[剪贴板] PNG 编码完成，大小: {} bytes", png_bytes.len());

    // 创建临时文件路径
    let temp_dir = std::env::temp_dir();
    let file_name = format!(
        "clipboard_image_{}.png",
        chrono::Local::now().format("%Y%m%d_%H%M%S_%3f")
    );
    let temp_path = temp_dir.join(&file_name);

    // 写入文件
    std::fs::write(&temp_path, png_bytes).map_err(|e| {
        eprintln!("[剪贴板] 写入临时文件失败: {}", e);
        format!("写入临时文件失败: {}", e)
    })?;

    let path_str = temp_path.to_string_lossy().to_string();
    eprintln!("[剪贴板] 图片已保存到临时文件: {}", path_str);

    Ok(path_str)
}
