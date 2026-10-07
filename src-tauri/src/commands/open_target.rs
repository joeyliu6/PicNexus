// src-tauri/src/commands/open_target.rs
// 「用系统默认程序打开」的命令与它的准入校验
//
// 校验分两条路：URL 走白名单 scheme + `url_policy::validate_external_url`，
// 文件路径走 canonicalize + 危险扩展名黑名单。两条路都要先挡掉 Windows
// 设备路径（`\\.\`、`\\?\` 及其正斜杠变体，按解析出的路径前缀判断）和盘符
// 伪装成 scheme 的情况——所以那两个判定函数各有 `#[cfg(windows)]` /
// `#[cfg(not(windows))]` 两份实现。网络共享路径（`\\NAS\共享`）不拦。

use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::url_policy::validate_external_url;

/// 用系统默认程序打开受限路径（文件或文件夹）或安全 URL。
/// 只允许已存在的绝对文件路径和明确白名单内的 URL scheme。
enum OpenTarget {
    Url(String),
    Path(PathBuf),
}

const ALLOWED_OPEN_URL_SCHEMES: &[&str] = &["http", "https"];
const DANGEROUS_OPEN_EXTENSIONS: &[&str] = &[
    "app", "appimage", "bat", "cmd", "com", "cpl", "dll", "exe", "hta", "jar", "js", "jse", "lnk",
    "msi", "msp", "pif", "ps1", "reg", "scr", "sh", "url", "vb", "vbe", "vbs", "wsf",
];

#[cfg(windows)]
fn is_windows_drive_path(input: &str) -> bool {
    let bytes = input.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

#[cfg(not(windows))]
fn is_windows_drive_path(_input: &str) -> bool {
    false
}

/// 按 Rust 解析出的路径前缀判断，不比对字符串开头：Windows 把 `/` 和 `\` 都当分隔符，
/// `//./C:/x`、`\/./pipe/x` 与 `\\.\C:\x`、`\\.\pipe\x` 等价，只认反斜杠会被绕过。
#[cfg(windows)]
fn has_forbidden_windows_device_prefix(input: &str) -> bool {
    use std::path::{Component, Prefix};

    let Some(Component::Prefix(prefix)) = Path::new(input).components().next() else {
        return false;
    };
    match prefix.kind() {
        // \\.\xxx 设备命名空间：命名管道、物理磁盘、GLOBALROOT……
        Prefix::DeviceNS(_) => true,
        // \\?\ 跳过 Windows 的路径规范化，校验看到的和最终打开的未必是同一个东西
        Prefix::Verbatim(_) | Prefix::VerbatimUNC(..) | Prefix::VerbatimDisk(_) => true,
        // `//?/C:/x`、`\\?/C:/x`：Rust 解析成服务器名为 `?` 的网络路径，Windows 却当本地设备路径打开
        Prefix::UNC(server, _) => server == "?" || server == ".",
        // 普通盘符路径；网络共享（\\NAS\共享）照常放行——用户可能把笔记放在 NAS 上
        Prefix::Disk(_) => false,
    }
}

#[cfg(not(windows))]
fn has_forbidden_windows_device_prefix(_input: &str) -> bool {
    false
}

fn validate_open_url(input: &str) -> Result<Option<OpenTarget>, AppError> {
    if is_windows_drive_path(input) {
        return Ok(None);
    }

    let Ok(parsed) = url::Url::parse(input) else {
        return Ok(None);
    };

    if !ALLOWED_OPEN_URL_SCHEMES.contains(&parsed.scheme()) {
        return Err(AppError::validation("不支持的链接类型"));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::validation("链接不能包含用户凭据"));
    }

    let validated = validate_external_url(parsed.as_str())?;
    Ok(Some(OpenTarget::Url(validated.to_string())))
}

fn validate_open_file_path(input: &str) -> Result<OpenTarget, AppError> {
    if has_forbidden_windows_device_prefix(input) {
        return Err(AppError::validation("不支持的系统设备路径"));
    }

    let path = Path::new(input);
    if !path.is_absolute() {
        return Err(AppError::validation("只能打开绝对路径"));
    }

    let metadata =
        std::fs::metadata(path).map_err(|e| AppError::file_io(format!("无法访问路径: {}", e)))?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(AppError::validation("只能打开文件或文件夹"));
    }

    let canonical = std::fs::canonicalize(path)
        .map_err(|e| AppError::file_io(format!("无法解析路径: {}", e)))?;

    if let Some(ext) = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
    {
        if DANGEROUS_OPEN_EXTENSIONS.contains(&ext.as_str()) {
            return Err(AppError::validation("不允许打开可执行、应用包或快捷方式"));
        }
    }

    Ok(OpenTarget::Path(canonical))
}

fn validate_open_target(input: &str) -> Result<OpenTarget, AppError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("路径不能为空"));
    }
    if trimmed.len() > 4096 {
        return Err(AppError::validation("路径过长"));
    }

    if let Some(target) = validate_open_url(trimmed)? {
        return Ok(target);
    }

    validate_open_file_path(trimmed)
}

#[cfg(test)]
mod open_target_tests {
    use super::*;

    #[test]
    fn open_target_allows_https_url() {
        assert!(matches!(
            validate_open_target("https://github.com/joeyliu6/PicNexus"),
            Ok(OpenTarget::Url(_))
        ));
    }

    #[test]
    fn open_target_allows_loopback_http_with_mapped_ipv6() {
        assert!(matches!(
            validate_open_target("http://[::ffff:127.0.0.1]:8080/image.png"),
            Ok(OpenTarget::Url(_))
        ));
    }

    #[test]
    fn open_target_rejects_private_mapped_ipv6_url() {
        assert!(validate_open_target("https://[::ffff:192.168.1.10]/image.png").is_err());
    }

    #[test]
    fn open_target_rejects_script_url() {
        assert!(validate_open_target("javascript:alert(1)").is_err());
    }

    #[test]
    fn open_target_rejects_relative_path() {
        assert!(validate_open_target("relative/file.md").is_err());
    }

    #[test]
    fn open_target_rejects_executable_file() {
        let path = std::env::temp_dir().join(format!(
            "picnexus-open-path-test-{}.exe",
            std::process::id()
        ));
        std::fs::write(&path, b"test").expect("write temp executable marker");

        let result = validate_open_target(path.to_string_lossy().as_ref());
        let _ = std::fs::remove_file(path);

        assert!(result.is_err());
    }

    /// 同一个真实存在的 .txt：普通写法能打开，设备路径的各种写法一律拒绝。
    /// 每种写法在 Windows 上都真能读到这个文件（metadata 成功），挡不住就会被交给 opener。
    #[cfg(windows)]
    #[test]
    fn open_target_rejects_every_spelling_of_device_paths() {
        let path = std::env::temp_dir().join(format!(
            "picnexus-open-device-test-{}.txt",
            std::process::id()
        ));
        std::fs::write(&path, b"test").expect("write temp file");
        let plain = path.to_string_lossy().to_string();
        let forward = plain.replace('\\', "/");

        let plain_ok = validate_open_target(&plain).is_ok();
        let accepted: Vec<String> = [
            format!(r"\\.\{plain}"),
            format!("//./{forward}"),
            format!(r"\/./{forward}"),
            format!(r"\\?\{plain}"),
            // Rust 把这三种解析成「服务器名为 ?」的网络路径，Windows 却当本地设备路径打开
            format!("//?/{forward}"),
            format!(r"\\?/{forward}"),
            format!(r"//?\{plain}"),
        ]
        .into_iter()
        .filter(|spelling| validate_open_target(spelling).is_ok())
        .collect();
        let _ = std::fs::remove_file(&path);

        assert!(plain_ok, "对照组：普通写法应能打开");
        assert!(accepted.is_empty(), "这些设备路径写法被放行了：{accepted:?}");
    }

    /// 网络共享路径保留可打开：用户可能把笔记放在 NAS 上，经 \\NAS\共享 打开文档修复
    #[cfg(windows)]
    #[test]
    fn network_share_paths_are_not_device_paths() {
        assert!(!has_forbidden_windows_device_prefix(r"\\nas\notes\a.md"));
        assert!(!has_forbidden_windows_device_prefix("//nas/notes/a.md"));
        assert!(!has_forbidden_windows_device_prefix(r"C:\notes\a.md"));
    }

    #[test]
    fn open_target_rejects_app_bundle_directory() {
        let path = std::env::temp_dir().join(format!(
            "picnexus-open-path-test-{}.app",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp app bundle marker");

        let result = validate_open_target(path.to_string_lossy().as_ref());
        let _ = std::fs::remove_dir_all(path);

        assert!(result.is_err());
    }
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), AppError> {
    match validate_open_target(&path)? {
        OpenTarget::Url(url) => {
            opener::open(&url).map_err(|e| AppError::file_io(format!("无法打开链接: {}", e)))?;
        }
        OpenTarget::Path(validated_path) => {
            opener::open(&validated_path).map_err(|e| {
                AppError::file_io(format!("无法打开 {}: {}", validated_path.display(), e))
            })?;
        }
    }
    Ok(())
}
