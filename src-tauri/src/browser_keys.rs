//! 主窗口不响应 WebView2 自带的浏览器快捷键：F5 / Ctrl+R 刷新整个界面、Ctrl+P 打印、Ctrl+F 弹出查找栏……
//! 桌面应用里这些是网页的样子，刷新还会丢掉正在显示的上传进度。
//!
//! 这些键 WebView2 先于网页处理，网页里 `preventDefault` 拦不住（微软文档
//! `ICoreWebView2AcceleratorKeyPressedEventArgs2` 写的处理顺序：宿主事件 → 浏览器 → 网页）。
//! 只能在宿主事件里逐键告诉浏览器「这个键你别管」；按键照常交给网页，图库的 Ctrl+F 才能聚焦搜索框。
//!
//! 不改设置项 `AreBrowserAcceleratorKeysEnabled`：它要等下一次整页导航才生效，主窗口建好时页面已经在加载。
//! 逐键的 `IsBrowserAcceleratorKeyEnabled` 要 WebView2 Runtime 1.0.2210.55 以上，更旧的运行时什么也不做。
//! 只管不带 Alt 的键（Alt 组合是系统键，Alt+F4 等交给系统）；开发版留着打开开发者工具的几个键。

/// 仍交给浏览器处理的键：开发版的 F12、Ctrl+Shift+I / J / C（开发者工具），正式版一个都不留
#[cfg(any(windows, test))]
fn keeps_browser_handling(virtual_key: u32, debug_build: bool) -> bool {
    const VK_F12: u32 = 0x7B;
    debug_build && matches!(virtual_key, VK_F12 | 0x49 | 0x4A | 0x43)
}

pub fn disable_browser_accelerator_keys(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let result = window.with_webview(|webview| unsafe {
            use webview2_com::AcceleratorKeyPressedEventHandler;
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::Interface;

            let handler = AcceleratorKeyPressedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN {
                    return Ok(());
                }
                let mut key = 0u32;
                args.VirtualKey(&mut key)?;
                if keeps_browser_handling(key, cfg!(debug_assertions)) {
                    return Ok(());
                }
                if let Ok(args2) = args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>() {
                    args2.SetIsBrowserAcceleratorKeyEnabled(false)?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            if let Err(e) = webview.controller().add_AcceleratorKeyPressed(&handler, &mut token) {
                log::warn!("[主窗口] 关闭浏览器快捷键失败: {:?}", e);
            }
        });
        if let Err(e) = result {
            log::warn!("[主窗口] 关闭浏览器快捷键失败: {}", e);
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(test)]
mod tests {
    use super::keeps_browser_handling;

    #[test]
    fn release_builds_hand_no_key_to_the_browser() {
        for key in [0x74 /* F5 */, 0x52 /* R */, 0x50 /* P */, 0x46 /* F */, 0x7B /* F12 */, 0x49 /* I */] {
            assert!(!keeps_browser_handling(key, false), "key {key:#x}");
        }
    }

    #[test]
    fn debug_builds_keep_only_the_developer_tools_keys() {
        for key in [0x7B, 0x49, 0x4A, 0x43] {
            assert!(keeps_browser_handling(key, true), "key {key:#x}");
        }
        for key in [0x74, 0x52, 0x50, 0x46] {
            assert!(!keeps_browser_handling(key, true), "key {key:#x}");
        }
    }
}
