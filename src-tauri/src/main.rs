// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod analytics;
mod cli;
mod commands;
mod error;
mod log_utils;
mod portable;
mod secure_key;
mod server;
mod url_policy;

use log::LevelFilter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::image::Image;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    Emitter, LogicalSize, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_log::{Target, TargetKind};
use tokio::sync::Mutex as TokioMutex;

/// 关闭按钮行为状态：true = 最小化到托盘，false = 直接退出
pub struct CloseToTrayState(pub AtomicBool);

/// Server 运行时状态
/// upload_config: 当前 Server 使用的图床配置
/// abort_handle: 当前 Server 任务的取消句柄（停止/重启时使用）
pub struct ServerState {
    pub upload_config: Arc<TokioMutex<Option<server::ServerUploadConfig>>>,
    pub auth_token: Arc<TokioMutex<Option<String>>>,
    pub abort_handle: std::sync::Mutex<Option<tokio::task::AbortHandle>>,
}

#[cfg(windows)]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: isize,
        dw_attribute: u32,
        pv_attribute: *const std::ffi::c_void,
        cb_attribute: u32,
    ) -> i32;
}

#[cfg(windows)]
fn disable_window_transitions(hwnd: isize) {
    const DWMWA_TRANSITIONS_FORCEDISABLED: u32 = 3;
    let disable: i32 = 1;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &disable as *const i32 as *const std::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

fn reveal_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let window = app.get_webview_window("main")?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    Some(window)
}

const TRAY_MENU_WINDOW_LABEL: &str = "tray-menu";
const TRAY_MENU_WIDTH: f64 = 185.0;
/// 菜单布局常量：必须与 Vue TrayMenuWindow.vue 保持同步
const TRAY_MENU_ITEM_HEIGHT: f64 = 26.0;
const TRAY_MENU_SEPARATOR_HEIGHT: f64 = 5.0;
const TRAY_MENU_PANEL_EXTRA: f64 = 18.0;
const TRAY_MENU_ITEM_COUNT: f64 = 7.0;
const TRAY_MENU_SEPARATOR_COUNT: f64 = 3.0;
/// 计算结果: 7*26 + 3*5 + 18 = 215.0
const TRAY_MENU_HEIGHT: f64 = TRAY_MENU_ITEM_COUNT * TRAY_MENU_ITEM_HEIGHT
    + TRAY_MENU_SEPARATOR_COUNT * TRAY_MENU_SEPARATOR_HEIGHT
    + TRAY_MENU_PANEL_EXTRA;

fn hide_tray_menu_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(TRAY_MENU_WINDOW_LABEL) {
        let _ = window.emit("tray-menu-hide-requested", ());
    }
}

fn clamp_tray_menu_position(
    app: &tauri::AppHandle,
    event_position: PhysicalPosition<f64>,
    rect: Rect,
    scale_factor: f64,
) -> PhysicalPosition<i32> {
    let rect_position = rect.position.to_physical::<f64>(scale_factor);
    let rect_size = rect.size.to_physical::<f64>(scale_factor);
    let menu_width = (TRAY_MENU_WIDTH * scale_factor).round();
    let menu_height = (TRAY_MENU_HEIGHT * scale_factor).round();

    let mut x = rect_position.x + rect_size.width - menu_width;
    let mut y = rect_position.y - menu_height;

    if let Ok(Some(monitor)) = app.monitor_from_point(event_position.x, event_position.y) {
        let work_area = monitor.work_area();
        let left = work_area.position.x as f64;
        let top = work_area.position.y as f64;
        let right = left + work_area.size.width as f64;
        let bottom = top + work_area.size.height as f64;

        if y < top {
            y = rect_position.y + rect_size.height;
        }
        if y + menu_height > bottom {
            y = rect_position.y - menu_height;
        }

        let max_x = (right - menu_width).max(left);
        let max_y = (bottom - menu_height).max(top);
        x = x.clamp(left, max_x);
        y = y.clamp(top, max_y);
    }

    PhysicalPosition::new(x.round() as i32, y.round() as i32)
}

fn show_tray_menu_window(
    app: &tauri::AppHandle,
    event_position: PhysicalPosition<f64>,
    rect: Rect,
) {
    let Some(window) = app.get_webview_window(TRAY_MENU_WINDOW_LABEL) else {
        log::warn!("[Tray] tray-menu 窗口不存在，无法显示自定义托盘菜单");
        return;
    };

    let scale_factor = app
        .monitor_from_point(event_position.x, event_position.y)
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .or_else(|| window.scale_factor().ok())
        .unwrap_or(1.0);
    let position = clamp_tray_menu_position(app, event_position, rect, scale_factor);

    if let Err(error) = window.set_size(LogicalSize::new(TRAY_MENU_WIDTH, TRAY_MENU_HEIGHT)) {
        log::warn!("[Tray] 设置托盘菜单尺寸失败: {:?}", error);
    }
    if let Err(error) = window.set_position(position) {
        log::warn!("[Tray] 设置托盘菜单位置失败: {:?}", error);
    }
    if let Err(error) = window.show() {
        log::warn!("[Tray] 显示托盘菜单失败: {:?}", error);
        return;
    }
    let _ = window.set_focus();
    let _ = window.emit("tray-menu-opened", ());
}

/// 全局 HTTP 客户端状态
/// 使用单例模式复用 HTTP 客户端，提升性能
pub struct HttpClient(pub reqwest::Client);

fn main() {
    // CLI 模式检测
    match cli::parse_cli_args() {
        cli::CliAction::Help => {
            cli::print_help();
            return;
        }
        cli::CliAction::Version => {
            cli::print_version();
            return;
        }
        cli::CliAction::Upload {
            files,
            json_output,
            service_id,
            profile,
        } => {
            cli::run_cli_upload(files, json_output, service_id, profile);
            return;
        }
        cli::CliAction::Error(message) => {
            eprintln!("[PicNexus] {}", message);
            eprintln!("[PicNexus] 使用 --help 查看命令行用法");
            std::process::exit(1);
        }
        cli::CliAction::None => {}
    }

    // 创建全局 HTTP 客户端（带连接池配置）
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60)) // 60秒超时
        .connect_timeout(std::time::Duration::from_secs(10)) // 10秒连接超时
        .pool_idle_timeout(std::time::Duration::from_secs(90)) // 连接池空闲超时
        .pool_max_idle_per_host(10) // 每个主机最多保持10个空闲连接
        .build()
        .unwrap_or_else(|e| {
            log::warn!("[HTTP Client] 创建失败: {:?}，使用默认配置", e);
            reqwest::Client::new()
        });

    let mut log_targets = vec![Target::new(TargetKind::Stdout)];
    if let Some(log_dir) = portable::portable_data_dir().map(|dir| dir.join("logs")) {
        log_targets.push(Target::new(TargetKind::Folder {
            path: log_dir,
            file_name: None,
        }));
    } else {
        log_targets.push(Target::new(TargetKind::LogDir { file_name: None }));
    }
    #[cfg(debug_assertions)]
    log_targets.push(Target::new(TargetKind::Webview));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // 注册 Tauri 2.0 插件
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets(log_targets)
                .level(LevelFilter::Info)
                .level_for("picnexus", LevelFilter::Debug)
                .level_for("hyper", LevelFilter::Warn)
                .level_for("hyper_util", LevelFilter::Warn)
                .level_for("reqwest", LevelFilter::Warn)
                .level_for("rustls", LevelFilter::Warn)
                .level_for("tungstenite", LevelFilter::Warn)
                .level_for("tokio_tungstenite", LevelFilter::Warn)
                .level_for("aws_sdk_s3", LevelFilter::Warn)
                .level_for("aws_config", LevelFilter::Warn)
                .level_for("aws_smithy_runtime", LevelFilter::Warn)
                .level_for("tracing", LevelFilter::Warn)
                .max_file_size(10_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        .manage(HttpClient(http_client)) // 注册全局 HTTP 客户端
        .manage(CloseToTrayState(AtomicBool::new(true)))
        .manage(analytics::AnalyticsRuntimeState::new())
        .manage(analytics::HeartbeatState::new())
        .manage(commands::link_checker::BatchCheckCancelFlag::new())
        .manage(commands::link_checker::BatchCheckPauseFlag(Arc::new(
            AtomicBool::new(false),
        )))
        .manage(commands::md_scanner::MdScanCancelFlag(Arc::new(
            AtomicBool::new(false),
        )))
        .manage(ServerState {
            upload_config: Arc::new(TokioMutex::new(None)),
            auth_token: Arc::new(TokioMutex::new(None)),
            abort_handle: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            commands::app_paths::is_portable_mode,
            commands::app_paths::get_user_data_dir,
            commands::app_paths::get_history_db_path,
            analytics::analytics_send_batch,
            analytics::analytics_shutdown,
            analytics::heartbeat::analytics_start_heartbeat,
            analytics::heartbeat::analytics_stop_heartbeat,
            commands::cookie_login::open_login_window,
            commands::cookie_login::show_login_window,
            commands::cookie_login::setup_cookie_event_monitoring,
            commands::r2::test_r2_connection,
            commands::webdav_backup::test_webdav_connection,
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
            commands::bilibili::upload_to_bilibili,
            commands::bilibili::test_bilibili_connection,
            commands::chaoxing::upload_to_chaoxing,
            commands::chaoxing::test_chaoxing_connection,
            commands::cli_path::get_cli_path_status,
            commands::cli_path::add_cli_to_path,
            commands::cli_path::remove_cli_from_path,
            commands::smms::upload_to_smms,
            commands::github::upload_to_github,
            commands::imgur::upload_to_imgur,
            commands::s3_compatible::upload_to_s3_compatible,
            commands::s3_compatible::test_s3_connection,
            commands::webdav_upload::upload_to_webdav,
            commands::webdav_upload::test_webdav_storage,
            commands::link_checker::check_image_link,
            commands::link_checker::download_image_from_url,
            commands::link_checker::download_url_image,
            commands::link_checker::batch_check_links,
            commands::link_checker::cancel_batch_check,
            commands::link_checker::pause_batch_check,
            commands::link_checker::resume_batch_check,
            commands::clipboard::clipboard_has_image,
            commands::clipboard::read_clipboard_image,
            commands::clipboard::cleanup_clipboard_temp_file,
            commands::user_files::export_text_file,
            commands::user_files::import_text_file,
            commands::user_files::cleanup_owned_temp_file,
            commands::user_files::allow_user_path,
            commands::image_meta::get_image_metadata,
            commands::image_compress::compress_image,
            commands::image_compress::cleanup_compressed_files,
            commands::image_compress::strip_exif_only,
            commands::image_compress::read_image_as_base64,
            commands::md_scanner::scan_md_folder,
            commands::md_scanner::cancel_md_scan,
            commands::app_key::get_or_create_secure_key,
            commands::app_key::set_secure_key,
            commands::system::open_log_dir,
            commands::webdav_backup::webdav_request,
            commands::open_target::open_path,
            commands::system::check_port_free,
            commands::system::check_editor_server_status,
            commands::system::update_server_config,
            commands::cli_config::save_cli_config,
            commands::system::get_executable_path
        ])
        .setup(|app| {
            // 1. 创建原生菜单栏 (仅 macOS)
            // 在 Windows 上不设置原生菜单栏，避免启动时菜单栏闪烁
            #[cfg(target_os = "macos")]
            {
                let preferences = MenuItem::with_id(
                    app,
                    "preferences",
                    "偏好设置...",
                    true,
                    Some("CmdOrCtrl+,"),
                )?;
                let history =
                    MenuItem::with_id(app, "history", "上传历史记录", true, Some("CmdOrCtrl+H"))?;

                let file_menu = Submenu::with_items(
                    app,
                    "PicNexus",
                    true,
                    &[&preferences, &PredefinedMenuItem::quit(app, Some("退出"))?],
                )?;

                let window_menu = Submenu::with_items(app, "窗口", true, &[&history])?;

                let menu = Menu::with_items(app, &[&file_menu, &window_menu])?;
                app.set_menu(menu)?;

                // 处理菜单事件 (macOS)
                app.on_menu_event(move |app_handle, event| {
                    let menu_id = event.id().as_ref();
                    log::debug!("菜单事件触发: {}", menu_id);

                    match menu_id {
                        "preferences" => {
                            log::debug!("菜单事件触发: 偏好设置");
                            if let Some(main_window) = app_handle.get_webview_window("main") {
                                let _ = main_window.unminimize();
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                                let _ = main_window.emit("navigate-to", "settings");
                            }
                        }
                        "history" => {
                            log::debug!("菜单事件触发: 上传历史记录");
                            if let Some(main_window) = app_handle.get_webview_window("main") {
                                let _ = main_window.unminimize();
                                let _ = main_window.show();
                                let _ = main_window.set_focus();
                                let _ = main_window.emit("navigate-to", "history");
                            }
                        }
                        _ => {
                            log::debug!("未知菜单项: {}", menu_id);
                        }
                    }
                });
            }

            // 3. 创建自定义托盘菜单窗口
            // macOS 使用上面的应用级菜单栏作为入口，不创建系统托盘
            #[cfg(not(target_os = "macos"))]
            {
                let tray_menu_window = WebviewWindowBuilder::new(
                    app,
                    TRAY_MENU_WINDOW_LABEL,
                    WebviewUrl::App("tray-menu.html".into()),
                )
                .inner_size(TRAY_MENU_WIDTH, TRAY_MENU_HEIGHT)
                .transparent(true)
                .resizable(false)
                .decorations(false)
                .visible(false)
                .skip_taskbar(true)
                .always_on_top(true)
                .focused(false)
                .shadow(false)
                .build()?;

                #[cfg(windows)]
                if let Ok(hwnd) = tray_menu_window.hwnd() {
                    disable_window_transitions(hwnd.0 as isize);
                }

                let tray_menu_for_focus = tray_menu_window.clone();
                tray_menu_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        if !*focused {
                            let _ = tray_menu_for_focus.emit("tray-menu-hide-requested", ());
                        }
                    }
                });

                // 4. 创建系统托盘（右键显示 Vue 控制的小菜单窗口）
                // 使用 256x256 PNG 作为托盘图标（适合高分屏缩放）
                let tray_icon = Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
                    .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
                let _tray = TrayIconBuilder::with_id("main-tray")
                    .icon(tray_icon)
                    .icon_as_template(false) // Windows 不使用模板模式以显示彩色图标
                    .show_menu_on_left_click(false) // 左键不显示菜单
                    .on_tray_icon_event(|tray, event| {
                        // 将事件传递给 positioner 插件
                        tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

                        if let TrayIconEvent::Click {
                            position,
                            rect,
                            button,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            match button {
                                MouseButton::Left => {
                                    hide_tray_menu_window(app);
                                    let _ = reveal_main_window(app);
                                }
                                MouseButton::Right => {
                                    show_tray_menu_window(app, position, rect);
                                }
                                _ => {}
                            }
                        }
                    })
                    .build(app)?;
            } // #[cfg(not(target_os = "macos"))] 块结束

            // 5. 窗口初始化
            let window = match app.get_webview_window("main") {
                Some(w) => w,
                None => {
                    log::error!("[Setup] 错误: 无法获取主窗口");
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

                log::debug!("[Display] 检测到屏幕尺寸: {}x{}", sw, sh);

                // Tier 1: 4K / 2K 大屏 (宽度大于 1920 或 高度大于 1200)
                if sw > 1920 || sh > 1200 {
                    if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: 1600,
                        height: 1200,
                    })) {
                        log::warn!("[Display] 设置窗口大小失败: {:?}", e);
                    } else {
                        log::debug!("[Display] 已设置为 Tier 1: 1600x1200");
                        if let Err(e) = window.center() {
                            log::warn!("[Display] 居中窗口失败: {:?}", e);
                        }
                    }
                }
                // Tier 2: 标准 1080P (宽度在 1366~1920 之间)
                else if sw >= 1366 && sh >= 900 {
                    if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: 1280,
                        height: 900,
                    })) {
                        log::warn!("[Display] 设置窗口大小失败: {:?}", e);
                    } else {
                        log::debug!("[Display] 已设置为 Tier 2: 1280x900");
                        if let Err(e) = window.center() {
                            log::warn!("[Display] 居中窗口失败: {:?}", e);
                        }
                    }
                }
                // Tier 3: 小屏幕
                else if let Err(e) = window.maximize() {
                    log::warn!("[Display] 最大化窗口失败: {:?}", e);
                } else {
                    log::debug!("[Display] 已设置为 Tier 3: 最大化");
                }
            } else {
                log::warn!("[Display] 无法获取显示器信息，使用默认窗口大小");
            }
            // --- 最佳适配方案逻辑 End ---

            // 5. 窗口事件处理：关闭最小化到托盘 + 后台内存优化
            {
                let window_for_close = window.clone();
                #[cfg(target_os = "windows")]
                let window_for_focus = window.clone();
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            let close_to_tray = window_for_close
                                .app_handle()
                                .state::<CloseToTrayState>()
                                .0
                                .load(Ordering::Relaxed);
                            if close_to_tray {
                                api.prevent_close();
                                let _ = window_for_close.hide();
                            }
                        }
                        #[cfg(target_os = "windows")]
                        tauri::WindowEvent::Focused(focused) => {
                            // Windows 后台内存优化：WebView2 MemoryUsageTargetLevel
                            let level_str = if *focused { "Normal" } else { "Low" };
                            let window_ref = window_for_focus.clone();
                            let _ = window_ref.with_webview(move |webview| {
                                #[cfg(windows)]
                                unsafe {
                                    use webview2_com::Microsoft::Web::WebView2::Win32::*;
                                    use windows_core::Interface;

                                    let controller = webview.controller();
                                    if let Ok(core) = controller.CoreWebView2() {
                                        if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                                            let level_value = if level_str == "Low" {
                                                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                                            } else {
                                                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                                            };
                                            if core19.SetMemoryUsageTargetLevel(level_value).is_ok()
                                            {
                                                log::trace!(
                                                    "[内存优化] ✓ 已设置为 {} 模式",
                                                    level_str
                                                );
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

            // 启动时清理过期日志（保留最近 7 天）
            if let Ok(log_dir) = portable::log_dir(app.handle()) {
                let max_age = std::time::Duration::from_secs(7 * 24 * 3600);
                let now = std::time::SystemTime::now();
                for entry in std::fs::read_dir(&log_dir).into_iter().flatten().flatten() {
                    let path = entry.path();
                    let is_log = path.extension().and_then(|e| e.to_str()) == Some("log")
                        || path.to_string_lossy().contains(".log.");
                    if !is_log {
                        continue;
                    }

                    let expired = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().or_else(|_| m.created()).ok())
                        .and_then(|t| now.duration_since(t).ok())
                        .is_some_and(|age| age > max_age);

                    if expired {
                        let _ = std::fs::remove_file(&path);
                        log::debug!(
                            "[日志清理] 已删除过期日志: {}",
                            log_utils::safe_path(&path.to_string_lossy())
                        );
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, CloseToTrayState>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}
