use crate::error::AppError;
use serde::Serialize;
use std::path::PathBuf;

const COMMAND_NAME: &str = "picnexus";
const MAX_USER_PATH_UTF16_CHARS: usize = 32_767;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliPathStatus {
    pub supported: bool,
    pub in_path: bool,
    pub executable_dir: String,
    pub command_name: String,
    pub needs_terminal_restart: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn split_path_entries(path_value: &str) -> Vec<String> {
    path_value
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn join_path_entries(entries: &[String]) -> String {
    entries.join(";")
}

fn normalize_path_for_compare(value: &str) -> String {
    let mut normalized = value
        .trim()
        .trim_matches('"')
        .replace('/', "\\")
        .to_ascii_lowercase();

    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }

    normalized
}

fn path_contains_dir(entries: &[String], dir: &str) -> bool {
    let target = normalize_path_for_compare(dir);
    entries
        .iter()
        .any(|entry| normalize_path_for_compare(entry) == target)
}

fn path_utf16_len_with_nul(value: &str) -> usize {
    value.encode_utf16().count() + 1
}

fn add_dir_to_path_value(path_value: &str, dir: &str) -> Result<String, String> {
    let mut entries = split_path_entries(path_value);
    if path_contains_dir(&entries, dir) {
        return Ok(join_path_entries(&entries));
    }

    entries.push(dir.to_string());
    let next = join_path_entries(&entries);
    if path_utf16_len_with_nul(&next) > MAX_USER_PATH_UTF16_CHARS {
        return Err("PATH 过长，无法加入 PicNexus。请先清理用户 PATH 后重试。".to_string());
    }
    Ok(next)
}

fn remove_dir_from_path_value(path_value: &str, dir: &str) -> String {
    let target = normalize_path_for_compare(dir);
    let entries = split_path_entries(path_value)
        .into_iter()
        .filter(|entry| normalize_path_for_compare(entry) != target)
        .collect::<Vec<_>>();
    join_path_entries(&entries)
}

fn status_from_path_value(
    path_value: &str,
    executable_dir: &str,
    supported: bool,
) -> CliPathStatus {
    let entries = split_path_entries(path_value);
    CliPathStatus {
        supported,
        in_path: supported && path_contains_dir(&entries, executable_dir),
        executable_dir: executable_dir.to_string(),
        command_name: COMMAND_NAME.to_string(),
        needs_terminal_restart: false,
        message: None,
    }
}

fn executable_dir() -> Result<PathBuf, AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::file_io(format!("无法获取当前可执行文件路径: {}", e)))?;
    exe.parent()
        .map(PathBuf::from)
        .ok_or_else(|| AppError::file_io("无法确定 PicNexus 可执行文件目录"))
}

#[cfg(target_os = "windows")]
fn read_user_path() -> Result<String, AppError> {
    let key = windows_registry::CURRENT_USER
        .open("Environment")
        .map_err(|e| AppError::config(format!("无法打开用户环境变量注册表: {}", e)))?;
    Ok(key.get_string("Path").unwrap_or_default())
}

#[cfg(target_os = "windows")]
fn write_user_path(value: &str) -> Result<(), AppError> {
    let key = windows_registry::CURRENT_USER
        .create("Environment")
        .map_err(|e| AppError::config(format!("无法打开用户环境变量注册表: {}", e)))?;
    let value_type = key
        .get_type("Path")
        .unwrap_or(windows_registry::Type::ExpandString);
    match value_type {
        windows_registry::Type::ExpandString => key.set_expand_string("Path", value),
        _ => key.set_string("Path", value),
    }
    .map_err(|e| AppError::config(format!("无法写入用户 PATH: {}", e)))
}

#[cfg(target_os = "windows")]
fn broadcast_environment_change() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let environment = "Environment\0".encode_utf16().collect::<Vec<_>>();
    let mut result = 0usize;
    unsafe {
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            environment.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5_000,
            &mut result,
        );
    }
}

#[cfg(target_os = "windows")]
fn windows_cli_path_status(needs_terminal_restart: bool) -> Result<CliPathStatus, AppError> {
    let dir = executable_dir()?.to_string_lossy().to_string();
    let path_value = read_user_path()?;
    let mut status = status_from_path_value(&path_value, &dir, true);
    status.needs_terminal_restart = needs_terminal_restart;
    Ok(status)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn get_cli_path_status() -> Result<CliPathStatus, AppError> {
    windows_cli_path_status(false)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn add_cli_to_path() -> Result<CliPathStatus, AppError> {
    let dir = executable_dir()?.to_string_lossy().to_string();
    let current = read_user_path()?;
    let next = add_dir_to_path_value(&current, &dir).map_err(AppError::config)?;
    let changed = next != join_path_entries(&split_path_entries(&current));
    if changed {
        write_user_path(&next)?;
        broadcast_environment_change();
    }
    windows_cli_path_status(changed)
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn remove_cli_from_path() -> Result<CliPathStatus, AppError> {
    let dir = executable_dir()?.to_string_lossy().to_string();
    let current = read_user_path()?;
    let next = remove_dir_from_path_value(&current, &dir);
    let changed = next != join_path_entries(&split_path_entries(&current));
    if changed {
        write_user_path(&next)?;
        broadcast_environment_change();
    }
    windows_cli_path_status(changed)
}

#[cfg(unix)]
mod unix_impl {
    use super::*;

    /// 符号链接目标目录：~/.local/bin
    pub(super) fn target_dir() -> Result<PathBuf, AppError> {
        let home = std::env::var("HOME").map_err(|_| AppError::config("无法读取 HOME 环境变量"))?;
        Ok(PathBuf::from(home).join(".local").join("bin"))
    }

    pub(super) fn link_path() -> Result<PathBuf, AppError> {
        Ok(target_dir()?.join(COMMAND_NAME))
    }

    /// 符号链接的指向源。AppImage 下必须优先使用 $APPIMAGE。
    pub(super) fn link_source() -> Result<PathBuf, AppError> {
        if let Ok(appimage) = std::env::var("APPIMAGE") {
            if !appimage.is_empty() {
                return Ok(PathBuf::from(appimage));
            }
        }
        std::env::current_exe()
            .map_err(|e| AppError::file_io(format!("无法获取当前可执行文件路径: {}", e)))
    }

    /// 检测 ~/.local/bin 是否在 $PATH 中。
    pub(super) fn target_dir_in_path(target: &PathBuf) -> bool {
        let Ok(path_var) = std::env::var("PATH") else {
            return false;
        };
        let target_str = target.to_string_lossy().to_string();
        path_var.split(':').any(|entry| {
            let normalized = entry.trim_end_matches('/');
            normalized == target_str.trim_end_matches('/')
        })
    }

    /// 检测符号链接是否存在且指向我们期望的源。
    pub(super) fn link_points_to_source(link: &PathBuf, source: &PathBuf) -> bool {
        match read_symlink_target(link) {
            Ok(target) => link_target_points_to_source(link, &target, source),
            Err(_) => false,
        }
    }

    fn read_symlink_target(link: &PathBuf) -> Result<PathBuf, AppError> {
        std::fs::read_link(link)
            .map_err(|e| AppError::file_io(format!("无法读取符号链接 {}: {}", link.display(), e)))
    }

    pub(super) fn link_target_points_to_source(
        link: &PathBuf,
        target: &PathBuf,
        source: &PathBuf,
    ) -> bool {
        if target == source {
            return true;
        }

        let absolute_target = if target.is_absolute() {
            target.clone()
        } else {
            link.parent()
                .map(|parent| parent.join(target))
                .unwrap_or_else(|| target.clone())
        };

        match (
            std::fs::canonicalize(absolute_target),
            std::fs::canonicalize(source),
        ) {
            (Ok(target), Ok(source)) => target == source,
            _ => false,
        }
    }

    fn link_file_type(link: &PathBuf) -> Result<Option<std::fs::FileType>, AppError> {
        match std::fs::symlink_metadata(link) {
            Ok(metadata) => Ok(Some(metadata.file_type())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(AppError::file_io(format!(
                "无法读取 {} 状态: {}",
                link.display(),
                e
            ))),
        }
    }

    fn existing_non_symlink_error(link: &PathBuf) -> AppError {
        AppError::config(format!(
            "{} 已存在但不是符号链接。为避免覆盖用户文件，请手动移走后重试。",
            link.display()
        ))
    }

    fn existing_foreign_symlink_error(
        link: &PathBuf,
        target: &PathBuf,
        source: &PathBuf,
    ) -> AppError {
        AppError::config(format!(
            "{} 已存在但指向 {}，不是当前 PicNexus 可执行文件 {}。为避免覆盖用户链接，请手动处理后重试。",
            link.display(),
            target.display(),
            source.display()
        ))
    }

    pub(super) fn status(needs_terminal_restart: bool) -> Result<CliPathStatus, AppError> {
        let dir = executable_dir()?.to_string_lossy().to_string();
        let target = target_dir()?;
        let link = link_path()?;
        let source = link_source()?;

        let link_exists = link_points_to_source(&link, &source);
        let dir_in_path = target_dir_in_path(&target);
        let in_path = link_exists && dir_in_path;

        let message = if link_exists && !dir_in_path {
            Some(format!(
                "已创建链接，但 {} 不在 PATH 中。请在终端执行：\n  echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.zshrc && source ~/.zshrc\n（bash 用户将 .zshrc 换成 .bash_profile）",
                target.display()
            ))
        } else {
            None
        };

        Ok(CliPathStatus {
            supported: true,
            in_path,
            executable_dir: dir,
            command_name: COMMAND_NAME.to_string(),
            needs_terminal_restart,
            message,
        })
    }

    pub(super) fn add() -> Result<CliPathStatus, AppError> {
        let target = target_dir()?;
        let link = link_path()?;
        let source = link_source()?;

        std::fs::create_dir_all(&target)
            .map_err(|e| AppError::file_io(format!("无法创建 {}: {}", target.display(), e)))?;

        let changed = match link_file_type(&link)? {
            Some(file_type) if file_type.is_symlink() => {
                let target = read_symlink_target(&link)?;
                if link_target_points_to_source(&link, &target, &source) {
                    false
                } else {
                    return Err(existing_foreign_symlink_error(&link, &target, &source));
                }
            }
            Some(_) => return Err(existing_non_symlink_error(&link)),
            None => {
                std::os::unix::fs::symlink(&source, &link)
                    .map_err(|e| AppError::file_io(format!("无法创建符号链接: {}", e)))?;
                true
            }
        };

        status(changed)
    }

    pub(super) fn remove() -> Result<CliPathStatus, AppError> {
        let link = link_path()?;
        let source = link_source()?;
        let changed = match link_file_type(&link)? {
            Some(file_type) if file_type.is_symlink() => {
                let target = read_symlink_target(&link)?;
                if !link_target_points_to_source(&link, &target, &source) {
                    return Err(existing_foreign_symlink_error(&link, &target, &source));
                }
                std::fs::remove_file(&link).map_err(|e| {
                    AppError::file_io(format!("无法删除符号链接 {}: {}", link.display(), e))
                })?;
                true
            }
            Some(_) => return Err(existing_non_symlink_error(&link)),
            None => false,
        };
        status(changed)
    }
}

#[cfg(unix)]
#[tauri::command]
pub fn get_cli_path_status() -> Result<CliPathStatus, AppError> {
    unix_impl::status(false)
}

#[cfg(unix)]
#[tauri::command]
pub fn add_cli_to_path() -> Result<CliPathStatus, AppError> {
    unix_impl::add()
}

#[cfg(unix)]
#[tauri::command]
pub fn remove_cli_from_path() -> Result<CliPathStatus, AppError> {
    unix_impl::remove()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_and_join_path_entries_preserves_order() {
        let entries = split_path_entries(r#"C:\A; C:\B ;C:\C"#);
        assert_eq!(entries, vec![r"C:\A", r"C:\B", r"C:\C"]);
        assert_eq!(join_path_entries(&entries), r"C:\A;C:\B;C:\C");
    }

    #[test]
    fn add_dir_does_not_duplicate_existing_path() {
        let next = add_dir_to_path_value(r"C:\Tools;C:\PicNexus", r"C:\PicNexus")
            .expect("path should update");
        assert_eq!(next, r"C:\Tools;C:\PicNexus");
    }

    #[test]
    fn compare_is_case_insensitive_and_ignores_trailing_slashes() {
        let entries = split_path_entries(r"C:\Tools;C:\Program Files\PicNexus\");
        assert!(path_contains_dir(&entries, r"c:/program files/picnexus"));
    }

    #[test]
    fn remove_dir_only_removes_exact_normalized_match() {
        let next =
            remove_dir_from_path_value(r"C:\PicNexus;C:\PicNexus Tools;C:\Other", r"c:\picnexus\");
        assert_eq!(next, r"C:\PicNexus Tools;C:\Other");
    }

    #[test]
    fn add_dir_rejects_overlong_path_without_appending() {
        let current = "A".repeat(MAX_USER_PATH_UTF16_CHARS);
        let err = add_dir_to_path_value(&current, r"C:\PicNexus")
            .expect_err("overlong path should be rejected");
        assert!(err.contains("PATH 过长"));
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::unix_impl;
    use std::path::PathBuf;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env_lock(test: impl FnOnce()) {
        let _guard = ENV_LOCK.lock().expect("env lock should not be poisoned");
        test();
    }

    struct EnvVarGuard {
        key: &'static str,
        old_value: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let old_value = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, old_value }
        }

        fn remove(key: &'static str) -> Self {
            let old_value = std::env::var(key).ok();
            std::env::remove_var(key);
            Self { key, old_value }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.old_value {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(name: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "picnexus-cli-path-{name}-{}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("temp dir should be writable");
            Self { path }
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn appimage_env_var_overrides_current_exe() {
        with_env_lock(|| {
            let _appimage = EnvVarGuard::set("APPIMAGE", "/tmp/foo.AppImage");

            let source = unix_impl::link_source().expect("appimage source should resolve");

            assert_eq!(source, PathBuf::from("/tmp/foo.AppImage"));
        });
    }

    #[test]
    fn target_dir_in_path_matches_trailing_slash() {
        with_env_lock(|| {
            let _path = EnvVarGuard::set("PATH", "/usr/bin:/home/u/.local/bin/:/bin");

            let in_path = unix_impl::target_dir_in_path(&PathBuf::from("/home/u/.local/bin"));

            assert!(in_path);
        });
    }

    #[test]
    fn link_points_to_source_accepts_relative_symlink_target() {
        let temp = TempDirGuard::new("relative-target");
        let source = temp.path.join("PicNexus.AppImage");
        let link_dir = temp.path.join("bin");
        let link = link_dir.join("picnexus");
        std::fs::write(&source, b"source").expect("source should be writable");
        std::fs::create_dir_all(&link_dir).expect("link dir should be writable");
        std::os::unix::fs::symlink("../PicNexus.AppImage", &link)
            .expect("relative symlink should be creatable");

        assert!(unix_impl::link_points_to_source(&link, &source));
    }

    #[test]
    fn link_points_to_source_rejects_foreign_symlink_target() {
        let temp = TempDirGuard::new("foreign-target");
        let source = temp.path.join("PicNexus.AppImage");
        let foreign = temp.path.join("other-picnexus");
        let link = temp.path.join("picnexus");
        std::fs::write(&source, b"source").expect("source should be writable");
        std::fs::write(&foreign, b"foreign").expect("foreign target should be writable");
        std::os::unix::fs::symlink(&foreign, &link).expect("symlink should be creatable");

        assert!(!unix_impl::link_points_to_source(&link, &source));
    }

    #[test]
    fn add_rejects_existing_symlink_to_other_target_without_replacing_it() {
        with_env_lock(|| {
            let home = TempDirGuard::new("add-foreign-link");
            let source = home.path.join("PicNexus.AppImage");
            let foreign = home.path.join("other-picnexus");
            let link_dir = home.path.join(".local").join("bin");
            let link = link_dir.join("picnexus");
            std::fs::write(&source, b"source").expect("source should be writable");
            std::fs::write(&foreign, b"foreign").expect("foreign target should be writable");
            std::fs::create_dir_all(&link_dir).expect("link dir should be writable");
            std::os::unix::fs::symlink(&foreign, &link).expect("symlink should be creatable");
            let _home = EnvVarGuard::set(
                "HOME",
                home.path.to_str().expect("temp path should be utf-8"),
            );
            let _appimage = EnvVarGuard::set(
                "APPIMAGE",
                source.to_str().expect("source path should be utf-8"),
            );

            let err = unix_impl::add().expect_err("foreign symlink should be rejected");

            assert!(err.to_string().contains("已存在但指向"));
            assert_eq!(
                std::fs::read_link(&link).expect("link should still exist"),
                foreign
            );
        });
    }

    #[test]
    fn remove_rejects_existing_symlink_to_other_target_without_deleting_it() {
        with_env_lock(|| {
            let home = TempDirGuard::new("remove-foreign-link");
            let source = home.path.join("PicNexus.AppImage");
            let foreign = home.path.join("other-picnexus");
            let link_dir = home.path.join(".local").join("bin");
            let link = link_dir.join("picnexus");
            std::fs::write(&source, b"source").expect("source should be writable");
            std::fs::write(&foreign, b"foreign").expect("foreign target should be writable");
            std::fs::create_dir_all(&link_dir).expect("link dir should be writable");
            std::os::unix::fs::symlink(&foreign, &link).expect("symlink should be creatable");
            let _home = EnvVarGuard::set(
                "HOME",
                home.path.to_str().expect("temp path should be utf-8"),
            );
            let _appimage = EnvVarGuard::set(
                "APPIMAGE",
                source.to_str().expect("source path should be utf-8"),
            );

            let err = unix_impl::remove().expect_err("foreign symlink should be rejected");

            assert!(err.to_string().contains("已存在但指向"));
            assert_eq!(
                std::fs::read_link(&link).expect("link should still exist"),
                foreign
            );
        });
    }

    #[test]
    fn link_source_falls_back_to_current_exe() {
        with_env_lock(|| {
            let _appimage = EnvVarGuard::remove("APPIMAGE");

            let source = unix_impl::link_source().expect("current exe source should resolve");
            let current_exe = std::env::current_exe().expect("current exe should resolve");

            assert_eq!(source, current_exe);
        });
    }
}
