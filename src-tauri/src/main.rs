// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod error;
mod commands;

use tauri::{Manager, Emitter};
use error::{AppError, IntoAppError};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(not(target_os = "macos"))]
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::image::Image;
use std::time::Duration;

// 用于 R2 和 WebDAV 测试
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
type HmacSha256 = Hmac<Sha256>;

// 用于密钥管理
use base64::{Engine as _, engine::general_purpose::STANDARD};
use keyring::Entry;
use rand::Rng;

// 定义服务名，防止与其他应用冲突
const SERVICE_NAME: &str = "us.picnex.app.secure";
const KEY_NAME: &str = "config_encryption_key";

/// 验证字段名是否安全（防止 JavaScript 注入）
/// 只允许字母、数字、下划线和连字符
fn is_safe_field_name(field: &str) -> bool {
    !field.is_empty() && field.len() <= 64 && field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 验证服务 ID 是否安全（防止 JavaScript 注入）
/// 只允许字母、数字、下划线和连字符
fn is_safe_service_id(service: &str) -> bool {
    !service.is_empty() && service.len() <= 32 && service.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 全局 HTTP 客户端状态
/// 使用单例模式复用 HTTP 客户端，提升性能
pub struct HttpClient(pub reqwest::Client);

fn main() {
    // 创建全局 HTTP 客户端（带连接池配置）
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))  // 60秒超时
        .connect_timeout(std::time::Duration::from_secs(10))  // 10秒连接超时
        .pool_idle_timeout(std::time::Duration::from_secs(90))  // 连接池空闲超时
        .pool_max_idle_per_host(10)  // 每个主机最多保持10个空闲连接
        .build()
        .unwrap_or_else(|e| {
            eprintln!("[HTTP Client] 创建失败: {:?}，使用默认配置", e);
            reqwest::Client::new()
        });

    tauri::Builder::default()
        // 注册 Tauri 2.0 插件
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .manage(HttpClient(http_client))     // 注册全局 HTTP 客户端
        .invoke_handler(tauri::generate_handler![
            save_cookie_from_login,
            start_cookie_monitoring,
            get_request_header_cookie,
            test_r2_connection,
            test_webdav_connection,
            list_r2_objects,
            delete_r2_object,
            commands::upload::upload_file_stream,
            commands::upload::test_weibo_connection,
            commands::r2::upload_to_r2,

            commands::jd::upload_to_jd,
            commands::jd::check_jd_available,
            commands::nowcoder::upload_to_nowcoder,
            commands::nowcoder::test_nowcoder_cookie,
            commands::qiyu::upload_to_qiyu,
            commands::qiyu_token::fetch_qiyu_token,
            commands::qiyu_token::check_chrome_installed,
            commands::qiyu_token::check_qiyu_available,
            commands::zhihu::upload_to_zhihu,
            commands::zhihu::test_zhihu_connection,
            commands::nami::upload_to_nami,
            commands::nami::test_nami_connection,
            commands::nami_token::fetch_nami_token,
            commands::link_checker::check_image_link,
            commands::link_checker::download_image_from_url,
            commands::clipboard::clipboard_has_image,
            commands::clipboard::read_clipboard_image,
            commands::image_meta::get_image_metadata,
            get_or_create_secure_key
        ])
        .setup(|app| {
            // 1. 创建原生菜单栏 (仅 macOS)
            // 在 Windows 上不设置原生菜单栏，避免启动时菜单栏闪烁
            #[cfg(target_os = "macos")]
            {
                let preferences = MenuItem::with_id(app, "preferences", "偏好设置...", true, Some("CmdOrCtrl+,"))?;
                let history = MenuItem::with_id(app, "history", "上传历史记录", true, Some("CmdOrCtrl+H"))?;

                let file_menu = Submenu::with_items(
                    app,
                    "PicNexus",
                    true,
                    &[
                        &preferences,
                        &PredefinedMenuItem::quit(app, Some("退出"))?,
                    ],
                )?;

                let window_menu = Submenu::with_items(
                    app,
                    "窗口",
                    true,
                    &[&history],
                )?;

                let menu = Menu::with_items(app, &[&file_menu, &window_menu])?;
                app.set_menu(menu)?;

                // 处理菜单事件 (macOS)
                app.on_menu_event(move |app_handle, event| {
                    let menu_id = event.id().as_ref();
                    eprintln!("菜单事件触发: {}", menu_id);

                    match menu_id {
                        "preferences" => {
                            eprintln!("菜单事件触发: 偏好设置");
                            if let Some(main_window) = app_handle.get_webview_window("main") {
                                let _ = main_window.unminimize();
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                                let _ = main_window.emit("navigate-to", "settings");
                            }
                        }
                        "history" => {
                            eprintln!("菜单事件触发: 上传历史记录");
                            if let Some(main_window) = app_handle.get_webview_window("main") {
                                let _ = main_window.unminimize();
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                                let _ = main_window.emit("navigate-to", "history");
                            }
                        }
                        _ => {
                            eprintln!("未知菜单项: {}", menu_id);
                        }
                    }
                });
            }

            // 3. 创建原生托盘菜单（PicGo 方案：0 内存占用）
            let menu_settings = MenuItemBuilder::new("打开设置")
                .id("open_settings")
                .build(app)?;
            let menu_history = MenuItemBuilder::new("上传历史")
                .id("open_history")
                .build(app)?;
            let menu_quit = MenuItemBuilder::new("退出")
                .id("quit")
                .build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .items(&[&menu_settings, &menu_history, &menu_quit])
                .build()?;

            // 4. 创建系统托盘（原生菜单，右键显示）
            // 使用 256x256 PNG 作为托盘图标（适合高分屏缩放）
            let tray_icon = Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
                .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(false)  // Windows 不使用模板模式以显示彩色图标
                .menu(&tray_menu)
                .show_menu_on_left_click(false)  // 左键不显示菜单
                .on_menu_event(|app, event| {
                    // 处理原生菜单点击事件
                    match event.id().as_ref() {
                        "open_settings" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("navigate-to", "settings");
                            }
                        }
                        "open_history" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("navigate-to", "history");
                            }
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // 将事件传递给 positioner 插件
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

                    // 左键点击：显示主窗口
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 5. 窗口初始化
            let window = match app.get_webview_window("main") {
                Some(w) => w,
                None => {
                    eprintln!("[Setup] 错误: 无法获取主窗口");
                    return Err("无法获取主窗口".into());
                }
            };

            // 6. 设置高分辨率窗口图标（修复 Windows 高分屏任务栏图标模糊问题）
            // Tauri 默认只读取 ICO 的第一个条目（16x16），导致任务栏图标模糊
            // 参考: https://github.com/tauri-apps/tauri/issues/14596
            #[cfg(target_os = "windows")]
            {
                if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
                    let _ = window.set_icon(icon);
                }
            }

            // --- 最佳适配方案逻辑 Start ---
            if let Ok(Some(monitor)) = window.current_monitor() {
                let screen_size = monitor.size();
                let sw = screen_size.width;
                let sh = screen_size.height;

                eprintln!("[Display] 检测到屏幕尺寸: {}x{}", sw, sh);

                // Tier 1: 4K / 2K 大屏 (宽度大于 1920 或 高度大于 1200)
                if sw > 1920 || sh > 1200 {
                    if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: 1600,
                        height: 1200,
                    })) {
                        eprintln!("[Display] 设置窗口大小失败: {:?}", e);
                    } else {
                        eprintln!("[Display] 已设置为 Tier 1: 1600x1200");
                        if let Err(e) = window.center() {
                            eprintln!("[Display] 居中窗口失败: {:?}", e);
                        }
                    }
                }
                // Tier 2: 标准 1080P (宽度在 1366~1920 之间)
                else if sw >= 1366 && sh >= 900 {
                    if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: 1280,
                        height: 900,
                    })) {
                        eprintln!("[Display] 设置窗口大小失败: {:?}", e);
                    } else {
                        eprintln!("[Display] 已设置为 Tier 2: 1280x900");
                        if let Err(e) = window.center() {
                            eprintln!("[Display] 居中窗口失败: {:?}", e);
                        }
                    }
                }
                // Tier 3: 小屏幕
                else {
                    if let Err(e) = window.maximize() {
                        eprintln!("[Display] 最大化窗口失败: {:?}", e);
                    } else {
                        eprintln!("[Display] 已设置为 Tier 3: 最大化");
                    }
                }
            } else {
                eprintln!("[Display] 无法获取显示器信息，使用默认窗口大小");
            }
            // --- 最佳适配方案逻辑 End ---

            // 5. 添加后台内存优化功能 (仅 Windows)
            // 使用 WebView2 的 MemoryUsageTargetLevel API 降低后台内存占用
            #[cfg(target_os = "windows")]
            {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Focused(focused) => {
                            let level_str = if *focused { "Normal" } else { "Low" };
                            let window_ref = window_clone.clone();

                            // 使用 with_webview 访问底层 WebView2 API
                            let _ = window_ref.with_webview(move |webview| {
                                #[cfg(windows)]
                                unsafe {
                                    use webview2_com::Microsoft::Web::WebView2::Win32::*;
                                    // 使用 windows_core（由 Tauri/wry 依赖树引入的版本）
                                    use windows_core::Interface;

                                    let controller = webview.controller();
                                    if let Ok(core) = controller.CoreWebView2() {
                                        // ICoreWebView2_19 包含 MemoryUsageTargetLevel API
                                        if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                                            let level_value = if level_str == "Low" {
                                                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                                            } else {
                                                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                                            };
                                            if core19.SetMemoryUsageTargetLevel(level_value).is_ok() {
                                                eprintln!("[内存优化] ✓ 已设置为 {} 模式", level_str);
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Cookie 更新事件的 payload 结构
#[derive(Clone, serde::Serialize)]
struct CookieUpdatedPayload {
    #[serde(rename = "serviceId")]
    service_id: String,
    cookie: String,
}

#[tauri::command]
async fn save_cookie_from_login(
    cookie: String,
    service_id: Option<String>,
    required_fields: Option<Vec<String>>,
    any_of_fields: Option<Vec<String>>,
    app: tauri::AppHandle
) -> Result<(), AppError> {
    let service = service_id.unwrap_or_else(|| "weibo".to_string());
    let fields = required_fields.unwrap_or_default();
    let any_fields = any_of_fields.unwrap_or_default();
    eprintln!("[保存Cookie] 开始保存Cookie，服务: {}，长度: {}，必要字段: {:?}，任意字段: {:?}",
        service, cookie.len(), fields, any_fields);

    if cookie.trim().is_empty() {
        return Err(AppError::validation("Cookie不能为空"));
    }

    if (!fields.is_empty() || !any_fields.is_empty()) && !validate_cookie_fields(&service, &cookie, &fields, &any_fields) {
        return Err(AppError::auth(format!(
            "Cookie 缺少必要字段，{}需要包含: {:?}{}",
            service, fields,
            if any_fields.is_empty() { String::new() } else { format!("，且至少包含: {:?} 之一", any_fields) }
        )));
    }

    if let Some(main_window) = app.get_webview_window("main") {
        let payload = CookieUpdatedPayload {
            service_id: service.clone(),
            cookie: cookie.clone(),
        };

        match main_window.emit("cookie-updated", payload) {
            Ok(_) => {
                eprintln!("[保存Cookie] ✓ 已发送 {} Cookie到主窗口", service);

                if let Some(login_window) = app.get_webview_window("login-webview") {
                    let _ = login_window.close();
                    eprintln!("[保存Cookie] ✓ 已请求关闭登录窗口");
                }

                Ok(())
            }
            Err(e) => {
                eprintln!("[保存Cookie] 发送事件失败: {:?}", e);
                Err(AppError::external(format!("发送Cookie事件失败: {}", e)))
            }
        }
    } else {
        eprintln!("[保存Cookie] 错误: 找不到主窗口");
        Err(AppError::external("找不到主窗口"))
    }
}

fn check_cookie_field(cookie: &str, field: &str, _service_id: &str) -> bool {
    if !is_safe_field_name(field) {
        eprintln!("[Cookie验证] 无效字段名: {}", field);
        return false;
    }

    let search_pattern = format!("{}=", field);
    let mut search_start = 0;

    while let Some(pos) = cookie[search_start..].find(&search_pattern) {
        let absolute_pos = search_start + pos;

        let is_valid_start = if absolute_pos == 0 {
            true
        } else {
            let before = &cookie[..absolute_pos];
            let trimmed = before.trim_end();
            trimmed.ends_with(';') || trimmed.is_empty()
        };

        if is_valid_start {
            let value_start = absolute_pos + search_pattern.len();
            let remaining = &cookie[value_start..];
            let value_end = remaining.find(';').unwrap_or(remaining.len());

            if value_end == 0 {
                eprintln!("[Cookie验证] 字段 {} 值为空", field);
                return false;
            }

            let value = &remaining[..value_end];
            // 安全日志：只打印字段名和长度，不打印实际值，防止敏感信息泄露
            eprintln!("[Cookie验证] 字段 {} 存在 (长度: {} 字符)", field, value.len());

            return true;
        }

        search_start = absolute_pos + 1;
    }

    false
}

/// 获取服务的默认验证规则（当前端未提供时使用）
fn get_default_validation_rules(service_id: &str) -> (Vec<&'static str>, Vec<&'static str>) {
    match service_id {
        // 微博：SUB 和 SUBP 是登录凭证，还需要额外检查 MLOGIN=1
        "weibo" => (vec!["SUB", "SUBP"], vec![]),
        "zhihu" => (vec!["z_c0"], vec![]),
        "nowcoder" => (vec!["t", "csrfToken"], vec!["acw_tc", "SERVERID", "__snaker__id", "gdxidpyhxdE"]),
        "nami" => (vec!["Auth-Token"], vec!["Q", "T"]),
        _ => (vec![], vec![]),
    }
}

/// 检查特定服务的登录状态（某些服务需要检查字段值而不仅仅是存在性）
fn check_login_status(service_id: &str, cookie: &str) -> bool {
    match service_id {
        "weibo" => {
            // 微博需要检查 MLOGIN=1 表示已登录
            // MLOGIN=0 表示未登录（即使有 SUB/SUBP 也是临时会话）
            if let Some(mlogin_pos) = cookie.find("MLOGIN=") {
                let value_start = mlogin_pos + 7;
                let remaining = &cookie[value_start..];
                let value_end = remaining.find(';').unwrap_or(remaining.len());
                let value = remaining[..value_end].trim();
                if value == "1" {
                    eprintln!("[登录状态检查] ✓ 微博 MLOGIN=1，已登录");
                    return true;
                } else {
                    eprintln!("[登录状态检查] ✗ 微博 MLOGIN={}，未登录", value);
                    return false;
                }
            }
            eprintln!("[登录状态检查] ✗ 微博缺少 MLOGIN 字段");
            false
        }
        // 其他服务只检查必要字段存在即可
        _ => true,
    }
}

fn validate_cookie_fields(service_id: &str, cookie: &str, required_fields: &[String], any_of_fields: &[String]) -> bool {
    // 如果前端未提供验证规则，使用默认规则
    let (default_required, default_any) = get_default_validation_rules(service_id);

    let actual_required: Vec<String> = if required_fields.is_empty() {
        default_required.iter().map(|s| s.to_string()).collect()
    } else {
        required_fields.to_vec()
    };

    let actual_any: Vec<String> = if any_of_fields.is_empty() {
        default_any.iter().map(|s| s.to_string()).collect()
    } else {
        any_of_fields.to_vec()
    };

    eprintln!("[Cookie验证] 服务: {}, 必要字段: {:?}, 任意字段: {:?}", service_id, actual_required, actual_any);

    if actual_required.is_empty() && actual_any.is_empty() {
        return !cookie.trim().is_empty();
    }

    // 检查必要字段
    for field in &actual_required {
        if !check_cookie_field(cookie, field, service_id) {
            eprintln!("[Cookie验证] ✗ 缺少必要字段: {}", field);
            return false;
        }
    }
    eprintln!("[Cookie验证] ✓ 通过 requiredFields 检查");

    // 检查任意字段
    if !actual_any.is_empty() {
        let has_any = actual_any.iter().any(|f| check_cookie_field(cookie, f, service_id));
        if !has_any {
            eprintln!("[Cookie验证] ✗ 缺少任意安全字段，需要至少包含: {:?}", actual_any);
            return false;
        }
        eprintln!("[Cookie验证] ✓ 通过 anyOfFields 检查");
    }

    // 检查特定服务的登录状态（如微博需要 MLOGIN=1）
    if !check_login_status(service_id, cookie) {
        eprintln!("[Cookie验证] ✗ {} 登录状态检查失败", service_id);
        return false;
    }

    eprintln!("[Cookie验证] ✓ {} Cookie 验证通过！", service_id);
    true
}

#[tauri::command]
async fn start_cookie_monitoring(
    app: tauri::AppHandle,
    service_id: Option<String>,
    target_domain: Option<String>,
    target_domains: Option<Vec<String>>,
    required_fields: Option<Vec<String>>,
    any_of_fields: Option<Vec<String>>,
    initial_delay_ms: Option<u64>,
    polling_interval_ms: Option<u64>,
) -> Result<(), AppError> {
    const DEFAULT_INITIAL_DELAY_MS: u64 = 3000;
    const DEFAULT_POLLING_INTERVAL_MS: u64 = 1000;
    const MIN_INITIAL_DELAY_MS: u64 = 500;
    const MAX_INITIAL_DELAY_MS: u64 = 10000;
    const MIN_POLLING_INTERVAL_MS: u64 = 200;
    const MAX_POLLING_INTERVAL_MS: u64 = 5000;

    let service = service_id.unwrap_or_else(|| "weibo".to_string());

    if !is_safe_service_id(&service) {
        return Err(AppError::validation(format!("无效的服务 ID: {}，只允许字母、数字、下划线和连字符", service)));
    }

    // 不再默认回退到微博域名，使用前端传入的配置
    let domains: Vec<String> = target_domains
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            target_domain
                .map(|d| vec![d])
                .unwrap_or_default()
        });
    let fields = required_fields.unwrap_or_default();
    let any_fields = any_of_fields.unwrap_or_default();

    for field in fields.iter().chain(any_fields.iter()) {
        if !is_safe_field_name(field) {
            return Err(AppError::validation(format!("无效的字段名: {}，只允许字母、数字、下划线和连字符", field)));
        }
    }

    let initial_delay = initial_delay_ms
        .unwrap_or(DEFAULT_INITIAL_DELAY_MS)
        .clamp(MIN_INITIAL_DELAY_MS, MAX_INITIAL_DELAY_MS);

    let polling_interval = polling_interval_ms
        .unwrap_or(DEFAULT_POLLING_INTERVAL_MS)
        .clamp(MIN_POLLING_INTERVAL_MS, MAX_POLLING_INTERVAL_MS);

    eprintln!(
        "[Cookie监控] 开始监控 {} 的Cookie (域名列表: {:?}, 必要字段: {:?}, 任意字段: {:?}, 初始延迟: {}ms, 轮询间隔: {}ms)",
        service, domains, fields, any_fields, initial_delay, polling_interval
    );

    let app_handle = app.clone();

    std::thread::spawn(move || {
        eprintln!("[Cookie监控] 等待 {}ms 后开始检测...", initial_delay);
        std::thread::sleep(Duration::from_millis(initial_delay));

        let mut check_count = 0;
        let max_timeout_ms = 240000u64;
        let max_checks = ((max_timeout_ms.saturating_sub(initial_delay)) / polling_interval).max(10) as i32;

        eprintln!(
            "[Cookie监控] 最大检查次数: {} (预计总时长: {}ms)",
            max_checks,
            initial_delay + (max_checks as u64 * polling_interval)
        );

        while check_count < max_checks {
            std::thread::sleep(Duration::from_millis(polling_interval));
            check_count += 1;

            eprintln!("[Cookie监控] 第 {}/{} 次检查 (服务: {})", check_count, max_checks, service);

            if let Some(login_window) = app_handle.get_webview_window("login-webview") {
                #[cfg(target_os = "windows")]
                {
                    if attempt_cookie_capture_and_save_generic(
                        &login_window,
                        &app_handle,
                        &service,
                        &domains,
                        &fields,
                        &any_fields
                    ) {
                        break;
                    }
                }

                #[cfg(not(target_os = "windows"))]
                {
                    let required_checks: Vec<String> = fields
                        .iter()
                        .map(|f| format!("cookie.includes('{}=')", f))
                        .collect();

                    let any_checks: Vec<String> = any_fields
                        .iter()
                        .map(|f| format!("cookie.includes('{}=')", f))
                        .collect();

                    let condition = if required_checks.is_empty() && any_checks.is_empty() {
                        "cookie.length > 0".to_string()
                    } else if any_checks.is_empty() {
                        required_checks.join(" && ")
                    } else if required_checks.is_empty() {
                        format!("({})", any_checks.join(" || "))
                    } else {
                        format!("({}) && ({})", required_checks.join(" && "), any_checks.join(" || "))
                    };

                    let fields_json = serde_json::to_string(&fields).unwrap_or_else(|_| "[]".to_string());
                    let any_fields_json = serde_json::to_string(&any_fields).unwrap_or_else(|_| "[]".to_string());

                    let check_js = format!(r#"
                        (async function() {{
                            try {{
                                const cookie = document.cookie || '';
                                if ({condition}) {{
                                    await window.__TAURI__.core.invoke('save_cookie_from_login', {{
                                        cookie: cookie,
                                        serviceId: '{service}',
                                        requiredFields: {fields_json},
                                        anyOfFields: {any_fields_json}
                                    }});
                                    return true;
                                }}
                                return false;
                            }} catch (e) {{
                                console.error('[自动监控] JS执行错误:', e);
                                return false;
                            }}
                        }})()
                    "#, condition = condition, service = service, fields_json = fields_json, any_fields_json = any_fields_json);

                    if let Err(e) = login_window.eval(&check_js) {
                        eprintln!("[Cookie监控] 执行JS脚本失败: {:?}", e);
                    }
                }
            } else {
                eprintln!("[Cookie监控] 登录窗口已关闭，自动停止监控");
                break;
            }
        }

        eprintln!("[Cookie监控] 监控结束（检查次数: {}）", check_count);
    });

    Ok(())
}

#[tauri::command]
async fn get_request_header_cookie(
    app: tauri::AppHandle,
    service_id: Option<String>,
    target_domain: Option<String>,
    target_domains: Option<Vec<String>>,
    required_fields: Option<Vec<String>>,
    any_of_fields: Option<Vec<String>>,
) -> Result<String, AppError> {
    let service = service_id.unwrap_or_else(|| "weibo".to_string());

    if !is_safe_service_id(&service) {
        return Err(AppError::validation(format!("无效的服务 ID: {}，只允许字母、数字、下划线和连字符", service)));
    }

    // 不再默认回退到微博域名，使用前端传入的配置
    let domains: Vec<String> = target_domains
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            target_domain
                .map(|d| vec![d])
                .unwrap_or_default()
        });
    let fields = required_fields.unwrap_or_default();
    let any_fields = any_of_fields.unwrap_or_default();

    for field in fields.iter().chain(any_fields.iter()) {
        if !is_safe_field_name(field) {
            return Err(AppError::validation(format!("无效的字段名: {}，只允许字母、数字、下划线和连字符", field)));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let Some(login_window) = app.get_webview_window("login-webview") else {
            return Err(AppError::external("登录窗口未打开，请先点击「开始登录」"));
        };

        let mut all_cookies: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();

        for domain in &domains {
            match try_extract_cookie_header_generic(&login_window, domain) {
                Ok(Some(cookie)) => {
                    eprintln!("[Cookie获取] 从 {} 提取到 Cookie (长度: {})", domain, cookie.len());
                    for part in cookie.split("; ") {
                        if let Some(eq_pos) = part.find('=') {
                            let key = part[..eq_pos].to_string();
                            let value = part[eq_pos + 1..].to_string();
                            all_cookies.insert(key, value);
                        }
                    }
                }
                Ok(None) => {
                    eprintln!("[Cookie获取] 从 {} 未提取到 Cookie", domain);
                }
                Err(err) => {
                    eprintln!("[Cookie获取] 从 {} 读取Cookie失败: {}", domain, err);
                }
            }
        }

        if all_cookies.is_empty() {
            return Err(AppError::auth("未检测到 Cookie，请确认已完成登录后再试"));
        }

        let merged_cookie: String = all_cookies
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("; ");

        if validate_cookie_fields(&service, &merged_cookie, &fields, &any_fields) {
            eprintln!("[Cookie获取] {} 请求头Cookie长度: {}", service, merged_cookie.len());
            Ok(merged_cookie)
        } else {
            Err(AppError::auth(format!(
                "提取到的 Cookie 缺少关键字段（{:?}{}），请确认已成功登录{}",
                fields,
                if any_fields.is_empty() { String::new() } else { format!(" 或 {:?} 之一", any_fields) },
                service
            )))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, service, domains, fields, any_fields);
        Err(AppError::external("当前操作系统暂不支持请求头 Cookie 提取，请使用页面内的手动复制方式"))
    }
}

#[cfg(target_os = "windows")]
fn attempt_cookie_capture_and_save_generic(
    login_window: &tauri::WebviewWindow,
    app_handle: &tauri::AppHandle,
    service_id: &str,
    target_domains: &[String],
    required_fields: &[String],
    any_of_fields: &[String],
) -> bool {
    let mut domains_to_try: Vec<String> = Vec::new();
    for domain in target_domains {
        if !domains_to_try.contains(domain) {
            domains_to_try.push(domain.clone());
        }
        if domain.starts_with("www.") {
            let without_www = domain[4..].to_string();
            if !domains_to_try.contains(&without_www) {
                domains_to_try.push(without_www);
            }
        } else {
            let with_www = format!("www.{}", domain);
            if !domains_to_try.contains(&with_www) {
                domains_to_try.push(with_www);
            }
        }
    }

    let mut all_cookies: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();

    for domain in &domains_to_try {
        match try_extract_cookie_header_generic(login_window, domain) {
            Ok(Some(cookie)) => {
                eprintln!("[Cookie监控] 从 {} 提取到 Cookie (长度: {})", domain, cookie.len());
                for part in cookie.split("; ") {
                    if let Some(eq_pos) = part.find('=') {
                        let key = part[..eq_pos].to_string();
                        let value = part[eq_pos + 1..].to_string();
                        all_cookies.insert(key, value);
                    }
                }
            }
            Ok(None) => {
                eprintln!("[Cookie监控] 从 {} 未提取到 Cookie", domain);
            }
            Err(err) => {
                eprintln!("[Cookie监控] 从 {} 读取Cookie失败: {}", domain, err);
            }
        }
    }

    if all_cookies.is_empty() {
        eprintln!("[Cookie监控] 未从任何域名提取到 Cookie，继续等待...");
        return false;
    }

    let merged_cookie: String = all_cookies
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ");

    // 安全日志：只打印 Cookie 长度和字段数量，不打印实际内容
    let field_count = merged_cookie.matches('=').count();
    eprintln!("[Cookie监控] 合并后的 Cookie: {} 个字段，共 {} 字符", field_count, merged_cookie.len());

    if validate_cookie_fields(service_id, &merged_cookie, required_fields, any_of_fields) {
        eprintln!("[Cookie监控] ✓ 验证通过，尝试保存 {} Cookie", service_id);
        match tauri::async_runtime::block_on(save_cookie_from_login(
            merged_cookie.clone(),
            Some(service_id.to_string()),
            Some(required_fields.to_vec()),
            Some(any_of_fields.to_vec()),
            app_handle.clone(),
        )) {
            Ok(_) => {
                eprintln!("[Cookie监控] ✓ {} Cookie保存成功", service_id);
                true
            }
            Err(err) => {
                eprintln!("[Cookie监控] 保存Cookie失败: {}", err);
                false
            }
        }
    } else {
        eprintln!("[Cookie监控] ✗ 验证失败，Cookie 缺少必要字段，继续等待...");
        false
    }
}

// WebView2 Cookie 自动提取功能 (Windows)
// 使用 WebView2 CookieManager API 从指定域名提取 Cookie
#[cfg(target_os = "windows")]
fn try_extract_cookie_header_generic(window: &tauri::WebviewWindow, domain: &str) -> Result<Option<String>, String> {
    use std::sync::mpsc;
    use std::time::Duration;

    // 创建 channel 用于等待异步结果
    let (tx, rx) = mpsc::channel::<Option<String>>();
    let domain_owned = domain.to_string();

    // 使用 with_webview 访问底层 WebView2 API
    let result = window.with_webview(move |webview| {
        #[cfg(windows)]
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::*;
            use windows_core::{Interface, HSTRING, PCWSTR, PWSTR};

            let controller = webview.controller();

            // 获取 ICoreWebView2
            let core = match controller.CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[Cookie提取] 获取 CoreWebView2 失败: {:?}", e);
                    let _ = tx.send(None);
                    return;
                }
            };

            // Cast 到 ICoreWebView2_2 获取 CookieManager
            let core2 = match core.cast::<ICoreWebView2_2>() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[Cookie提取] Cast 到 ICoreWebView2_2 失败: {:?}", e);
                    let _ = tx.send(None);
                    return;
                }
            };

            // 获取 CookieManager
            let cookie_manager = match core2.CookieManager() {
                Ok(cm) => cm,
                Err(e) => {
                    eprintln!("[Cookie提取] 获取 CookieManager 失败: {:?}", e);
                    let _ = tx.send(None);
                    return;
                }
            };

            // 构建 URI（GetCookies 需要完整的 URL）
            let uri = format!("https://{}/", domain_owned);
            let uri_hstring = HSTRING::from(&uri);

            // 使用 implement 宏创建 GetCookies 回调 handler
            let tx_clone = tx.clone();

            #[windows_core::implement(ICoreWebView2GetCookiesCompletedHandler)]
            struct GetCookiesHandler {
                tx: std::sync::mpsc::Sender<Option<String>>,
            }

            impl ICoreWebView2GetCookiesCompletedHandler_Impl for GetCookiesHandler_Impl {
                fn Invoke(
                    &self,
                    _result: windows_core::HRESULT,
                    cookie_list: windows_core::Ref<'_, ICoreWebView2CookieList>,
                ) -> windows_core::Result<()> {
                    let mut cookies = Vec::new();

                    unsafe {
                        if let Ok(list) = cookie_list.ok() {
                            // 获取 cookie 数量
                            let mut count: u32 = 0;
                            if list.Count(&mut count).is_ok() {
                                for i in 0..count {
                                    if let Ok(cookie) = list.GetValueAtIndex(i) {
                                        // 获取 cookie 的 Name 和 Value
                                        let mut name = PWSTR::null();
                                        let mut value = PWSTR::null();

                                        if cookie.Name(&mut name).is_ok() && cookie.Value(&mut value).is_ok() {
                                            let name_str = name.to_string().unwrap_or_default();
                                            let value_str = value.to_string().unwrap_or_default();

                                            if !name_str.is_empty() {
                                                cookies.push(format!("{}={}", name_str, value_str));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    let result = if cookies.is_empty() {
                        None
                    } else {
                        Some(cookies.join("; "))
                    };

                    let _ = self.tx.send(result);
                    Ok(())
                }
            }

            let handler: ICoreWebView2GetCookiesCompletedHandler = GetCookiesHandler { tx: tx_clone }.into();

            // 调用 GetCookies
            if let Err(e) = cookie_manager.GetCookies(PCWSTR(uri_hstring.as_ptr()), &handler) {
                eprintln!("[Cookie提取] GetCookies 调用失败: {:?}", e);
                let _ = tx.send(None);
            }
        }
    });

    if result.is_err() {
        eprintln!("[Cookie提取] with_webview 调用失败");
        return Ok(None);
    }

    // 等待异步结果（最多 5 秒）
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(cookie_opt) => {
            if let Some(ref cookies) = cookie_opt {
                eprintln!("[Cookie提取] ✓ 从 {} 提取到 {} 个 Cookie", domain, cookies.matches('=').count());
            }
            Ok(cookie_opt)
        }
        Err(_) => {
            eprintln!("[Cookie提取] 等待结果超时");
            Ok(None)
        }
    }
}

// === R2 和 WebDAV 测试命令 ===

#[derive(serde::Deserialize, Clone)]
struct R2Config {
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "accessKeyId")]
    access_key_id: String,
    #[serde(rename = "secretAccessKey")]
    secret_access_key: String,
    #[serde(rename = "bucketName")]
    bucket_name: String,
    #[allow(dead_code)]
    path: String,
    #[allow(dead_code)]
    #[serde(rename = "publicDomain")]
    public_domain: String,
}

#[derive(serde::Serialize, Clone)]
struct R2Object {
    key: String,
    size: i64,
    #[serde(rename = "lastModified")]
    last_modified: String,
}

#[derive(serde::Deserialize, Clone)]
struct WebDAVConfig {
    url: String,
    username: String,
    password: String,
    #[allow(dead_code)]
    #[serde(rename = "remotePath")]
    remote_path: String,
}

#[tauri::command]
async fn test_r2_connection(
    config: R2Config,
    http_client: tauri::State<'_, HttpClient>
) -> Result<String, AppError> {
    if config.account_id.is_empty()
        || config.access_key_id.is_empty()
        || config.secret_access_key.is_empty()
        || config.bucket_name.is_empty() {
        return Err(AppError::config("配置不完整: AccountID、KeyID、Secret 和 Bucket 均为必填项。"));
    }

    let endpoint_url = format!("https://{}.r2.cloudflarestorage.com/{}", config.account_id, config.bucket_name);

    let now = chrono::Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();

    let region = "auto";
    let service = "s3";
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
    let canonical_uri = format!("/{}", config.bucket_name);
    let canonical_querystring = "";
    let canonical_headers = format!("host:{}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{}\n", host, datetime_str);
    let signed_headers = "host;x-amz-content-sha256;x-amz-date";
    let payload_hash = "UNSIGNED-PAYLOAD";

    let canonical_request = format!(
        "HEAD\n{}\n{}\n{}\n{}\n{}",
        canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
    );

    let mut hasher = Sha256::new();
    hasher.update(canonical_request.as_bytes());
    let canonical_request_hash = hex::encode(hasher.finalize());

    let credential_scope = format!("{}/{}/{}/aws4_request", date_str, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        datetime_str, credential_scope, canonical_request_hash
    );

    let k_date = hmac_sha256(format!("AWS4{}", config.secret_access_key).as_bytes(), date_str.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key_id, credential_scope, signed_headers, signature
    );

    match http_client.0
        .head(&endpoint_url)
        .header("Host", host)
        .header("x-amz-date", datetime_str)
        .header("x-amz-content-sha256", payload_hash)
        .header("Authorization", authorization_header)
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                Ok("R2 连接成功！".to_string())
            } else if status == reqwest::StatusCode::NOT_FOUND {
                Err(AppError::storage(format!("存储桶 (Bucket) '{}' 未找到", config.bucket_name)))
            } else if status == reqwest::StatusCode::FORBIDDEN {
                Err(AppError::auth("R2 认证失败: Access Key ID 或 Secret Access Key 无效，或权限不足"))
            } else {
                Err(AppError::storage(format!("连接失败: HTTP {}", status)))
            }
        }
        Err(err) => {
            if err.is_connect() {
                Err(AppError::storage("无法连接到 R2 服务器，请检查网络连接"))
            } else if err.is_timeout() {
                Err(AppError::storage("请求超时"))
            } else {
                Err(AppError::storage(format!("连接失败: {}", err)))
            }
        }
    }
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

#[tauri::command]
async fn test_webdav_connection(
    config: WebDAVConfig,
    http_client: tauri::State<'_, HttpClient>
) -> Result<String, AppError> {
    if config.url.is_empty() || config.username.is_empty() || config.password.is_empty() {
        return Err(AppError::config("配置不完整: URL、用户名和密码均为必填项。"));
    }
    let auth_header = format!(
        "Basic {}",
        STANDARD.encode(format!("{}:{}", config.username, config.password))
    );

    let response = http_client.0
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &config.url)
        .header("Authorization", auth_header)
        .header("Depth", "0")
        .send()
        .await;

    match response {
        Ok(res) => {
            let status = res.status();
            if status.is_success() || status.as_u16() == 207 {
                Ok("WebDAV 连接成功！".to_string())
            } else if status == reqwest::StatusCode::UNAUTHORIZED {
                Err(AppError::webdav("认证失败: 用户名或密码错误"))
            } else if status == reqwest::StatusCode::NOT_FOUND {
                Err(AppError::webdav("URL 未找到，请检查链接是否正确"))
            } else {
                Err(AppError::webdav(format!("服务器返回状态 {}", status)))
            }
        }
        Err(err) => {
            if err.is_connect() {
                Err(AppError::webdav("无法连接到服务器，请检查 URL 或网络"))
            } else if err.is_timeout() {
                Err(AppError::webdav("请求超时"))
            } else {
                Err(AppError::webdav(format!("连接失败: {}", err)))
            }
        }
    }
}

#[tauri::command]
async fn list_r2_objects(
    config: R2Config,
    http_client: tauri::State<'_, HttpClient>
) -> Result<Vec<R2Object>, AppError> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    if config.account_id.is_empty()
        || config.access_key_id.is_empty()
        || config.secret_access_key.is_empty()
        || config.bucket_name.is_empty() {
        return Err(AppError::config("R2 配置不完整，请先在设置中配置所有必填字段"));
    }

    let mut objects: Vec<R2Object> = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        let mut url = format!(
            "https://{}.r2.cloudflarestorage.com/{}?list-type=2",
            config.account_id, config.bucket_name
        );

        if let Some(token) = &continuation_token {
            url.push_str(&format!("&continuation-token={}", urlencoding::encode(token)));
        }

        let now = chrono::Utc::now();
        let date_str = now.format("%Y%m%d").to_string();
        let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();

        let region = "auto";
        let service = "s3";
        let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
        let canonical_uri = format!("/{}", config.bucket_name);
        let mut canonical_querystring = "list-type=2".to_string();

        if let Some(token) = &continuation_token {
            canonical_querystring.push_str(&format!("&continuation-token={}", urlencoding::encode(token)));
        }

        let canonical_headers = format!("host:{}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{}\n", host, datetime_str);
        let signed_headers = "host;x-amz-content-sha256;x-amz-date";
        let payload_hash = "UNSIGNED-PAYLOAD";

        let canonical_request = format!(
            "GET\n{}\n{}\n{}\n{}\n{}",
            canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
        );

        let mut hasher = Sha256::new();
        hasher.update(canonical_request.as_bytes());
        let canonical_request_hash = hex::encode(hasher.finalize());

        let credential_scope = format!("{}/{}/{}/aws4_request", date_str, region, service);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{}\n{}\n{}",
            datetime_str, credential_scope, canonical_request_hash
        );

        let k_date = hmac_sha256(format!("AWS4{}", config.secret_access_key).as_bytes(), date_str.as_bytes());
        let k_region = hmac_sha256(&k_date, region.as_bytes());
        let k_service = hmac_sha256(&k_region, service.as_bytes());
        let k_signing = hmac_sha256(&k_service, b"aws4_request");
        let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

        let authorization_header = format!(
            "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
            config.access_key_id, credential_scope, signed_headers, signature
        );

        let response = http_client.0
            .get(&url)
            .header("Host", &host)
            .header("x-amz-date", &datetime_str)
            .header("x-amz-content-sha256", payload_hash)
            .header("Authorization", &authorization_header)
            .send()
            .await
            .into_storage_err_with("请求失败")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::storage(format!("列出对象失败 (HTTP {}): {}", status, body)));
        }

        let body = response.text().await.into_storage_err_with("读取响应失败")?;

        let mut reader = Reader::from_str(&body);
        reader.config_mut().trim_text(true);

        let mut buf = Vec::new();
        let mut current_key = String::new();
        let mut current_size: i64 = 0;
        let mut current_last_modified = String::new();
        let mut in_contents = false;
        let mut in_key = false;
        let mut in_size = false;
        let mut in_last_modified = false;
        let mut in_is_truncated = false;
        let mut in_next_continuation_token = false;
        let mut is_truncated = false;
        let mut next_token = String::new();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) => {
                    match e.name().as_ref() {
                        b"Contents" => in_contents = true,
                        b"Key" if in_contents => in_key = true,
                        b"Size" if in_contents => in_size = true,
                        b"LastModified" if in_contents => in_last_modified = true,
                        b"IsTruncated" => in_is_truncated = true,
                        b"NextContinuationToken" => in_next_continuation_token = true,
                        _ => {}
                    }
                }
                Ok(Event::Text(e)) => {
                    let text = e.unescape().unwrap_or_default().to_string();
                    if in_key {
                        current_key = text;
                    } else if in_size {
                        current_size = text.parse().unwrap_or(0);
                    } else if in_last_modified {
                        current_last_modified = text;
                    } else if in_is_truncated {
                        is_truncated = text == "true";
                    } else if in_next_continuation_token {
                        next_token = text;
                    }
                }
                Ok(Event::End(e)) => {
                    match e.name().as_ref() {
                        b"Contents" => {
                            in_contents = false;
                            if !current_key.is_empty() {
                                objects.push(R2Object {
                                    key: current_key.clone(),
                                    size: current_size,
                                    last_modified: current_last_modified.clone(),
                                });
                            }
                            current_key.clear();
                            current_size = 0;
                            current_last_modified.clear();
                        }
                        b"Key" => in_key = false,
                        b"Size" => in_size = false,
                        b"LastModified" => in_last_modified = false,
                        b"IsTruncated" => in_is_truncated = false,
                        b"NextContinuationToken" => in_next_continuation_token = false,
                        _ => {}
                    }
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(AppError::storage(format!("解析 XML 失败: {}", e))),
                _ => {}
            }
            buf.clear();
        }

        if is_truncated && !next_token.is_empty() {
            continuation_token = Some(next_token);
        } else {
            break;
        }
    }

    objects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    eprintln!("[R2管理] 成功列出 {} 个对象", objects.len());
    Ok(objects)
}

/// AWS S3 签名 V4 兼容的 URI 路径编码
///
/// 根据 AWS 文档，URI 编码规则：
/// - 不编码：A-Z, a-z, 0-9, '-', '.', '_', '~'
/// - 其他字符使用 %XX 格式编码
/// - 空格编码为 %20（不是 +）
/// - 斜杠 '/' 不编码（作为路径分隔符）
fn uri_encode_path(path: &str) -> String {
    path.split('/')
        .map(|segment| aws_uri_encode(segment, false))
        .collect::<Vec<_>>()
        .join("/")
}

/// AWS S3 签名 V4 兼容的 URI 编码
///
/// encode_slash: 是否编码斜杠（用于签名时的规范化 URI 需要 false，查询参数需要 true）
fn aws_uri_encode(input: &str, encode_slash: bool) -> String {
    let mut encoded = String::with_capacity(input.len() * 3);

    for byte in input.bytes() {
        match byte {
            // 不编码：A-Z, a-z, 0-9, '-', '.', '_', '~'
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            // 斜杠根据参数决定是否编码
            b'/' if !encode_slash => {
                encoded.push('/');
            }
            // 其他字符使用 %XX 格式编码
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }

    encoded
}

#[tauri::command]
async fn delete_r2_object(
    config: R2Config,
    key: String,
    http_client: tauri::State<'_, HttpClient>
) -> Result<String, AppError> {
    if config.account_id.is_empty()
        || config.access_key_id.is_empty()
        || config.secret_access_key.is_empty()
        || config.bucket_name.is_empty() {
        return Err(AppError::config("R2 配置不完整，请先在设置中配置所有必填字段"));
    }

    if key.is_empty() {
        return Err(AppError::validation("对象 Key 不能为空"));
    }

    let encoded_key = uri_encode_path(&key);

    let url = format!(
        "https://{}.r2.cloudflarestorage.com/{}/{}",
        config.account_id, config.bucket_name, encoded_key
    );

    let now = chrono::Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();

    let region = "auto";
    let service = "s3";
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
    let canonical_uri = format!("/{}/{}", config.bucket_name, encoded_key);
    let canonical_querystring = "";
    let canonical_headers = format!("host:{}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{}\n", host, datetime_str);
    let signed_headers = "host;x-amz-content-sha256;x-amz-date";
    let payload_hash = "UNSIGNED-PAYLOAD";

    eprintln!("[R2删除] 调试信息:");
    eprintln!("  原始 key: {}", key);
    eprintln!("  编码后 key: {}", encoded_key);
    eprintln!("  Canonical URI: {}", canonical_uri);
    eprintln!("  URL: {}", url);

    let canonical_request = format!(
        "DELETE\n{}\n{}\n{}\n{}\n{}",
        canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
    );

    let mut hasher = Sha256::new();
    hasher.update(canonical_request.as_bytes());
    let canonical_request_hash = hex::encode(hasher.finalize());

    let credential_scope = format!("{}/{}/{}/aws4_request", date_str, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        datetime_str, credential_scope, canonical_request_hash
    );

    let k_date = hmac_sha256(format!("AWS4{}", config.secret_access_key).as_bytes(), date_str.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key_id, credential_scope, signed_headers, signature
    );

    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 0..max_retries {
        if attempt > 0 {
            let delay = std::time::Duration::from_millis(500 * (1 << attempt));
            eprintln!("[R2删除] 第 {} 次重试，等待 {:?}...", attempt, delay);
            tokio::time::sleep(delay).await;
        }

        match http_client.0
            .delete(&url)
            .header("Host", &host)
            .header("x-amz-date", &datetime_str)
            .header("x-amz-content-sha256", payload_hash)
            .header("Authorization", &authorization_header)
            .send()
            .await {
                Ok(response) => {
                    if !response.status().is_success() {
                        let status = response.status();
                        let body = response.text().await.unwrap_or_default();
                        last_error = format!("删除对象失败 (HTTP {}): {}", status, body);

                        if status.is_client_error() {
                            eprintln!("[R2删除] 客户端错误，不重试: {}", last_error);
                            return Err(AppError::storage(last_error));
                        }

                        eprintln!("[R2删除] 服务器错误，将重试: {}", last_error);
                        continue;
                    }

                    eprintln!("[R2管理] 成功删除对象: {}", key);
                    return Ok(format!("成功删除: {}", key));
                },
                Err(e) => {
                    last_error = format!("请求失败: {}", e);
                    eprintln!("[R2删除] 网络错误 (尝试 {}/{}): {}", attempt + 1, max_retries, last_error);

                    if e.is_timeout() || e.is_connect() {
                        continue;
                    }

                    continue;
                }
            }
    }

    Err(AppError::storage(format!("删除失败（已重试 {} 次）: {}", max_retries, last_error)))
}

#[tauri::command]
fn get_or_create_secure_key() -> Result<String, AppError> {
    let entry = Entry::new(SERVICE_NAME, KEY_NAME).map_err(|e| {
        AppError::external(format!("无法访问系统钥匙串: {}", e))
    })?;

    match entry.get_password() {
        Ok(key) => {
            eprintln!("[密钥管理] 从钥匙串读取现有密钥");
            Ok(key)
        },
        Err(_) => {
            eprintln!("[密钥管理] 生成新的加密密钥");
            let mut key_bytes = [0u8; 32];
            rand::thread_rng().fill(&mut key_bytes);
            let new_key = STANDARD.encode(key_bytes);

            entry.set_password(&new_key).map_err(|e| {
                AppError::external(format!("无法保存密钥到系统钥匙串: {}", e))
            })?;

            eprintln!("[密钥管理] ✓ 新密钥已保存到系统钥匙串");
            Ok(new_key)
        }
    }
}

