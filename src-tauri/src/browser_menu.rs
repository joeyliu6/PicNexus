//! 主窗口的 WebView2 原生右键菜单只留编辑用的几项（撤销、剪切、复制、粘贴、全选……）。
//!
//! 前端只在输入框里、选中的字上放行原生菜单（`src/shell/useNativeContextMenu.ts`），可菜单里还夹着
//! Edge 自己的东西：「Import passwords」「Writing direction」，以后的版本也可能再加。网页里删不掉单项，
//! 只能在宿主的 `ContextMenuRequested` 里按菜单项的名字过滤：只留白名单，删完一项不剩就整个不弹。
//! 名字是英文标签的小驼峰写法（微软文档 `ICoreWebView2ContextMenuItem.Name`）。
//! 需要 WebView2 Runtime 1.0.1185.39 以上，更旧的运行时转换失败就照原样弹。

/// 留下的菜单项；开发版另留「检查」
#[cfg(any(windows, test))]
const KEPT_ITEMS: &[&str] = &["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "emoji", "spellCheck"];

#[cfg(any(windows, test))]
fn keeps_item(name: &str, debug_build: bool) -> bool {
    KEPT_ITEMS.contains(&name) || (debug_build && name == "inspectElement")
}

/// 删掉菜单项后多出来的分隔线：开头、结尾的和连着的第二条起。参数是每一项是不是分隔线，返回要删的下标（从大到小，照着删下标不乱）
#[cfg(any(windows, test))]
fn stray_separators(separators: &[bool]) -> Vec<usize> {
    let mut stray = Vec::new();
    // 开头的分隔线也算多余：当作前面已经有一条
    let mut after_separator = true;
    for (index, &separator) in separators.iter().enumerate() {
        if separator && after_separator {
            stray.push(index);
        } else {
            after_separator = separator;
        }
    }
    if let Some(last) = (0..separators.len()).rev().find(|index| !stray.contains(index)) {
        if separators[last] {
            stray.push(last);
        }
    }
    stray.sort_unstable_by(|a, b| b.cmp(a));
    stray
}

pub fn trim_browser_context_menu(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let result = window.with_webview(|webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use webview2_com::{take_pwstr, ContextMenuRequestedEventHandler};
            use windows_core::{Interface, PWSTR};

            let core = match webview.controller().CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_11>()) {
                Ok(core) => core,
                Err(e) => {
                    log::warn!("[主窗口] 精简右键菜单失败: {:?}", e);
                    return;
                }
            };
            let handler = ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let items = args.MenuItems()?;
                let mut count = 0u32;
                items.Count(&mut count)?;
                let mut names = Vec::new();
                // 从后往前删，前面的下标不变
                for index in (0..count).rev() {
                    let item = items.GetValueAtIndex(index)?;
                    let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
                    item.Kind(&mut kind)?;
                    if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                        continue;
                    }
                    let mut name = PWSTR::null();
                    item.Name(&mut name)?;
                    let name = take_pwstr(name);
                    if !keeps_item(&name, cfg!(debug_assertions)) {
                        items.RemoveValueAtIndex(index)?;
                    }
                    names.push(name);
                }
                items.Count(&mut count)?;
                let mut separators = Vec::with_capacity(count as usize);
                for index in 0..count {
                    let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
                    items.GetValueAtIndex(index)?.Kind(&mut kind)?;
                    separators.push(kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR);
                }
                for index in stray_separators(&separators) {
                    items.RemoveValueAtIndex(index as u32)?;
                }
                items.Count(&mut count)?;
                if count == 0 {
                    args.SetHandled(true)?;
                }
                names.reverse();
                log::debug!("[主窗口] 右键菜单原有 {}，留下 {} 项", names.join(" "), count);
                Ok(())
            }));
            let mut token = 0i64;
            if let Err(e) = core.add_ContextMenuRequested(&handler, &mut token) {
                log::warn!("[主窗口] 精简右键菜单失败: {:?}", e);
            }
        });
        if let Err(e) = result {
            log::warn!("[主窗口] 精简右键菜单失败: {}", e);
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

#[cfg(test)]
mod tests {
    use super::{keeps_item, stray_separators};

    #[test]
    fn keeps_only_editing_items() {
        for name in ["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "emoji", "spellCheck"] {
            assert!(keeps_item(name, false), "{name}");
        }
        for name in ["importPasswords", "writingDirection", "saveAs", "print", "reload", "inspectElement"] {
            assert!(!keeps_item(name, false), "{name}");
        }
    }

    #[test]
    fn debug_builds_also_keep_inspect() {
        assert!(keeps_item("inspectElement", true));
        assert!(!keeps_item("importPasswords", true));
    }

    #[test]
    fn drops_leading_trailing_and_doubled_separators() {
        assert_eq!(stray_separators(&[]), Vec::<usize>::new());
        assert_eq!(stray_separators(&[true]), vec![0]);
        assert_eq!(stray_separators(&[false, true, false]), Vec::<usize>::new());
        // 分隔线 · 撤销 · 分隔线 · 分隔线 · 复制 · 分隔线
        assert_eq!(stray_separators(&[true, false, true, true, false, true]), vec![5, 3, 0]);
        assert_eq!(stray_separators(&[false, true, true]), vec![2, 1]);
    }
}
