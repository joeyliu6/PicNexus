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

fn main() {
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
        .invoke_handler(tauri::generate_handler![
            save_cookie_from_login,
            start_cookie_monitoring,
            get_request_header_cookie,
            test_r2_connection,
            test_webdav_connection
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
async fn test_r2_connection(config: R2Config) -> Result<String, String> {
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
    
    // 发送请求
    let client = reqwest::Client::new();
    match client
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
async fn test_webdav_connection(config: WebDAVConfig) -> Result<String, String> {
    // 检查空字段
    if config.url.is_empty() || config.username.is_empty() || config.password.is_empty() {
        return Err("配置不完整: URL、用户名和密码均为必填项。".to_string());
    }

    let client = reqwest::Client::new();
    let auth_header = format!(
        "Basic {}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, format!("{}:{}", config.username, config.password))
    );

    // 执行 WebDAV 的 'PROPFIND' 请求 (比 OPTIONS 更可靠)
    let response = client
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

