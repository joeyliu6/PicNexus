// src-tauri/src/commands/qiyu_token.rs
// 七鱼图床 Token 自动获取模块
// 使用 Sidecar (Node.js + Puppeteer) 从七鱼页面获取上传凭证
// v2.10: 迁移到 AppError 统一错误类型

use serde::{Deserialize, Serialize};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tokio::time::{timeout, Duration};

use crate::error::AppError;

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
pub async fn check_chrome_installed(app: tauri::AppHandle) -> Result<bool, AppError> {
    println!("[QiyuToken] 检测 Chrome 安装状态...");

    let sidecar = app.shell()
        .sidecar("qiyu-token-fetcher")
        .map_err(|e| AppError::external(format!("创建 sidecar 失败: {}", e)))?;

    let (mut rx, _child) = sidecar
        .args(["check-chrome"])
        .spawn()
        .map_err(|e| AppError::external(format!("启动 sidecar 失败: {}", e)))?;

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
        return Err(AppError::network("检测 Chrome 超时（45秒），请检查网络连接"));
    }

    // 输出 stderr 日志
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            println!("{}", line);
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<CheckChromeData> = serde_json::from_str(&output)
        .map_err(|e| AppError::external(format!("解析响应失败: {}. 原始输出: {}", e, output)))?;

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
        Err(AppError::external(response.error.unwrap_or_else(|| "未知错误".to_string())))
    }
}

/// 检查七鱼图床是否可用（完整检测）
/// 通过实际获取 Token 来验证上传能力
#[tauri::command]
pub async fn check_qiyu_available(app: tauri::AppHandle) -> bool {
    println!("[Qiyu] 开始可用性检测（获取 Token）...");
    let start_time = std::time::Instant::now();

    match fetch_qiyu_token_internal(&app).await {
        Ok(token) => {
            let elapsed = start_time.elapsed();
            println!("[Qiyu] 检测完成 - Object: {}, 耗时: {:?}, 结果: 可用",
                token.object_path, elapsed);
            true
        }
        Err(e) => {
            let elapsed = start_time.elapsed();
            println!("[Qiyu] 可用性检测失败 - 错误: {}, 耗时: {:?}", e, elapsed);
            false
        }
    }
}

/// 从七鱼页面获取新的上传 Token
#[tauri::command]
pub async fn fetch_qiyu_token(app: tauri::AppHandle) -> Result<QiyuToken, AppError> {
    fetch_qiyu_token_internal(&app).await
}

/// 内部函数：从七鱼页面获取新的上传 Token
pub async fn fetch_qiyu_token_internal(app: &tauri::AppHandle) -> Result<QiyuToken, AppError> {
    println!("[QiyuToken] ========== 开始获取 Token (Sidecar) ==========");

    let sidecar = app.shell()
        .sidecar("qiyu-token-fetcher")
        .map_err(|e| AppError::external(format!("创建 sidecar 失败: {}", e)))?;

    let (mut rx, _child) = sidecar
        .args(["fetch-token"])
        .spawn()
        .map_err(|e| AppError::external(format!("启动 sidecar 失败: {}", e)))?;

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
        return Err(AppError::network("获取 Token 超时（45秒），请检查网络连接或稍后重试"));
    }

    // 输出 stderr 日志（包含进度信息）
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            println!("{}", line);
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<QiyuToken> = serde_json::from_str(&output)
        .map_err(|e| AppError::external(format!("解析响应失败: {}. 原始输出: {}", e, output)))?;

    if response.success {
        if let Some(token) = response.data {
            println!("[QiyuToken] ========== Token 获取成功 ==========");
            println!("[QiyuToken]   Object: {}", token.object_path);
            println!("[QiyuToken]   Expires: {}", token.expires);
            return Ok(token);
        }
        Err(AppError::upload("七鱼", "响应中没有 Token 数据"))
    } else {
        Err(AppError::upload("七鱼", response.error.unwrap_or_else(|| "未知错误".to_string())))
    }
}
