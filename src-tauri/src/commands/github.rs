// src-tauri/src/commands/github.rs
// GitHub 图床上传命令

use tauri::{Window, Emitter};
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose::STANDARD};

use crate::error::{AppError, IntoAppError};
use super::utils::read_file_bytes;

/// GitHub 上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct GithubUploadResult {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_path: Option<String>,
}

/// GitHub 上传请求体
#[derive(Debug, Serialize)]
struct GithubUploadRequest {
    message: String,
    content: String,
    branch: String,
}

/// GitHub 上传响应
#[derive(Debug, Deserialize)]
struct GithubUploadResponse {
    content: GithubContent,
}

/// GitHub 内容信息
#[derive(Debug, Deserialize)]
struct GithubContent {
    #[serde(rename = "download_url")]
    download_url: String,
    sha: String,
}

/// 文件大小限制：25MB（GitHub API 限制）
const MAX_FILE_SIZE: u64 = 25 * 1024 * 1024;

/// 上传文件到 GitHub
#[tauri::command]
pub async fn upload_to_github(
    window: Window,
    id: String,
    file_path: String,
    github_token: String,
    owner: String,
    repo: String,
    branch: String,
    path: String,
) -> Result<GithubUploadResult, AppError> {
    println!("[GitHub] 开始上传文件: {}", file_path);

    // 发送进度: 0% - 读取文件
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 0,
        "total": 100,
        "step": "读取文件...",
        "step_index": 1,
        "total_steps": 3
    }));

    // 1. 读取文件
    let (buffer, file_size) = read_file_bytes(&file_path).await?;

    // 2. 验证文件大小（限制 25MB）
    if file_size > MAX_FILE_SIZE {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过 GitHub API 限制 (25MB)",
            file_size as f64 / 1024.0 / 1024.0
        )));
    }

    // 3. 获取文件名
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法获取文件名"))?;

    // 发送进度: 33% - 编码文件
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 33,
        "total": 100,
        "step": "编码文件...",
        "step_index": 2,
        "total_steps": 3
    }));

    // 4. Base64 编码文件内容
    let content = STANDARD.encode(&buffer);

    // 5. 构建远程路径
    let remote_path = format!("{}/{}", path.trim_end_matches('/'), file_name);

    let url = format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        owner, repo, urlencoding::encode(&remote_path)
    );

    let request_body = GithubUploadRequest {
        message: format!("Upload {} via PicNexus", file_name),
        content,
        branch: branch.clone(),
    };

    // 发送进度: 66% - 正在上传
    let _ = window.emit("upload://progress", serde_json::json!({
        "id": id,
        "progress": 66,
        "total": 100,
        "step": "正在上传...",
        "step_index": 3,
        "total_steps": 3
    }));

    // 6. 发送请求到 GitHub API
    let client = reqwest::Client::new();
    let response = client
        .put(&url)
        .header("Authorization", format!("token {}", github_token))
        .header("User-Agent", "PicNexus")
        .header("Accept", "application/vnd.github.v3+json")
        .json(&request_body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .into_network_err_with("上传请求失败")?;

    // 7. 解析响应
    let status = response.status();
    let response_text = response.text().await
        .into_network_err_with("无法读取响应")?;

    println!("[GitHub] API 响应状态: {}", status);
    println!("[GitHub] API 响应: {}", response_text);

    if !status.is_success() {
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::auth("GitHub 认证失败：Token 无效或已过期"));
        } else if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::auth("GitHub API 频率限制：请稍后再试"));
        } else if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::storage("GitHub 仓库或分支不存在，请检查配置"));
        } else if status.as_u16() == 422 {
            return Err(AppError::validation("GitHub 上传失败：文件过大或存在验证错误"));
        }
        return Err(AppError::upload("GitHub", format!("上传失败 (HTTP {}): {}", status, response_text)));
    }

    let github_response: GithubUploadResponse = serde_json::from_str(&response_text)
        .map_err(|e| AppError::upload("GitHub", format!("JSON 解析失败: {}", e)))?;

    println!("[GitHub] 上传成功 - URL: {}", github_response.content.download_url);

    Ok(GithubUploadResult {
        url: github_response.content.download_url,
        sha: Some(github_response.content.sha),
        remote_path: Some(remote_path),
    })
}
