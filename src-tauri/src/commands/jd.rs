// src-tauri/src/commands/jd.rs
// 京东图床上传命令
// v2.10: 迁移到 AppError 统一错误类型

use reqwest::multipart;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};

use super::utils::read_file_bytes;
use crate::error::{AppError, IntoAppError};
use crate::log_utils::{safe_path, safe_url, summarize_text};

/// 京东上传结果
#[derive(Debug, Serialize, Deserialize)]
pub struct JDUploadResult {
    pub url: String,
    pub size: u64,
}

/// 京东 Aid 信息
#[derive(Debug, Deserialize)]
struct AidInfo {
    aid: String,
    pin: String,
}

/// 京东上传 API 响应
#[derive(Debug, Deserialize)]
struct JDUploadResponse {
    code: i32,
    path: Option<String>,
}

/// 文件大小限制：15MB
const MAX_FILE_SIZE: u64 = 15 * 1024 * 1024;

/// 获取京东 aid 和 pin
async fn get_aid_info() -> Result<AidInfo, AppError> {
    let url = "https://api.m.jd.com/client.action?functionId=getAidInfo&body=%7B%22aidClientType%22%3A%22comet%22%2C%22aidClientVersion%22%3A%22comet%20-v1.0.0%22%2C%22appId%22%3A%22im.customer%22%2C%22os%22%3A%22comet%22%2C%22entry%22%3A%22jd_web_EnterpriseZC%22%2C%22reqSrc%22%3A%22s_comet%22%2C%22siteId%22%3A-1%2C%22customerAppId%22%3A%22im.customer%22%7D&appid=wh5&client=wh5&clientVersion=1.0.0&loginType=3&callback=jsonp1";

    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://jdcs.jd.com/chat/index.action?venderId=1&appId=jd.waiter&customerAppId=im.customer&entry=jd_web_EnterpriseZC")
        .send()
        .await
        .into_network_err_with("获取 aid 请求失败")?;

    let response_text = response
        .text()
        .await
        .into_network_err_with("无法读取 aid 响应")?;

    log::debug!("[JD] Aid API 响应: {}", summarize_text(&response_text));

    // 解析 JSONP 响应: jsonp1({...})
    let json_str = response_text
        .trim()
        .strip_prefix("jsonp1(")
        .and_then(|s| s.strip_suffix(")"))
        .ok_or_else(|| AppError::upload("京东", "无效的 JSONP 响应格式"))?;

    let json_value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| AppError::upload("京东", format!("JSON 解析失败: {}", e)))?;

    let aid = json_value["aid"]
        .as_str()
        .ok_or_else(|| AppError::upload("京东", "响应中缺少 aid 字段"))?
        .to_string();

    let pin = json_value["pin"]
        .as_str()
        .unwrap_or("") // pin 可能为空字符串
        .to_string();

    Ok(AidInfo { aid, pin })
}

/// 检查京东图床是否可用
/// 通过调用 get_aid_info() 检测 API 是否可达
#[tauri::command]
pub async fn check_jd_available() -> bool {
    log::info!("[JD] 开始可用性检测...");
    let start_time = std::time::Instant::now();

    match get_aid_info().await {
        Ok(aid_info) => {
            let elapsed = start_time.elapsed();
            log::info!(
                "[JD] 检测完成 - aid: {}, 耗时: {:?}, 结果: 可用",
                aid_info.aid,
                elapsed
            );
            true
        }
        Err(e) => {
            let elapsed = start_time.elapsed();
            log::error!("[JD] 可用性检测失败 - 错误: {}, 耗时: {:?}", e, elapsed);
            false
        }
    }
}

#[tauri::command]
pub async fn upload_to_jd(
    window: Window,
    id: String,
    file_path: String,
) -> Result<JDUploadResult, AppError> {
    log::info!("[JD] 开始上传文件: {}", safe_path(&file_path));

    // 发送进度: 0% - 读取文件
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 0,
            "total": 100,
            "step": "读取文件...",
            "step_index": 1,
            "total_steps": 4
        }),
    );

    // 1. 读取文件
    let (buffer, file_size) = read_file_bytes(&file_path).await?;

    // 2. 验证文件大小（限制 15MB）
    if file_size > MAX_FILE_SIZE {
        return Err(AppError::validation(format!(
            "文件大小 ({:.2}MB) 超过限制 (15MB)",
            file_size as f64 / 1024.0 / 1024.0
        )));
    }

    // 3. 验证文件类型（只允许图片）
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::validation("无法获取文件名"))?;

    let ext = file_name
        .split('.')
        .next_back()
        .ok_or_else(|| AppError::validation("无法获取文件扩展名"))?
        .to_lowercase();

    if !["jpg", "jpeg", "png", "gif"].contains(&ext.as_str()) {
        return Err(AppError::validation("只支持 JPG、PNG、GIF 格式的图片"));
    }

    // 发送进度: 25% - 获取凭证
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 25,
            "total": 100,
            "step": "获取上传凭证...",
            "step_index": 2,
            "total_steps": 4
        }),
    );

    // 4. 获取 aid 和 pin
    log::debug!("[JD] 正在获取 aid 和 pin...");
    let aid_info = get_aid_info().await?;
    log::debug!("[JD] 获取成功 - aid: {}", aid_info.aid);

    // 5. 构建 multipart form
    // 将扩展名转为小写（避免服务器不支持大写扩展名）
    let normalized_file_name = if let Some(dot_pos) = file_name.rfind('.') {
        format!("{}.{}", &file_name[..dot_pos], ext)
    } else {
        file_name.to_string()
    };

    let part = multipart::Part::bytes(buffer)
        .file_name(normalized_file_name)
        .mime_str("image/*")
        .into_validation_err_with("无法设置 MIME 类型")?;

    let form = multipart::Form::new()
        .part("upload", part) // 京东用 "upload" 字段名
        .text("appId", "im.customer")
        .text("aid", aid_info.aid)
        .text("clientType", "comet")
        .text("pin", aid_info.pin);

    // 发送进度: 50% - 正在上传
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 50,
            "total": 100,
            "step": "正在上传...",
            "step_index": 3,
            "total_steps": 4
        }),
    );

    // 6. 发送请求到京东上传 API
    let client = reqwest::Client::new();
    let response = client
        .post("https://file-dd.jd.com/file/uploadImg.action")
        .header("Accept", "application/json, text/plain, */*")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Origin", "https://jdcs.jd.com")
        .header("Referer", "https://jdcs.jd.com/chat/index.action?venderId=1&appId=jd.waiter&customerAppId=im.customer&entry=jd_web_EnterpriseZC")
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .into_network_err_with("上传请求失败")?;

    // 发送进度: 75% - 处理响应
    let _ = window.emit(
        "upload://progress",
        serde_json::json!({
            "id": id,
            "progress": 75,
            "total": 100,
            "step": "处理响应...",
            "step_index": 4,
            "total_steps": 4
        }),
    );

    // 7. 解析响应
    let response_text = response
        .text()
        .await
        .into_network_err_with("无法读取响应")?;

    log::debug!("[JD] 上传 API 响应: {}", summarize_text(&response_text));

    let upload_response: JDUploadResponse = serde_json::from_str(&response_text)
        .map_err(|e| AppError::upload("京东", format!("JSON 解析失败: {}", e)))?;

    // 8. 检查上传结果
    if upload_response.code != 0 {
        return Err(AppError::upload_with_code(
            "京东",
            upload_response.code,
            format!("API 返回错误码: {}", upload_response.code),
        ));
    }

    let raw_url = upload_response
        .path
        .ok_or_else(|| AppError::upload("京东", "API 未返回图片链接"))?;

    // 替换域名：dd-static.jd.com/ddimgp -> img30.360buyimg.com/imgzone
    let image_url = raw_url.replace("dd-static.jd.com/ddimgp", "img30.360buyimg.com/imgzone");

    log::info!("[JD] 上传成功（原始URL: {}）", safe_url(&raw_url));
    log::debug!("[JD] 转换后URL: {}", safe_url(&image_url));

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    Ok(JDUploadResult {
        url: image_url,
        size: file_size,
    })
}
