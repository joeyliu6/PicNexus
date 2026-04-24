// src-tauri/src/commands/utils.rs
// 通用工具函数

use tokio::fs::File;
use tokio::io::AsyncReadExt;

use crate::error::AppError;

/// 读取文件到字节数组
///
/// # 参数
/// - `path`: 文件路径
///
/// # 返回
/// - `Ok((Vec<u8>, u64))`: 文件内容和文件大小
/// - `Err(AppError)`: 文件 IO 错误
pub async fn read_file_bytes(path: &str) -> Result<(Vec<u8>, u64), AppError> {
    let mut file = File::open(path)
        .await
        .map_err(|e| AppError::file_io(format!("无法打开文件: {}", e)))?;

    let file_size = file
        .metadata()
        .await
        .map_err(|e| AppError::file_io(format!("无法获取文件元数据: {}", e)))?
        .len();

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .await
        .map_err(|e| AppError::file_io(format!("无法读取文件: {}", e)))?;

    Ok((buffer, file_size))
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
            let path = std::env::temp_dir()
                .join(format!("picnexus_test_{}_{}.bin", std::process::id(), seq));
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

        let (bytes, size) = read_file_bytes(tmp.path.to_str().unwrap())
            .await
            .expect("应能读取存在的文件");

        assert_eq!(bytes, content);
        assert_eq!(size, content.len() as u64);
    }

    #[tokio::test]
    async fn read_empty_file_returns_zero_length() {
        let tmp = TempFile::new(&[]);

        let (bytes, size) = read_file_bytes(tmp.path.to_str().unwrap())
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

        let (bytes, size) = read_file_bytes(tmp.path.to_str().unwrap())
            .await
            .expect("二进制文件应能读取");

        assert_eq!(bytes, content);
        assert_eq!(size, 256);
    }

    #[tokio::test]
    async fn read_nonexistent_file_returns_file_io_error() {
        let bogus = std::env::temp_dir()
            .join("picnexus_test_does_not_exist_12345.bin");
        // 万一存在（极小概率），先删掉
        let _ = std::fs::remove_file(&bogus);

        let result = read_file_bytes(bogus.to_str().unwrap()).await;

        match result {
            Err(AppError::FileIo { message }) => {
                assert!(message.contains("无法打开文件"), "错误消息应指明打开失败: {}", message);
            }
            Err(e) => panic!("应为 FileIo 错误，实际: {:?}", e),
            Ok(_) => panic!("不存在的文件不应成功读取"),
        }
    }
}
