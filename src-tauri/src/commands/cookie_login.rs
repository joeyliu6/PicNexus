// src-tauri/src/commands/cookie_login.rs
// Cookie 登录链路：开登录窗口 → 监听导航/轮询 → 提取并校验 Cookie → 回传主窗口
//
// 这一族对外只暴露 6 个命令，12 个私有辅助函数全部只被它们调用，所以整体收在
// 一个模块里。注意其中 4 个提取函数带 `#[cfg(target_os = "windows")]`——它们靠
// WebView2 的 CoreWebView2 接口拿 Cookie，**没有非 Windows 实现**；非 Windows
// 平台由调用点的 `#[cfg(not(target_os = "windows"))]` 分支直接返回错误。
// 改这里时两边分支都要顾到：本机 cargo check 只会编译 Windows 那一半。

use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::error::AppError;

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

/// Cookie 更新事件的 payload 结构
#[derive(Clone, serde::Serialize)]
struct CookieUpdatedPayload {
    #[serde(rename = "serviceId")]
    service_id: String,
    cookie: String,
}

/// 打开多 Webview 登录窗口
/// 窗口结构：标题栏 Webview (36px) + 内容区 Webview
#[tauri::command]
pub async fn open_login_window(
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
pub async fn show_login_window(app: tauri::AppHandle) -> Result<(), AppError> {
    if let Some(window) = app.get_window("login-window") {
        window
            .show()
            .map_err(|e| AppError::external(format!("显示窗口失败: {}", e)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_cookie_from_login(
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
pub async fn start_cookie_monitoring(
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

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            &app,
            &service,
            &domains,
            &fields,
            &any_fields,
            initial_delay,
            polling_interval,
        );
        return Err(AppError::external(
            "当前操作系统暂不支持安全的自动 Cookie 提取，请在 Windows WebView2 环境使用登录授权",
        ));
    }

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
                    drop(login_webview);
                    log::warn!(
                        "[Cookie监控] 非 Windows 平台已禁用远程页面 IPC 注入；请使用支持请求头 Cookie 提取的平台"
                    );
                    break;
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
pub async fn setup_cookie_event_monitoring(
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
        let _ = (
            app,
            service,
            domains,
            fields,
            any_fields,
            field_value_checks,
            timeout,
        );
        return Err(AppError::external(
            "当前操作系统暂不支持安全的自动 Cookie 提取，请在 Windows WebView2 环境使用登录授权",
        ));
    }

    Ok(())
}

#[tauri::command]
pub async fn get_request_header_cookie(
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
