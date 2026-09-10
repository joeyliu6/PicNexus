// src-tauri/src/commands/cookie_login.rs
// Cookie 登录链路：开登录窗口 → 监听导航/轮询 → 提取并校验 Cookie → 回传主窗口
//
// 这一族对外只暴露 5 个命令，私有辅助函数全部只被它们调用，所以整体收在一个模块里。
// 注意其中 6 个（`CookieMonitorCtx` 及其配套的 arm/capture/poll/extract 一组）带
// `#[cfg(target_os = "windows")]`——它们靠 WebView2 的 CoreWebView2 接口拿 Cookie，
// **没有非 Windows 实现**；非 Windows 平台由调用点的 `#[cfg(not(target_os = "windows"))]`
// 分支直接返回错误。改这里时两边分支都要顾到：本机 cargo check 只会编译 Windows 那一半。
//
// Windows 上有两条提取通道，缺一不可：
//   主路径 = NavigationCompleted 事件驱动；兜底 = 每 2 秒的轮询（SPA 登录不触发导航事件）。
//   事件通道建不起来时（CoreWebView2 拿不到 / handler 注册失败 / 闭包压根没被执行），
//   由 `arm_timeout_and_poll_fallback` 降级到「仅轮询 + 超时通知」。
//   ⚠️ 那个降级判断绝不能写在 `with_webview` 的返回值上——它是单向投递，返回 Ok
//   只代表消息发出去了，不代表闭包跑过。详见该函数处的注释。

// Duration 只被 Windows 侧的计时/轮询线程用到；不加 cfg 门的话，
// 非 Windows 编译会报 unused import（本机 cargo check 只编 Windows 那一半，看不见）。
#[cfg(target_os = "windows")]
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

        let ctx = CookieMonitorCtx {
            app: app.clone(),
            service_id: service.clone(),
            domains: domains.clone(),
            required_fields: fields.clone(),
            any_of_fields: any_fields.clone(),
            field_value_checks: field_value_checks.clone(),
            completed: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            armed: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            closure_ran: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            timeout_ms: timeout,
        };

        let ctx_for_watchdog = ctx.clone();
        let result = login_webview.with_webview(move |webview| {
            #[cfg(windows)]
            unsafe {
                use webview2_com::Microsoft::Web::WebView2::Win32::*;

                // 闭包有三个出口（注册成功 / CoreWebView2 失败 / 注册失败），每个都必须发
                // ready，否则前端只能干等它自己那个 3 秒兜底计时器。用 Drop 守卫兜住所有
                // 出口，包括将来新增的 early return。
                //
                // 这个 emit 原本在 with_webview **返回之后**才执行（旧 L878），而闭包此时
                // 还没跑——`with_webview` 底层是 proxy.send_event 的单向投递，发完就返回。
                // 所以那句「通知前端 handler 已注册完成，可以安全跳转」是假的：前端可能在
                // handler 真正注册好之前就跳转，把首次 NavigationCompleted 丢掉；纯 SPA
                // 登录页之后可能再无导航事件，兜底就永远起不来。移进闭包后
                // 「ready = 监控已就绪（事件模式或降级模式）」这个语义才成立。
                struct ReadyGuard(tauri::AppHandle);
                impl Drop for ReadyGuard {
                    fn drop(&mut self) {
                        let _ = self.0.emit("cookie-monitoring-ready", ());
                    }
                }
                let _ready = ReadyGuard(ctx.app.clone());

                // 给看门狗打卡：闭包确实被事件循环执行到了。必须在任何可能 early return
                // 之前，否则降级出口会被看门狗误判成「闭包没跑」。
                ctx.closure_ran
                    .store(true, std::sync::atomic::Ordering::SeqCst);

                let forced = forced_failure_stage();

                let controller = webview.controller();

                // ── 降级点 A：拿不到 CoreWebView2 ──
                // 为什么在闭包内就地启动兜底、而不是回传给外层判断：
                // `with_webview` 底层是 send_user_message → proxy.send_event 的单向投递
                // （tauri-runtime-wry/src/lib.rs），闭包返回类型是 `()`，事件循环调完即丢。
                // 本命令是 async fn，跑在 tokio 工作线程上，必然不是主线程，所以外层拿到
                // Ok 时这段代码往往还没执行——回传标志只会读到初值，是竞态。
                if forced.as_deref() == Some("corewebview2") {
                    log::warn!("[事件监控] 调试开关强制 CoreWebView2 失败");
                    arm_timeout_and_poll_fallback(&ctx, "强制降级(CoreWebView2)");
                    return;
                }
                let core = match controller.CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        log::warn!("[事件监控] 获取 CoreWebView2 失败: {:?}，降级到轮询模式", e);
                        arm_timeout_and_poll_fallback(&ctx, "CoreWebView2 失败");
                        return;
                    }
                };

                #[windows_core::implement(ICoreWebView2NavigationCompletedEventHandler)]
                struct NavHandler {
                    ctx: CookieMonitorCtx,
                }

                impl ICoreWebView2NavigationCompletedEventHandler_Impl for NavHandler_Impl {
                    fn Invoke(
                        &self,
                        sender: windows_core::Ref<'_, ICoreWebView2>,
                        args: windows_core::Ref<'_, ICoreWebView2NavigationCompletedEventArgs>,
                    ) -> windows_core::Result<()> {
                        use std::sync::atomic::Ordering;

                        if self.ctx.completed.load(Ordering::SeqCst) {
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

                        // 首次导航完成（登录页加载好）→ 启动超时计时 + 轮询兜底。
                        // 幂等由 arm_timeout_and_poll_fallback 内部的 armed 令牌保证，
                        // 所以这里不再自己 swap 标志位。
                        arm_timeout_and_poll_fallback(&self.ctx, "首次导航");

                        if !is_success.as_bool() {
                            return Ok(());
                        }

                        // Issue #2: 将 Cookie 提取移到新线程，避免阻塞 WebView2 UI 线程。
                        // capture_and_save_once 内部会 with_webview + channel 等待，
                        // 在 UI 线程中调用会死锁。
                        let ctx = self.ctx.clone();
                        std::thread::spawn(move || {
                            log::debug!(
                                "[事件监控] 检测到页面跳转，尝试提取 {} Cookie...",
                                ctx.service_id
                            );
                            capture_and_save_once(&ctx, "事件监控");
                        });

                        Ok(())
                    }
                }

                let handler: ICoreWebView2NavigationCompletedEventHandler =
                    NavHandler { ctx: ctx.clone() }.into();

                // ── 降级点 B：handler 注册不上 ──
                // 旧代码这里只有一句 warn 加 `return`，注释写着「降级到轮询模式提示」，
                // 但实际什么都没降级：这个 return 只是退出闭包，外层 `result` 仍是 Ok。
                let mut token: i64 = 0;
                let registered = if forced.as_deref() == Some("add_handler") {
                    log::warn!("[事件监控] 调试开关强制跳过 NavigationCompleted 注册");
                    false
                } else {
                    match core.add_NavigationCompleted(&handler, &mut token) {
                        Ok(()) => true,
                        Err(e) => {
                            log::warn!("[事件监控] 注册 NavigationCompleted 失败: {:?}", e);
                            false
                        }
                    }
                };

                if !registered {
                    log::warn!("[事件监控] 事件通道不可用，降级到轮询模式");
                    arm_timeout_and_poll_fallback(&ctx, "handler 注册失败");
                    return;
                }

                log::debug!("[事件监控] ✓ NavigationCompleted 事件注册成功");
            }
        });

        // `cookie-monitoring-ready` 的发射已移进闭包（见闭包顶部的 ReadyGuard）。

        if let Err(e) = result {
            // 走到这里只剩一种语义：事件循环已关闭、应用正在退出（FailedToSendMessage）。
            // 此时闭包永远不会执行，而降级轮询依赖的 try_extract_cookie_header_generic
            // 本身也走 with_webview，同样投递不出去——降级毫无意义，如实报错。
            log::warn!("[事件监控] with_webview 投递失败（事件循环已关闭）: {}", e);
            return Err(AppError::external("应用正在退出，无法启动 Cookie 监控"));
        }

        // 看门狗：补上两个降级点都盖不到的最后一个洞——WithWebview 消息始终没被事件循环
        // 处理，闭包一次都没跑。此时闭包内的降级判断全部落空，而用户看到的是
        // 「窗口开着、毫无反应、也没有任何提示」，正是本次要修的静默失效。
        //
        // ⚠️ 判据必须是 `closure_ran`（闭包跑没跑），**不能**是 `armed`（兜底起没起）。
        // 用 armed 会顺带把「闭包跑了、handler 也注册了，只是登录页还没加载完」也算进来，
        // 于是在第 8 秒就抢跑 arm——而 arm 同时启动超时计时，`timeout_ms` 默认只有 60 秒。
        // 后果：慢网下登录页 25 秒才可用时，倒计时却从第 8 秒起算，用户还在扫码就被弹
        // 「自动获取超时」，且轮询线程同样到点收工，之后登录成功也再不抓 Cookie。
        // 掐表的起点必须留给首次导航，这正是 `arm_timeout_and_poll_fallback` 原本的语义。
        //
        // 闭包真没跑的情况下没有「首次导航」可等，8 秒起算不存在这个副作用。
        std::thread::spawn(move || {
            use std::sync::atomic::Ordering;

            std::thread::sleep(Duration::from_secs(8));

            if ctx_for_watchdog.closure_ran.load(Ordering::SeqCst) {
                // 闭包已执行：注册成功就等它的 NavigationCompleted，注册失败它自己已经
                // 就地降级过了。两种情况都轮不到看门狗插手。
                return;
            }
            if ctx_for_watchdog.completed.load(Ordering::SeqCst) {
                return;
            }
            if ctx_for_watchdog.app.get_window("login-window").is_none() {
                return;
            }

            log::warn!("[事件监控] 看门狗：8s 内 with_webview 闭包未执行，就地降级到轮询模式");
            arm_timeout_and_poll_fallback(&ctx_for_watchdog, "看门狗(闭包未执行)");
        });
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

/// 一次 Cookie 监控会话的共享上下文。
///
/// 同一套参数有四处要用：NavigationCompleted handler、超时计时线程、轮询兜底线程，
/// 以及事件通道不可用时的两条降级路径。散着传的代价是每处重复六行 `xxx.clone()`，
/// 还得给函数挂 `#[allow(clippy::too_many_arguments)]`。收进结构体后一次 clone 顶六次，
/// 将来加字段也不会漏掉某个调用点。
#[cfg(target_os = "windows")]
#[derive(Clone)]
struct CookieMonitorCtx {
    app: tauri::AppHandle,
    service_id: String,
    domains: Vec<String>,
    required_fields: Vec<String>,
    any_of_fields: Vec<String>,
    field_value_checks: Option<std::collections::HashMap<String, String>>,
    /// 会话终态：Cookie 已成功保存。后台线程读到 true 立即退出；
    /// 抢保存权用 `compare_exchange`，保证只有一个线程真的写配置。
    completed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// 一次性令牌：「超时计时 + 轮询兜底」这一对是否已启动。
    /// 取代原来的 `first_nav_done`——旧名字把「首次导航发生过」和「兜底已启动」
    /// 绑成一件事，但降级路径下根本没有导航，那个名字会骗人。
    armed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// `with_webview` 的闭包是否真的被事件循环执行过。
    /// 只服务于看门狗：它要兜的是「闭包一次都没跑」，而不是「还没导航」。
    /// 两者必须分开——见看门狗处的注释。
    closure_ran: std::sync::Arc<std::sync::atomic::AtomicBool>,
    timeout_ms: u64,
}

/// 强制走降级路径的调试开关，取值 `corewebview2` / `add_handler`。
///
/// 为什么需要它：两个降级点要 WebView2 自身出故障才会走到，正常机器上永远复现不了。
/// 结果就是这两条分支从上线到今天，`cargo test` 和真机验收**都没碰过**——
/// 2026-09-09 那次真机验收命中的是「✓ NavigationCompleted 事件注册成功」，
/// `[轮询兜底]` 日志一次都没出现。没有人为触发口，修完仍然只是「看起来对」。
///
/// 只在 debug 构建下读环境变量：release 包里这个函数恒返回 `None`，
/// 编译器会把两处判断整个折叠掉，不构成配置面或攻击面。
#[cfg(all(target_os = "windows", debug_assertions))]
fn forced_failure_stage() -> Option<String> {
    std::env::var("PICNEXUS_COOKIE_FORCE_FALLBACK").ok()
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn forced_failure_stage() -> Option<String> {
    None
}

/// 启动「超时计时线程 + 轮询兜底线程」这一对兜底设施，一次会话只生效一次。
///
/// 为什么必须成对启动：轮询线程跑满 timeout 后是**静默返回**的，
/// `cookie-monitoring-timeout` 只有超时线程会发。少启一个，用户就落进
/// 「窗口开着、永远没反应、也没有任何提示」的静默失效。
///
/// 为什么幂等收口在这里：四处触发（首次导航 / CoreWebView2 失败 / handler 注册失败 /
/// 看门狗）理论上互斥，但把判断散在调用点，日后漏一处就会把超时提示发两遍。
///
/// ⚠️ 本函数同时启动超时计时，所以**调用时刻就是掐表起点**。正常路径下这个起点必须是
/// 首次导航完成（登录页可用），不能提前——`timeout_ms` 默认只有 60 秒，提前多少就等于
/// 从用户的输密码/扫码时间里扣多少。看门狗因此只在「闭包压根没执行」时才调它。
///
/// ⚠️ 调用约束：本函数会被 WebView2 UI 线程调用，**只允许 spawn，不允许阻塞**。
/// 尤其不能在这里直接调 `try_extract_cookie_header_generic`——它内部 `with_webview`
/// 再阻塞等 channel，在 UI 线程上调必死锁。
#[cfg(target_os = "windows")]
fn arm_timeout_and_poll_fallback(ctx: &CookieMonitorCtx, reason: &str) {
    use std::sync::atomic::Ordering;

    if ctx.armed.swap(true, Ordering::SeqCst) {
        log::debug!("[事件监控] 兜底设施已启动，跳过重复启动（触发源: {}）", reason);
        return;
    }

    log::debug!(
        "[事件监控] 启动 {}ms 超时计时器 + 轮询兜底（触发源: {}）",
        ctx.timeout_ms,
        reason
    );

    // 超时计时线程：分段 sleep，支持提前退出 + 窗口关闭感知
    {
        let app = ctx.app.clone();
        let service_id = ctx.service_id.clone();
        let completed = ctx.completed.clone();
        let timeout_ms = ctx.timeout_ms;

        std::thread::spawn(move || {
            let interval = Duration::from_secs(1);
            let total = Duration::from_millis(timeout_ms);
            let mut elapsed = Duration::ZERO;

            while elapsed < total {
                std::thread::sleep(interval.min(total - elapsed));
                elapsed += interval;
                if completed.load(Ordering::SeqCst) {
                    return;
                }
                if app.get_window("login-window").is_none() {
                    log::debug!("[事件监控] 登录窗口已关闭，取消超时计时");
                    return;
                }
            }

            log::warn!(
                "[事件监控] ⏰ {} 超时（{}ms），发送通知",
                service_id,
                timeout_ms
            );
            let _ = app.emit("cookie-monitoring-timeout", &service_id);
        });
    }

    spawn_cookie_poll_fallback(ctx.clone());
}

/// 提取 → 校验 → 抢占保存权 → 异步落盘，返回本次是否抢到并保存。
///
/// 事件监控线程与轮询兜底线程共用这一段：两者原本是同一段逻辑的两份拷贝
/// （NavigationCompleted 分支与轮询循环各写了一遍），改一处忘另一处只是时间问题。
/// `completed` 的 `compare_exchange` 保证两条路径抢的是同一把锁，Cookie 只保存一次。
///
/// ⚠️ 调用约束：必须在**非 WebView2 UI 线程**调用。内部 `extract_and_merge_cookies`
/// → `try_extract_cookie_header_generic` 会 `with_webview` 再阻塞等 channel，
/// 在 UI 线程上调必死锁。
#[cfg(target_os = "windows")]
fn capture_and_save_once(ctx: &CookieMonitorCtx, log_prefix: &str) -> bool {
    use std::sync::atomic::Ordering;

    let Some(login_webview) = ctx.app.get_webview("login-content") else {
        log::debug!("[{}] 登录窗口已关闭", log_prefix);
        return false;
    };

    let Some(merged_cookie) = extract_and_merge_cookies(&login_webview, &ctx.domains, log_prefix)
    else {
        log::debug!("[{}] 未提取到 Cookie，等待下次机会...", log_prefix);
        return false;
    };

    if !validate_cookie_fields_with_value_checks(
        &ctx.service_id,
        &merged_cookie,
        &ctx.required_fields,
        &ctx.any_of_fields,
        &ctx.field_value_checks,
    ) {
        log::debug!("[{}] ✗ Cookie 验证未通过，等待下次机会...", log_prefix);
        return false;
    }

    log::debug!(
        "[{}] ✓ {} Cookie 验证通过！保存中...",
        log_prefix,
        ctx.service_id
    );

    if ctx
        .completed
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        log::debug!("[{}] 已被其他线程完成，跳过保存", log_prefix);
        return false;
    }

    let app_save = ctx.app.clone();
    let service_save = ctx.service_id.clone();
    let fields_save = ctx.required_fields.clone();
    let any_fields_save = ctx.any_of_fields.clone();
    let prefix = log_prefix.to_string();

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
            log::warn!("[{}] 保存Cookie失败: {}", prefix, e);
        }
    });

    true
}

/// SPA 轮询兜底：定期从 WebView 提取 Cookie 并验证。
/// 用于 SPA 登录流程不触发 NavigationCompleted 的场景；事件通道不可用时
/// （见 `arm_timeout_and_poll_fallback` 的三个触发源）它是唯一的提取通道。
#[cfg(target_os = "windows")]
fn spawn_cookie_poll_fallback(ctx: CookieMonitorCtx) {
    use std::sync::atomic::Ordering;

    std::thread::spawn(move || {
        let poll_interval = Duration::from_secs(2);
        let total = Duration::from_millis(ctx.timeout_ms);

        // 初始延迟 3 秒，分段 sleep 以感知窗口关闭
        for _ in 0..3 {
            std::thread::sleep(Duration::from_secs(1));
            if ctx.completed.load(Ordering::SeqCst) || ctx.app.get_window("login-window").is_none()
            {
                return;
            }
        }
        let mut elapsed = Duration::from_secs(3);

        while elapsed < total {
            if ctx.completed.load(Ordering::SeqCst) {
                log::debug!("[轮询兜底] Cookie 已获取，轮询退出");
                return;
            }

            if ctx.app.get_webview("login-content").is_none() {
                log::debug!("[轮询兜底] 登录窗口已关闭，轮询退出");
                return;
            }

            if capture_and_save_once(&ctx, "轮询兜底") {
                return;
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

#[cfg(test)]
mod tests;
