//! 主窗口打开时多大、放在哪。
//!
//! 记下过的大小和位置由 window-state 插件在窗口建好时放回（只记大小和位置，不记最大化：Windows 上
//! 还没显示的窗口一最大化就会弹出来，界面没画好、「启动时最小化到托盘」也拦不住）。
//! 没记过，或者记下的大小放不下现在这块屏幕（换了显示器）时，按屏幕挑：用扣掉任务栏后的可用区域、
//! 按逻辑像素算。按物理像素算的话，4K 屏开 200% 缩放时 1600×1200 只剩 800×600，正好是最小窗口。

use std::path::PathBuf;

use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, DEFAULT_FILENAME};

use crate::portable;

/// 设计稿的标准窗口（视觉基准图 1400×900）
const PREFERRED: (f64, f64) = (1400.0, 900.0);
/// 窗口最多占可用区域的九成，四周露出桌面
const MAX_SHARE: f64 = 0.9;
/// 缩到九成还不到这么大就铺满可用区域（小屏笔记本）
const ROOMY: (f64, f64) = (1100.0, 700.0);
/// 记什么：大小和位置
pub const REMEMBERED: StateFlags = StateFlags::SIZE.union(StateFlags::POSITION);
/// 只记主窗口（登录小窗、统计用的隐藏窗口不记）
pub const TRACKED_WINDOW: &str = "main";
const PORTABLE_FILENAME: &str = "window-state.json";

#[derive(Debug, PartialEq)]
enum FirstSize {
    /// 逻辑像素，在可用区域里居中
    Window { width: f64, height: f64 },
    FillWorkArea,
}

/// 可用区域（逻辑像素）→ 第一次打开的窗口
fn first_size(work_width: f64, work_height: f64) -> FirstSize {
    let width = PREFERRED.0.min(work_width * MAX_SHARE);
    let height = PREFERRED.1.min(work_height * MAX_SHARE);
    if width < ROOMY.0 || height < ROOMY.1 {
        FirstSize::FillWorkArea
    } else {
        FirstSize::Window { width, height }
    }
}

/// 记下的窗口（内容区）放得下这块屏幕的可用区域
fn fits(client: PhysicalSize<u32>, work: PhysicalSize<u32>) -> bool {
    client.width <= work.width && client.height <= work.height
}

/// 内容区在可用区域里居中时，窗口外框放在哪。Windows 给无边框窗口在左、右、下留了一圈看不见的拖拽边
/// （175% 缩放时 12px），`inset` 是内容区相对外框左上角的偏移；铺满时内容区正好盖住可用区域，那圈边露到外面，同最大化
fn outer_position(
    work: PhysicalPosition<i32>,
    work_size: PhysicalSize<u32>,
    client: PhysicalSize<u32>,
    inset: (i32, i32),
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        work.x + (work_size.width.saturating_sub(client.width) / 2) as i32 - inset.0,
        work.y + (work_size.height.saturating_sub(client.height) / 2) as i32 - inset.1,
    )
}

/// window-state 插件记在哪：便携版放进程序旁的 data 文件夹，其余用插件默认的（系统配置目录）。
/// 插件把这个名字接在系统配置目录后面，给的是绝对路径时 `Path::join` 整个换成它
pub fn state_filename() -> String {
    match portable::portable_data_dir() {
        Some(dir) => dir.join(PORTABLE_FILENAME).to_string_lossy().into_owned(),
        None => DEFAULT_FILENAME.to_string(),
    }
}

fn state_path<R: Runtime>(window: &WebviewWindow<R>) -> Option<PathBuf> {
    let dir = window.app_handle().path().app_config_dir().ok()?;
    Some(dir.join(state_filename()))
}

/// 插件放回记下的大小和位置之后调：没记过、或者放不下现在的屏幕，就按屏幕挑
pub fn fit_main_window<R: Runtime>(window: &WebviewWindow<R>) {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => monitor,
        _ => {
            log::warn!("[窗口] 无法获取显示器信息，使用默认窗口大小");
            return;
        }
    };
    let work = *monitor.work_area();
    let remembered = state_path(window).is_some_and(|path| path.exists());
    if remembered && window.inner_size().is_ok_and(|size| fits(size, work.size)) {
        log::debug!("[窗口] 沿用上次的大小和位置");
        return;
    }

    let scale = monitor.scale_factor();
    let logical = (work.size.width as f64 / scale, work.size.height as f64 / scale);
    let size = match first_size(logical.0, logical.1) {
        FirstSize::Window { width, height } => PhysicalSize::new(
            (width * scale).round() as u32,
            (height * scale).round() as u32,
        ),
        FirstSize::FillWorkArea => work.size,
    };
    let inset = match (window.inner_position(), window.outer_position()) {
        (Ok(inner), Ok(outer)) => (inner.x - outer.x, inner.y - outer.y),
        _ => (0, 0),
    };
    let position = outer_position(work.position, work.size, size, inset);
    log::debug!(
        "[窗口] 按屏幕可用区域 {}×{}（缩放 {}）定为 {}×{}",
        work.size.width,
        work.size.height,
        scale,
        size.width,
        size.height
    );
    if let Err(e) = window.set_size(size).and_then(|_| window.set_position(position)) {
        log::warn!("[窗口] 设置窗口大小失败: {:?}", e);
    }
}

/// 主窗口关到托盘时记一次：应用常驻托盘，很少走到正常退出（插件只在退出时写盘）
pub fn remember_main_window<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(e) = window.app_handle().save_window_state(REMEMBERED) {
        log::warn!("[窗口] 记下窗口大小和位置失败: {:?}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_roomy_screen_gets_the_design_size() {
        // 可用区域按逻辑像素：1920×1080 开 100% 与 4K 开 200% 都是 1920×1032（任务栏 48），
        // 2560×1440 开 100% 与 4K 开 150% 都是 2560×1392
        for (w, h) in [(1920.0, 1032.0), (2560.0, 1392.0)] {
            assert_eq!(first_size(w, h), FirstSize::Window { width: 1400.0, height: 900.0 }, "{w}×{h}");
        }
    }

    #[test]
    fn a_medium_screen_gets_ninety_percent() {
        // 1920×1080 开 125%：可用区域约 1536×826
        assert_eq!(first_size(1536.0, 826.0), FirstSize::Window { width: 1382.4, height: 743.4 });
    }

    #[test]
    fn a_small_screen_fills_the_work_area() {
        // 1366×768 开 100%、1920×1080 开 150%
        assert_eq!(first_size(1366.0, 728.0), FirstSize::FillWorkArea);
        assert_eq!(first_size(1280.0, 688.0), FirstSize::FillWorkArea);
    }

    #[test]
    fn a_remembered_window_must_fit_the_screen() {
        let work = PhysicalSize::new(1920, 1032);
        assert!(fits(PhysicalSize::new(1400, 900), work));
        assert!(fits(PhysicalSize::new(1920, 1032), work));
        // 在 4K 屏上记下的大窗口，换到笔记本上放不下
        assert!(!fits(PhysicalSize::new(2400, 1600), work));
    }

    #[test]
    fn the_content_is_centred_and_the_invisible_border_hangs_outside() {
        // 4K 屏 175%：可用区域 3840×2090，内容区 2450×1575，左右下各 12px 看不见的拖拽边
        let (work, work_size) = (PhysicalPosition::new(0, 0), PhysicalSize::new(3840, 2090));
        assert_eq!(
            outer_position(work, work_size, PhysicalSize::new(2450, 1575), (12, 0)),
            PhysicalPosition::new(683, 257)
        );
        // 铺满：内容区正好盖住可用区域，左边那圈边落到屏幕外
        assert_eq!(outer_position(work, work_size, work_size, (12, 0)), PhysicalPosition::new(-12, 0));
    }

    #[cfg(windows)]
    #[test]
    fn an_absolute_filename_replaces_the_config_dir() {
        let config = std::path::Path::new(r"C:\Users\me\AppData\Roaming\com.picnexus.app");
        assert_eq!(
            config.join(r"D:\PicNexus\data\window-state.json"),
            std::path::Path::new(r"D:\PicNexus\data\window-state.json")
        );
    }
}
