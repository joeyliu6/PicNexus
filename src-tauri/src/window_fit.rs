//! 主窗口打开时多大、放在哪：按这块屏幕扣掉任务栏后的可用区域、用逻辑像素挑。
//! 按物理像素算的话，4K 屏开 200% 缩放时 1600×1200 只剩 800×600，正好是最小窗口。
//! 小屏铺满可用区域而不最大化：Windows 上还没显示的窗口一最大化就会弹出来，
//! 界面没画好、「启动时最小化到托盘」也拦不住。

use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// 设计稿的标准窗口（视觉基准图 1400×900）
const PREFERRED: (f64, f64) = (1400.0, 900.0);
/// 窗口最多占可用区域的九成，四周露出桌面
const MAX_SHARE: f64 = 0.9;
/// 缩到九成还不到这么大就铺满可用区域（小屏笔记本）
const ROOMY: (f64, f64) = (1100.0, 700.0);

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

/// 建好窗口后按屏幕定大小和位置
pub fn fit_main_window<R: Runtime>(window: &WebviewWindow<R>) {
    let monitor = match window.current_monitor() {
        Ok(Some(monitor)) => monitor,
        _ => {
            log::warn!("[窗口] 无法获取显示器信息，使用默认窗口大小");
            return;
        }
    };
    let work = *monitor.work_area();

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
}
