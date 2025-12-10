// src-tauri/src/commands/jd.rs
// 京东图床上传命令

use tauri::Window;
use serde::{Deserialize, Serialize};
use reqwest::multipart;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

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
async fn get_aid_info() -> Result<AidInfo, String> {
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
        .map_err(|e| format!("获取 aid 请求失败: {}", e))?;

    let response_text = response.text().await
        .map_err(|e| format!("无法读取 aid 响应: {}", e))?;

    println!("[JD] Aid API 响应: {}", response_text);

    // 解析 JSONP 响应: jsonp1({...})
    let json_str = response_text
        .trim()
        .strip_prefix("jsonp1(")
        .and_then(|s| s.strip_suffix(")"))
        .ok_or("无效的 JSONP 响应格式")?;

    let json_value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    let aid = json_value["aid"]
        .as_str()
        .ok_or("响应中缺少 aid 字段")?
        .to_string();

    let pin = json_value["pin"]
        .as_str()
        .unwrap_or("")  // pin 可能为空字符串
        .to_string();

    Ok(AidInfo { aid, pin })
}

#[tauri::command]
pub async fn upload_to_jd(
    _window: Window,
    _id: String,
    file_path: String,
) -> Result<JDUploadResult, String> {
    println!("[JD] 开始上传文件: {}", file_path);

    // 1. 读取文件
    let mut file = File::open(&file_path).await
        .map_err(|e| format!("无法打开文件: {}", e))?;

    let file_size = file.metadata().await
        .map_err(|e| format!("无法获取文件元数据: {}", e))?
        .len();

    // 2. 验证文件大小（限制 15MB）
    if file_size > MAX_FILE_SIZE {
        return Err(format!(
            "文件大小 ({:.2}MB) 超过限制 (15MB)",
            file_size as f64 / 1024.0 / 1024.0
        ));
    }

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).await
        .map_err(|e| format!("无法读取文件: {}", e))?;

    // 3. 验证文件类型（只允许图片）
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无法获取文件名")?;

    let ext = file_name.split('.').last()
        .ok_or("无法获取文件扩展名")?
        .to_lowercase();

    if !["jpg", "jpeg", "png", "gif"].contains(&ext.as_str()) {
        return Err("只支持 JPG、PNG、GIF 格式的图片".to_string());
    }

    // 4. 获取 aid 和 pin
    println!("[JD] 正在获取 aid 和 pin...");
    let aid_info = get_aid_info().await?;
    println!("[JD] 获取成功 - aid: {}, pin: {}", aid_info.aid, aid_info.pin);

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
        .map_err(|e| format!("无法设置 MIME 类型: {}", e))?;

    let form = multipart::Form::new()
        .part("upload", part)  // 京东用 "upload" 字段名
        .text("appId", "im.customer")
        .text("aid", aid_info.aid)
        .text("clientType", "comet")
        .text("pin", aid_info.pin);

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
        .map_err(|e| format!("上传请求失败: {}", e))?;

    // 7. 解析响应
    let response_text = response.text().await
        .map_err(|e| format!("无法读取响应: {}", e))?;

    println!("[JD] 上传 API 响应: {}", response_text);

    let upload_response: JDUploadResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("JSON 解析失败: {}", e))?;

    // 8. 检查上传结果
    if upload_response.code != 0 {
        return Err(format!("京东 API 返回错误码: {}", upload_response.code));
    }

    let image_url = upload_response.path
        .ok_or("API 未返回图片链接")?;

    println!("[JD] 上传成功: {}", image_url);

    // ✅ 修复: 删除此处的100%事件发送
    // 前端会在收到Ok结果时自动设置100%

    Ok(JDUploadResult {
        url: image_url,
        size: file_size,
    })
}
