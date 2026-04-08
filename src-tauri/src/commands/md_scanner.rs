// MD 文件批量扫描 + 图片链接提取
// 单次 IPC 完成递归目录遍历 + 文件读取 + 正则提取，消除 JS 侧数百次 IPC 往返

use crate::error::AppError;
use fancy_regex::Regex as FancyRegex;
use regex::Regex;
use std::sync::LazyLock;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

// 预编译正则（全局只编译一次）
static MD_IMAGE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)"#).unwrap());
static HTML_IMG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<img[^>]+src=["']([^"']+)["'][^>]*/?\s*>"#).unwrap());
static FENCE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(```|~~~)").unwrap());
// 行内代码：使用 fancy-regex 支持 backreference，与 JS 侧正则完全一致
static INLINE_CODE_RE: LazyLock<FancyRegex> =
    LazyLock::new(|| FancyRegex::new(r"(`{1,3})(?:(?!\1).)+\1").unwrap());

/// 单张图片链接
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdImageLink {
    pub original_text: String,
    pub url: String,
    pub alt_text: String,
    pub line_number: usize,
    /// "markdown" | "html"
    pub syntax: String,
    /// "normal" | "blockquote" | "table"
    pub context: String,
}

/// 单个文件的扫描结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdFileResult {
    pub file_path: String,
    pub file_name: String,
    pub links: Vec<MdImageLink>,
}

/// 进度事件
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    /// "scanning" | "reading"
    pub phase: String,
    /// 已发现的 MD 文件数
    pub scanned_files: usize,
    /// 已读取完的文件数
    pub processed_files: usize,
    /// 总文件数（reading 阶段有值）
    pub total_files: usize,
    /// 已提取的链接数
    pub found_links: usize,
    /// 当前处理的文件名（用于 UI 展示）
    pub current_file: String,
}

/// 最终返回
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<MdFileResult>,
    pub total_files: usize,
    pub total_links: usize,
    pub elapsed_ms: u64,
    pub cancelled: bool,
    /// 因权限不足等原因跳过的目录列表
    pub skipped_dirs: Vec<String>,
}

/// 取消标志
pub struct MdScanCancelFlag(pub Arc<AtomicBool>);

/// MD 文件扩展名
const MD_EXTENSIONS: &[&str] = &[".md", ".markdown"];

fn is_markdown_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    MD_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

/// 递归扫描目录，收集所有 MD 文件路径
fn scan_md_files(
    dir: &Path,
    include_subfolders: bool,
    cancel: &AtomicBool,
    results: &mut Vec<String>,
    skipped_dirs: &mut Vec<String>,
) {
    if cancel.load(Ordering::Relaxed) {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("[MdScanner] 读取目录失败: {:?} - {}", dir, e);
            skipped_dirs.push(dir.to_string_lossy().into_owned());
            return;
        }
    };

    let mut sub_dirs = Vec::new();

    for entry in entries.flatten() {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let path = entry.path();
        if path.is_dir() && include_subfolders {
            sub_dirs.push(path);
        } else if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if is_markdown_file(name) {
                    results.push(path.to_string_lossy().into_owned());
                }
            }
        }
    }

    for sub in sub_dirs {
        scan_md_files(&sub, include_subfolders, cancel, results, skipped_dirs);
    }
}

/// 检测行的上下文类型
fn detect_context(line: &str) -> &'static str {
    let trimmed = line.trim_start();
    if trimmed.starts_with('>') {
        return "blockquote";
    }
    if trimmed.starts_with('|') || trimmed.matches('|').count() >= 2 {
        return "table";
    }
    "normal"
}

/// 判断是否为有效的图片 URL
fn is_valid_image_url(url: &str) -> bool {
    if url.is_empty() || url.starts_with("data:") || url.starts_with('#') {
        return false;
    }
    url.starts_with("http://") || url.starts_with("https://")
}

/// 剥离行内代码，替换为等长空格（与 JS 侧 stripInlineCode 一致）
fn strip_inline_code(line: &str) -> String {
    INLINE_CODE_RE
        .replace_all(line, |caps: &fancy_regex::Captures| {
            " ".repeat(caps.get(0).unwrap().as_str().len())
        })
        .into_owned()
}

/// 从 Markdown 内容中提取图片链接（与 JS 侧 extractImageLinks 逻辑一致）
fn extract_image_links(content: &str) -> Vec<MdImageLink> {
    let mut results = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    let mut inside_fence = false;

    for (i, line) in content.lines().enumerate() {
        let line_number = i + 1;

        // 围栏代码块
        if FENCE_RE.is_match(line) {
            inside_fence = !inside_fence;
            continue;
        }
        if inside_fence {
            continue;
        }

        // 剥离行内代码（按 ``` → `` → ` 优先级，替换为等长空格）
        let stripped = strip_inline_code(line);

        let context = detect_context(line);

        // Markdown 图片
        for cap in MD_IMAGE_RE.captures_iter(&stripped) {
            let url = cap[2].trim();
            if is_valid_image_url(url) && seen_urls.insert(url.to_string()) {
                let start = cap.get(0).unwrap().start();
                let len = cap.get(0).unwrap().len();
                let original_text = if start + len <= line.len() {
                    line[start..start + len].to_string()
                } else {
                    cap[0].to_string()
                };
                results.push(MdImageLink {
                    original_text,
                    url: url.to_string(),
                    alt_text: cap[1].to_string(),
                    line_number,
                    syntax: "markdown".to_string(),
                    context: context.to_string(),
                });
            }
        }

        // HTML img 标签
        for cap in HTML_IMG_RE.captures_iter(&stripped) {
            let url = cap[1].trim();
            if is_valid_image_url(url) && seen_urls.insert(url.to_string()) {
                let start = cap.get(0).unwrap().start();
                let len = cap.get(0).unwrap().len();
                let original_text = if start + len <= line.len() {
                    line[start..start + len].to_string()
                } else {
                    cap[0].to_string()
                };
                results.push(MdImageLink {
                    original_text,
                    url: url.to_string(),
                    alt_text: String::new(),
                    line_number,
                    syntax: "html".to_string(),
                    context: context.to_string(),
                });
            }
        }
    }

    results
}

/// 主命令：单次 IPC 完成目录扫描 + 文件读取 + 链接提取
#[tauri::command]
pub async fn scan_md_folder(
    window: tauri::Window,
    dir: String,
    include_subfolders: bool,
    cancel_flag: tauri::State<'_, MdScanCancelFlag>,
) -> Result<ScanResult, AppError> {
    let start = std::time::Instant::now();
    let cancel = cancel_flag.0.clone();
    cancel.store(false, Ordering::SeqCst);

    // 路径安全校验：规范化 + 确认是目录
    let canonical = std::fs::canonicalize(&dir).map_err(|e| {
        AppError::file_io(format!("路径无效或不存在: {} ({})", dir, e))
    })?;
    if !canonical.is_dir() {
        return Err(AppError::file_io(format!("路径不是目录: {}", dir)));
    }

    // 阶段 1：目录扫描（同步 I/O，在 blocking 线程中执行）
    let dir_clone = canonical.to_string_lossy().to_string();
    let cancel_clone = cancel.clone();
    let window_clone = window.clone();
    let scan_result = tokio::task::spawn_blocking(move || {
        let mut paths = Vec::new();
        let mut skipped = Vec::new();
        scan_md_files(Path::new(&dir_clone), include_subfolders, &cancel_clone, &mut paths, &mut skipped);

        // 发送扫描完成进度
        let _ = window_clone.emit("md-scan://progress", ScanProgress {
            phase: "scanning".to_string(),
            scanned_files: paths.len(),
            processed_files: 0,
            total_files: 0,
            found_links: 0,
            current_file: String::new(),
        });

        (paths, skipped)
    })
    .await
    .map_err(|e| AppError::file_io(format!("扫描线程异常: {}", e)))?;

    let (md_paths, skipped_dirs) = scan_result;

    if cancel.load(Ordering::SeqCst) || md_paths.is_empty() {
        return Ok(ScanResult {
            files: vec![],
            total_files: md_paths.len(),
            total_links: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
            cancelled: cancel.load(Ordering::SeqCst),
            skipped_dirs,
        });
    }

    let total_files = md_paths.len();

    // 阶段 2：批量读取 + 链接提取（在 blocking 线程中执行）
    let cancel_clone = cancel.clone();
    let window_clone = window.clone();
    let files = tokio::task::spawn_blocking(move || {
        let mut results: Vec<MdFileResult> = Vec::new();
        let mut total_links = 0usize;

        for (idx, path_str) in md_paths.iter().enumerate() {
            if cancel_clone.load(Ordering::Relaxed) {
                break;
            }

            let file_name = Path::new(path_str)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            match std::fs::read_to_string(path_str) {
                Ok(content) => {
                    let links = extract_image_links(&content);
                    total_links += links.len();
                    results.push(MdFileResult {
                        file_path: path_str.clone(),
                        file_name: file_name.clone(),
                        links,
                    });
                }
                Err(e) => {
                    log::warn!("[MdScanner] 读取文件失败: {} - {}", path_str, e);
                }
            }

            // 每 5 个文件或最后一个文件发送进度
            if (idx + 1) % 5 == 0 || idx + 1 == total_files {
                let _ = window_clone.emit("md-scan://progress", ScanProgress {
                    phase: "reading".to_string(),
                    scanned_files: total_files,
                    processed_files: idx + 1,
                    total_files,
                    found_links: total_links,
                    current_file: file_name,
                });
            }
        }

        (results, total_links)
    })
    .await
    .map_err(|e| AppError::file_io(format!("读取线程异常: {}", e)))?;

    let cancelled = cancel.load(Ordering::SeqCst);
    let elapsed_ms = start.elapsed().as_millis() as u64;

    log::info!(
        "[MdScanner] 完成: {} 文件, {} 链接, {}ms, 取消={}",
        files.0.len(),
        files.1,
        elapsed_ms,
        cancelled,
    );

    Ok(ScanResult {
        total_files: files.0.len(),
        total_links: files.1,
        files: files.0,
        elapsed_ms,
        cancelled,
        skipped_dirs,
    })
}

/// 取消扫描
#[tauri::command]
pub async fn cancel_md_scan(
    cancel_flag: tauri::State<'_, MdScanCancelFlag>,
) -> Result<(), AppError> {
    log::info!("[MdScanner] 收到取消请求");
    cancel_flag.0.store(true, Ordering::SeqCst);
    Ok(())
}
