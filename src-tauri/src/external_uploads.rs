// src-tauri/src/external_uploads.rs
// 软件外上传（命令行 / Typora 配置档 / 编辑器服务）的「待入库」收件箱。
//
// Why 不直接写历史库：历史库的表结构只由前端维护（SchemaManager.ts），Rust 再抄一份就得两边同步改；
// 命令行又是单独的进程，写了库开着的主界面也不知道。所以这里每成功一张，只在用户数据目录的
// `pending-uploads/` 下落一个 JSON 文件；主界面启动、窗口拿到焦点、编辑器服务传完时，
// 前端（src/composables/history/externalUploads.ts）把它们写进历史库，写完再删。
// 流程见 docs/flows/history-flow.md「软件外的上传」。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::commands::image_meta::{get_image_metadata, ImageMetadata};

/// 收件箱目录名（在用户数据目录下，与 cli-config.json 同级）
pub const INBOX_DIR: &str = "pending-uploads";

/// 编辑器服务记下一条后发给主界面的事件（前端 externalUploads.ts 的同名常量）
pub const EXTERNAL_UPLOAD_EVENT: &str = "external-uploads://recorded";

/// 这张图从哪条路传上去的
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UploadSource {
    /// `picnexus --service <id>`：图床编号就是用户传的那个，是完整的
    Cli,
    /// `picnexus --profile typora`：只知道图床类型，WebDAV / 自定义 S3 由前端按设置补全
    Typora,
    /// 编辑器服务（Obsidian 插件等）：同上，按设置里编辑器服务用的图床补全
    Editor,
}

/// 一条待入库的上传记录
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalUpload {
    /// 只含数字和 `-`，同时用作文件名和历史记录 ID
    pub id: String,
    /// 上传完成的时间（毫秒）
    pub timestamp: i64,
    pub source: UploadSource,
    pub service_id: String,
    pub url: String,
    pub file_name: String,
    /// 用户本机的原图路径；编辑器服务收到的是图片内容（只有临时文件），这里为空
    pub file_path: Option<String>,
    pub metadata: ImageMetadata,
}

/// 往哪个目录记；GUI 进程里额外带上 AppHandle，记完通知主界面
#[derive(Clone)]
pub struct ExternalUploadSink {
    data_dir: PathBuf,
    app: Option<tauri::AppHandle>,
}

impl ExternalUploadSink {
    pub fn new(data_dir: PathBuf, app: Option<tauri::AppHandle>) -> Self {
        Self { data_dir, app }
    }

    /// 记一条成功的上传。只记日志、不报错：历史记不上不能让已经成功的上传变成失败
    pub fn record(
        &self,
        image_path: &Path,
        file_path: Option<&str>,
        source: UploadSource,
        service_id: &str,
        url: &str,
    ) {
        let entry = build_entry(image_path, file_path, source, service_id, url);
        if let Err(e) = write_entry(&self.data_dir, &entry) {
            log::warn!("[ExternalUploads] 记录上传失败（历史里会缺这一条）: {}", e);
            return;
        }
        if let Some(app) = &self.app {
            use tauri::Emitter;
            if let Err(e) = app.emit(EXTERNAL_UPLOAD_EVENT, ()) {
                log::warn!("[ExternalUploads] 通知主界面失败: {}", e);
            }
        }
    }
}

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 毫秒 + 进程号 + 进程内序号：几个命令行进程同时传也不会撞名
fn new_id(timestamp: i64) -> String {
    let seq = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", timestamp, std::process::id(), seq)
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// 图片尺寸在这里就读好：编辑器服务的临时文件、Typora 的粘贴图，过后可能就没了
pub fn build_entry(
    image_path: &Path,
    file_path: Option<&str>,
    source: UploadSource,
    service_id: &str,
    url: &str,
) -> ExternalUpload {
    let timestamp = chrono::Utc::now().timestamp_millis();
    let metadata = get_image_metadata(image_path.to_string_lossy().into_owned()).unwrap_or_else(|e| {
        // 与前端 getImageMetadata 失败时的兜底一致
        log::warn!("[ExternalUploads] 读取图片尺寸失败: {}", e);
        ImageMetadata { width: 0, height: 0, aspect_ratio: 1.0, file_size: 0, format: "unknown".to_string() }
    });
    let file_name = image_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "未知文件".to_string());
    ExternalUpload {
        id: new_id(timestamp),
        timestamp,
        source,
        service_id: service_id.to_string(),
        url: url.to_string(),
        file_name,
        file_path: file_path.map(str::to_string),
        metadata,
    }
}

fn inbox_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(INBOX_DIR)
}

/// 先写临时文件再改名：前端列目录时只会看到写完整的 `.json`
pub fn write_entry(data_dir: &Path, entry: &ExternalUpload) -> Result<(), String> {
    let dir = inbox_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建 {}: {}", INBOX_DIR, e))?;
    let json = serde_json::to_vec(entry).map_err(|e| format!("序列化失败: {}", e))?;
    let tmp = dir.join(format!("{}.json.tmp", entry.id));
    std::fs::write(&tmp, json).map_err(|e| format!("写入失败: {}", e))?;
    std::fs::rename(&tmp, dir.join(format!("{}.json", entry.id)))
        .map_err(|e| format!("改名失败: {}", e))
}

/// 列出全部待入库记录（按时间先后）。读不了的坏文件记日志后删掉，免得每次都卡在它上面
pub fn list_entries(data_dir: &Path) -> Result<Vec<ExternalUpload>, String> {
    let dir = inbox_dir(data_dir);
    let reader = match std::fs::read_dir(&dir) {
        Ok(reader) => reader,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("无法读取 {}: {}", INBOX_DIR, e)),
    };
    let mut entries = Vec::new();
    for item in reader.flatten() {
        let path = item.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let parsed = std::fs::read(&path)
            .map_err(|e| e.to_string())
            .and_then(|bytes| serde_json::from_slice::<ExternalUpload>(&bytes).map_err(|e| e.to_string()));
        match parsed {
            Ok(entry) if is_valid_id(&entry.id) => entries.push(entry),
            Ok(_) | Err(_) => {
                log::warn!("[ExternalUploads] 丢弃无法读取的记录: {:?} ({:?})", path.file_name(), parsed.err());
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp).then_with(|| a.id.cmp(&b.id)));
    Ok(entries)
}

/// 删掉已经写进历史库的记录；不合法的 ID 直接跳过，防止拼出目录外的路径
pub fn remove_entries(data_dir: &Path, ids: &[String]) -> Result<(), String> {
    let dir = inbox_dir(data_dir);
    for id in ids.iter().filter(|id| is_valid_id(id)) {
        match std::fs::remove_file(dir.join(format!("{}.json", id))) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("删除记录 {} 失败: {}", id, e)),
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn temp_data_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "picnexus-external-uploads-{}-{}-{}",
            name,
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn write_png(dir: &Path, name: &str, width: u32, height: u32) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        image::RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 255]))
            .save(&path)
            .unwrap();
        path
    }

    #[test]
    fn recorded_upload_can_be_listed_then_removed() {
        let data_dir = temp_data_dir("roundtrip");
        let image = write_png(&data_dir.join("src"), "头像.png", 4, 2);
        let sink = ExternalUploadSink::new(data_dir.clone(), None);

        sink.record(&image, Some("C:/pics/头像.png"), UploadSource::Cli, "github", "https://x/头像.png");

        let entries = list_entries(&data_dir).unwrap();
        assert_eq!(entries.len(), 1);
        let entry = &entries[0];
        assert_eq!(entry.service_id, "github");
        assert_eq!(entry.source, UploadSource::Cli);
        assert_eq!(entry.url, "https://x/头像.png");
        assert_eq!(entry.file_name, "头像.png");
        assert_eq!(entry.file_path.as_deref(), Some("C:/pics/头像.png"));
        assert_eq!((entry.metadata.width, entry.metadata.height), (4, 2));
        assert_eq!(entry.metadata.format, "png");

        remove_entries(&data_dir, &[entry.id.clone()]).unwrap();
        assert!(list_entries(&data_dir).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    #[test]
    fn missing_inbox_lists_nothing() {
        let data_dir = temp_data_dir("missing");
        assert!(list_entries(&data_dir).unwrap().is_empty());
    }

    #[test]
    fn unreadable_image_still_records_with_fallback_metadata() {
        let data_dir = temp_data_dir("gone");
        let entry = build_entry(&data_dir.join("已删除.png"), None, UploadSource::Editor, "webdav", "https://x/a.png");
        assert_eq!(entry.metadata.width, 0);
        assert_eq!(entry.metadata.aspect_ratio, 1.0);
        assert_eq!(entry.file_name, "已删除.png");
    }

    #[test]
    fn corrupt_file_is_dropped_and_tmp_files_ignored() {
        let data_dir = temp_data_dir("corrupt");
        let dir = inbox_dir(&data_dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("1-1-1.json"), b"{not json").unwrap();
        std::fs::write(dir.join("1-1-2.json.tmp"), b"{}").unwrap();

        assert!(list_entries(&data_dir).unwrap().is_empty());
        assert!(!dir.join("1-1-1.json").exists(), "坏文件应当被删掉");
        assert!(dir.join("1-1-2.json.tmp").exists(), "没写完的临时文件不该被动");
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    #[test]
    fn remove_ignores_ids_that_would_escape_the_inbox() {
        let data_dir = temp_data_dir("escape");
        std::fs::create_dir_all(&data_dir).unwrap();
        let outside = data_dir.join("cli-config.json");
        std::fs::write(&outside, b"keep").unwrap();

        remove_entries(&data_dir, &["../cli-config".to_string()]).unwrap();
        assert!(outside.exists());
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    #[test]
    fn ids_from_one_process_never_collide() {
        let a = new_id(1);
        let b = new_id(1);
        assert_ne!(a, b);
        assert!(is_valid_id(&a));
    }
}
