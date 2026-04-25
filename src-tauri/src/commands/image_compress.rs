use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::imageops::FilterType;
use image::GenericImageView;
use serde::Serialize;
use tauri::Manager;

use crate::error::AppError;

/// 全局原子计数器，为压缩临时文件生成唯一后缀，避免同名文件在同一毫秒并发压缩时覆盖。
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

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
        // Why: 毫秒时间戳在并发场景下可能碰撞（用户同时压缩不同目录的同名文件），
        //      拼接原子计数器彻底消除命名竞争。
        let seq = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let output_path = compress_dir.join(format!("{}_{}_{}.{}", stem, timestamp, seq, out_ext));

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

        // 编码并保存（使用专业编码器）
        match out_ext {
            "jpg" => {
                let encoded_bytes = encode_jpeg_mozjpeg(&processed, final_w, final_h, quality)?;

                let final_bytes = if !strip_exif {
                    if let Some(exif_segment) = source_exif_segment.as_ref() {
                        inject_jpeg_exif_segment(&encoded_bytes, exif_segment)
                            .unwrap_or(encoded_bytes)
                    } else {
                        encoded_bytes
                    }
                } else {
                    encoded_bytes
                };

                fs::write(&output_path, &final_bytes).map_err(|e| {
                    AppError::file_io(format!("写入 JPEG 文件失败: {}", e))
                })?;
            }
            "webp" => {
                let rgba = processed.to_rgba8();
                let encoder = webp::Encoder::from_rgba(rgba.as_raw(), final_w, final_h);
                let encoded = encoder.encode(quality as f32);
                fs::write(&output_path, &*encoded).map_err(|e| {
                    AppError::file_io(format!("写入 WebP 文件失败: {}", e))
                })?;
            }
            "png" => {
                let png_bytes = encode_png_lossy(&processed, final_w, final_h, quality)?;
                fs::write(&output_path, &png_bytes).map_err(|e| {
                    AppError::file_io(format!("写入 PNG 文件失败: {}", e))
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

/// 像素数预检：防止超大图片导致内存耗尽（上限 5000 万像素）
fn check_pixel_limit(width: u32, height: u32) -> Result<(), AppError> {
    let pixel_count = (width as u64).checked_mul(height as u64)
        .ok_or_else(|| AppError::file_io("图片尺寸溢出"))?;
    if pixel_count > 50_000_000 {
        return Err(AppError::file_io(format!(
            "图片像素数 ({}) 超过上限 (5000万)，请先缩小图片",
            pixel_count
        )));
    }
    Ok(())
}

/// 使用 MozJPEG 编码 JPEG（压缩率比标准 libjpeg 好 10-15%）
fn encode_jpeg_mozjpeg(
    img: &image::DynamicImage,
    width: u32,
    height: u32,
    quality: u8,
) -> Result<Vec<u8>, AppError> {
    check_pixel_limit(width, height)?;

    let rgb = img.to_rgb8();
    let mut comp = mozjpeg::Compress::new(mozjpeg::ColorSpace::JCS_RGB);
    comp.set_size(width as usize, height as usize);
    comp.set_quality(quality as f32);

    let mut started = comp.start_compress(Vec::new())
        .map_err(|e| AppError::file_io(format!("MozJPEG 初始化失败: {}", e)))?;

    let row_stride = (width as usize).checked_mul(3)
        .ok_or_else(|| AppError::file_io("行步长计算溢出"))?;
    let raw = rgb.as_raw();
    for row in 0..height as usize {
        let start = row * row_stride;
        let end = start + row_stride;
        if end > raw.len() {
            return Err(AppError::file_io("图像数据不完整，扫描行越界"));
        }
        started.write_scanlines(&raw[start..end])
            .map_err(|e| AppError::file_io(format!("MozJPEG 写入扫描行失败: {}", e)))?;
    }

    started.finish()
        .map_err(|e| AppError::file_io(format!("MozJPEG 编码失败: {}", e)))
}

/// 使用 imagequant 有损压缩 PNG（类似 TinyPNG/pngquant）
fn encode_png_lossy(
    img: &image::DynamicImage,
    width: u32,
    height: u32,
    quality: u8,
) -> Result<Vec<u8>, AppError> {
    check_pixel_limit(width, height)?;

    let rgba = img.to_rgba8();
    let pixels: Vec<imagequant::RGBA> = rgba
        .pixels()
        .map(|p| imagequant::RGBA { r: p[0], g: p[1], b: p[2], a: p[3] })
        .collect();

    let mut liq = imagequant::new();
    // speed=10: 比默认(4)快 8 倍，质量仅降 5%（pngquant 官方推荐用于实时场景）
    liq.set_speed(10)
        .map_err(|e| AppError::file_io(format!("imagequant 设置速度失败: {}", e)))?;
    // 将用户 quality（1-100）映射到 imagequant 的合理范围
    // 映射：用户 1-100 → imagequant min 60-90, max 70-100
    // quality 70+ 在浏览器中肉眼无差别（pngquant 官方文档）
    let iq_max = (60 + (quality as u32) * 40 / 100).min(100) as u8;
    let iq_min = iq_max.saturating_sub(10).max(60);
    liq.set_quality(iq_min, iq_max)
        .map_err(|e| AppError::file_io(format!("imagequant 设置质量失败: {}", e)))?;

    let mut liq_image = liq.new_image(pixels, width as usize, height as usize, 0.0)
        .map_err(|e| AppError::file_io(format!("imagequant 创建图像失败: {}", e)))?;

    let mut result = liq.quantize(&mut liq_image)
        .map_err(|e| AppError::file_io(format!("imagequant 量化失败: {}", e)))?;

    result.set_dithering_level(1.0)
        .map_err(|e| AppError::file_io(format!("imagequant 设置抖动失败: {}", e)))?;

    let (palette, indexed_pixels) = result.remapped(&mut liq_image)
        .map_err(|e| AppError::file_io(format!("imagequant 重映射失败: {}", e)))?;

    let mut encoder = lodepng::Encoder::new();
    encoder.set_auto_convert(false);

    // 设置 info 和 raw 两套调色板（lodepng 要求两者一致）
    fn apply_palette(mode: &mut lodepng::ColorMode, palette: &[imagequant::RGBA]) -> Result<(), AppError> {
        mode.colortype = lodepng::ColorType::PALETTE;
        mode.set_bitdepth(8);
        for c in palette {
            mode.palette_add(lodepng::RGBA { r: c.r, g: c.g, b: c.b, a: c.a })
                .map_err(|e| AppError::file_io(format!("lodepng 调色板失败: {:?}", e)))?;
        }
        Ok(())
    }
    apply_palette(&mut encoder.info_png_mut().color, &palette)?;
    apply_palette(encoder.info_raw_mut(), &palette)?;

    encoder.encode(&indexed_pixels, width as usize, height as usize)
        .map_err(|e| AppError::file_io(format!("lodepng 编码失败: {:?}", e)))
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
        // 同 compress_image：拼接原子计数器避免并发同名碰撞
        let seq = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let output_path = compress_dir.join(format!("{}_{}_{}.{}", stem, timestamp, seq, out_ext));

        // 用高质量重编码，自然去除 EXIF
        match out_ext {
            "jpg" => {
                let encoded = encode_jpeg_mozjpeg(&img, w, h, 100)?;
                fs::write(&output_path, &encoded).map_err(|e| {
                    AppError::file_io(format!("写入 JPEG 文件失败: {}", e))
                })?;
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

/// 读取图片文件为 base64 data URI（用于压缩预览）
///
/// 为避免大图占用过多内存，当图片长边超过 max_side 时自动缩小。
#[tauri::command]
pub async fn read_image_as_base64(
    file_path: String,
    max_side: Option<u32>,
) -> Result<String, AppError> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::file_io(format!("文件不存在: {}", file_path)));
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    // PNG/WebP 可能带透明通道，用 PNG 预览保留透明；其他格式用 JPEG（编码快、体积小）
    let has_alpha = matches!(ext.as_str(), "png" | "webp");

    let max_side = max_side.unwrap_or(1200);
    let file_path_clone = file_path.clone();

    tokio::task::spawn_blocking(move || {
        let img = image::open(&file_path_clone)
            .map_err(|e| AppError::file_io(format!("无法打开图片: {}", e)))?;

        let (w, h) = img.dimensions();
        let long_side = w.max(h);

        let final_img = if long_side > max_side {
            img.resize(max_side, max_side, FilterType::Triangle)
        } else {
            img
        };

        if has_alpha {
            let mut buf = Vec::new();
            final_img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| AppError::file_io(format!("预览 PNG 编码失败: {}", e)))?;
            let b64 = STANDARD.encode(&buf);
            Ok(format!("data:image/png;base64,{}", b64))
        } else {
            let rgb = final_img.to_rgb8();
            let (fw, fh) = rgb.dimensions();
            let mut buf = std::io::Cursor::new(Vec::new());
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85);
            encoder.encode(rgb.as_raw(), fw, fh, image::ExtendedColorType::Rgb8)
                .map_err(|e| AppError::file_io(format!("预览 JPEG 编码失败: {}", e)))?;
            let b64 = STANDARD.encode(buf.into_inner());
            Ok(format!("data:image/jpeg;base64,{}", b64))
        }
    })
    .await
    .map_err(|e| AppError::external(format!("读取图片失败: {}", e)))?
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------- calculate_target_size --------

    #[test]
    fn target_size_max_zero_returns_original() {
        assert_eq!(calculate_target_size(1920, 1080, 0), (1920, 1080));
    }

    #[test]
    fn target_size_smaller_than_limit_returns_original() {
        assert_eq!(calculate_target_size(800, 600, 1200), (800, 600));
    }

    #[test]
    fn target_size_landscape_scales_to_long_side() {
        let (w, h) = calculate_target_size(2000, 1000, 1000);
        assert_eq!(w, 1000);
        assert_eq!(h, 500);
    }

    #[test]
    fn target_size_portrait_scales_to_long_side() {
        let (w, h) = calculate_target_size(1000, 2000, 1000);
        assert_eq!(w, 500);
        assert_eq!(h, 1000);
    }

    #[test]
    fn target_size_short_side_at_least_1_for_extreme_aspect() {
        // 1x10000 缩放到长边 100：短边按比例 0.01，必须夹到 1
        let (w, h) = calculate_target_size(1, 10000, 100);
        assert_eq!(h, 100);
        assert!(w >= 1);
    }

    // -------- check_pixel_limit --------

    #[test]
    fn pixel_limit_under_50m_passes() {
        assert!(check_pixel_limit(7000, 7000).is_ok()); // 49M
    }

    #[test]
    fn pixel_limit_over_50m_fails() {
        assert!(check_pixel_limit(8000, 8000).is_err()); // 64M
    }

    #[test]
    fn pixel_limit_overflow_returns_err() {
        // u32::MAX * u32::MAX 用 u64 不会溢出，但远超阈值
        assert!(check_pixel_limit(u32::MAX, u32::MAX).is_err());
    }

    // -------- extract_jpeg_exif_segment --------

    /// 构造一个最小合法 JPEG 字节流：SOI + APP1(EXIF) + SOS + EOI
    fn build_jpeg_with_exif(exif_payload: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let mut bytes = vec![0xFF, 0xD8]; // SOI

        // APP1 段：FF E1 + length(2) + "Exif\0\0" + payload
        let app1_body_len = 6 + exif_payload.len(); // "Exif\0\0" + payload
        let seg_len = (app1_body_len + 2) as u16; // 包含 length 字段自身的 2 字节
        let mut app1 = vec![0xFF, 0xE1];
        app1.extend_from_slice(&seg_len.to_be_bytes());
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(exif_payload);

        bytes.extend_from_slice(&app1);
        // SOS 段（让循环里走到 0xDA 提前退出）：FF DA + length(2)=2
        bytes.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02]);
        // EOI
        bytes.extend_from_slice(&[0xFF, 0xD9]);

        (bytes, app1)
    }

    #[test]
    fn extract_exif_finds_app1_segment() {
        let (jpeg, expected_app1) = build_jpeg_with_exif(b"\x49\x49\x2A\x00mock-exif");
        let extracted = extract_jpeg_exif_segment(&jpeg).expect("应找到 EXIF 段");
        assert_eq!(extracted, expected_app1);
    }

    #[test]
    fn extract_exif_returns_none_for_non_jpeg() {
        // 错误 SOI
        let bad = vec![0x89, 0x50, 0x4E, 0x47];
        assert!(extract_jpeg_exif_segment(&bad).is_none());
    }

    #[test]
    fn extract_exif_returns_none_when_no_exif_app1() {
        // 仅 SOI + SOS + EOI，无 APP1
        let bytes = vec![0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9];
        assert!(extract_jpeg_exif_segment(&bytes).is_none());
    }

    #[test]
    fn extract_exif_returns_none_for_truncated_input() {
        let bytes = vec![0xFF, 0xD8, 0xFF];
        assert!(extract_jpeg_exif_segment(&bytes).is_none());
    }

    // -------- inject_jpeg_exif_segment --------

    #[test]
    fn inject_exif_round_trips_with_extract() {
        let (original_jpeg, exif_segment) = build_jpeg_with_exif(b"\x49\x49\x2A\x00payload");

        // 从无 EXIF 的"裸" JPEG 起步：SOI + SOS + EOI
        let bare = vec![0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9];
        let injected = inject_jpeg_exif_segment(&bare, &exif_segment).expect("注入应成功");

        // SOI 之后立即出现 EXIF 段
        assert_eq!(&injected[0..2], &[0xFF, 0xD8]);
        assert_eq!(&injected[2..2 + exif_segment.len()], exif_segment.as_slice());

        // 再次提取应拿回同一段
        let re_extracted = extract_jpeg_exif_segment(&injected).expect("应再次找到 EXIF");
        assert_eq!(re_extracted, exif_segment);

        // 与重建的 original 不必字节相同（取决于排列），但提取出的 EXIF 应一致
        let re_extracted_orig = extract_jpeg_exif_segment(&original_jpeg).unwrap();
        assert_eq!(re_extracted, re_extracted_orig);
    }

    #[test]
    fn inject_exif_rejects_non_jpeg_target() {
        let exif = vec![0xFF, 0xE1, 0x00, 0x08, b'E', b'x', b'i', b'f', 0, 0];
        let bad_target = vec![0x00, 0x01, 0x02];
        assert!(inject_jpeg_exif_segment(&bad_target, &exif).is_none());
    }

    #[test]
    fn inject_exif_rejects_invalid_segment_marker() {
        let valid_jpeg = vec![0xFF, 0xD8, 0xFF, 0xD9];
        // 非 FF E1 起头
        let bad_seg = vec![0xFF, 0xE0, 0x00, 0x08, b'E', b'x', b'i', b'f', 0, 0];
        assert!(inject_jpeg_exif_segment(&valid_jpeg, &bad_seg).is_none());
    }
}
