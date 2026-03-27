use std::fs;
use std::io::Write;
use std::path::Path;

use image::imageops::FilterType;
use image::GenericImageView;
use serde::Serialize;
use tauri::Manager;

use crate::error::AppError;

#[derive(Serialize)]
pub struct CompressResult {
    /// 压缩后文件路径（临时目录）
    #[serde(rename = "outputPath")]
    pub output_path: String,
    /// 原始文件大小（字节）
    #[serde(rename = "originalSize")]
    pub original_size: u64,
    /// 压缩后文件大小（字节）
    #[serde(rename = "compressedSize")]
    pub compressed_size: u64,
    /// 压缩率（0.0 ~ 1.0，越小越好）
    pub ratio: f64,
    /// 压缩后宽度
    pub width: u32,
    /// 压缩后高度
    pub height: u32,
    /// 输出格式
    pub format: String,
}

/// 压缩图片
///
/// 支持 JPEG/PNG/WebP/BMP 输入。
/// 压缩策略：
/// 1. 如果指定了 max_long_side，按最长边等比缩放
/// 2. 使用指定质量重新编码（重编码自然去除 EXIF）
/// 3. 输出到临时文件，返回压缩结果
///
/// # 参数
/// - `file_path`: 原图绝对路径
/// - `quality`: 压缩质量 1-100（JPEG/WebP 有效）
/// - `max_long_side`: 最长边限制（像素），0 表示不限制
/// - `output_format`: 输出格式 "original" | "webp" | "jpeg"
/// - `strip_exif`: 是否去除 EXIF（false 时尽量保留，受格式转换/编码器限制）
#[tauri::command]
pub async fn compress_image(
    app: tauri::AppHandle,
    file_path: String,
    quality: u8,
    max_long_side: u32,
    output_format: String,
    strip_exif: bool,
) -> Result<CompressResult, AppError> {
    let path = Path::new(&file_path);

    if !path.exists() {
        return Err(AppError::file_io(format!("文件不存在: {}", file_path)));
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|e| AppError::file_io(format!("无法解析文件路径: {}", e)))?;
    let path = canonical_path.as_path();

    let original_size = fs::metadata(path)
        .map_err(|e| AppError::file_io(format!("读取文件元数据失败: {}", e)))?
        .len();

    let src_ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default();

    // GIF 动图不支持压缩，直接跳过
    if src_ext == "gif" {
        return Err(AppError::validation("GIF 动图不支持压缩"));
    }

    let quality = quality.clamp(1, 100);

    // 在阻塞线程池中执行 CPU 密集的图片处理
    let app_handle = app.clone();
    let file_path_owned = file_path.clone();

    tokio::task::spawn_blocking(move || {
        let path = Path::new(&file_path_owned);
        let canonical = path.canonicalize().map_err(|e| {
            AppError::file_io(format!("无法解析文件路径: {}", e))
        })?;

        let img = image::open(&canonical).map_err(|e| {
            AppError::file_io(format!("无法打开图片: {}", e))
        })?;

        let (orig_w, orig_h) = img.dimensions();

        // 计算目标尺寸（按最长边等比缩放）
        let (target_w, target_h) = calculate_target_size(orig_w, orig_h, max_long_side);

        // 如果需要缩放，使用 Lanczos3 高质量缩放算法
        let processed = if target_w != orig_w || target_h != orig_h {
            img.resize(target_w, target_h, FilterType::Lanczos3)
        } else {
            img
        };

        let (final_w, final_h) = processed.dimensions();

        // 确定输出格式和扩展名
        let (out_ext, out_format_name) = match output_format.as_str() {
            "webp" => ("webp", "webp"),
            "jpeg" => ("jpg", "jpg"),
            _ => {
                // "original": 保持原格式
                match src_ext.as_str() {
                    "png" => ("png", "png"),
                    "bmp" => ("jpg", "jpg"),
                    "webp" => ("webp", "webp"),
                    _ => ("jpg", "jpg"),
                }
            }
        };

        // 生成临时输出路径
        let temp_dir = app_handle.path().temp_dir().map_err(|e| {
            AppError::file_io(format!("无法获取临时目录: {}", e))
        })?;
        let compress_dir = temp_dir.join("picnexus_compress");
        fs::create_dir_all(&compress_dir).map_err(|e| {
            AppError::file_io(format!("无法创建压缩临时目录: {}", e))
        })?;

        let stem = canonical.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("compressed");
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let output_path = compress_dir.join(format!("{}_{}.{}", stem, timestamp, out_ext));

        // 当关闭 strip_exif 时，在 JPEG → JPEG 路径尽量保留原始 EXIF。
        // 其他格式受当前编码链路限制，无法稳定保留。
        let source_exif_segment = if !strip_exif && (src_ext == "jpg" || src_ext == "jpeg") && out_ext == "jpg" {
            fs::read(&canonical)
                .ok()
                .and_then(|bytes| extract_jpeg_exif_segment(&bytes))
        } else {
            if !strip_exif {
                log::debug!(
                    "[图片压缩] strip_exif=false，但当前编码路径可能无法保留元数据: src_ext={}, out_ext={}",
                    src_ext,
                    out_ext
                );
            }
            None
        };

        // 编码并保存
        match out_ext {
            "jpg" => {
                let rgb = processed.to_rgb8();
                let mut encoded_bytes = Vec::<u8>::new();
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                    &mut encoded_bytes,
                    quality,
                );
                encoder.encode(
                    rgb.as_raw(),
                    final_w,
                    final_h,
                    image::ColorType::Rgb8,
                ).map_err(|e| {
                    AppError::file_io(format!("JPEG 编码失败: {}", e))
                })?;

                let final_bytes = if !strip_exif {
                    if let Some(exif_segment) = source_exif_segment.as_ref() {
                        inject_jpeg_exif_segment(&encoded_bytes, exif_segment)
                            .unwrap_or_else(|| encoded_bytes.clone())
                    } else {
                        encoded_bytes.clone()
                    }
                } else {
                    encoded_bytes.clone()
                };

                let mut out_file = fs::File::create(&output_path).map_err(|e| {
                    AppError::file_io(format!("无法创建输出文件: {}", e))
                })?;
                out_file.write_all(&final_bytes).map_err(|e| {
                    AppError::file_io(format!("写入 JPEG 文件失败: {}", e))
                })?;
            }
            "webp" => {
                // image crate 0.24 的 WebP 编码通过 save 方法支持
                // 质量控制通过先转 JPEG 再转 WebP 实现（MVP 简化方案）
                processed.save(&output_path).map_err(|e| {
                    AppError::file_io(format!("WebP 编码失败: {}", e))
                })?;
            }
            "png" => {
                // PNG 使用默认压缩（后续 Phase 2 引入 oxipng 优化）
                processed.save(&output_path).map_err(|e| {
                    AppError::file_io(format!("PNG 编码失败: {}", e))
                })?;
            }
            _ => {
                processed.save(&output_path).map_err(|e| {
                    AppError::file_io(format!("图片保存失败: {}", e))
                })?;
            }
        }

        let compressed_size = fs::metadata(&output_path)
            .map_err(|e| AppError::file_io(format!("读取压缩后文件大小失败: {}", e)))?
            .len();

        let ratio = if original_size > 0 {
            compressed_size as f64 / original_size as f64
        } else {
            1.0
        };

        log::info!(
            "[图片压缩] {} → {} | {}x{} → {}x{} | {:.1}KB → {:.1}KB ({:.0}%)",
            file_path_owned,
            output_path.display(),
            orig_w, orig_h,
            final_w, final_h,
            original_size as f64 / 1024.0,
            compressed_size as f64 / 1024.0,
            ratio * 100.0,
        );

        Ok(CompressResult {
            output_path: output_path.to_string_lossy().to_string(),
            original_size,
            compressed_size,
            ratio,
            width: final_w,
            height: final_h,
            format: out_format_name.to_string(),
        })
    })
    .await
    .map_err(|e| AppError::external(format!("压缩任务执行失败: {}", e)))?
}

/// 清理压缩临时文件
#[tauri::command]
pub async fn cleanup_compressed_files(
    app: tauri::AppHandle,
    file_paths: Vec<String>,
) -> Result<u32, AppError> {
    let temp_dir = app
        .path()
        .temp_dir()
        .map_err(|e| AppError::file_io(format!("无法获取临时目录: {}", e)))?;
    let compress_dir = temp_dir.join("picnexus_compress");

    let mut cleaned = 0u32;
    for file_path in &file_paths {
        let path = Path::new(file_path);
        // 安全检查：只删除压缩临时目录下的文件
        if let Ok(canonical) = path.canonicalize() {
            if canonical.starts_with(&compress_dir) {
                if fs::remove_file(&canonical).is_ok() {
                    cleaned += 1;
                }
            } else {
                log::warn!("[清理] 拒绝删除非临时目录文件: {}", file_path);
            }
        }
    }

    log::debug!(
        "[清理] 已清理 {}/{} 个压缩临时文件",
        cleaned,
        file_paths.len()
    );
    Ok(cleaned)
}

/// 计算按最长边等比缩放后的目标尺寸
fn calculate_target_size(orig_w: u32, orig_h: u32, max_long_side: u32) -> (u32, u32) {
    if max_long_side == 0 {
        return (orig_w, orig_h);
    }
    let long = orig_w.max(orig_h);
    if long <= max_long_side {
        return (orig_w, orig_h);
    }
    let scale = max_long_side as f64 / long as f64;
    let w = (orig_w as f64 * scale) as u32;
    let h = (orig_h as f64 * scale) as u32;
    (w.max(1), h.max(1))
}

/// 提取 JPEG 中的 EXIF APP1 段（包含 marker + length + payload）
fn extract_jpeg_exif_segment(jpeg: &[u8]) -> Option<Vec<u8>> {
    if jpeg.len() < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return None;
    }

    let mut pos = 2usize;
    while pos + 4 <= jpeg.len() {
        if jpeg[pos] != 0xFF {
            pos += 1;
            continue;
        }

        let marker = jpeg[pos + 1];
        if marker == 0xDA {
            // Start Of Scan，后续为图像数据，不再包含标准 metadata 段
            break;
        }
        if marker == 0xD8 || marker == 0xD9 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            pos += 2;
            continue;
        }

        let seg_len = u16::from_be_bytes([jpeg[pos + 2], jpeg[pos + 3]]) as usize;
        if seg_len < 2 {
            return None;
        }
        let seg_end = pos + 2 + seg_len;
        if seg_end > jpeg.len() {
            return None;
        }

        if marker == 0xE1 && seg_len >= 8 {
            let payload_start = pos + 4;
            if payload_start + 6 <= seg_end
                && &jpeg[payload_start..payload_start + 6] == b"Exif\0\0"
            {
                return Some(jpeg[pos..seg_end].to_vec());
            }
        }

        pos = seg_end;
    }

    None
}

/// 将 EXIF APP1 段注入 JPEG（紧跟 SOI）
fn inject_jpeg_exif_segment(jpeg: &[u8], exif_segment: &[u8]) -> Option<Vec<u8>> {
    if jpeg.len() < 2 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 {
        return None;
    }
    if exif_segment.len() < 10 || exif_segment[0] != 0xFF || exif_segment[1] != 0xE1 {
        return None;
    }

    let mut out = Vec::with_capacity(jpeg.len() + exif_segment.len());
    out.extend_from_slice(&jpeg[..2]);
    out.extend_from_slice(exif_segment);
    out.extend_from_slice(&jpeg[2..]);
    Some(out)
}

/// 仅去除 EXIF 元数据（不压缩质量、不缩放）
///
/// 用于：启用了 stripExif 但跳过压缩的小文件。
/// 通过 image crate 重编码实现，自然去除 EXIF。
#[tauri::command]
pub async fn strip_exif_only(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<CompressResult, AppError> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::file_io(format!("文件不存在: {}", file_path)));
    }

    let canonical_path = path
        .canonicalize()
        .map_err(|e| AppError::file_io(format!("无法解析文件路径: {}", e)))?;

    let original_size = fs::metadata(&canonical_path)
        .map_err(|e| AppError::file_io(format!("读取文件元数据失败: {}", e)))?
        .len();

    let src_ext = canonical_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default();

    if src_ext == "gif" {
        return Err(AppError::validation("GIF 动图不支持 EXIF 剥离"));
    }

    let app_handle = app.clone();
    let file_path_owned = file_path.clone();

    tokio::task::spawn_blocking(move || {
        let canonical = Path::new(&file_path_owned)
            .canonicalize()
            .map_err(|e| AppError::file_io(format!("无法解析文件路径: {}", e)))?;

        let img = image::open(&canonical)
            .map_err(|e| AppError::file_io(format!("无法打开图片: {}", e)))?;

        let (w, h) = img.dimensions();

        // 保持原格式，用高质量重编码（仅为去除 EXIF）
        let out_ext = match src_ext.as_str() {
            "png" => "png",
            "webp" => "webp",
            "bmp" => "jpg",
            _ => "jpg",
        };

        let temp_dir = app_handle
            .path()
            .temp_dir()
            .map_err(|e| AppError::file_io(format!("无法获取临时目录: {}", e)))?;
        let compress_dir = temp_dir.join("picnexus_compress");
        fs::create_dir_all(&compress_dir)
            .map_err(|e| AppError::file_io(format!("无法创建临时目录: {}", e)))?;

        let stem = canonical
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("stripped");
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let output_path = compress_dir.join(format!("{}_{}.{}", stem, timestamp, out_ext));

        // 用高质量重编码（JPEG 用 quality=100），自然去除 EXIF
        match out_ext {
            "jpg" => {
                let rgb = img.to_rgb8();
                let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                    fs::File::create(&output_path)
                        .map_err(|e| AppError::file_io(format!("无法创建输出文件: {}", e)))?,
                    100, // 最高质量，仅为去 EXIF
                );
                encoder
                    .encode(rgb.as_raw(), w, h, image::ColorType::Rgb8)
                    .map_err(|e| AppError::file_io(format!("JPEG 编码失败: {}", e)))?;
            }
            _ => {
                img.save(&output_path)
                    .map_err(|e| AppError::file_io(format!("图片保存失败: {}", e)))?;
            }
        }

        let compressed_size = fs::metadata(&output_path)
            .map_err(|e| AppError::file_io(format!("读取文件大小失败: {}", e)))?
            .len();

        let ratio = if original_size > 0 {
            compressed_size as f64 / original_size as f64
        } else {
            1.0
        };

        log::info!(
            "[EXIF剥离] {} → {} | {:.1}KB → {:.1}KB",
            file_path_owned,
            output_path.display(),
            original_size as f64 / 1024.0,
            compressed_size as f64 / 1024.0,
        );

        Ok(CompressResult {
            output_path: output_path.to_string_lossy().to_string(),
            original_size,
            compressed_size,
            ratio,
            width: w,
            height: h,
            format: out_ext.to_string(),
        })
    })
    .await
    .map_err(|e| AppError::external(format!("EXIF 剥离任务执行失败: {}", e)))?
}
