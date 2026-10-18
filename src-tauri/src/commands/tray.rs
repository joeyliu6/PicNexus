// src-tauri/src/commands/tray.rs
// 托盘（交接说明 8.6，T01–T08）：系统原生菜单。菜单内容由主窗口前端按配置算好、用 Tauri 的菜单接口画出来
// （配置在前端加密保存，Rust 读不到），见 src/tray/。这里只管三件事：
// 1. 建托盘图标与点击行为（三个平台都建）；
// 2. 前端菜单接口做不到的：Windows 上把「打开 PicNexus」设为默认项（系统会把它加粗）；
// 3. 读 Windows 任务栏的深浅，前端据此把单色托盘图标画成黑或白；
// 4. Windows 上剪贴板一变就告诉前端，「上传剪贴板图片」在打开菜单前就已经是对的灰 / 亮。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, ResourceId, Runtime, Webview};

use crate::error::AppError;

/// 与 src/tray/nativeTray.ts 的 TRAY_ID 一致
pub const TRAY_ID: &str = "main-tray";
/// 鼠标移到托盘图标上（打开菜单之前）：前端借此刷新「剪贴板里有没有图片」与任务栏深浅。
/// 与 src/tray/installTray.ts 的 TRAY_HOVER_EVENT 一致
pub const TRAY_HOVER_EVENT: &str = "tray-pointer-enter";
/// 剪贴板内容变了（Windows）：前端重查剪贴板里有没有图片。与 src/tray/installTray.ts 的 TRAY_CLIPBOARD_EVENT 一致
pub const TRAY_CLIPBOARD_EVENT: &str = "tray-clipboard-changed";
/// 隔多久看一眼剪贴板序号（只读一个系统计数，几乎没有开销）
#[cfg(windows)]
const CLIPBOARD_POLL: std::time::Duration = std::time::Duration::from_millis(500);
/// 悬停通知最多隔这么久发一次（鼠标在图标上移动会连续来事件）
const HOVER_EMIT_INTERVAL_MS: u64 = 800;

/// 上一次发悬停通知的时刻（进程内单调毫秒，从 1 起）；0 = 还没发过
static LAST_HOVER_MS: AtomicU64 = AtomicU64::new(0);
static CLOCK_START: OnceLock<Instant> = OnceLock::new();

/// 主窗口刚被显示或隐藏到托盘：前端重新判断「在不在屏」（决定通知走应用内还是系统通知）。
/// 与 src/composables/appPresence.ts 的 WINDOW_PRESENCE_EVENT 一致
pub const WINDOW_PRESENCE_EVENT: &str = "main-window-presence-changed";

/// 兜底菜单的两项文案，与 src/tray/trayMenuModel.ts 的 OPEN_LABEL / QUIT_LABEL 一致
const OPEN_LABEL: &str = "打开 PicNexus";
const QUIT_LABEL: &str = "退出 PicNexus";

const FALLBACK_OPEN_ID: &str = "tray-fallback-open";
const FALLBACK_QUIT_ID: &str = "tray-fallback-quit";

/// 显示并聚焦主窗口（托盘左键 / 双击、兜底菜单的「打开 PicNexus」）
pub fn reveal_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit(WINDOW_PRESENCE_EVENT, ());
    }
}

/// 建托盘图标。菜单先放一份只有「打开 / 退出」的兜底菜单：前端画好正式菜单之前、
/// 或主窗口脚本出错时，仍能打开和退出。
pub fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, FALLBACK_OPEN_ID, OPEN_LABEL, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, FALLBACK_QUIT_ID, QUIT_LABEL, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("PicNexus")
        .menu(&menu)
        // macOS 菜单栏图标点开就是菜单；Windows 左键 / 双击打开主界面、右键菜单（decisions/tray.md）。
        // Linux 系统托盘不给点击事件，一律弹菜单。
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        // macOS 菜单栏图标用模板图（前端每次重画后也会重新标上）
        .icon_as_template(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            FALLBACK_OPEN_ID => reveal_main_window(app),
            FALLBACK_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } if !cfg!(target_os = "macos") => reveal_main_window(tray.app_handle()),
            // 双击 = 两次左键抬起，上面已经打开了，不再单独处理 DoubleClick
            // Enter 与 Move 都算：tray-icon 的 Enter 只在「移出」被检测到之后才会再来，
            // 而移出检测要等鼠标在图标上动过才启动——移进来就右键、再移走时，下一次悬停收不到 Enter
            TrayIconEvent::Enter { .. } | TrayIconEvent::Move { .. } => {
                if !take_hover_slot(now_ms(), &LAST_HOVER_MS) {
                    return;
                }
                let _ = tray.app_handle().emit_to(
                    "main",
                    TRAY_HOVER_EVENT,
                    TrayHoverPayload {
                        taskbar_light: taskbar_light(),
                    },
                );
            }
            _ => {}
        });

    // 前端第一次画图标之前先用应用图标顶着
    match Image::from_bytes(include_bytes!("../../icons/128x128@2x.png")) {
        Ok(icon) => builder = builder.icon(icon),
        Err(error) => {
            log::warn!("[Tray] 读取托盘图标失败，使用窗口图标: {:?}", error);
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
        }
    }

    builder.build(app)?;
    #[cfg(windows)]
    watch_clipboard_sequence(app.handle().clone());
    Ok(())
}

/// 剪贴板序号一变就通知前端。只靠悬停不够：资源管理器转发托盘上的鼠标移动有延迟，
/// 移过去马上右键时，前端还没来得及重查，菜单显示的是上一次的剪贴板状态
#[cfg(windows)]
fn watch_clipboard_sequence<R: Runtime>(app: AppHandle<R>) {
    use crate::commands::clipboard_watch::sequence_number;
    std::thread::spawn(move || {
        let mut last = sequence_number();
        loop {
            std::thread::sleep(CLIPBOARD_POLL);
            let current = sequence_number();
            if current == last {
                continue;
            }
            last = current;
            if let Err(error) = app.emit_to("main", TRAY_CLIPBOARD_EVENT, ()) {
                log::warn!("[Tray] 通知剪贴板变化失败: {}", error);
            }
        }
    });
}

/// 单调时钟（不随系统时间往回调而倒退），从 1 起，0 留给「还没发过」
fn now_ms() -> u64 {
    CLOCK_START.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1
}

/// 这一次悬停该不该通知前端：离上一次至少 HOVER_EMIT_INTERVAL_MS 才发，发了就记下时刻
fn take_hover_slot(now: u64, last: &AtomicU64) -> bool {
    let previous = last.load(Ordering::Relaxed);
    if previous != 0 && now.saturating_sub(previous) < HOVER_EMIT_INTERVAL_MS {
        return false;
    }
    last.store(now, Ordering::Relaxed);
    true
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayHoverPayload {
    taskbar_light: Option<bool>,
}

/// Windows 任务栏是不是浅色（设置 › 个性化 › 颜色 ›「选择默认 Windows 模式」）。
/// 应用模式（AppsUseLightTheme）与它可以不同，网页里的 prefers-color-scheme 只反映应用模式。
#[cfg(windows)]
fn taskbar_light() -> Option<bool> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .ok()?;
    key.get_u32("SystemUsesLightTheme").ok().map(|value| value != 0)
}

/// 其他平台读不到托盘区的深浅：macOS 用模板图由系统上色，Linux 固定白色（decisions/tray.md）
#[cfg(not(windows))]
fn taskbar_light() -> Option<bool> {
    None
}

/// 前端第一次画托盘图标时问一次任务栏深浅；之后随悬停事件一起送
#[tauri::command]
pub fn get_taskbar_light() -> Option<bool> {
    taskbar_light()
}

/// 把前端建好的托盘菜单里第 position 项（从 0 数，分隔线也算）设为默认项：Windows 会把它加粗。
/// 其他平台没有「默认项」，什么也不做。
#[tauri::command]
pub async fn set_tray_default_item<R: Runtime>(
    webview: Webview<R>,
    rid: ResourceId,
    position: u32,
) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        use tauri::menu::ContextMenu;
        use windows_sys::Win32::UI::WindowsAndMessaging::SetMenuDefaultItem;

        let menu = webview
            .resources_table()
            .get::<Menu<R>>(rid)
            .map_err(|error| AppError::external(format!("找不到托盘菜单: {error}")))?;
        let hmenu = menu
            .hpopupmenu()
            .map_err(|error| AppError::external(format!("读取托盘菜单句柄失败: {error}")))?;
        // SAFETY: hmenu 来自仍在资源表里的菜单（上面持有 Arc，调用期间不会被销毁）；第三个参数 1 = 按位置
        let ok = unsafe { SetMenuDefaultItem(hmenu as _, position, 1) };
        if ok == 0 {
            return Err(AppError::external(format!(
                "无法把第 {position} 项设为默认项"
            )));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (webview, rid, position);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hover_emits_first_time_then_at_most_once_per_interval() {
        let last = AtomicU64::new(0);
        assert!(take_hover_slot(10_000, &last), "第一次悬停要通知");
        assert!(!take_hover_slot(10_000 + HOVER_EMIT_INTERVAL_MS - 1, &last), "间隔内的移动不再通知");
        assert!(take_hover_slot(10_000 + HOVER_EMIT_INTERVAL_MS, &last), "隔够了再通知");
    }
}
