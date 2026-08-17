// src-tauri/src/commands/utils.rs
// 通用工具函数

use tokio::fs::File;
use tokio::io::AsyncReadExt;

use crate::error::AppError;

/// 读取文件到字节数组
///
/// # 参数
/// - `path`: 文件路径
/// - `max_bytes`: 允许读取的最大文件大小
///
/// # 返回
/// - `Ok((Vec<u8>, u64))`: 文件内容和文件大小
/// - `Err(AppError)`: 文件 IO 错误
pub async fn read_file_bytes(path: &str, max_bytes: u64) -> Result<(Vec<u8>, u64), AppError> {
    let file = File::open(path)
        .await
        .map_err(|e| AppError::file_io(format!("无法打开文件: {}", e)))?;

    let file_size = file
        .metadata()
        .await
        .map_err(|e| AppError::file_io(format!("无法获取文件元数据: {}", e)))?
        .len();

    if file_size > max_bytes {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过读取上限 ({:.2}MB)",
            file_size as f64 / 1024.0 / 1024.0,
            max_bytes as f64 / 1024.0 / 1024.0,
        )));
    }

    let capacity = usize::try_from(file_size)
        .map_err(|_| AppError::file_io("文件过大，无法分配读取缓冲区"))?;
    let mut buffer = Vec::with_capacity(capacity);
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut buffer)
        .await
        .map_err(|e| AppError::file_io(format!("无法读取文件: {}", e)))?;

    let actual_size = buffer.len() as u64;
    if actual_size > max_bytes {
        return Err(AppError::validation("文件在读取期间增长并超过大小上限"));
    }

    Ok((buffer, actual_size))
}

/// 只读元数据做大小校验，不把文件内容读进内存
///
/// 用于流式上传路径（S3/R2/WebDAV）：请求体直接从磁盘读，但仍要在发请求前拦掉超限文件。
///
/// # 参数
/// - `path`: 文件路径
/// - `max_bytes`: 允许上传的最大文件大小
///
/// # 返回
/// - `Ok(u64)`: 文件大小
/// - `Err(AppError)`: 文件不存在、不是普通文件，或超过大小上限
pub async fn probe_upload_file_size(path: &str, max_bytes: u64) -> Result<u64, AppError> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|e| AppError::file_io(format!("无法获取文件元数据: {}", e)))?;

    if !metadata.is_file() {
        return Err(AppError::validation("路径不是有效的文件"));
    }

    let file_size = metadata.len();
    if file_size > max_bytes {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过读取上限 ({:.2}MB)",
            file_size as f64 / 1024.0 / 1024.0,
            max_bytes as f64 / 1024.0 / 1024.0,
        )));
    }

    Ok(file_size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// 在系统临时目录下写一个文件，返回其路径。测试结束后由 Drop 清理。
    ///
    /// 文件名用"进程号 + 单调递增计数器"保证唯一：
    /// Windows 时钟精度有时只有 ~15ms，光靠 nanos 在并行跑的测试之间会撞
    /// 导致互相覆盖、读到空内容。
    struct TempFile {
        path: std::path::PathBuf,
    }

    static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

    impl TempFile {
        fn new(content: &[u8]) -> Self {
            let seq = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "picnexus_test_{}_{}.bin",
                std::process::id(),
                seq
            ));
            let mut f = std::fs::File::create(&path).expect("创建临时文件失败");
            f.write_all(content).expect("写入临时文件失败");
            Self { path }
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[tokio::test]
    async fn read_existing_file_returns_bytes_and_size() {
        let content = b"hello picnexus";
        let tmp = TempFile::new(content);

        let (bytes, size) = read_file_bytes(tmp.path.to_str().unwrap(), 1024)
            .await
            .expect("应能读取存在的文件");

        assert_eq!(bytes, content);
        assert_eq!(size, content.len() as u64);
    }

    #[tokio::test]
    async fn read_empty_file_returns_zero_length() {
        let tmp = TempFile::new(&[]);

        let (bytes, size) = read_file_bytes(tmp.path.to_str().unwrap(), 1024)
            .await
            .expect("空文件也应能读取");

        assert!(bytes.is_empty());
        assert_eq!(size, 0);
    }

    #[tokio::test]
    async fn read_binary_content_preserves_bytes_exactly() {
        // 包含 0x00 和非 UTF-8 序列，验证不会做字符串转换
        let content: Vec<u8> = (0u8..=255).collect();
        let tmp = TempFile::new(&content);

        let (bytes, size) = read_file_bytes(tmp.path.to_str().unwrap(), 1024)
            .await
            .expect("二进制文件应能读取");

        assert_eq!(bytes, content);
        assert_eq!(size, 256);
    }

    #[tokio::test]
    async fn read_nonexistent_file_returns_file_io_error() {
        let bogus = std::env::temp_dir().join("picnexus_test_does_not_exist_12345.bin");
        // 万一存在（极小概率），先删掉
        let _ = std::fs::remove_file(&bogus);

        let result = read_file_bytes(bogus.to_str().unwrap(), 1024).await;

        match result {
            Err(AppError::FileIo { message }) => {
                assert!(
                    message.contains("无法打开文件"),
                    "错误消息应指明打开失败: {}",
                    message
                );
            }
            Err(e) => panic!("应为 FileIo 错误，实际: {:?}", e),
            Ok(_) => panic!("不存在的文件不应成功读取"),
        }
    }

    #[tokio::test]
    async fn probe_upload_file_size_returns_size_without_reading() {
        let content = b"hello picnexus";
        let tmp = TempFile::new(content);

        let size = probe_upload_file_size(tmp.path.to_str().unwrap(), 1024)
            .await
            .expect("应能读取文件大小");

        assert_eq!(size, content.len() as u64);
    }

    #[tokio::test]
    async fn probe_upload_file_size_rejects_oversized_file() {
        // 稀疏文件：元数据声明 64MB，但不占实际磁盘——正好验证"不读内容也能拦下"
        let path = std::env::temp_dir().join(format!(
            "picnexus_probe_{}_{}",
            std::process::id(),
            TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        let file = std::fs::File::create(&path).expect("创建稀疏文件失败");
        file.set_len(64 * 1024 * 1024)
            .expect("设置稀疏文件大小失败");

        let result = probe_upload_file_size(path.to_str().unwrap(), 1024).await;
        let _ = std::fs::remove_file(&path);

        assert!(matches!(result, Err(AppError::Validation { .. })));
    }

    #[tokio::test]
    async fn probe_upload_file_size_rejects_missing_file() {
        let bogus = std::env::temp_dir().join("picnexus_probe_does_not_exist_12345.bin");
        let _ = std::fs::remove_file(&bogus);

        let result = probe_upload_file_size(bogus.to_str().unwrap(), 1024).await;

        assert!(matches!(result, Err(AppError::FileIo { .. })));
    }

    #[tokio::test]
    async fn rejects_sparse_file_from_metadata_before_reading() {
        let path = std::env::temp_dir().join(format!(
            "picnexus_sparse_{}_{}",
            std::process::id(),
            TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed),
        ));
        let file = std::fs::File::create(&path).expect("创建稀疏文件失败");
        file.set_len(64 * 1024 * 1024)
            .expect("设置稀疏文件大小失败");

        let result = read_file_bytes(path.to_str().unwrap(), 1024).await;
        let _ = std::fs::remove_file(&path);

        assert!(matches!(result, Err(AppError::Validation { .. })));
    }
}

// ──────────────────────────────────────────────
// 上传文件名唯一化
// ──────────────────────────────────────────────

/// 随机段长度（base36）。36^4 ≈ 168 万种组合——碰撞只在
/// 「同一天 + 同一个原文件名 + 同一个随机段」三者同时命中时才发生。
///
/// 与前端 `src/uploaders/s3/objectKey.ts` 的 `RANDOM_SEGMENT_LENGTH` 保持一致。
const RANDOM_SEGMENT_LENGTH: u32 = 4;

const BASE36_DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

fn to_base36_padded(mut value: u64, width: usize) -> String {
    let mut buf = Vec::with_capacity(width);
    if value == 0 {
        buf.push(b'0');
    }
    while value > 0 {
        buf.push(BASE36_DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    while buf.len() < width {
        buf.push(b'0');
    }
    buf.reverse();
    String::from_utf8(buf).expect("base36 字符集全是 ASCII")
}

/// 生成「日期_随机」唯一标记，如 `20260817_a3f9`
///
/// 用**本地时间**而不是 UTC：前端 `formatDateCompact` 走的是 `Date.getFullYear()` 等本地方法，
/// 两边错开时区会让同一次操作在 GUI 与 CLI 下落到不同日期段。
fn unique_token() -> String {
    use rand::Rng;
    let date = chrono::Local::now().format("%Y%m%d").to_string();
    let space = 36u64.pow(RANDOM_SEGMENT_LENGTH);
    let value = rand::thread_rng().gen_range(0..space);
    format!("{}_{}", date, to_base36_padded(value, RANDOM_SEGMENT_LENGTH as usize))
}

/// S3 系对象名唯一化：`{yyyyMMdd}_{随机}_{原文件名}`
///
/// 与前端 `objectKey.ts::buildObjectKey` 同格式——GUI 走前端那份、编辑器/CLI 走这份，
/// 同一个桶里两条路径产出的对象名必须长得一样，否则用户会以为撞上了两种不同的东西。
pub fn prefix_unique_file_name(file_name: &str) -> String {
    format!("{}_{}", unique_token(), file_name)
}

/// WebDAV 文件名唯一化：`{原名主干}_{yyyyMMdd}_{随机}.{扩展名}`
///
/// Why 顺序与 S3 系相反（原名在**前**）：这是按「最重要的参数放最前面」这条命名规范
/// 算出来的——S3 桶基本没人用文件管理器去翻，日期在前便于按时间扫读；而 WebDAV 通常
/// 指向用户自己的 NAS，那个目录是**人会去翻的**，此时最重要的是「这是哪张图」。
/// 两套顺序不同是刻意的，**不要为了"统一"把它们合并掉**。
pub fn suffix_unique_file_name(file_name: &str) -> String {
    let path = std::path::Path::new(file_name);
    let stem = path.file_stem().and_then(|s| s.to_str());
    let ext = path.extension().and_then(|e| e.to_str());

    match (stem, ext) {
        (Some(stem), Some(ext)) => format!("{}_{}.{}", stem, unique_token(), ext),
        (Some(stem), None) => format!("{}_{}", stem, unique_token()),
        // 文件名不是合法 UTF-8 或形如 ".gitignore"：整体附加，至少保证唯一
        _ => format!("{}_{}", file_name, unique_token()),
    }
}

#[cfg(test)]
mod unique_name_tests {
    use super::*;

    fn today() -> String {
        chrono::Local::now().format("%Y%m%d").to_string()
    }

    #[test]
    fn prefix_style_matches_frontend_object_key_shape() {
        let key = prefix_unique_file_name("image.png");
        let re_prefix = format!("{}_", today());

        assert!(key.starts_with(&re_prefix), "应以本地日期开头: {}", key);
        assert!(key.ends_with("_image.png"), "原文件名应留在末尾: {}", key);
        // {日期}_{4位随机}_{原名}
        assert_eq!(key.len(), 8 + 1 + 4 + 1 + "image.png".len());
    }

    #[test]
    fn suffix_style_keeps_original_name_in_front_and_extension_last() {
        let name = suffix_unique_file_name("image.png");

        assert!(name.starts_with("image_"), "原名应在最前: {}", name);
        assert!(name.ends_with(".png"), "扩展名必须保住，Rust 侧靠它推断 Content-Type: {}", name);
        assert!(name.contains(&today()));
        assert_eq!(name.len(), "image".len() + 1 + 8 + 1 + 4 + ".png".len());
    }

    #[test]
    fn suffix_style_handles_names_without_extension() {
        let name = suffix_unique_file_name("screenshot");
        assert!(name.starts_with("screenshot_"), "{}", name);
        assert!(!name.contains('.'), "没有扩展名就不该凭空造一个: {}", name);
    }

    #[test]
    fn suffix_style_keeps_only_the_last_extension() {
        // 多点文件名：`archive.tar.gz` 的 stem 是 `archive.tar`
        let name = suffix_unique_file_name("archive.tar.gz");
        assert!(name.starts_with("archive.tar_"), "{}", name);
        assert!(name.ends_with(".gz"), "{}", name);
    }

    #[test]
    fn generated_names_differ_across_calls() {
        // 随机段的意义就在这：同名文件连传两次不能落到同一个名字上
        let names: std::collections::HashSet<String> =
            (0..64).map(|_| suffix_unique_file_name("image.png")).collect();
        assert!(names.len() > 60, "64 次调用应产出近乎全不重复的名字，实际 {}", names.len());
    }

    #[test]
    fn base36_is_left_padded_to_fixed_width() {
        assert_eq!(to_base36_padded(0, 4), "0000");
        assert_eq!(to_base36_padded(35, 4), "000z");
        assert_eq!(to_base36_padded(36, 4), "0010");
        assert_eq!(to_base36_padded(36 * 36 * 36 * 36 - 1, 4), "zzzz");
    }
}
