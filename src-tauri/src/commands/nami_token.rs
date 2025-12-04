// src-tauri/src/commands/nami_token.rs
// 纳米图床 Token 自动获取模块
// 使用 Sidecar (Node.js + Puppeteer) 从纳米页面获取动态 Headers

use serde::{Deserialize, Serialize};
use tauri::api::process::{Command, CommandEvent};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NamiDynamicHeaders {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "zmToken")]
    pub zm_token: String,
    #[serde(rename = "zmUa")]
    pub zm_ua: String,
    pub timestamp: String,
    pub sid: String,
    pub mid: String,
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "headerTid")]
    pub header_tid: String,
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

/// 检测系统是否安装了 Chrome 浏览器 (用于纳米图床)
#[tauri::command]
pub async fn check_nami_chrome_installed() -> Result<bool, String> {
    println!("[NamiToken] 检测 Chrome 安装状态...");

    let (mut rx, _child) = Command::new_sidecar("nami-token-fetcher")
        .map_err(|e| format!("创建 sidecar 失败: {}", e))?
        .args(["check-chrome"])
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败: {}", e))?;

    let mut output = String::new();
    let mut stderr_output = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                output.push_str(&line);
            }
            CommandEvent::Stderr(line) => {
                stderr_output.push_str(&line);
                stderr_output.push('\n');
            }
            CommandEvent::Terminated(status) => {
                println!("[NamiToken] Sidecar 退出，状态: {:?}", status);
            }
            _ => {}
        }
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
                    println!("[NamiToken] 检测到 {}: {}", name, path);
                }
                return Ok(true);
            }
        }
        println!("[NamiToken] 未检测到 Chrome 或 Edge");
        Ok(false)
    } else {
        Err(response.error.unwrap_or_else(|| "未知错误".to_string()))
    }
}

/// 从纳米页面获取动态 Headers
#[tauri::command]
pub async fn fetch_nami_token(cookie: String, auth_token: String) -> Result<NamiDynamicHeaders, String> {
    println!("[NamiToken] ========== 开始获取动态 Headers (Sidecar) ==========");

    let (mut rx, _child) = Command::new_sidecar("nami-token-fetcher")
        .map_err(|e| format!("创建 sidecar 失败: {}", e))?
        .args(["fetch-token", "--cookie", &cookie, "--auth-token", &auth_token])
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败: {}", e))?;

    let mut output = String::new();
    let mut stderr_output = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                output.push_str(&line);
            }
            CommandEvent::Stderr(line) => {
                stderr_output.push_str(&line);
                stderr_output.push('\n');
            }
            CommandEvent::Terminated(status) => {
                println!("[NamiToken] Sidecar 退出，状态: {:?}", status);
            }
            _ => {}
        }
    }

    // 输出 stderr 日志（包含进度信息）
    if !stderr_output.is_empty() {
        for line in stderr_output.lines() {
            println!("{}", line);
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<NamiDynamicHeaders> = serde_json::from_str(&output)
        .map_err(|e| format!("解析响应失败: {}. 原始输出: {}", e, output))?;

    if response.success {
        if let Some(headers) = response.data {
            println!("[NamiToken] ========== Headers 获取成功 ==========");
            println!("[NamiToken]   access_token: {}...", &headers.access_token.chars().take(20).collect::<String>());
            println!("[NamiToken]   zm_token: {}...", &headers.zm_token.chars().take(20).collect::<String>());
            return Ok(headers);
        }
        Err("响应中没有 Headers 数据".to_string())
    } else {
        Err(response.error.unwrap_or_else(|| "未知错误".to_string()))
    }
}
