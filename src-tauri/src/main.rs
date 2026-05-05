// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod cli;
mod commands;
mod error;
mod log_utils;
mod portable;
mod server;

use error::AppError;
use log::LevelFilter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
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

fn reveal_main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let window = app.get_webview_window("main")?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    Some(window)
}

const TRAY_MENU_WINDOW_LABEL: &str = "tray-menu";
const TRAY_MENU_WIDTH: f64 = 240.0;
/// 菜单布局常量：必须与 Vue TrayMenuWindow.vue 保持同步
const TRAY_MENU_ITEM_HEIGHT: f64 = 26.0;
const TRAY_MENU_SEPARATOR_HEIGHT: f64 = 5.0;
const TRAY_MENU_PANEL_EXTRA: f64 = 18.0;
const TRAY_MENU_ITEM_COUNT: f64 = 6.0;
const TRAY_MENU_SEPARATOR_COUNT: f64 = 3.0;
/// 计算结果: 6*26 + 3*5 + 18 = 189.0
const TRAY_MENU_HEIGHT: f64 = TRAY_MENU_ITEM_COUNT * TRAY_MENU_ITEM_HEIGHT
    + TRAY_MENU_SEPARATOR_COUNT * TRAY_MENU_SEPARATOR_HEIGHT
    + TRAY_MENU_PANEL_EXTRA;

fn hide_tray_menu_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(TRAY_MENU_WINDOW_LABEL) {
        let _ = window.hide();
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

fn show_tray_menu_window(app: &tauri::AppHandle, event_position: PhysicalPosition<f64>, rect: Rect) {
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

#[tauri::command]
fn is_portable_mode() -> bool {
    portable::is_portable()
}

#[tauri::command]
fn get_user_data_dir(app: tauri::AppHandle) -> Result<String, AppError> {
    Ok(portable::user_data_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn get_history_db_path() -> String {
    portable::history_db_url()
}

// 用于 R2 和 WebDAV 测试
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
type HmacSha256 = Hmac<Sha256>;

// 用于密钥管理
use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::Entry;
use rand::Rng;

// 定义服务名，防止与其他应用冲突
const SERVICE_NAME: &str = "us.picnex.app.secure";
const KEY_NAME: &str = "config_encryption_key";

/// 验证字段名是否安全（防止 JavaScript 注入）
/// 只允许字母、数字、下划线和连字符
fn is_safe_field_name(field: &str) -> bool {
    !field.is_empty()
        && field.len() <= 64
        && field
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 验证服务 ID 是否安全（防止 JavaScript 注入）
/// 只允许字母、数字、下划线和连字符
fn is_safe_service_id(service: &str) -> bool {
    !service.is_empty()
        && service.len() <= 32
        && service
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
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
        cli::CliAction::Upload { files, json_output } => {
            cli::run_cli_upload(files, json_output);
            return;
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
        .plugin(tauri_plugin_single_instance::init(
            |app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
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
            is_portable_mode,
            get_user_data_dir,
            get_history_db_path,
            open_login_window,
            show_login_window,
            save_cookie_from_login,
            start_cookie_monitoring,
            setup_cookie_event_monitoring,
            get_request_header_cookie,
            test_r2_connection,
            test_webdav_connection,
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
            commands::smms::upload_to_smms,
            commands::github::upload_to_github,
            commands::imgur::upload_to_imgur,
            commands::s3_compatible::upload_to_s3_compatible,
            commands::s3_compatible::test_s3_connection,
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
            commands::image_meta::get_image_metadata,
            commands::image_compress::compress_image,
            commands::image_compress::cleanup_compressed_files,
            commands::image_compress::strip_exif_only,
            commands::image_compress::read_image_as_base64,
            commands::md_scanner::scan_md_folder,
            commands::md_scanner::cancel_md_scan,
            get_or_create_secure_key,
            set_secure_key,
            open_log_dir,
            open_path,
            check_port_free,
            update_server_config,
            save_cli_config,
            get_executable_path
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

                let tray_menu_for_focus = tray_menu_window.clone();
                tray_menu_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        if !*focused {
                            let _ = tray_menu_for_focus.hide();
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

/// Cookie 更新事件的 payload 结构
#[derive(Clone, serde::Serialize)]
struct CookieUpdatedPayload {
    #[serde(rename = "serviceId")]
    service_id: String,
    cookie: String,
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, CloseToTrayState>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

/// 打开多 Webview 登录窗口
/// 窗口结构：标题栏 Webview (36px) + 内容区 Webview
#[tauri::command]
async fn open_login_window(
    app: tauri::AppHandle,
    service_id: String,
    service_name: String,
    width: f64,
    height: f64,
    titlebar_url: String,
    content_url: String,
) -> Result<(), AppError> {
    use tauri::{LogicalPosition, LogicalSize, WebviewUrl};

    if !is_safe_service_id(&service_id) {
        return Err(AppError::validation(format!(
            "无效的服务 ID: {}",
            service_id
        )));
    }

    // URL 路径白名单校验
    if !titlebar_url.starts_with("login-titlebar.html") {
        return Err(AppError::validation("无效的标题栏 URL"));
    }
    if !content_url.starts_with("login-webview.html") {
        return Err(AppError::validation("无效的内容 URL"));
    }

    // 限制窗口尺寸范围
    let width = width.clamp(300.0, 2000.0);
    let height = height.clamp(200.0, 1500.0);

    // 如果窗口已存在，聚焦并返回
    if let Some(existing) = app.get_window("login-window") {
        let _ = existing.set_focus();
        return Ok(());
    }

    let titlebar_height: f64 = 36.0;

    // 创建无边框窗口
    let window = tauri::window::WindowBuilder::new(&app, "login-window")
        .title(format!("{} 登录", service_name))
        .inner_size(width, height)
        .decorations(false)
        .visible(false)
        .center()
        .build()
        .map_err(|e| AppError::external(format!("创建登录窗口失败: {}", e)))?;

    // 添加标题栏 Webview
    let _titlebar = window
        .add_child(
            tauri::webview::WebviewBuilder::new(
                "login-titlebar",
                WebviewUrl::App(titlebar_url.into()),
            ),
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(width, titlebar_height),
        )
        .map_err(|e| AppError::external(format!("创建标题栏失败: {}", e)))?;

    // 添加内容区 Webview
    let _content = window
        .add_child(
            tauri::webview::WebviewBuilder::new(
                "login-content",
                WebviewUrl::App(content_url.into()),
            ),
            LogicalPosition::new(0.0, titlebar_height),
            LogicalSize::new(width, height - titlebar_height),
        )
        .map_err(|e| AppError::external(format!("创建内容区失败: {}", e)))?;

    // 监听窗口 resize，同步更新子 Webview 尺寸
    let win_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Resized(physical_size) = event {
            // 最小化时物理尺寸为 (0, 0)，跳过布局更新
            if physical_size.width == 0 || physical_size.height == 0 {
                return;
            }
            let scale = win_clone.scale_factor().unwrap_or(1.0);
            let logical_w = physical_size.width as f64 / scale;
            let logical_h = physical_size.height as f64 / scale;

            if let Some(titlebar) = win_clone.app_handle().get_webview("login-titlebar") {
                let _ = titlebar.set_size(LogicalSize::new(logical_w, titlebar_height));
            }
            if let Some(content) = win_clone.app_handle().get_webview("login-content") {
                let _ = content.set_position(LogicalPosition::new(0.0, titlebar_height));
                let _ = content.set_size(LogicalSize::new(logical_w, logical_h - titlebar_height));
            }
        }
    });

    // 不立即 show，等待前端 Vue 挂载完成后由 show_login_window 命令触发
    // 兜底：3 秒后如果前端未调用 show，自动显示（防止前端崩溃导致窗口永不可见）
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        if let Some(w) = app_handle.get_window("login-window") {
            if !w.is_visible().unwrap_or(true) {
                let _ = w.show();
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn show_login_window(app: tauri::AppHandle) -> Result<(), AppError> {
    if let Some(window) = app.get_window("login-window") {
        window
            .show()
            .map_err(|e| AppError::external(format!("显示窗口失败: {}", e)))?;
    }
    Ok(())
}

#[tauri::command]
async fn save_cookie_from_login(
    cookie: String,
    service_id: Option<String>,
    required_fields: Option<Vec<String>>,
    any_of_fields: Option<Vec<String>>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    let service = service_id.unwrap_or_else(|| "weibo".to_string());
    let fields = required_fields.unwrap_or_default();
    let any_fields = any_of_fields.unwrap_or_default();
    log::debug!(
        "[保存Cookie] 开始保存Cookie，服务: {}，长度: {}，必要字段: {:?}，任意字段: {:?}",
        service,
        cookie.len(),
        fields,
        any_fields
    );

    if cookie.trim().is_empty() {
        return Err(AppError::validation("Cookie不能为空"));
    }

    if (!fields.is_empty() || !any_fields.is_empty())
        && !validate_cookie_fields(&service, &cookie, &fields, &any_fields)
    {
        return Err(AppError::auth(format!(
            "Cookie 缺少必要字段，{}需要包含: {:?}{}",
            service,
            fields,
            if any_fields.is_empty() {
                String::new()
            } else {
                format!("，且至少包含: {:?} 之一", any_fields)
            }
        )));
    }

    if let Some(main_window) = app.get_webview_window("main") {
        let payload = CookieUpdatedPayload {
            service_id: service.clone(),
            cookie: cookie.clone(),
        };

        match main_window.emit("cookie-updated", payload) {
            Ok(_) => {
                log::debug!("[保存Cookie] ✓ 已发送 {} Cookie到主窗口", service);

                if let Some(login_window) = app.get_window("login-window") {
                    let _ = login_window.close();
                    log::debug!("[保存Cookie] ✓ 已请求关闭登录窗口");
                }

                Ok(())
            }
            Err(e) => {
                log::error!("[保存Cookie] 发送事件失败: {:?}", e);
                Err(AppError::external(format!("发送Cookie事件失败: {}", e)))
            }
        }
    } else {
        log::error!("[保存Cookie] 错误: 找不到主窗口");
        Err(AppError::external("找不到主窗口"))
    }
}

fn check_cookie_field(cookie: &str, field: &str, _service_id: &str) -> bool {
    if !is_safe_field_name(field) {
        log::warn!("[Cookie验证] 无效字段名: {}", field);
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
                log::warn!("[Cookie验证] 字段 {} 值为空", field);
                return false;
            }

            let value = &remaining[..value_end];
            // 安全日志：只打印字段名和长度，不打印实际值，防止敏感信息泄露
            log::debug!(
                "[Cookie验证] 字段 {} 存在 (长度: {} 字符)",
                field,
                value.len()
            );

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
        "nowcoder" => (
            vec!["t", "csrfToken"],
            vec!["acw_tc", "SERVERID", "__snaker__id", "gdxidpyhxdE"],
        ),
        "nami" => (vec!["Auth-Token"], vec!["Q", "T"]),
        // 哔哩哔哩：需要 SESSDATA 和 bili_jct (csrf)
        "bilibili" => (vec!["SESSDATA", "bili_jct"], vec![]),
        // 超星：需要 _uid 字段
        "chaoxing" => (vec!["_uid"], vec![]),
        _ => (vec![], vec![]),
    }
}

/// 检查字段值是否匹配期望值（泛化的登录状态检查，替代硬编码的服务特定逻辑）
fn check_field_value_matches(
    cookie: &str,
    field_value_checks: &std::collections::HashMap<String, String>,
) -> bool {
    if field_value_checks.is_empty() {
        return true;
    }

    for (field, expected_value) in field_value_checks {
        let search_pattern = format!("{}=", field);
        let mut found = false;
        let mut search_start = 0;

        while let Some(pos) = cookie[search_start..].find(&search_pattern) {
            let absolute_pos = search_start + pos;
            let is_valid_start = if absolute_pos == 0 {
                true
            } else {
                let before = &cookie[..absolute_pos];
                before.trim_end().ends_with(';') || before.trim_end().is_empty()
            };

            if is_valid_start {
                let value_start = absolute_pos + search_pattern.len();
                let remaining = &cookie[value_start..];
                let value_end = remaining.find(';').unwrap_or(remaining.len());
                let actual_value = remaining[..value_end].trim();

                if actual_value == expected_value.as_str() {
                    log::debug!("[字段值检查] ✓ {} 值匹配", field);
                    found = true;
                    break;
                } else {
                    log::debug!(
                        "[字段值检查] ✗ {} 值不匹配，期望长度 {}，实际长度 {}",
                        field,
                        expected_value.len(),
                        actual_value.len()
                    );
                    return false;
                }
            }
            search_start = absolute_pos + 1;
        }

        if !found {
            log::debug!("[字段值检查] ✗ 缺少字段 {}", field);
            return false;
        }
    }
    true
}

/// 获取服务的默认字段值检查规则（当前端未传 field_value_checks 时使用）
fn get_default_field_value_checks(service_id: &str) -> std::collections::HashMap<String, String> {
    let mut checks = std::collections::HashMap::new();
    if service_id == "weibo" {
        checks.insert("MLOGIN".to_string(), "1".to_string());
    }
    checks
}

fn validate_cookie_fields(
    service_id: &str,
    cookie: &str,
    required_fields: &[String],
    any_of_fields: &[String],
) -> bool {
    validate_cookie_fields_with_value_checks(
        service_id,
        cookie,
        required_fields,
        any_of_fields,
        &None,
    )
}

fn validate_cookie_fields_with_value_checks(
    service_id: &str,
    cookie: &str,
    required_fields: &[String],
    any_of_fields: &[String],
    field_value_checks: &Option<std::collections::HashMap<String, String>>,
) -> bool {
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

    log::debug!(
        "[Cookie验证] 服务: {}, 必要字段: {:?}, 任意字段: {:?}",
        service_id,
        actual_required,
        actual_any
    );

    if actual_required.is_empty() && actual_any.is_empty() {
        return !cookie.trim().is_empty();
    }

    // 检查必要字段
    for field in &actual_required {
        if !check_cookie_field(cookie, field, service_id) {
            log::warn!("[Cookie验证] ✗ 缺少必要字段: {}", field);
            return false;
        }
    }
    log::debug!("[Cookie验证] ✓ 通过 requiredFields 检查");

    // 检查任意字段
    if !actual_any.is_empty() {
        let has_any = actual_any
            .iter()
            .any(|f| check_cookie_field(cookie, f, service_id));
        if !has_any {
            log::warn!(
                "[Cookie验证] ✗ 缺少任意安全字段，需要至少包含: {:?}",
                actual_any
            );
            return false;
        }
        log::debug!("[Cookie验证] ✓ 通过 anyOfFields 检查");
    }

    // 检查字段值（泛化的登录状态检查）
    let actual_checks = match field_value_checks {
        Some(checks) if !checks.is_empty() => checks.clone(),
        _ => get_default_field_value_checks(service_id),
    };
    if !check_field_value_matches(cookie, &actual_checks) {
        log::warn!("[Cookie验证] ✗ {} 字段值检查失败", service_id);
        return false;
    }

    log::debug!("[Cookie验证] ✓ {} Cookie 验证通过！", service_id);
    true
}

// DEPRECATED: 已被 setup_cookie_event_monitoring 替代，保留供非 Windows 降级使用
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri IPC 参数已被前端调用约定固定，拆结构会扩大改动面。
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
        return Err(AppError::validation(format!(
            "无效的服务 ID: {}，只允许字母、数字、下划线和连字符",
            service
        )));
    }

    // 不再默认回退到微博域名，使用前端传入的配置
    let domains: Vec<String> = target_domains
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| target_domain.map(|d| vec![d]).unwrap_or_default());
    let fields = required_fields.unwrap_or_default();
    let any_fields = any_of_fields.unwrap_or_default();

    for field in fields.iter().chain(any_fields.iter()) {
        if !is_safe_field_name(field) {
            return Err(AppError::validation(format!(
                "无效的字段名: {}，只允许字母、数字、下划线和连字符",
                field
            )));
        }
    }

    let initial_delay = initial_delay_ms
        .unwrap_or(DEFAULT_INITIAL_DELAY_MS)
        .clamp(MIN_INITIAL_DELAY_MS, MAX_INITIAL_DELAY_MS);

    let polling_interval = polling_interval_ms
        .unwrap_or(DEFAULT_POLLING_INTERVAL_MS)
        .clamp(MIN_POLLING_INTERVAL_MS, MAX_POLLING_INTERVAL_MS);

    log::debug!(
        "[Cookie监控] 开始监控 {} 的Cookie (域名列表: {:?}, 必要字段: {:?}, 任意字段: {:?}, 初始延迟: {}ms, 轮询间隔: {}ms)",
        service, domains, fields, any_fields, initial_delay, polling_interval
    );

    let app_handle = app.clone();

    std::thread::spawn(move || {
        log::debug!("[Cookie监控] 等待 {}ms 后开始检测...", initial_delay);
        std::thread::sleep(Duration::from_millis(initial_delay));

        let mut check_count = 0;
        let max_timeout_ms = 240000u64;
        let max_checks =
            ((max_timeout_ms.saturating_sub(initial_delay)) / polling_interval).max(10) as i32;

        log::debug!(
            "[Cookie监控] 最大检查次数: {} (预计总时长: {}ms)",
            max_checks,
            initial_delay + (max_checks as u64 * polling_interval)
        );

        while check_count < max_checks {
            std::thread::sleep(Duration::from_millis(polling_interval));
            check_count += 1;

            log::debug!(
                "[Cookie监控] 第 {}/{} 次检查 (服务: {})",
                check_count,
                max_checks,
                service
            );

            if let Some(login_webview) = app_handle.get_webview("login-content") {
                #[cfg(target_os = "windows")]
                {
                    if attempt_cookie_capture_and_save_generic(
                        &login_webview,
                        &app_handle,
                        &service,
                        &domains,
                        &fields,
                        &any_fields,
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
                        format!(
                            "({}) && ({})",
                            required_checks.join(" && "),
                            any_checks.join(" || ")
                        )
                    };

                    let fields_json =
                        serde_json::to_string(&fields).unwrap_or_else(|_| "[]".to_string());
                    let any_fields_json =
                        serde_json::to_string(&any_fields).unwrap_or_else(|_| "[]".to_string());

                    let check_js = format!(
                        r#"
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
                    "#,
                        condition = condition,
                        service = service,
                        fields_json = fields_json,
                        any_fields_json = any_fields_json
                    );

                    if let Err(e) = login_webview.eval(&check_js) {
                        log::warn!("[Cookie监控] 执行JS脚本失败: {:?}", e);
                    }
                }
            } else {
                log::debug!("[Cookie监控] 登录窗口已关闭，自动停止监控");
                break;
            }
        }

        log::debug!("[Cookie监控] 监控结束（检查次数: {}）", check_count);
    });

    Ok(())
}

/// 事件驱动的 Cookie 监控：监听 NavigationCompleted 事件，仅在页面导航完成时提取 Cookie
#[tauri::command]
async fn setup_cookie_event_monitoring(
    app: tauri::AppHandle,
    service_id: Option<String>,
    target_domains: Option<Vec<String>>,
    required_fields: Option<Vec<String>>,
    any_of_fields: Option<Vec<String>>,
    field_value_checks: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<(), AppError> {
    const DEFAULT_TIMEOUT_MS: u64 = 60000;

    let service = service_id.unwrap_or_else(|| "weibo".to_string());

    if !is_safe_service_id(&service) {
        return Err(AppError::validation(format!("无效的服务 ID: {}", service)));
    }

    let domains: Vec<String> = target_domains.filter(|v| !v.is_empty()).unwrap_or_default();
    let fields = required_fields.unwrap_or_default();
    let any_fields = any_of_fields.unwrap_or_default();

    for field in fields.iter().chain(any_fields.iter()) {
        if !is_safe_field_name(field) {
            return Err(AppError::validation(format!("无效的字段名: {}", field)));
        }
    }

    // Issue #3: 验证 field_value_checks 的 key 安全性
    if let Some(ref checks) = field_value_checks {
        for key in checks.keys() {
            if !is_safe_field_name(key) {
                return Err(AppError::validation(format!(
                    "无效的字段值检查 key: {}",
                    key
                )));
            }
        }
    }

    let timeout = timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(10000, 300000);

    log::debug!(
        "[事件监控] 开始监控 {} 的Cookie (域名: {:?}, 超时: {}ms)",
        service,
        domains,
        timeout
    );

    #[cfg(target_os = "windows")]
    {
        let Some(login_webview) = app.get_webview("login-content") else {
            return Err(AppError::external("登录窗口未打开"));
        };

        let app_handle = app.clone();
        let service_clone = service.clone();
        let domains_clone = domains.clone();
        let fields_clone = fields.clone();
        let any_fields_clone = any_fields.clone();
        let field_value_checks_clone = field_value_checks.clone();

        let completed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first_nav_done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        let completed_for_handler = completed.clone();
        let first_nav_for_handler = first_nav_done.clone();

        let app_for_ready = app.clone();
        let result = login_webview.with_webview(move |webview| {
            #[cfg(windows)]
            unsafe {
                use webview2_com::Microsoft::Web::WebView2::Win32::*;

                let controller = webview.controller();
                let core = match controller.CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("[事件监控] 获取 CoreWebView2 失败: {:?}", e);
                        return;
                    }
                };

                #[windows_core::implement(ICoreWebView2NavigationCompletedEventHandler)]
                struct NavHandler {
                    app_handle: tauri::AppHandle,
                    service_id: String,
                    domains: Vec<String>,
                    required_fields: Vec<String>,
                    any_of_fields: Vec<String>,
                    field_value_checks: Option<std::collections::HashMap<String, String>>,
                    completed: std::sync::Arc<std::sync::atomic::AtomicBool>,
                    first_nav_done: std::sync::Arc<std::sync::atomic::AtomicBool>,
                    timeout_ms: u64,
                }

                impl ICoreWebView2NavigationCompletedEventHandler_Impl for NavHandler_Impl {
                    fn Invoke(
                        &self,
                        sender: windows_core::Ref<'_, ICoreWebView2>,
                        args: windows_core::Ref<'_, ICoreWebView2NavigationCompletedEventArgs>,
                    ) -> windows_core::Result<()> {
                        use std::sync::atomic::Ordering;

                        if self.completed.load(Ordering::SeqCst) {
                            return Ok(());
                        }

                        // 检查导航是否成功
                        let mut is_success = windows_core::BOOL::default();
                        if let Ok(a) = args.ok() {
                            let _ = unsafe { a.IsSuccess(&mut is_success) };
                        }

                        // 获取当前 URL 用于日志
                        let mut url_ptr = windows_core::PWSTR::null();
                        if let Ok(s) = sender.ok() {
                            let _ = unsafe { s.Source(&mut url_ptr) };
                        }
                        let current_url = unsafe { url_ptr.to_string().unwrap_or_default() };
                        log::debug!(
                            "[事件监控] NavigationCompleted: {} (成功: {})",
                            current_url,
                            is_success.as_bool()
                        );

                        // 首次导航完成（登录页加载好），启动超时计时器 + 轮询兜底
                        if !self.first_nav_done.swap(true, Ordering::SeqCst) {
                            log::debug!(
                                "[事件监控] 登录页加载完成，启动 {}ms 超时计时器 + 轮询兜底",
                                self.timeout_ms
                            );
                            let timeout = self.timeout_ms;
                            let completed_for_timeout = self.completed.clone();
                            let app_for_timeout = self.app_handle.clone();
                            let service_for_timeout = self.service_id.clone();

                            // Issue #4: 分段 sleep，支持提前退出 + 窗口关闭感知
                            std::thread::spawn(move || {
                                use std::sync::atomic::Ordering;
                                let interval = Duration::from_secs(1);
                                let total = Duration::from_millis(timeout);
                                let mut elapsed = Duration::ZERO;

                                while elapsed < total {
                                    std::thread::sleep(interval.min(total - elapsed));
                                    elapsed += interval;
                                    if completed_for_timeout.load(Ordering::SeqCst) {
                                        return;
                                    }
                                    if app_for_timeout.get_window("login-window").is_none() {
                                        log::debug!("[事件监控] 登录窗口已关闭，取消超时计时");
                                        return;
                                    }
                                }
                                log::warn!(
                                    "[事件监控] ⏰ {} 超时（{}ms），发送通知",
                                    service_for_timeout,
                                    timeout
                                );
                                let _ = app_for_timeout
                                    .emit("cookie-monitoring-timeout", &service_for_timeout);
                            });

                            // 轮询兜底：SPA 登录流程不触发 NavigationCompleted，定期提取 Cookie
                            spawn_cookie_poll_fallback(
                                self.app_handle.clone(),
                                self.service_id.clone(),
                                self.domains.clone(),
                                self.required_fields.clone(),
                                self.any_of_fields.clone(),
                                self.field_value_checks.clone(),
                                self.completed.clone(),
                                self.timeout_ms,
                            );
                        }

                        if !is_success.as_bool() {
                            return Ok(());
                        }

                        // Issue #2: 将 Cookie 提取移到新线程，避免阻塞 WebView2 UI 线程
                        // try_extract_cookie_header_generic 内部调用 with_webview + channel 等待，
                        // 在 UI 线程中调用会死锁
                        let app = self.app_handle.clone();
                        let service = self.service_id.clone();
                        let domains = self.domains.clone();
                        let required_fields = self.required_fields.clone();
                        let any_of_fields = self.any_of_fields.clone();
                        let field_value_checks = self.field_value_checks.clone();
                        let completed = self.completed.clone();

                        std::thread::spawn(move || {
                            log::debug!(
                                "[事件监控] 检测到页面跳转，尝试提取 {} Cookie...",
                                service
                            );

                            let login_webview = match app.get_webview("login-content") {
                                Some(w) => w,
                                None => {
                                    log::debug!("[事件监控] 登录窗口已关闭");
                                    return;
                                }
                            };

                            let merged_cookie = match extract_and_merge_cookies(
                                &login_webview,
                                &domains,
                                "事件监控",
                            ) {
                                Some(c) => c,
                                None => {
                                    log::debug!("[事件监控] 未提取到 Cookie，等待下次导航...");
                                    return;
                                }
                            };

                            if validate_cookie_fields_with_value_checks(
                                &service,
                                &merged_cookie,
                                &required_fields,
                                &any_of_fields,
                                &field_value_checks,
                            ) {
                                log::debug!("[事件监控] ✓ {} Cookie 验证通过！保存中...", service);
                                if completed
                                    .compare_exchange(
                                        false,
                                        true,
                                        std::sync::atomic::Ordering::SeqCst,
                                        std::sync::atomic::Ordering::SeqCst,
                                    )
                                    .is_err()
                                {
                                    log::debug!("[事件监控] 已被其他线程完成，跳过保存");
                                    return;
                                }

                                let app_save = app.clone();
                                let service_save = service.clone();
                                let fields_save = required_fields;
                                let any_fields_save = any_of_fields;

                                tauri::async_runtime::spawn(async move {
                                    if let Err(e) = save_cookie_from_login(
                                        merged_cookie,
                                        Some(service_save),
                                        Some(fields_save),
                                        Some(any_fields_save),
                                        app_save,
                                    )
                                    .await
                                    {
                                        log::warn!("[事件监控] 保存Cookie失败: {}", e);
                                    }
                                });
                            } else {
                                log::debug!("[事件监控] ✗ Cookie 验证未通过，等待下次导航...");
                            }
                        });

                        Ok(())
                    }
                }

                let handler: ICoreWebView2NavigationCompletedEventHandler = NavHandler {
                    app_handle,
                    service_id: service_clone,
                    domains: domains_clone,
                    required_fields: fields_clone,
                    any_of_fields: any_fields_clone,
                    field_value_checks: field_value_checks_clone,
                    completed: completed_for_handler,
                    first_nav_done: first_nav_for_handler,
                    timeout_ms: timeout,
                }
                .into();

                let mut token: i64 = 0;
                if let Err(e) = core.add_NavigationCompleted(&handler, &mut token) {
                    log::warn!("[事件监控] 注册 NavigationCompleted 失败: {:?}", e);
                    // 降级到轮询模式提示
                    return;
                }

                log::debug!("[事件监控] ✓ NavigationCompleted 事件注册成功");
            }
        });

        // 通知前端 handler 已注册完成，可以安全跳转
        let _ = app_for_ready.emit("cookie-monitoring-ready", ());

        if result.is_err() {
            log::warn!("[事件监控] with_webview 调用失败，降级到轮询模式");
            // 降级：调用旧的轮询命令
            return start_cookie_monitoring(
                app,
                Some(service),
                None,
                Some(domains),
                Some(fields),
                Some(any_fields),
                None,
                None,
            )
            .await;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        log::debug!("[事件监控] 非 Windows 平台，降级到轮询模式");
        return start_cookie_monitoring(
            app,
            Some(service),
            None,
            Some(domains),
            Some(fields),
            Some(any_fields),
            None,
            None,
        )
        .await;
    }

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
        return Err(AppError::validation(format!(
            "无效的服务 ID: {}，只允许字母、数字、下划线和连字符",
            service
        )));
    }

    // 不再默认回退到微博域名，使用前端传入的配置
    let domains: Vec<String> = target_domains
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| target_domain.map(|d| vec![d]).unwrap_or_default());
    let fields = required_fields.unwrap_or_default();
    let any_fields = any_of_fields.unwrap_or_default();

    for field in fields.iter().chain(any_fields.iter()) {
        if !is_safe_field_name(field) {
            return Err(AppError::validation(format!(
                "无效的字段名: {}，只允许字母、数字、下划线和连字符",
                field
            )));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let Some(login_webview) = app.get_webview("login-content") else {
            return Err(AppError::external("登录窗口未打开，请先点击「开始登录」"));
        };

        let merged_cookie = match extract_and_merge_cookies(&login_webview, &domains, "Cookie获取")
        {
            Some(c) => c,
            None => return Err(AppError::auth("未检测到 Cookie，请确认已完成登录后再试")),
        };

        if validate_cookie_fields(&service, &merged_cookie, &fields, &any_fields) {
            log::debug!(
                "[Cookie获取] {} 请求头Cookie长度: {}",
                service,
                merged_cookie.len()
            );
            Ok(merged_cookie)
        } else {
            Err(AppError::auth(format!(
                "提取到的 Cookie 缺少关键字段（{:?}{}），请确认已成功登录{}",
                fields,
                if any_fields.is_empty() {
                    String::new()
                } else {
                    format!(" 或 {:?} 之一", any_fields)
                },
                service
            )))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, service, domains, fields, any_fields);
        Err(AppError::external(
            "当前操作系统暂不支持请求头 Cookie 提取，请使用页面内的手动复制方式",
        ))
    }
}

#[cfg(target_os = "windows")]
fn attempt_cookie_capture_and_save_generic(
    login_window: &tauri::Webview,
    app_handle: &tauri::AppHandle,
    service_id: &str,
    target_domains: &[String],
    required_fields: &[String],
    any_of_fields: &[String],
) -> bool {
    let merged_cookie = match extract_and_merge_cookies(login_window, target_domains, "Cookie监控")
    {
        Some(c) => c,
        None => {
            log::debug!("[Cookie监控] 未从任何域名提取到 Cookie，继续等待...");
            return false;
        }
    };

    if validate_cookie_fields(service_id, &merged_cookie, required_fields, any_of_fields) {
        log::debug!("[Cookie监控] ✓ 验证通过，尝试保存 {} Cookie", service_id);
        match tauri::async_runtime::block_on(save_cookie_from_login(
            merged_cookie.clone(),
            Some(service_id.to_string()),
            Some(required_fields.to_vec()),
            Some(any_of_fields.to_vec()),
            app_handle.clone(),
        )) {
            Ok(_) => {
                log::debug!("[Cookie监控] ✓ {} Cookie保存成功", service_id);
                true
            }
            Err(err) => {
                log::warn!("[Cookie监控] 保存Cookie失败: {}", err);
                false
            }
        }
    } else {
        log::debug!("[Cookie监控] ✗ 验证失败，Cookie 缺少必要字段，继续等待...");
        false
    }
}

/// SPA 轮询兜底：定期从 WebView 提取 Cookie 并验证
/// 用于 SPA 登录流程不触发 NavigationCompleted 的场景
#[cfg(target_os = "windows")]
#[allow(clippy::too_many_arguments)] // Cookie 轮询兜底沿用调用方拆开的 IPC 参数，保持局部兼容。
fn spawn_cookie_poll_fallback(
    app: tauri::AppHandle,
    service_id: String,
    domains: Vec<String>,
    required_fields: Vec<String>,
    any_of_fields: Vec<String>,
    field_value_checks: Option<std::collections::HashMap<String, String>>,
    completed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    timeout_ms: u64,
) {
    use std::sync::atomic::Ordering;

    std::thread::spawn(move || {
        let poll_interval = Duration::from_secs(2);
        let total = Duration::from_millis(timeout_ms);

        // 初始延迟 3 秒，分段 sleep 以感知窗口关闭
        for _ in 0..3 {
            std::thread::sleep(Duration::from_secs(1));
            if completed.load(Ordering::SeqCst) || app.get_window("login-window").is_none() {
                return;
            }
        }
        let mut elapsed = Duration::from_secs(3);

        while elapsed < total {
            if completed.load(Ordering::SeqCst) {
                log::debug!("[轮询兜底] Cookie 已获取，轮询退出");
                return;
            }

            let Some(login_webview) = app.get_webview("login-content") else {
                log::debug!("[轮询兜底] 登录窗口已关闭，轮询退出");
                return;
            };

            if let Some(merged_cookie) =
                extract_and_merge_cookies(&login_webview, &domains, "轮询兜底")
            {
                if validate_cookie_fields_with_value_checks(
                    &service_id,
                    &merged_cookie,
                    &required_fields,
                    &any_of_fields,
                    &field_value_checks,
                ) {
                    log::debug!("[轮询兜底] ✓ {} Cookie 验证通过！保存中...", service_id);
                    if completed
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_err()
                    {
                        log::debug!("[轮询兜底] 已被其他线程完成，跳过保存");
                        return;
                    }

                    let app_save = app.clone();
                    let service_save = service_id.clone();
                    let fields_save = required_fields.clone();
                    let any_fields_save = any_of_fields.clone();

                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = save_cookie_from_login(
                            merged_cookie,
                            Some(service_save),
                            Some(fields_save),
                            Some(any_fields_save),
                            app_save,
                        )
                        .await
                        {
                            log::warn!("[轮询兜底] 保存Cookie失败: {}", e);
                        }
                    });
                    return;
                }
            }

            std::thread::sleep(poll_interval);
            elapsed += poll_interval;
        }
    });
}

/// 从多个域名提取 Cookie 并合并去重
/// 返回 (合并后的 Cookie 字符串, 是否为空)
#[cfg(target_os = "windows")]
fn extract_and_merge_cookies(
    webview: &tauri::Webview,
    domains: &[String],
    log_prefix: &str,
) -> Option<String> {
    let mut all_cookies: std::collections::BTreeMap<String, String> =
        std::collections::BTreeMap::new();

    for domain in domains {
        match try_extract_cookie_header_generic(webview, domain) {
            Ok(Some(cookie)) => {
                log::debug!(
                    "[{}] 从 {} 提取到 Cookie (长度: {})",
                    log_prefix,
                    domain,
                    cookie.len()
                );
                for part in cookie.split("; ") {
                    if let Some(eq_pos) = part.find('=') {
                        let key = part[..eq_pos].to_string();
                        let value = part[eq_pos + 1..].to_string();
                        all_cookies.insert(key, value);
                    }
                }
            }
            Ok(None) => {
                log::debug!("[{}] 从 {} 未提取到 Cookie", log_prefix, domain);
            }
            Err(err) => {
                log::warn!("[{}] 从 {} 读取Cookie失败: {}", log_prefix, domain, err);
            }
        }
    }

    if all_cookies.is_empty() {
        return None;
    }

    let merged: String = all_cookies
        .into_iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ");

    let field_count = merged.matches('=').count();
    log::debug!(
        "[{}] 合并 Cookie: {} 个字段，{} 字符",
        log_prefix,
        field_count,
        merged.len()
    );
    Some(merged)
}

// WebView2 Cookie 自动提取功能 (Windows)
// 使用 WebView2 CookieManager API 从指定域名提取 Cookie
#[cfg(target_os = "windows")]
fn try_extract_cookie_header_generic(
    window: &tauri::Webview,
    domain: &str,
) -> Result<Option<String>, String> {
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
                    log::warn!("[Cookie提取] 获取 CoreWebView2 失败: {:?}", e);
                    let _ = tx.send(None);
                    return;
                }
            };

            // Cast 到 ICoreWebView2_2 获取 CookieManager
            let core2 = match core.cast::<ICoreWebView2_2>() {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("[Cookie提取] Cast 到 ICoreWebView2_2 失败: {:?}", e);
                    let _ = tx.send(None);
                    return;
                }
            };

            // 获取 CookieManager
            let cookie_manager = match core2.CookieManager() {
                Ok(cm) => cm,
                Err(e) => {
                    log::warn!("[Cookie提取] 获取 CookieManager 失败: {:?}", e);
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

                                        if cookie.Name(&mut name).is_ok()
                                            && cookie.Value(&mut value).is_ok()
                                        {
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

            let handler: ICoreWebView2GetCookiesCompletedHandler =
                GetCookiesHandler { tx: tx_clone }.into();

            // 调用 GetCookies
            if let Err(e) = cookie_manager.GetCookies(PCWSTR(uri_hstring.as_ptr()), &handler) {
                log::warn!("[Cookie提取] GetCookies 调用失败: {:?}", e);
                let _ = tx.send(None);
            }
        }
    });

    if result.is_err() {
        log::warn!("[Cookie提取] with_webview 调用失败");
        return Ok(None);
    }

    // 等待异步结果（最多 5 秒）
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(cookie_opt) => {
            if let Some(ref cookies) = cookie_opt {
                log::debug!(
                    "[Cookie提取] ✓ 从 {} 提取到 {} 个 Cookie",
                    domain,
                    cookies.matches('=').count()
                );
            }
            Ok(cookie_opt)
        }
        Err(_) => {
            log::warn!("[Cookie提取] 等待结果超时");
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
    http_client: tauri::State<'_, HttpClient>,
) -> Result<String, AppError> {
    if config.account_id.is_empty()
        || config.access_key_id.is_empty()
        || config.secret_access_key.is_empty()
        || config.bucket_name.is_empty()
    {
        return Err(AppError::config(
            "配置不完整: AccountID、KeyID、Secret 和 Bucket 均为必填项。",
        ));
    }

    let endpoint_url = format!(
        "https://{}.r2.cloudflarestorage.com/{}",
        config.account_id, config.bucket_name
    );

    let now = chrono::Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();

    let region = "auto";
    let service = "s3";
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
    let canonical_uri = format!("/{}", config.bucket_name);
    let canonical_querystring = "";
    let canonical_headers = format!(
        "host:{}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{}\n",
        host, datetime_str
    );
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

    let k_date = hmac_sha256(
        format!("AWS4{}", config.secret_access_key).as_bytes(),
        date_str.as_bytes(),
    );
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key_id, credential_scope, signed_headers, signature
    );

    match http_client
        .0
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
                Err(AppError::storage(format!(
                    "存储桶 (Bucket) '{}' 未找到",
                    config.bucket_name
                )))
            } else if status == reqwest::StatusCode::FORBIDDEN {
                Err(AppError::auth(
                    "R2 认证失败: Access Key ID 或 Secret Access Key 无效，或权限不足",
                ))
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
    http_client: tauri::State<'_, HttpClient>,
) -> Result<String, AppError> {
    if config.url.is_empty() || config.username.is_empty() || config.password.is_empty() {
        return Err(AppError::config(
            "配置不完整: URL、用户名和密码均为必填项。",
        ));
    }
    let auth_header = format!(
        "Basic {}",
        STANDARD.encode(format!("{}:{}", config.username, config.password))
    );

    let response = http_client
        .0
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").unwrap(),
            &config.url,
        )
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
fn get_or_create_secure_key() -> Result<String, AppError> {
    if let Some(key_path) = portable::secure_key_path() {
        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::file_io(format!("无法创建便携数据目录: {}", e)))?;
        }

        if key_path.exists() {
            let key = std::fs::read_to_string(&key_path)
                .map_err(|e| AppError::file_io(format!("无法读取便携密钥: {}", e)))?
                .trim()
                .to_string();
            if !key.is_empty() {
                log::debug!("[密钥管理] 从便携数据目录读取现有密钥");
                return Ok(key);
            }
        }

        log::debug!("[密钥管理] 生成新的便携密钥");
        let mut key_bytes = [0u8; 32];
        rand::thread_rng().fill(&mut key_bytes);
        let new_key = STANDARD.encode(key_bytes);
        std::fs::write(&key_path, &new_key)
            .map_err(|e| AppError::file_io(format!("无法保存便携密钥: {}", e)))?;
        return Ok(new_key);
    }

    let entry = Entry::new(SERVICE_NAME, KEY_NAME)
        .map_err(|e| AppError::external(format!("无法访问系统钥匙串: {}", e)))?;

    match entry.get_password() {
        Ok(key) => {
            log::debug!("[密钥管理] 从钥匙串读取现有密钥");
            Ok(key)
        }
        Err(_) => {
            log::debug!("[密钥管理] 生成新的加密密钥");
            let mut key_bytes = [0u8; 32];
            rand::thread_rng().fill(&mut key_bytes);
            let new_key = STANDARD.encode(key_bytes);

            entry
                .set_password(&new_key)
                .map_err(|e| AppError::external(format!("无法保存密钥到系统钥匙串: {}", e)))?;

            log::debug!("[密钥管理] ✓ 新密钥已保存到系统钥匙串");
            Ok(new_key)
        }
    }
}

#[tauri::command]
fn set_secure_key(key: String) -> Result<(), AppError> {
    // 校验密钥格式：必须是合法 Base64 且解码后正好 32 字节（AES-256）
    let decoded = STANDARD
        .decode(&key)
        .map_err(|_| AppError::external("密钥格式无效：非法 Base64".to_string()))?;
    if decoded.len() != 32 {
        return Err(AppError::external(format!(
            "密钥长度无效：期望 32 字节，实际 {} 字节",
            decoded.len()
        )));
    }

    if let Some(key_path) = portable::secure_key_path() {
        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::file_io(format!("无法创建便携数据目录: {}", e)))?;
        }
        std::fs::write(&key_path, key)
            .map_err(|e| AppError::file_io(format!("无法更新便携密钥: {}", e)))?;
        log::debug!("[密钥管理] ✓ 密钥已更新到便携数据目录");
        return Ok(());
    }

    let entry = Entry::new(SERVICE_NAME, KEY_NAME)
        .map_err(|e| AppError::external(format!("无法访问系统钥匙串: {}", e)))?;

    entry
        .set_password(&key)
        .map_err(|e| AppError::external(format!("无法更新密钥到系统钥匙串: {}", e)))?;

    log::debug!("[密钥管理] ✓ 密钥已更新到系统钥匙串");
    Ok(())
}

/// 打开日志目录
#[tauri::command]
fn open_log_dir(app: tauri::AppHandle) -> Result<(), AppError> {
    let log_dir = portable::log_dir(&app)?;
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| AppError::file_io(format!("无法创建日志目录: {}", e)))?;
    opener::open(&log_dir).map_err(|e| AppError::file_io(format!("无法打开日志目录: {}", e)))?;
    Ok(())
}

/// 用系统默认程序打开受限路径（文件或文件夹）或安全 URL。
/// 只允许已存在的绝对文件路径和明确白名单内的 URL scheme。
enum OpenTarget {
    Url(String),
    Path(PathBuf),
}

const ALLOWED_OPEN_URL_SCHEMES: &[&str] = &["http", "https", "mailto", "tel"];
const DANGEROUS_OPEN_EXTENSIONS: &[&str] = &[
    "app", "appimage", "bat", "cmd", "com", "cpl", "dll", "exe", "hta", "jar", "js", "jse", "lnk",
    "msi", "msp", "pif", "ps1", "reg", "scr", "sh", "url", "vb", "vbe", "vbs", "wsf",
];

#[cfg(windows)]
fn is_windows_drive_path(input: &str) -> bool {
    let bytes = input.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

#[cfg(not(windows))]
fn is_windows_drive_path(_input: &str) -> bool {
    false
}

#[cfg(windows)]
fn has_forbidden_windows_device_prefix(input: &str) -> bool {
    input.starts_with("\\\\.\\") || input.starts_with("\\\\?\\")
}

#[cfg(not(windows))]
fn has_forbidden_windows_device_prefix(_input: &str) -> bool {
    false
}

fn validate_open_url(input: &str) -> Result<Option<OpenTarget>, AppError> {
    if is_windows_drive_path(input) {
        return Ok(None);
    }

    let Ok(parsed) = url::Url::parse(input) else {
        return Ok(None);
    };

    if !ALLOWED_OPEN_URL_SCHEMES.contains(&parsed.scheme()) {
        return Err(AppError::validation("不支持的链接类型"));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::validation("链接不能包含用户凭据"));
    }

    Ok(Some(OpenTarget::Url(parsed.to_string())))
}

fn validate_open_file_path(input: &str) -> Result<OpenTarget, AppError> {
    if has_forbidden_windows_device_prefix(input) {
        return Err(AppError::validation("不支持的系统设备路径"));
    }

    let path = Path::new(input);
    if !path.is_absolute() {
        return Err(AppError::validation("只能打开绝对路径"));
    }

    let metadata =
        std::fs::metadata(path).map_err(|e| AppError::file_io(format!("无法访问路径: {}", e)))?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(AppError::validation("只能打开文件或文件夹"));
    }

    let canonical = std::fs::canonicalize(path)
        .map_err(|e| AppError::file_io(format!("无法解析路径: {}", e)))?;

    if let Some(ext) = canonical
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
    {
        if DANGEROUS_OPEN_EXTENSIONS.contains(&ext.as_str()) {
            return Err(AppError::validation("不允许打开可执行、应用包或快捷方式"));
        }
    }

    Ok(OpenTarget::Path(canonical))
}

fn validate_open_target(input: &str) -> Result<OpenTarget, AppError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("路径不能为空"));
    }
    if trimmed.len() > 4096 {
        return Err(AppError::validation("路径过长"));
    }

    if let Some(target) = validate_open_url(trimmed)? {
        return Ok(target);
    }

    validate_open_file_path(trimmed)
}

#[cfg(test)]
mod open_target_tests {
    use super::*;

    #[test]
    fn open_target_allows_https_url() {
        assert!(matches!(
            validate_open_target("https://github.com/joeyliu6/PicNexus"),
            Ok(OpenTarget::Url(_))
        ));
    }

    #[test]
    fn open_target_rejects_script_url() {
        assert!(validate_open_target("javascript:alert(1)").is_err());
    }

    #[test]
    fn open_target_rejects_relative_path() {
        assert!(validate_open_target("relative/file.md").is_err());
    }

    #[test]
    fn open_target_rejects_executable_file() {
        let path = std::env::temp_dir().join(format!(
            "picnexus-open-path-test-{}.exe",
            std::process::id()
        ));
        std::fs::write(&path, b"test").expect("write temp executable marker");

        let result = validate_open_target(path.to_string_lossy().as_ref());
        let _ = std::fs::remove_file(path);

        assert!(result.is_err());
    }

    #[test]
    fn open_target_rejects_app_bundle_directory() {
        let path = std::env::temp_dir().join(format!(
            "picnexus-open-path-test-{}.app",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temp app bundle marker");

        let result = validate_open_target(path.to_string_lossy().as_ref());
        let _ = std::fs::remove_dir_all(path);

        assert!(result.is_err());
    }
}

#[tauri::command]
fn open_path(path: String) -> Result<(), AppError> {
    match validate_open_target(&path)? {
        OpenTarget::Url(url) => {
            opener::open(&url).map_err(|e| AppError::file_io(format!("无法打开链接: {}", e)))?;
        }
        OpenTarget::Path(validated_path) => {
            opener::open(&validated_path).map_err(|e| {
                AppError::file_io(format!("无法打开 {}: {}", validated_path.display(), e))
            })?;
        }
    }
    Ok(())
}

/// 保存 CLI 配置文件（供 Typora 自定义命令模式使用）
///
/// 返回当前可执行文件的绝对路径（用于 Typora 自定义命令配置提示）
#[tauri::command]
fn get_executable_path() -> Result<String, AppError> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| AppError::file_io(format!("无法获取可执行文件路径: {}", e)))
}

/// 将 Server 图床配置写入 {app_data_dir}/cli-config.json，
/// CLI 模式启动时直接读取此文件，无需启动 GUI。
/// 传 None 时删除配置文件（禁用 CLI 模式）。
#[tauri::command]
async fn save_cli_config(
    app: tauri::AppHandle,
    service_config_json: Option<String>,
) -> Result<(), AppError> {
    let config_dir = portable::user_data_dir(&app)?;

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| AppError::file_io(format!("无法创建配置目录: {}", e)))?;

    let config_path = config_dir.join("cli-config.json");

    match service_config_json {
        Some(json) => {
            // 先验证 JSON 格式，避免写入损坏的配置
            let _: server::ServerUploadConfig = serde_json::from_str(&json)
                .map_err(|e| AppError::config(format!("CLI 配置格式无效: {}", e)))?;

            std::fs::write(&config_path, &json)
                .map_err(|e| AppError::file_io(format!("写入 cli-config.json 失败: {}", e)))?;

            log::info!(
                "[CLI Config] ✓ cli-config.json 已更新: {}",
                config_path.display()
            );
        }
        None => {
            if config_path.exists() {
                std::fs::remove_file(&config_path)
                    .map_err(|e| AppError::file_io(format!("删除 cli-config.json 失败: {}", e)))?;
            }
            log::info!("[CLI Config] cli-config.json 已删除");
        }
    }

    Ok(())
}

#[tauri::command]
async fn check_port_free(port: u16) -> bool {
    server::is_port_free(port).await
}

/// 更新编辑器兼容 Server 配置（由前端调用）
///
/// - enabled: 是否启动 Server
/// - port: 监听端口（默认 36799）
/// - service_config_json: Server 专用图床配置的 JSON 字符串（ServerUploadConfig 枚举）
///   格式示例: {"type":"jd"} | {"type":"github","token":"...","owner":"...","repo":"...","branch":"main","path":"images/"}
///   传 null 时清空配置（Server 收到请求会提示未配置图床）
#[tauri::command]
async fn update_server_config(
    state: tauri::State<'_, ServerState>,
    enabled: bool,
    port: u16,
    service_config_json: Option<String>,
    auth_token: Option<String>,
) -> Result<String, AppError> {
    let normalized_auth_token = auth_token
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty());

    // 1. 更新图床配置
    {
        let mut config = state.upload_config.lock().await;
        if let Some(ref json) = service_config_json {
            match serde_json::from_str::<server::ServerUploadConfig>(json) {
                Ok(parsed) => {
                    *config = Some(parsed);
                    log::info!("[Server] 图床配置已更新");
                }
                Err(e) => {
                    return Err(AppError::config(format!("Server 配置解析失败: {}", e)));
                }
            }
        } else {
            *config = None;
        }
    }
    {
        let mut token = state.auth_token.lock().await;
        *token = normalized_auth_token;
    }

    // 2. 停止当前运行的 Server（如有），等待端口释放
    {
        let abort_handle = {
            let mut handle = state
                .abort_handle
                .lock()
                .map_err(|_| AppError::external("锁定 abort_handle 失败"))?;
            handle.take()
        };
        if let Some(h) = abort_handle {
            h.abort();
            log::info!("[Server] 旧 Server 已停止");
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    }

    // 3. 如果 enabled，两阶段启动：先 bind（同步等结果），再 spawn serve
    if enabled {
        let listener = server::bind_server(port)
            .await
            .map_err(AppError::external)?;

        let config_arc = Arc::clone(&state.upload_config);
        let auth_token_arc = Arc::clone(&state.auth_token);
        let task = tokio::task::spawn(async move {
            if let Err(e) = server::run_server(listener, config_arc, auth_token_arc).await {
                log::error!("[Server] 运行失败: {}", e);
            }
        });

        let mut handle = state
            .abort_handle
            .lock()
            .map_err(|_| AppError::external("锁定 abort_handle 失败"))?;
        *handle = Some(task.abort_handle());

        log::info!("[Server] 编辑器兼容 Server 已启动，端口: {}", port);
        Ok(format!("Server 已在端口 {} 启动", port))
    } else {
        log::info!("[Server] 编辑器兼容 Server 已停止");
        Ok("Server 已停止".to_string())
    }
}
