// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{CustomMenuItem, Manager, Menu, MenuItem, Submenu, SystemTray, SystemTrayMenu, SystemTrayMenuItem, SystemTrayEvent};
use std::time::Duration;
#[cfg(target_os = "windows")]
use std::{collections::BTreeMap, sync::mpsc};
#[cfg(target_os = "windows")]
use webview2_com::{
    GetCookiesCompletedHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2CookieList, ICoreWebView2_2},
};
#[cfg(target_os = "windows")]
use windows::{
    core::{Interface, PWSTR},
    Win32::System::Com::CoTaskMemFree,
};

// 用于 R2 和 WebDAV 测试
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
type HmacSha256 = Hmac<Sha256>;

/// 全局 HTTP 客户端状态
/// 使用单例模式复用 HTTP 客户端，提升性能
struct HttpClient(reqwest::Client);

fn main() {
    // 创建全局 HTTP 客户端（带连接池配置）
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))  // 60秒超时
        .connect_timeout(std::time::Duration::from_secs(10))  // 10秒连接超时
        .pool_idle_timeout(std::time::Duration::from_secs(90))  // 连接池空闲超时
        .pool_max_idle_per_host(10)  // 每个主机最多保持10个空闲连接
        .build()
        .expect("Failed to create HTTP client");
    // 1. 定义原生菜单栏 (PRD 1.1)
    // "文件" 菜单 (或 "应用" 菜单 on macOS)
    let preferences = CustomMenuItem::new("preferences".to_string(), "偏好设置...")
        .accelerator("CmdOrCtrl+,"); // 快捷键 CmdOrCtrl+,
    let quit = CustomMenuItem::new("quit".to_string(), "退出");
    
    let file_menu = if cfg!(target_os = "macos") {
        // macOS 使用 "应用" 菜单
        Submenu::new(
            "WeiboDR-Uploader",
            Menu::new()
                .add_item(preferences)
                .add_native_item(MenuItem::Quit)
        )
    } else {
        // Windows/Linux 使用 "文件" 菜单
        Submenu::new(
            "文件",
            Menu::new()
                .add_item(preferences)
                .add_item(quit)
        )
    };
    
    // "窗口" 菜单
    let history = CustomMenuItem::new("history".to_string(), "上传历史记录")
        .accelerator("CmdOrCtrl+H"); // 快捷键 CmdOrCtrl+H
    let window_menu = Submenu::new(
        "窗口",
        Menu::new()
            .add_item(history)
    );
    
    // 构建完整菜单
    let menu = Menu::new()
        .add_submenu(file_menu)
        .add_submenu(window_menu);
    
    // 2. 定义系统托盘菜单 (PRD 3.3)
    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("open_settings", "打开设置"))
        .add_item(CustomMenuItem::new("open_history", "上传历史"))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("quit", "退出"));

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(HttpClient(http_client))     // 注册全局 HTTP 客户端
        .invoke_handler(tauri::generate_handler![
            save_cookie_from_login,
            start_cookie_monitoring,
            get_request_header_cookie,
            test_r2_connection,
            test_webdav_connection,
            list_r2_objects,
            delete_r2_object
        ])
        .menu(menu)                          // 3. 添加原生菜单栏
        .system_tray(system_tray)            // 4. 添加系统托盘
        .on_menu_event(|event| {            // 5. 处理菜单栏事件
            let app = event.window().app_handle();
            let menu_id = event.menu_item_id().to_string();
            eprintln!("菜单事件触发: {}", menu_id); // 调试日志
            
            match event.menu_item_id() {
                "preferences" => {
                    eprintln!("菜单事件触发: 偏好设置");
                    if let Some(main_window) = app.get_window("main") {
                        let _ = main_window.emit("navigate-to", "settings");
                    }
                }
                "history" => {
                    eprintln!("菜单事件触发: 上传历史记录");
                    if let Some(main_window) = app.get_window("main") {
                        let _ = main_window.emit("navigate-to", "history");
                    }
                }
                "quit" => {
                    std::process::exit(0);
                }
                _ => {
                    eprintln!("未知菜单项: {}", menu_id);
                }
            }
        })
        .on_system_tray_event(|app, event| match event { // 6. 处理托盘事件
            SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "open_settings" => {
                        eprintln!("托盘事件触发: 打开设置");
                        if let Some(main_window) = app.get_window("main") {
                            let _ = main_window.emit("navigate-to", "settings");
                        }
                    }
                    "open_history" => {
                        eprintln!("托盘事件触发: 上传历史记录");
                        if let Some(main_window) = app.get_window("main") {
                            let _ = main_window.emit("navigate-to", "history");
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn save_cookie_from_login(cookie: String, app: tauri::AppHandle) -> Result<(), String> {
    eprintln!("[保存Cookie] 开始保存Cookie，长度: {}", cookie.len());
    
    // 输入验证
    if cookie.trim().is_empty() {
        return Err("Cookie不能为空".to_string());
    }
    
    // 发送事件到主窗口
    if let Some(main_window) = app.get_window("main") {
        match main_window.emit("cookie-updated", cookie.clone()) {
            Ok(_) => {
                eprintln!("[保存Cookie] ✓ 已发送Cookie到主窗口");

                // 成功后，异步关闭登录窗口
                if let Some(login_window) = app.get_window("login-webview") {
                    let _ = login_window.close();
                    eprintln!("[保存Cookie] ✓ 已请求关闭登录窗口");
                }
                
                Ok(())
            }
            Err(e) => {
                eprintln!("[保存Cookie] 发送事件失败: {:?}", e);
                Err(format!("发送Cookie事件失败: {}", e))
            }
        }
    } else {
        eprintln!("[保存Cookie] 错误: 找不到主窗口");
        Err("找不到主窗口".to_string())
    }
}

#[tauri::command]
async fn start_cookie_monitoring(app: tauri::AppHandle) -> Result<(), String> {
    eprintln!("[Cookie监控] 开始监控登录窗口的Cookie");
    
    let app_handle = app.clone();
    
    // 在新线程中运行监控
    std::thread::spawn(move || {
        let mut check_count = 0;
        let max_checks = 120; // 最多检查120次（4分钟）
        
        while check_count < max_checks {
            std::thread::sleep(Duration::from_secs(2));
            check_count += 1;
            
            // 获取登录窗口
            if let Some(login_window) = app_handle.get_window("login-webview") {
                #[cfg(target_os = "windows")]
                {
                    if attempt_cookie_capture_and_save(&login_window, &app_handle) {
                        break;
                    }
                }

                #[cfg(not(target_os = "windows"))]
                {
                    // 准备注入的JS，用于检查和发送Cookie
                    let check_js = r#"
                        (async function() {
                            try {
                                const cookie = document.cookie || '';
                                // 微博登录成功的关键Cookie字段
                                if (cookie.includes('SUB=') || cookie.includes('SUBP=')) {
                                    // 调用Tauri后端命令来保存Cookie
                                    await window.__TAURI__.invoke('save_cookie_from_login', { 
                                        cookie: cookie 
                                    });
                                    return true; // 表示成功
                                }
                                return false; // 表示未登录
                            } catch (e) {
                                console.error('[自动监控] JS执行错误:', e);
                                return false;
                            }
                        })()
                    "#;
                    
                    // 执行JS
                    if let Err(e) = login_window.eval(check_js) {
                        eprintln!("[Cookie监控] 执行JS脚本失败: {:?}", e);
                    }
                }
            } else {
                eprintln!("[Cookie监控] 登录窗口已关闭，自动停止监控");
                break; // 窗口关闭，退出循环
            }
        }
        
        eprintln!("[Cookie监控] 监控结束（检查次数: {}）", check_count);
    });
    
    Ok(())
}

#[tauri::command]
async fn get_request_header_cookie(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let Some(login_window) = app.get_window("login-webview") else {
            return Err("登录窗口未打开，请先点击“开始登录”".to_string());
        };

        match try_extract_cookie_header(&login_window) {
            Ok(Some(cookie)) => {
                if cookie.contains("SUB=") && cookie.contains("SUBP=") {
                    eprintln!("[Cookie获取] 请求头Cookie长度: {}", cookie.len());
                    Ok(cookie)
                } else {
                    Err("提取到的 Cookie 缺少关键字段（SUB / SUBP），请确认已成功登录微博"
                        .to_string())
                }
            }
            Ok(None) => Err("未检测到 Cookie，请确认已完成登录后再试".to_string()),
            Err(err) => Err(format!("提取请求头 Cookie 失败: {}", err)),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("当前操作系统暂不支持请求头 Cookie 提取，请使用页面内的手动复制方式".to_string())
    }
}

#[cfg(target_os = "windows")]
fn attempt_cookie_capture_and_save(
    login_window: &tauri::Window,
    app_handle: &tauri::AppHandle,
) -> bool {
    match try_extract_cookie_header(login_window) {
        Ok(Some(cookie)) => {
            if cookie.contains("SUB=") && cookie.contains("SUBP=") {
                eprintln!("[Cookie监控] 检测到请求头Cookie，尝试保存");
                match tauri::async_runtime::block_on(save_cookie_from_login(
                    cookie.clone(),
                    app_handle.clone(),
                )) {
                    Ok(_) => {
                        eprintln!("[Cookie监控] ✓ 请求头Cookie保存成功");
                        true
                    }
                    Err(err) => {
                        eprintln!("[Cookie监控] 保存Cookie失败: {}", err);
                        false
                    }
                }
            } else {
                false
            }
        }
        Ok(None) => false,
        Err(err) => {
            eprintln!("[Cookie监控] 读取请求头Cookie失败: {}", err);
            false
        }
    }
}

#[cfg(target_os = "windows")]
fn try_extract_cookie_header(window: &tauri::Window) -> Result<Option<String>, String> {
    let (result_tx, result_rx) = mpsc::channel();
    window
        .with_webview(move |inner| {
            let res = (|| -> Result<Option<String>, String> {
                let controller = inner.controller();
                let webview = unsafe { controller.CoreWebView2() }
                    .map_err(|e| format!("{:?}", e))?;
                let webview2: ICoreWebView2_2 = webview
                    .cast()
                    .map_err(|e| format!("{:?}", e))?;
                let cookie_manager = unsafe { webview2.CookieManager() }
                    .map_err(|e| format!("{:?}", e))?;

                let mut cookie_store: BTreeMap<String, String> = BTreeMap::new();
                let target_urls = [
                    "https://weibo.com/"
                ];

                for url in target_urls {
                    let cm = cookie_manager.clone();
                    let url_string = url.to_string();
                    let url_string_clone = url_string.clone(); // Clone for use in closure
                    let (tx, rx) = mpsc::channel();

                    let result = GetCookiesCompletedHandler::wait_for_async_operation(
                        Box::new(move |handler| unsafe {
                            let wide = encode_wide(&url_string_clone);
                            cm.GetCookies(
                                windows::core::PCWSTR::from_raw(wide.as_ptr()),
                                &handler,
                            )
                            .map_err(webview2_com::Error::WindowsError)
                        }),
                        Box::new(move |hr, list| {
                            hr?;
                            tx.send(list)
                                .expect("send GetCookies result over channel");
                            Ok(())
                        }),
                    );

                    if let Err(err) = result {
                        eprintln!(
                            "[Cookie监控] 获取 {} 请求头Cookie失败: {:?}",
                            url_string, err
                        );
                        continue;
                    }

                    match rx.recv() {
                        Ok(Some(list)) => {
                            if let Err(err) = merge_cookie_list(&mut cookie_store, list)
                            {
                                eprintln!(
                                    "[Cookie监控] 解析 {} Cookie 失败: {}",
                                    url_string, err
                                );
                            }
                        }
                        Ok(None) => continue,
                        Err(_) => {
                            return Err("接收Cookie结果失败".to_string());
                        }
                    }
                }

                if cookie_store.is_empty() {
                    return Ok(None);
                }

                // 调试输出：显示提取到的所有Cookie
                eprintln!("[Cookie调试] 提取到的Cookie键值对: {:?}", cookie_store);

                let header = cookie_store
                    .into_iter()
                    .map(|(k, v)| format!("{k}={v}"))
                    .collect::<Vec<_>>()
                    .join("; ");

                eprintln!("[Cookie调试] 生成的请求头Cookie: {}", header);

                Ok(Some(header))
            })();

            let _ = result_tx.send(res);
        })
        .map_err(|e| e.to_string())?;

    result_rx
        .recv()
        .map_err(|_| "无法获取登录WebView".to_string())?
}

#[cfg(target_os = "windows")]
fn merge_cookie_list(
    store: &mut BTreeMap<String, String>,
    list: ICoreWebView2CookieList,
) -> Result<(), String> {
    unsafe {
        let mut count = 0;
        list.Count(&mut count)
            .map_err(|e| format!("{:?}", e))?;
        for idx in 0..count {
            let cookie = list
                .GetValueAtIndex(idx)
                .map_err(|e| format!("{:?}", e))?;
            let name = read_cookie_string(|ptr| cookie.Name(ptr))?;
            let value = read_cookie_string(|ptr| cookie.Value(ptr))?;
            if name.is_empty() || value.is_empty() {
                continue;
            }
            store.insert(name, value);
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_cookie_string<F>(getter: F) -> Result<String, String>
where
    F: FnOnce(&mut PWSTR) -> windows::core::Result<()>,
{
    let mut buffer = PWSTR::null();
    getter(&mut buffer).map_err(|e| format!("{:?}", e))?;
    Ok(pwstr_to_string_and_free(buffer))
}

#[cfg(target_os = "windows")]
fn pwstr_to_string_and_free(pwstr: PWSTR) -> String {
    if pwstr.is_null() {
        return String::new();
    }
    unsafe {
        let mut len = 0;
        while *pwstr.0.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(pwstr.0, len);
        let result = String::from_utf16_lossy(slice);
        CoTaskMemFree(pwstr.0 as _);
        result
    }
}

#[cfg(target_os = "windows")]
fn encode_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

// === R2 和 WebDAV 测试命令 ===

/// R2 配置结构体（与 TypeScript 接口匹配）
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

/// R2 对象结构体（返回给前端）
#[derive(serde::Serialize, Clone)]
struct R2Object {
    key: String,
    size: i64,
    #[serde(rename = "lastModified")]
    last_modified: String,
}

/// WebDAV 配置结构体（与 TypeScript 接口匹配）
#[derive(serde::Deserialize, Clone)]
struct WebDAVConfig {
    url: String,
    username: String,
    password: String,
    #[allow(dead_code)]
    #[serde(rename = "remotePath")]
    remote_path: String,
}

/// 测试 R2 连接
#[tauri::command]
async fn test_r2_connection(
    config: R2Config,
    http_client: tauri::State<'_, HttpClient>
) -> Result<String, String> {
    // 检查空字段
    if config.account_id.is_empty() 
        || config.access_key_id.is_empty() 
        || config.secret_access_key.is_empty() 
        || config.bucket_name.is_empty() {
        return Err("配置不完整: AccountID、KeyID、Secret 和 Bucket 均为必填项。".to_string());
    }

    // 使用 HEAD bucket 请求测试连接
    let endpoint_url = format!("https://{}.r2.cloudflarestorage.com/{}", config.account_id, config.bucket_name);
    
    // 获取当前时间
    let now = chrono::Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();
    
    // AWS Signature V4 签名
    let region = "auto";
    let service = "s3";
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
    let canonical_uri = format!("/{}", config.bucket_name);
    let canonical_querystring = "";
    let canonical_headers = format!("host:{}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{}\n", host, datetime_str);
    let signed_headers = "host;x-amz-content-sha256;x-amz-date";
    let payload_hash = "UNSIGNED-PAYLOAD";
    
    // 创建规范请求
    let canonical_request = format!(
        "HEAD\n{}\n{}\n{}\n{}\n{}",
        canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
    );
    
    // 计算规范请求的哈希
    let mut hasher = Sha256::new();
    hasher.update(canonical_request.as_bytes());
    let canonical_request_hash = hex::encode(hasher.finalize());
    
    // 创建待签名字符串
    let credential_scope = format!("{}/{}/{}/aws4_request", date_str, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        datetime_str, credential_scope, canonical_request_hash
    );
    
    // 计算签名
    let k_date = hmac_sha256(format!("AWS4{}", config.secret_access_key).as_bytes(), date_str.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    
    // 构建 Authorization header
    let authorization_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key_id, credential_scope, signed_headers, signature
    );
    
    // 使用全局 HTTP 客户端（已配置超时和连接池）
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
                Err(format!("连接失败: 存储桶 (Bucket) '{}' 未找到。", config.bucket_name))
            } else if status == reqwest::StatusCode::FORBIDDEN {
                Err("连接失败: Access Key ID 或 Secret Access Key 无效，或权限不足。".to_string())
            } else {
                Err(format!("连接失败: HTTP {}", status))
            }
        }
        Err(err) => {
            if err.is_connect() {
                Err("连接失败: 无法连接到 R2 服务器。请检查网络连接。".to_string())
            } else if err.is_timeout() {
                Err("连接失败: 请求超时。".to_string())
            } else {
                Err(format!("连接失败: {}", err))
            }
        }
    }
}

/// HMAC-SHA256 辅助函数
fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// 测试 WebDAV 连接
#[tauri::command]
async fn test_webdav_connection(
    config: WebDAVConfig,
    http_client: tauri::State<'_, HttpClient>
) -> Result<String, String> {
    // 检查空字段
    if config.url.is_empty() || config.username.is_empty() || config.password.is_empty() {
        return Err("配置不完整: URL、用户名和密码均为必填项。".to_string());
    }
    let auth_header = format!(
        "Basic {}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, format!("{}:{}", config.username, config.password))
    );

    // 执行 WebDAV 的 'PROPFIND' 请求 (比 OPTIONS 更可靠)
    // 使用全局 HTTP 客户端
    let response = http_client.0
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &config.url)
        .header("Authorization", auth_header)
        .header("Depth", "0") // 只检查根 URL 本身
        .send()
        .await;

    match response {
        Ok(res) => {
            let status = res.status();
            // 200 (OK) 或 207 (Multi-Status) 都表示连接成功
            if status.is_success() || status.as_u16() == 207 {
                Ok("WebDAV 连接成功！".to_string())
            } else if status == reqwest::StatusCode::UNAUTHORIZED {
                Err("连接失败: 用户名或密码错误。".to_string())
            } else if status == reqwest::StatusCode::NOT_FOUND {
                Err("连接失败: URL 未找到。请检查链接是否正确。".to_string())
            } else {
                Err(format!("连接失败: 服务器返回状态 {}", status))
            }
        }
        Err(err) => {
            // 处理网络层错误
            let err_str = err.to_string();
            if err.is_connect() {
                Err("连接失败: 无法连接到服务器。请检查 URL 或网络。".to_string())
            } else if err.is_timeout() {
                Err("连接失败: 请求超时。".to_string())
            } else {
                Err(format!("连接失败: {}", err_str))
            }
        }
    }
}

/// 列出 R2 存储桶中的所有对象
/// 
/// # 参数
/// * `config` - R2 配置
/// * `http_client` - 全局 HTTP 客户端
/// 
/// # 返回
/// 返回 `Result<Vec<R2Object>, String>`，成功时返回对象列表，失败时返回错误信息
#[tauri::command]
async fn list_r2_objects(
    config: R2Config,
    http_client: tauri::State<'_, HttpClient>
) -> Result<Vec<R2Object>, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    // 检查配置完整性
    if config.account_id.is_empty() 
        || config.access_key_id.is_empty() 
        || config.secret_access_key.is_empty() 
        || config.bucket_name.is_empty() {
        return Err("R2 配置不完整，请先在设置中配置所有必填字段。".to_string());
    }

    let mut objects: Vec<R2Object> = Vec::new();
    let mut continuation_token: Option<String> = None;

    loop {
        // 构建请求 URL
        let mut url = format!(
            "https://{}.r2.cloudflarestorage.com/{}?list-type=2",
            config.account_id, config.bucket_name
        );
        
        if let Some(token) = &continuation_token {
            url.push_str(&format!("&continuation-token={}", urlencoding::encode(token)));
        }

        // 获取当前时间
        let now = chrono::Utc::now();
        let date_str = now.format("%Y%m%d").to_string();
        let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();
        
        // AWS Signature V4 签名
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
        
        // 创建规范请求
        let canonical_request = format!(
            "GET\n{}\n{}\n{}\n{}\n{}",
            canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
        );
        
        // 计算规范请求的哈希
        let mut hasher = Sha256::new();
        hasher.update(canonical_request.as_bytes());
        let canonical_request_hash = hex::encode(hasher.finalize());
        
        // 创建待签名字符串
        let credential_scope = format!("{}/{}/{}/aws4_request", date_str, region, service);
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{}\n{}\n{}",
            datetime_str, credential_scope, canonical_request_hash
        );
        
        // 计算签名
        let k_date = hmac_sha256(format!("AWS4{}", config.secret_access_key).as_bytes(), date_str.as_bytes());
        let k_region = hmac_sha256(&k_date, region.as_bytes());
        let k_service = hmac_sha256(&k_region, service.as_bytes());
        let k_signing = hmac_sha256(&k_service, b"aws4_request");
        let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
        
        // 构建 Authorization header
        let authorization_header = format!(
            "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
            config.access_key_id, credential_scope, signed_headers, signature
        );
        
        // 使用全局 HTTP 客户端发送请求
        let response = http_client.0
            .get(&url)
            .header("Host", &host)
            .header("x-amz-date", &datetime_str)
            .header("x-amz-content-sha256", payload_hash)
            .header("Authorization", &authorization_header)
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("列出对象失败 (HTTP {}): {}", status, body));
        }

        let body = response.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

        // 解析 XML 响应
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
                Err(e) => return Err(format!("解析 XML 失败: {}", e)),
                _ => {}
            }
            buf.clear();
        }

        // 检查是否还有更多数据
        if is_truncated && !next_token.is_empty() {
            continuation_token = Some(next_token);
        } else {
            break;
        }
    }

    // 按最后修改时间降序排序（最新的在前）
    objects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));

    eprintln!("[R2管理] 成功列出 {} 个对象", objects.len());
    Ok(objects)
}

/// 辅助函数：对路径进行 URI 编码（符合 AWS Signature V4 规范）
/// 对每个路径段进行编码，但保留斜杠 /
fn uri_encode_path(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            urlencoding::encode(segment).into_owned()
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 删除 R2 存储桶中的指定对象
/// 
/// # 参数
/// * `config` - R2 配置
/// * `key` - 要删除的对象的 Key
/// * `http_client` - 全局 HTTP 客户端
/// 
/// # 返回
/// 返回 `Result<String, String>`，成功时返回成功消息，失败时返回错误信息
#[tauri::command]
async fn delete_r2_object(
    config: R2Config, 
    key: String,
    http_client: tauri::State<'_, HttpClient>
) -> Result<String, String> {
    // 检查配置完整性
    if config.account_id.is_empty() 
        || config.access_key_id.is_empty() 
        || config.secret_access_key.is_empty() 
        || config.bucket_name.is_empty() {
        return Err("R2 配置不完整，请先在设置中配置所有必填字段。".to_string());
    }

    if key.is_empty() {
        return Err("对象 Key 不能为空。".to_string());
    }

    // 对 key 进行路径编码（保留斜杠）
    let encoded_key = uri_encode_path(&key);
    
    // 构建请求 URL
    let url = format!(
        "https://{}.r2.cloudflarestorage.com/{}/{}",
        config.account_id, config.bucket_name, encoded_key
    );

    // 获取当前时间
    let now = chrono::Utc::now();
    let date_str = now.format("%Y%m%d").to_string();
    let datetime_str = now.format("%Y%m%dT%H%M%SZ").to_string();
    
    // AWS Signature V4 签名
    let region = "auto";
    let service = "s3";
    let host = format!("{}.r2.cloudflarestorage.com", config.account_id);
    // canonical_uri 中也需要使用相同的编码方式
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
    
    // 创建规范请求
    let canonical_request = format!(
        "DELETE\n{}\n{}\n{}\n{}\n{}",
        canonical_uri, canonical_querystring, canonical_headers, signed_headers, payload_hash
    );
    
    // 计算规范请求的哈希
    let mut hasher = Sha256::new();
    hasher.update(canonical_request.as_bytes());
    let canonical_request_hash = hex::encode(hasher.finalize());
    
    // 创建待签名字符串
    let credential_scope = format!("{}/{}/{}/aws4_request", date_str, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        datetime_str, credential_scope, canonical_request_hash
    );
    
    // 计算签名
    let k_date = hmac_sha256(format!("AWS4{}", config.secret_access_key).as_bytes(), date_str.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    
    // 构建 Authorization header
    let authorization_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        config.access_key_id, credential_scope, signed_headers, signature
    );
    
    // 重试机制：最多尝试 3 次（使用全局 HTTP 客户端）
    let max_retries = 3;
    let mut last_error = String::new();
    
    for attempt in 0..max_retries {
        if attempt > 0 {
            let delay = std::time::Duration::from_millis(500 * (1 << attempt)); // 指数退避：500ms, 1s, 2s
            eprintln!("[R2删除] 第 {} 次重试，等待 {:?}...", attempt, delay);
            tokio::time::sleep(delay).await;
        }
        
        // 使用全局 HTTP 客户端发送 DELETE 请求
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
                        
                        // 如果是 4xx 错误（客户端错误），不重试
                        if status.is_client_error() {
                            eprintln!("[R2删除] 客户端错误，不重试: {}", last_error);
                            return Err(last_error);
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
                    
                    // 如果是超时错误或连接错误，继续重试
                    if e.is_timeout() || e.is_connect() {
                        continue;
                    }
                    
                    // 其他错误也尝试重试
                    continue;
                }
            }
    }
    
    // 所有重试都失败
    Err(format!("删除失败（已重试 {} 次）: {}", max_retries, last_error))
}

