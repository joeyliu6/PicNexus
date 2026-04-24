// MD 文件批量扫描 + 图片链接提取
// 单次 IPC 完成递归目录遍历 + 文件读取 + 正则提取，消除 JS 侧数百次 IPC 往返

use crate::error::AppError;
use fancy_regex::Regex as FancyRegex;
use regex::Regex;
use std::sync::LazyLock;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

/// 递归深度上限。Windows MAX_PATH 260 字符，深度超过这个量级基本是循环或恶意构造。
const MAX_SCAN_DEPTH: usize = 64;

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
///
/// 安全约束：
/// - visited 记录已规范化的目录，避免符号链接循环导致栈溢出
/// - depth 限制递归深度，兜底防止 visited 因规范化失败失守
fn scan_md_files(
    dir: &Path,
    include_subfolders: bool,
    cancel: &AtomicBool,
    results: &mut Vec<String>,
    skipped_dirs: &mut Vec<String>,
    visited: &mut HashSet<PathBuf>,
    depth: usize,
) {
    if cancel.load(Ordering::Relaxed) {
        return;
    }

    if depth > MAX_SCAN_DEPTH {
        log::warn!("[MdScanner] 超过最大递归深度，跳过: {:?}", dir);
        skipped_dirs.push(dir.to_string_lossy().into_owned());
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
        // 规范化后再查重：解析符号链接，避免 a/link → a 的循环
        let canonical = match std::fs::canonicalize(&sub) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[MdScanner] 规范化子目录失败，跳过: {:?} - {}", sub, e);
                skipped_dirs.push(sub.to_string_lossy().into_owned());
                continue;
            }
        };
        if !visited.insert(canonical) {
            log::debug!("[MdScanner] 跳过已访问目录（防循环）: {:?}", sub);
            continue;
        }
        scan_md_files(
            &sub,
            include_subfolders,
            cancel,
            results,
            skipped_dirs,
            visited,
            depth + 1,
        );
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
/// include_code_blocks=true 时不跳过围栏块和行内代码，与 JS 侧 options.includeCodeBlocks 语义相同
fn extract_image_links(content: &str, include_code_blocks: bool) -> Vec<MdImageLink> {
    let mut results = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    let mut inside_fence = false;

    for (i, line) in content.lines().enumerate() {
        let line_number = i + 1;

        if !include_code_blocks {
            // 围栏代码块
            if FENCE_RE.is_match(line) {
                inside_fence = !inside_fence;
                continue;
            }
            if inside_fence {
                continue;
            }
        }

        // 代码块模式下直接用原始行，否则剥离行内代码
        let stripped = if include_code_blocks {
            line.to_string()
        } else {
            strip_inline_code(line)
        };

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
    include_code_blocks: bool,
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
        let mut visited: HashSet<PathBuf> = HashSet::new();
        // 入口目录已在外层 canonicalize 过，先塞入 visited 防自环
        visited.insert(PathBuf::from(&dir_clone));
        scan_md_files(
            Path::new(&dir_clone),
            include_subfolders,
            &cancel_clone,
            &mut paths,
            &mut skipped,
            &mut visited,
            0,
        );

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
                    let links = extract_image_links(&content, include_code_blocks);
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

// ==================== 单元测试 ====================

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- is_markdown_file ----------

    #[test]
    fn is_markdown_file_accepts_common_extensions() {
        assert!(is_markdown_file("README.md"));
        assert!(is_markdown_file("note.markdown"));
    }

    #[test]
    fn is_markdown_file_is_case_insensitive() {
        assert!(is_markdown_file("README.MD"));
        assert!(is_markdown_file("Note.Markdown"));
    }

    #[test]
    fn is_markdown_file_rejects_non_md_extensions() {
        assert!(!is_markdown_file("image.png"));
        assert!(!is_markdown_file("script.js"));
        assert!(!is_markdown_file("noext"));
        assert!(!is_markdown_file(""));
    }

    #[test]
    fn is_markdown_file_rejects_similar_but_wrong_extensions() {
        assert!(!is_markdown_file("file.mdx"));
        assert!(!is_markdown_file("file.md.bak"));
    }

    // ---------- detect_context ----------

    #[test]
    fn detect_context_blockquote() {
        assert_eq!(detect_context("> quoted line"), "blockquote");
        assert_eq!(detect_context("  > indented quote"), "blockquote");
    }

    #[test]
    fn detect_context_table() {
        assert_eq!(detect_context("| col1 | col2 |"), "table");
        assert_eq!(detect_context("a | b | c"), "table");
    }

    #[test]
    fn detect_context_normal() {
        assert_eq!(detect_context("plain paragraph"), "normal");
        assert_eq!(detect_context(""), "normal");
        assert_eq!(detect_context("only one | pipe"), "normal");
    }

    // ---------- is_valid_image_url ----------

    #[test]
    fn valid_http_and_https_urls() {
        assert!(is_valid_image_url("http://example.com/img.jpg"));
        assert!(is_valid_image_url("https://example.com/img.png"));
    }

    #[test]
    fn invalid_data_urls_and_anchors() {
        assert!(!is_valid_image_url(""));
        assert!(!is_valid_image_url("data:image/png;base64,xxx"));
        assert!(!is_valid_image_url("#anchor"));
    }

    #[test]
    fn invalid_relative_paths() {
        assert!(!is_valid_image_url("./local.jpg"));
        assert!(!is_valid_image_url("/abs/path.jpg"));
        assert!(!is_valid_image_url("ftp://example.com/x"));
    }

    // ---------- strip_inline_code ----------

    #[test]
    fn strip_inline_code_replaces_backticks_with_spaces() {
        let result = strip_inline_code("This `code` and more");
        // `code` 长度 6，应被替换为 6 个空格
        assert_eq!(result, "This        and more");
        assert_eq!(result.len(), "This `code` and more".len());
    }

    #[test]
    fn strip_inline_code_handles_multiple_spans() {
        let result = strip_inline_code("`a` and `bb` end");
        assert!(!result.contains('`'));
        assert_eq!(result.len(), "`a` and `bb` end".len());
    }

    #[test]
    fn strip_inline_code_preserves_non_code_text() {
        assert_eq!(strip_inline_code("no code here"), "no code here");
    }

    #[test]
    fn strip_inline_code_handles_triple_backtick_inline() {
        // ```x``` 也应被处理
        let result = strip_inline_code("a ```x``` b");
        assert_eq!(result.len(), "a ```x``` b".len());
        assert!(!result.contains("```x```"));
    }

    // ---------- extract_image_links ----------

    #[test]
    fn extract_markdown_image_syntax() {
        let content = "![alt text](https://example.com/img.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/img.jpg");
        assert_eq!(links[0].alt_text, "alt text");
        assert_eq!(links[0].syntax, "markdown");
        assert_eq!(links[0].line_number, 1);
        assert_eq!(links[0].context, "normal");
    }

    #[test]
    fn extract_html_img_tag() {
        let content = r#"<img src="https://example.com/x.png" alt="x" />"#;
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/x.png");
        assert_eq!(links[0].syntax, "html");
        assert_eq!(links[0].alt_text, ""); // HTML 正则不提取 alt
    }

    #[test]
    fn extract_skips_fenced_code_block_by_default() {
        let content = "\
![before](https://example.com/a.jpg)
```
![inside](https://example.com/b.jpg)
```
![after](https://example.com/c.jpg)";
        let links = extract_image_links(content, false);
        let urls: Vec<&str> = links.iter().map(|l| l.url.as_str()).collect();
        assert!(urls.contains(&"https://example.com/a.jpg"));
        assert!(urls.contains(&"https://example.com/c.jpg"));
        assert!(!urls.contains(&"https://example.com/b.jpg"));
    }

    #[test]
    fn extract_includes_fenced_code_when_flag_set() {
        let content = "\
```
![inside](https://example.com/b.jpg)
```";
        let links = extract_image_links(content, true);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/b.jpg");
    }

    #[test]
    fn extract_deduplicates_same_url() {
        let content = "\
![](https://example.com/same.jpg)
![again](https://example.com/same.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
    }

    #[test]
    fn extract_detects_blockquote_context() {
        let content = "> ![](https://example.com/q.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].context, "blockquote");
    }

    #[test]
    fn extract_detects_table_context() {
        let content = "| cell | ![](https://example.com/t.jpg) |";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].context, "table");
    }

    #[test]
    fn extract_ignores_image_inside_inline_code() {
        // ![inline](https://example.com/x.jpg) 包在反引号里应被忽略
        let content = "前 `![inline](https://example.com/x.jpg)` 后";
        let links = extract_image_links(content, false);
        assert!(links.is_empty(), "行内代码里的 markdown 图片应被忽略");
    }

    #[test]
    fn extract_ignores_data_url_and_anchors() {
        let content = "\
![bad](data:image/png;base64,abc)
![bad2](#anchor)
![good](https://example.com/ok.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/ok.jpg");
    }

    #[test]
    fn extract_assigns_correct_line_numbers() {
        let content = "\
line 1
line 2
![x](https://example.com/y.jpg)
line 4";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].line_number, 3);
    }

    #[test]
    fn extract_handles_mixed_markdown_and_html() {
        let content = "\
![md](https://example.com/md.jpg)
<img src=\"https://example.com/html.jpg\" />";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 2);
        let syntaxes: Vec<&str> = links.iter().map(|l| l.syntax.as_str()).collect();
        assert!(syntaxes.contains(&"markdown"));
        assert!(syntaxes.contains(&"html"));
    }

    #[test]
    fn extract_empty_content_returns_empty() {
        assert!(extract_image_links("", false).is_empty());
        assert!(extract_image_links("no images here", false).is_empty());
    }

    #[test]
    fn extract_original_text_preserves_exact_markdown() {
        let content = "![alt](https://example.com/x.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links[0].original_text, "![alt](https://example.com/x.jpg)");
    }
}
