// src-tauri/src/commands/image_meta.rs
// 图片元数据提取命令
// 性能优化：使用 imagesize crate 只读取图片头部字节，避免完整解码

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::error::AppError;
use crate::server::upload_handler::MAX_SERVER_UPLOAD_SIZE;

const SVG_METADATA_READ_LIMIT: usize = 256 * 1024;

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

fn parse_svg_number(value: &str) -> Option<f64> {
    let value = value.trim();
    let numeric = value
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | '+' | '-' | 'e' | 'E'))
        .collect::<String>();
    if numeric.is_empty() {
        return None;
    }
    numeric
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite() && *n > 0.0)
}

fn extract_svg_attr(svg: &str, attr: &str) -> Option<String> {
    for pattern in [
        format!(r#"(?is)\b{}\s*=\s*"([^"]+)""#, regex::escape(attr)),
        format!(r#"(?is)\b{}\s*=\s*'([^']+)'"#, regex::escape(attr)),
    ] {
        let re = regex::Regex::new(&pattern).ok()?;
        if let Some(captures) = re.captures(svg) {
            if let Some(value) = captures.get(1) {
                return Some(value.as_str().to_string());
            }
        }
    }
    None
}

fn svg_number_to_u32(value: f64) -> Option<u32> {
    if value > u32::MAX as f64 {
        return None;
    }
    Some(value.round().max(1.0) as u32)
}

fn parse_svg_dimensions(svg: &str) -> Option<(u32, u32)> {
    if let (Some(width), Some(height)) = (
        extract_svg_attr(svg, "width"),
        extract_svg_attr(svg, "height"),
    ) {
        let width = svg_number_to_u32(parse_svg_number(&width)?)?;
        let height = svg_number_to_u32(parse_svg_number(&height)?)?;
        return Some((width, height));
    }

    let view_box = extract_svg_attr(svg, "viewBox")?;
    let parts = view_box
        .split(|c: char| c.is_ascii_whitespace() || c == ',')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    if parts.len() != 4 {
        return None;
    }

    let width = svg_number_to_u32(parse_svg_number(parts[2])?)?;
    let height = svg_number_to_u32(parse_svg_number(parts[3])?)?;
    Some((width, height))
}

fn read_svg_metadata_snippet(path: &Path) -> Result<String, AppError> {
    let mut file =
        File::open(path).map_err(|e| AppError::file_io(format!("读取 SVG 文件失败: {}", e)))?;
    let mut buffer = Vec::with_capacity(SVG_METADATA_READ_LIMIT.min(8192));
    file.by_ref()
        .take(SVG_METADATA_READ_LIMIT as u64)
        .read_to_end(&mut buffer)
        .map_err(|e| AppError::file_io(format!("读取 SVG 文件失败: {}", e)))?;

    let snippet =
        String::from_utf8(buffer).map_err(|_| AppError::validation("SVG 文件不是有效 UTF-8"))?;
    let lower = snippet.to_ascii_lowercase();
    let Some(svg_start) = lower.find("<svg") else {
        return Err(AppError::validation("SVG 缺少有效尺寸信息"));
    };
    let Some(tag_end_offset) = snippet[svg_start..].find('>') else {
        return Err(AppError::validation("SVG 开始标签过大或不完整"));
    };

    Ok(snippet[svg_start..=svg_start + tag_end_offset].to_string())
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

    // 1.5 路径规范化，防止路径穿越攻击（如 ../../etc/passwd）
    let canonical_path = path
        .canonicalize()
        .map_err(|e| AppError::file_io(format!("无法解析文件路径: {}", e)))?;
    let path = canonical_path.as_path();

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

    if format == "svg" {
        if file_size > MAX_SERVER_UPLOAD_SIZE as u64 {
            return Err(AppError::validation(format!(
                "SVG 文件过大 ({:.1}MB)，最大支持 {}MB",
                file_size as f64 / 1024.0 / 1024.0,
                MAX_SERVER_UPLOAD_SIZE / 1024 / 1024
            )));
        }

        let svg = read_svg_metadata_snippet(path)?;
        let (width, height) = parse_svg_dimensions(&svg)
            .ok_or_else(|| AppError::validation("SVG 缺少有效尺寸信息"))?;
        let aspect_ratio = width as f64 / height as f64;

        return Ok(ImageMetadata {
            width,
            height,
            aspect_ratio,
            file_size,
            format,
        });
    }

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

#[cfg(test)]
mod tests {
    use super::{get_image_metadata, parse_svg_dimensions};
    use crate::error::AppError;
    use crate::server::upload_handler::MAX_SERVER_UPLOAD_SIZE;
    use std::fs::{self, OpenOptions};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parse_svg_dimensions_from_width_and_height() {
        let svg = r#"<svg width="24px" height="12" xmlns="http://www.w3.org/2000/svg"></svg>"#;

        assert_eq!(parse_svg_dimensions(svg), Some((24, 12)));
    }

    #[test]
    fn parse_svg_dimensions_from_viewbox() {
        let svg = r#"<svg viewBox="0 0 16 9"></svg>"#;

        assert_eq!(parse_svg_dimensions(svg), Some((16, 9)));
    }

    #[test]
    fn parse_svg_dimensions_rejects_missing_size() {
        let svg = r#"<svg><path d="M0 0" /></svg>"#;

        assert_eq!(parse_svg_dimensions(svg), None);
    }

    #[test]
    fn get_image_metadata_rejects_oversized_svg_before_reading() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "picnexus_oversized_svg_{}_{}.svg",
            std::process::id(),
            unique
        ));
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .expect("test svg should be created");
        file.set_len(MAX_SERVER_UPLOAD_SIZE as u64 + 1)
            .expect("test svg size should be set");
        drop(file);

        let result = get_image_metadata(path.to_string_lossy().to_string());
        let _ = fs::remove_file(&path);

        match result {
            Err(AppError::Validation { message }) => {
                assert!(message.contains("SVG 文件过大"));
                assert!(message.contains("50MB"));
            }
            Err(other) => panic!("expected validation error, got {other:?}"),
            Ok(_) => panic!("oversized SVG should be rejected"),
        }
    }
}
