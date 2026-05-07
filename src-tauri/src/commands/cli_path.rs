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

fn status_from_path_value(path_value: &str, executable_dir: &str, supported: bool) -> CliPathStatus {
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

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn get_cli_path_status() -> Result<CliPathStatus, AppError> {
    let dir = executable_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(CliPathStatus {
        supported: false,
        in_path: false,
        executable_dir: dir,
        command_name: COMMAND_NAME.to_string(),
        needs_terminal_restart: false,
        message: Some("当前平台暂不支持一键加入 PATH，请使用完整路径命令。".to_string()),
    })
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

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn add_cli_to_path() -> Result<CliPathStatus, AppError> {
    get_cli_path_status()
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

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn remove_cli_from_path() -> Result<CliPathStatus, AppError> {
    get_cli_path_status()
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
        let next = remove_dir_from_path_value(
            r"C:\PicNexus;C:\PicNexus Tools;C:\Other",
            r"c:\picnexus\",
        );
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
