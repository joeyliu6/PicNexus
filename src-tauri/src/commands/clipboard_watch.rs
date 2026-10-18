// src-tauri/src/commands/clipboard_watch.rs
// 自动上传剪贴板（设置 › 上传与链接）：后台隔一会儿看一眼剪贴板，出现新图片就通知主窗口，
// 前端照「粘贴上传」那条路上传。
//
// Windows 先看系统的剪贴板序号（GetClipboardSequenceNumber），没变就不读图，几乎没有开销；
// macOS / Linux 没有这么便宜的办法，每 2 秒读一次图、算一个指纹。
// 开启那一刻剪贴板里已有的图不算新图（免得一打开开关就把旧截图传上去）。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use arboard::Clipboard;
use tauri::{AppHandle, Emitter};

/// 前端监听的事件名（与 src/composables/upload/clipboardWatch.ts 一致）
pub const CLIPBOARD_IMAGE_EVENT: &str = "clipboard-image-changed";

#[cfg(windows)]
const POLL_INTERVAL: Duration = Duration::from_millis(500);
#[cfg(not(windows))]
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// 每开一次就换一个代号；旧线程发现代号变了就退出（关掉或重开时不会留两个线程）
#[derive(Default)]
pub struct ClipboardWatchState {
    generation: Arc<AtomicU64>,
}

/// 剪贴板里图片的指纹：宽高 + 每隔一段取一个字节（整张 4K 截图逐字节算太慢，抽样足够分辨「换了一张」）
fn image_fingerprint(clipboard: &mut Clipboard) -> Option<u64> {
    let image = clipboard.get_image().ok()?;
    let mut hasher = DefaultHasher::new();
    image.width.hash(&mut hasher);
    image.height.hash(&mut hasher);
    let bytes = image.bytes.as_ref();
    let step = (bytes.len() / 65_536).max(1);
    for byte in bytes.iter().step_by(step) {
        byte.hash(&mut hasher);
    }
    Some(hasher.finish())
}

/// 这一次看到的图算不算新图：有图、且和上一次看到的不一样（中间换成过文字再换回同一张也算，用户确实又复制了一次）
fn is_new_image(previous: Option<u64>, current: Option<u64>) -> bool {
    current.is_some() && current != previous
}

/// 系统剪贴板的序号：每次有人往剪贴板里放东西就加一（托盘也用它判断剪贴板变没变）
#[cfg(windows)]
pub(crate) fn sequence_number() -> u32 {
    // SAFETY: 无参数的 Win32 查询，只读系统计数
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
}

fn watch_loop(app: AppHandle, generation: Arc<AtomicU64>, mine: u64) {
    let mut clipboard = match Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(error) => {
            log::warn!("[剪贴板监听] 无法访问剪贴板，自动上传剪贴板不可用: {}", error);
            return;
        }
    };
    #[cfg(windows)]
    let mut last_sequence = sequence_number();
    let mut last = image_fingerprint(&mut clipboard);
    log::info!("[剪贴板监听] 已开启");

    loop {
        std::thread::sleep(POLL_INTERVAL);
        if generation.load(Ordering::SeqCst) != mine {
            log::info!("[剪贴板监听] 已关闭");
            return;
        }
        #[cfg(windows)]
        {
            let sequence = sequence_number();
            if sequence == last_sequence {
                continue;
            }
            last_sequence = sequence;
        }
        let current = image_fingerprint(&mut clipboard);
        if is_new_image(last, current) {
            log::info!("[剪贴板监听] 发现新图片，通知上传");
            if let Err(error) = app.emit_to("main", CLIPBOARD_IMAGE_EVENT, ()) {
                log::warn!("[剪贴板监听] 通知主窗口失败: {}", error);
            }
        }
        last = current;
    }
}

/// 开 / 关自动上传剪贴板。重复开会换掉旧线程（新线程以「此刻」的剪贴板为起点）
#[tauri::command]
pub fn set_clipboard_watch(
    app: AppHandle,
    state: tauri::State<'_, ClipboardWatchState>,
    enabled: bool,
) {
    let mine = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if !enabled {
        return;
    }
    let generation = Arc::clone(&state.generation);
    std::thread::spawn(move || watch_loop(app, generation, mine));
}

#[cfg(test)]
mod tests {
    use super::is_new_image;

    #[test]
    fn a_different_image_is_new() {
        assert!(is_new_image(Some(1), Some(2)));
        assert!(is_new_image(None, Some(2)));
    }

    #[test]
    fn the_same_image_or_no_image_is_not_new() {
        assert!(!is_new_image(Some(1), Some(1)));
        assert!(!is_new_image(Some(1), None));
        assert!(!is_new_image(None, None));
    }
}
