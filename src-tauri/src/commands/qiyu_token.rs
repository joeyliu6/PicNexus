// src-tauri/src/commands/qiyu_token.rs
// 七鱼图床 Token 自动获取模块
// 使用 Sidecar (Node.js + Puppeteer) 从七鱼页面获取上传凭证

use serde::{Deserialize, Serialize};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tokio::time::{timeout, Duration};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QiyuToken {
    pub token: String,
    pub object_path: String,
    pub expires: i64,
}

#[derive(Debug, Deserialize)]
struct SidecarResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CheckChromeData {
    installed: bool,
    path: Option<String>,
    name: Option<String>,
}

/// 检测系统是否安装了 Chrome 浏览器
#[tauri::command]
pub async fn check_chrome_installed(app: tauri::AppHandle) -> Result<bool, String> {
    println!("[QiyuToken] 检测 Chrome 安装状态...");

    let sidecar = app.shell()
        .sidecar("qiyu-token-fetcher")
        .map_err(|e| format!("创建 sidecar 失败: {}", e))?;

    let (mut rx, _child) = sidecar
        .args(["check-chrome"])
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败: {}", e))?;

    let mut output = String::new();
    let mut stderr_output = String::new();

    // 添加 45 秒超时控制
    let result = timeout(Duration::from_secs(45), async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    output.push_str(&String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    stderr_output.push_str(&String::from_utf8_lossy(&line));
                    stderr_output.push('\n');
                }
                CommandEvent::Terminated(status) => {
                    println!("[QiyuToken] Sidecar 退出，状态: {:?}", status);
                }
                _ => {}
            }
        }
    }).await;

    // 检查是否超时
    if result.is_err() {
        return Err("检测 Chrome 超时（45秒），请检查网络连接".to_string());
    }

    // 输出 stderr 日志
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            println!("{}", line);
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<CheckChromeData> = serde_json::from_str(&output)
        .map_err(|e| format!("解析响应失败: {}. 原始输出: {}", e, output))?;

    if response.success {
        if let Some(data) = response.data {
            if data.installed {
                if let (Some(name), Some(path)) = (&data.name, &data.path) {
                    println!("[QiyuToken] 检测到 {}: {}", name, path);
                }
                return Ok(true);
            }
        }
        println!("[QiyuToken] 未检测到 Chrome 或 Edge");
        Ok(false)
    } else {
        Err(response.error.unwrap_or_else(|| "未知错误".to_string()))
    }
}

/// 检查七鱼图床是否可用（完整检测）
/// 通过实际获取 Token 来验证上传能力
#[tauri::command]
pub async fn check_qiyu_available(app: tauri::AppHandle) -> bool {
    match fetch_qiyu_token_internal(&app).await {
        Ok(_) => true,
        Err(e) => {
            println!("[Qiyu] 可用性检测失败: {}", e);
            false
        }
    }
}

/// 从七鱼页面获取新的上传 Token
#[tauri::command]
pub async fn fetch_qiyu_token(app: tauri::AppHandle) -> Result<QiyuToken, String> {
    fetch_qiyu_token_internal(&app).await
}

/// 内部函数：从七鱼页面获取新的上传 Token
pub async fn fetch_qiyu_token_internal(app: &tauri::AppHandle) -> Result<QiyuToken, String> {
    println!("[QiyuToken] ========== 开始获取 Token (Sidecar) ==========");

    let sidecar = app.shell()
        .sidecar("qiyu-token-fetcher")
        .map_err(|e| format!("创建 sidecar 失败: {}", e))?;

    let (mut rx, _child) = sidecar
        .args(["fetch-token"])
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败: {}", e))?;

    let mut output = String::new();
    let mut stderr_output = String::new();

    // 添加 45 秒超时控制
    let result = timeout(Duration::from_secs(45), async {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    output.push_str(&String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    stderr_output.push_str(&String::from_utf8_lossy(&line));
                    stderr_output.push('\n');
                }
                CommandEvent::Terminated(status) => {
                    println!("[QiyuToken] Sidecar 退出，状态: {:?}", status);
                }
                _ => {}
            }
        }
    }).await;

    // 检查是否超时
    if result.is_err() {
        return Err("获取 Token 超时（45秒），请检查网络连接或稍后重试".to_string());
    }

    // 输出 stderr 日志（包含进度信息）
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            println!("{}", line);
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<QiyuToken> = serde_json::from_str(&output)
        .map_err(|e| format!("解析响应失败: {}. 原始输出: {}", e, output))?;

    if response.success {
        if let Some(token) = response.data {
            println!("[QiyuToken] ========== Token 获取成功 ==========");
            println!("[QiyuToken]   Object: {}", token.object_path);
            println!("[QiyuToken]   Expires: {}", token.expires);
            return Ok(token);
        }
        Err("响应中没有 Token 数据".to_string())
    } else {
        Err(response.error.unwrap_or_else(|| "未知错误".to_string()))
    }
}
