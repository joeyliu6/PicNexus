// MD 文件批量扫描 + 图片链接提取
// 单次 IPC 完成递归目录遍历 + 文件读取 + 正则提取，消除 JS 侧数百次 IPC 往返

use crate::error::AppError;
use crate::log_utils::safe_path;
use fancy_regex::Regex as FancyRegex;
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::LazyLock;
use tauri::Emitter;

/// 递归深度上限。Windows MAX_PATH 260 字符，深度超过这个量级基本是循环或恶意构造。
const MAX_SCAN_DEPTH: usize = 64;

// 预编译正则（全局只编译一次）
static HTML_IMG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"<img[^>]+src=["']([^"']+)["'][^>]*/?\s*>"#).unwrap());
// 围栏代码块首行（3+ 连续反引号或波浪号）
// 按 CommonMark：
// - 允许 0-3 空格缩进（≥4 空格属于缩进代码块，不是围栏）
// - open fence 可以带 info string（如 ```python）
// - close fence 必须与 open 同字符、数量 ≥ open，且尾部只能是空白
static FENCE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^ {0,3}(`{3,}|~{3,})").unwrap());
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

/// 明确"不是图片"的文件扩展名黑名单（小写，不带点）
/// 用于过滤徽章/代理服务 URL 中嵌套的 .js/.css 等资源路径被误识为图片
/// 未列出的扩展名（包括图床 ID 无扩展 URL）一律放行
/// 必须与 JS 侧 `src/utils/mdParser.ts` 的 NON_IMAGE_EXTENSIONS 保持一致
const NON_IMAGE_EXTENSIONS: &[&str] = &[
    // 脚本/样式/源码
    "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "sass", "less",
    // 标记/数据
    "html", "htm", "xml", "json", "yaml", "yml", "toml", "csv", // 文档
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "markdown",
    // 归档
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", // 可执行/安装包
    "exe", "dmg", "msi", "deb", "rpm", "apk", "ipa", // 音视频
    "mp4", "webm", "mkv", "avi", "mov", "mp3", "wav", "ogg", "flac", "aac",
];

/// 提取 URL path 末段的扩展名（小写），无扩展或 dotfile 返回 None
fn get_url_path_extension(url: &str) -> Option<String> {
    // 去掉 query / fragment 再取最后一段
    let path_only = url.split(['?', '#']).next().unwrap_or("");
    let last_seg = path_only.rsplit('/').next().unwrap_or("");
    // rfind 找最后一个点；位置为 0 视为 dotfile（.htaccess 之类），不算扩展
    match last_seg.rfind('.') {
        Some(idx) if idx > 0 => Some(last_seg[idx + 1..].to_lowercase()),
        _ => None,
    }
}

/// 判断是否为有效的图片 URL（过滤 data:、相对路径、非图片扩展名等）
fn is_valid_image_url(url: &str) -> bool {
    if url.is_empty() || url.starts_with("data:") || url.starts_with('#') {
        return false;
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return false;
    }
    if let Some(ext) = get_url_path_extension(url) {
        if NON_IMAGE_EXTENSIONS.iter().any(|&e| e == ext) {
            return false;
        }
    }
    true
}

/// 剥离行内代码，替换为等长空格（与 JS 侧 stripInlineCode 一致）
fn strip_inline_code(line: &str) -> String {
    INLINE_CODE_RE
        .replace_all(line, |caps: &fancy_regex::Captures| {
            " ".repeat(caps.get(0).unwrap().as_str().len())
        })
        .into_owned()
}

struct MarkdownImageMatch {
    start: usize,
    end: usize,
    alt: String,
    url: String,
}

fn is_escaped(bytes: &[u8], index: usize) -> bool {
    let mut count = 0usize;
    let mut i = index;
    while i > 0 {
        i -= 1;
        if bytes[i] == b'\\' {
            count += 1;
        } else {
            break;
        }
    }
    count % 2 == 1
}

fn find_unescaped_byte(bytes: &[u8], target: u8, from: usize) -> Option<usize> {
    (from..bytes.len()).find(|&i| bytes[i] == target && !is_escaped(bytes, i))
}

fn parse_title_and_close(bytes: &[u8], pos: usize) -> Option<usize> {
    let mut i = pos;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i == pos || i >= bytes.len() || bytes[i] != b'"' {
        return None;
    }
    i += 1;
    while i < bytes.len() {
        if bytes[i] == b'"' && !is_escaped(bytes, i) {
            i += 1;
            return if i < bytes.len() && bytes[i] == b')' {
                Some(i + 1)
            } else {
                None
            };
        }
        i += 1;
    }
    None
}

fn parse_markdown_image_at(line: &str, start: usize) -> Option<MarkdownImageMatch> {
    let bytes = line.as_bytes();
    if start + 1 >= bytes.len() || bytes[start] != b'!' || bytes[start + 1] != b'[' {
        return None;
    }

    let alt_end = find_unescaped_byte(bytes, b']', start + 2)?;
    if alt_end + 1 >= bytes.len() || bytes[alt_end + 1] != b'(' {
        return None;
    }

    let url_start = alt_end + 2;
    if url_start >= bytes.len() {
        return None;
    }

    let alt = line[start + 2..alt_end].to_string();

    if bytes[url_start] == b'<' {
        let url_end = find_unescaped_byte(bytes, b'>', url_start + 1)?;
        let close = if url_end + 1 < bytes.len() && bytes[url_end + 1] == b')' {
            url_end + 2
        } else {
            parse_title_and_close(bytes, url_end + 1)?
        };
        return Some(MarkdownImageMatch {
            start,
            end: close,
            alt,
            url: line[url_start + 1..url_end].trim().to_string(),
        });
    }

    let mut depth = 0usize;
    let mut i = url_start;
    while i < bytes.len() {
        let b = bytes[i];
        if is_escaped(bytes, i) {
            i += 1;
            continue;
        }

        if b == b'(' {
            depth += 1;
        } else if b == b')' {
            if depth > 0 {
                depth -= 1;
            } else {
                return Some(MarkdownImageMatch {
                    start,
                    end: i + 1,
                    alt,
                    url: line[url_start..i].trim().to_string(),
                });
            }
        } else if b.is_ascii_whitespace() && depth == 0 {
            let close = parse_title_and_close(bytes, i)?;
            return Some(MarkdownImageMatch {
                start,
                end: close,
                alt,
                url: line[url_start..i].trim().to_string(),
            });
        }
        i += 1;
    }

    None
}

fn parse_markdown_image_matches(line: &str) -> Vec<MarkdownImageMatch> {
    let mut matches = Vec::new();
    let mut search_from = 0usize;

    while search_from < line.len() {
        let Some(relative_start) = line[search_from..].find("![") else {
            break;
        };
        let start = search_from + relative_start;
        if let Some(m) = parse_markdown_image_at(line, start) {
            search_from = m.end;
            matches.push(m);
        } else {
            search_from = start + 2;
        }
    }

    matches
}

/// 从 Markdown 内容中提取图片链接（与 JS 侧 extractImageLinks 逻辑一致）
/// include_code_blocks=true 时不跳过围栏块和行内代码，与 JS 侧 options.includeCodeBlocks 语义相同
fn extract_image_links(content: &str, include_code_blocks: bool) -> Vec<MdImageLink> {
    let mut results = Vec::new();
    let mut seen_urls = std::collections::HashSet::new();
    // 当前打开的围栏：(开头字符, 反引号/波浪数)；None 表示未在围栏内
    // 仅同字符且反引号数 ≥ open 时才关闭，避免 ``` 与 ~~~ 串扰和嵌套误判
    let mut fence_open: Option<(char, usize)> = None;

    for (i, line) in content.lines().enumerate() {
        let line_number = i + 1;

        if !include_code_blocks {
            if let Some(caps) = FENCE_RE.captures(line) {
                let m = caps.get(1).unwrap();
                let seq = m.as_str();
                let c = seq.chars().next().unwrap();
                let len = seq.len();
                // close fence 尾部必须只有空白（CommonMark 4.5），否则仍视为围栏内字面量
                let tail_ws = line[m.end()..].chars().all(char::is_whitespace);
                match fence_open {
                    None => {
                        fence_open = Some((c, len));
                        continue;
                    }
                    Some((oc, olen)) if oc == c && len >= olen && tail_ws => {
                        fence_open = None;
                        continue;
                    }
                    _ => {} // 同字符但长度不足 / 不同字符 / 尾部带 info string：视为围栏内字面量
                }
            }
            if fence_open.is_some() {
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
        for md_match in parse_markdown_image_matches(&stripped) {
            let url = md_match.url.trim();
            if is_valid_image_url(url) && seen_urls.insert(url.to_string()) {
                let original_text = if md_match.end <= line.len() {
                    line[md_match.start..md_match.end].to_string()
                } else {
                    stripped[md_match.start..md_match.end].to_string()
                };
                results.push(MdImageLink {
                    original_text,
                    url: url.to_string(),
                    alt_text: md_match.alt,
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
    let canonical = std::fs::canonicalize(&dir)
        .map_err(|e| AppError::file_io(format!("路径无效或不存在: {} ({})", dir, e)))?;
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
        let _ = window_clone.emit(
            "md-scan://progress",
            ScanProgress {
                phase: "scanning".to_string(),
                scanned_files: paths.len(),
                processed_files: 0,
                total_files: 0,
                found_links: 0,
                current_file: String::new(),
            },
        );

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
                    log::warn!("[MdScanner] 读取文件失败: {} - {}", safe_path(path_str), e);
                }
            }

            // 每 5 个文件或最后一个文件发送进度
            if (idx + 1) % 5 == 0 || idx + 1 == total_files {
                let _ = window_clone.emit(
                    "md-scan://progress",
                    ScanProgress {
                        phase: "reading".to_string(),
                        scanned_files: total_files,
                        processed_files: idx + 1,
                        total_files,
                        found_links: total_links,
                        current_file: file_name,
                    },
                );
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

    #[test]
    fn invalid_non_image_extension_badge_url() {
        // badge-size.now.sh 徽章代理把 .js 文件 URL 拼到 path 里 —— 按黑名单过滤
        assert!(!is_valid_image_url(
            "https://badge-size.now.sh/https://unpkg.com/@popperjs/core/dist/umd/popper.min.js?compression=brotli&label=popper"
        ));
    }

    #[test]
    fn invalid_various_non_image_extensions() {
        assert!(!is_valid_image_url("https://cdn.com/style.css"));
        assert!(!is_valid_image_url("https://cdn.com/page.html"));
        assert!(!is_valid_image_url("https://cdn.com/doc.pdf"));
        assert!(!is_valid_image_url("https://cdn.com/pkg.zip"));
        assert!(!is_valid_image_url("https://cdn.com/video.mp4"));
    }

    #[test]
    fn extension_check_is_case_insensitive() {
        assert!(!is_valid_image_url("https://cdn.com/foo.JS"));
        assert!(!is_valid_image_url("https://cdn.com/foo.Css"));
    }

    #[test]
    fn valid_image_extensions_pass_blocklist() {
        assert!(is_valid_image_url("https://cdn.com/a.svg"));
        assert!(is_valid_image_url("https://cdn.com/b.webp"));
        assert!(is_valid_image_url("https://cdn.com/c.avif"));
    }

    #[test]
    fn valid_no_extension_cdn_id_url() {
        // 图床 ID 风格 URL 无扩展 —— 应放行
        assert!(is_valid_image_url("https://i.imgur.com/abc123XYZ"));
    }

    #[test]
    fn extension_check_ignores_query_and_fragment() {
        // path 末段是 .png，query 里的 .js 不应影响判定
        assert!(is_valid_image_url(
            "https://cdn.com/image.png?ref=foo.js#sec"
        ));
    }

    // ---------- get_url_path_extension ----------

    #[test]
    fn get_ext_handles_query_and_fragment() {
        assert_eq!(
            get_url_path_extension("https://a.com/x.png?v=1"),
            Some("png".to_string())
        );
        assert_eq!(
            get_url_path_extension("https://a.com/x.js#sec"),
            Some("js".to_string())
        );
        assert_eq!(
            get_url_path_extension("https://a.com/x.png?foo.js"),
            Some("png".to_string())
        );
    }

    #[test]
    fn get_ext_returns_none_for_no_extension_or_dotfile() {
        assert_eq!(get_url_path_extension("https://a.com/abc123"), None);
        assert_eq!(get_url_path_extension("https://a.com/"), None);
        // ".htaccess" 这类 dotfile 首字符就是点，不算扩展
        assert_eq!(get_url_path_extension("https://a.com/.htaccess"), None);
    }

    #[test]
    fn get_ext_lowercases_result() {
        assert_eq!(
            get_url_path_extension("https://a.com/X.JPG"),
            Some("jpg".to_string())
        );
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
    fn extract_markdown_title_with_escaped_quotes() {
        let content = r#"![alt](https://example.com/img.jpg "some \"quoted\" title")"#;
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/img.jpg");
        assert_eq!(links[0].original_text, content);
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
    fn extract_tilde_fence_not_closed_by_backtick() {
        // ~~~ 围栏不应被 ``` 误关闭
        let content = "\
~~~text
![inside](https://example.com/a.jpg)
```
~~~
![after](https://example.com/b.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/b.jpg");
    }

    #[test]
    fn extract_nested_fence_inner_shorter_is_literal() {
        // 4-tick 围栏内的 3-tick 应为字面量
        let content = "\
````markdown
```
![inside](https://example.com/nested.jpg)
```
````
![after](https://example.com/after.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/after.jpg");
    }

    #[test]
    fn extract_ignores_4plus_space_indent_as_fence() {
        // 4+ 空格缩进的 ``` 按 CommonMark 属于缩进代码块首行，不是 fence 开头
        // 注意：Rust `"\` 连续行会吞掉下一行的前导空格，这里用显式 \n 拼接以保留 4 空格
        let content =
            "    ```\n![x](https://example.com/a.jpg)\n    ```\n![y](https://example.com/b.jpg)";
        let links = extract_image_links(content, false);
        // 两张图片都应提取（围栏从未开启）
        assert_eq!(links.len(), 2);
    }

    #[test]
    fn extract_accepts_0_to_3_space_indent_fence() {
        // 3 空格缩进仍合法（同样需避开 `\` 吞缩进的陷阱，使用显式 \n 拼接）
        let content = "   ```\n![inside](https://example.com/a.jpg)\n   ```\n![after](https://example.com/b.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/b.jpg");
    }

    #[test]
    fn extract_close_fence_must_have_whitespace_tail() {
        // close fence 尾部带 info string 按 CommonMark 不闭合（仍在围栏内）
        let content = "\
```
![inside](https://example.com/a.jpg)
``` notes
![still-inside](https://example.com/b.jpg)
```
![after](https://example.com/c.jpg)";
        let links = extract_image_links(content, false);
        // 前两张仍在围栏内，最后一张才应被提取
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/c.jpg");
    }

    #[test]
    fn extract_close_fence_allows_trailing_spaces_and_tabs() {
        // 尾部纯空白（空格/制表符）按规范仍视为合法 close
        let content =
            "```\n![in](https://example.com/a.jpg)\n```   \t\n![after](https://example.com/b.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/b.jpg");
    }

    #[test]
    fn extract_open_fence_info_string_still_opens() {
        // open fence 允许带 info string（``` python），不影响开启
        let content = "\
``` python
![inside](https://example.com/a.jpg)
```
![after](https://example.com/b.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/b.jpg");
    }

    #[test]
    fn extract_close_fence_must_match_length() {
        // close fence 反引号数 < open 时不关闭
        let content = "\
````
![x](https://example.com/a.jpg)
```
![y](https://example.com/b.jpg)
````
![z](https://example.com/c.jpg)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/c.jpg");
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
    fn extract_includes_inline_code_when_flag_set() {
        let content = "前 `![inline](https://example.com/in.jpg)` 后";
        let links = extract_image_links(content, true);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://example.com/in.jpg");
    }

    #[test]
    fn extract_markdown_url_with_balanced_parentheses() {
        let content = "![alt](https://cdn.example.com/photo_(1).png)";
        let links = extract_image_links(content, false);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].url, "https://cdn.example.com/photo_(1).png");
        assert_eq!(links[0].original_text, content);
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
