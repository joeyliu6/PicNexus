use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};
use crate::error::AppError;
use serde::Serialize;
use reqwest::header;
use std::path::Path;
use quick_xml::events::Event;
use quick_xml::Reader;
use tauri::Window;
use futures::StreamExt;
use std::sync::{Arc, Mutex};

#[derive(Serialize)]
pub struct UploadResponse {
    pub pid: String,
    pub width: i32,
    pub height: i32,
    pub size: i32,
}

/// 定义进度事件的载荷
#[derive(Serialize, Clone)]
struct ProgressPayload {
    id: String,
    progress: u64,
    total: u64,
}

/// 使用 quick-xml 进行健壮的 XML 解析
/// 能够处理格式变化（如空格、换行符等）
fn parse_weibo_response(xml: &str) -> Result<UploadResponse, AppError> {
    // 首先检查认证错误
    if xml.contains("<data>100006</data>") {
         return Err(AppError::AuthError("Cookie expired (code 100006)".to_string()));
    }
    
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true); // 自动修剪文本内容
    
    let mut buf = Vec::new();
    let mut pid: Option<String> = None;
    let mut width: i32 = 0;
    let mut height: i32 = 0;
    let mut size: i32 = 0;
    let mut in_pid = false;
    let mut in_width = false;
    let mut in_height = false;
    let mut in_size = false;
    
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                match e.name().as_ref() {
                    b"pid" => in_pid = true,
                    b"width" => in_width = true,
                    b"height" => in_height = true,
                    b"size" => in_size = true,
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();
                if in_pid {
                    pid = Some(text);
                } else if in_width {
                    width = text.parse().unwrap_or(0);
                } else if in_height {
                    height = text.parse().unwrap_or(0);
                } else if in_size {
                    size = text.parse().unwrap_or(0);
                }
            }
            Ok(Event::End(e)) => {
                match e.name().as_ref() {
                    b"pid" => in_pid = false,
                    b"width" => in_width = false,
                    b"height" => in_height = false,
                    b"size" => in_size = false,
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                // XML 解析失败，尝试回退到正则匹配
                eprintln!("[上传] XML 解析失败，尝试正则匹配: {}", e);
                return parse_weibo_response_fallback(xml);
            }
            _ => {}
        }
        buf.clear();
    }
    
    // 验证必需字段
    let pid = pid.ok_or_else(|| AppError::WeiboApiError { 
        code: -1, 
        msg: "Failed to parse PID from XML response".to_string() 
    })?;
    
    Ok(UploadResponse {
        pid,
        width,
        height,
        size,
    })
}

/// 回退解析方法：使用更宽松的字符串匹配
/// 作为 XML 解析失败时的备用方案
fn parse_weibo_response_fallback(xml: &str) -> Result<UploadResponse, AppError> {
    // 使用更宽松的匹配，允许标签前后有空白字符
    // 查找 <pid> 或 <pid > 等变体
    let pid = find_xml_tag_content(xml, "pid")
        .ok_or_else(|| AppError::WeiboApiError { 
            code: -1, 
            msg: "Failed to parse PID (fallback)".to_string() 
        })?;
    
    let width = find_xml_tag_content(xml, "width")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    
    let height = find_xml_tag_content(xml, "height")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    
    let size = find_xml_tag_content(xml, "size")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    
    Ok(UploadResponse {
        pid,
        width,
        height,
        size,
    })
}

/// 辅助函数：查找 XML 标签内容，支持多种格式变体
fn find_xml_tag_content(xml: &str, tag: &str) -> Option<String> {
    // 尝试多种格式：<tag>、<tag >、<tag\n> 等
    let patterns = [
        format!("<{}>", tag),
        format!("<{} >", tag),
        format!("<{}\n>", tag),
        format!("<{}\r\n>", tag),
    ];
    
    let closing_tag = format!("</{}>", tag);
    
    for pattern in &patterns {
        if let Some(start) = xml.find(pattern) {
            let content_start = start + pattern.len();
            if let Some(end) = xml[content_start..].find(&closing_tag) {
                let content = &xml[content_start..content_start + end];
                return Some(content.trim().to_string());
            }
        }
    }
    
    None
}


// HttpClient 在 main.rs 中定义，这里直接使用
use crate::HttpClient;

#[tauri::command]
pub async fn upload_file_stream(
    window: Window,
    id: String,
    file_path: String, 
    weibo_cookie: String,
    http_client: tauri::State<'_, HttpClient>
) -> Result<UploadResponse, AppError> {
    
    let path = Path::new(&file_path);
    // Unused variable file_name
    let _file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("image.jpg");
    
    let file = File::open(&file_path).await?;
    let metadata = file.metadata().await?;
    let total_len = metadata.len();

    // 使用 FramedRead 读取文件流
    let stream = FramedRead::new(file, BytesCodec::new());
    
    // 关键优化：通过 map 包装流，在此处注入进度监控
    let uploaded = Arc::new(Mutex::new(0u64));
    let uploaded_clone = Arc::clone(&uploaded);
    let window_clone = window.clone();
    let id_clone = id.clone();
    let total_len_clone = total_len;
    
    let progress_stream = stream.map(move |chunk| {
        if let Ok(bytes) = &chunk {
            // 安全处理 Mutex lock，避免 panic
            if let Ok(mut uploaded) = uploaded_clone.lock() {
                *uploaded += bytes.len() as u64;
                let current_progress = *uploaded;

                // 发送进度事件到前端
                // 注意：为了性能，可以加个判断，比如每 1% 或每 100KB 发送一次，这里为了简单每次 chunk 都发
                let _ = window_clone.emit("upload://progress", ProgressPayload {
                    id: id_clone.clone(),
                    progress: current_progress,
                    total: total_len_clone,
                });
            } else {
                eprintln!("[上传] 警告: Mutex 锁被污染，跳过进度更新");
            }
        }
        chunk
    });

    let body = reqwest::Body::wrap_stream(progress_stream);

    let url = "https://picupload.weibo.com/interface/pic_upload.php?s=xml&ori=1&data=1&rotate=0&wm=&app=miniblog&mime=image/jpeg";

    // 使用全局 HTTP 客户端（带连接池配置），而不是创建新客户端
    let res = http_client.0.post(url)
        .header(header::COOKIE, weibo_cookie)
        .header(header::CONTENT_LENGTH, total_len) // 必须显式设置长度，否则流式上传可能无法计算总长
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::REFERER, "https://photo.weibo.com/")
        .header(header::ORIGIN, "https://photo.weibo.com")
        .header(header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36")
        .body(body)
        .send()
        .await?;

    let text = res.text().await?;
    
    // 上传完成，发送 100% 事件
    let _ = window.emit("upload://progress", ProgressPayload {
        id: id.clone(),
        progress: total_len,
        total: total_len,
    });
    
    parse_weibo_response(&text)
}

