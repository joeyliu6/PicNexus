// src-tauri/src/commands/link_checker.rs
// 图片链接检测命令
// v2.10: 迁移到 AppError 统一错误类型
// v3.0: 新增批量检测引擎、服务感知请求头、并发控制

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::error::AppError;

/// 最大允许下载的文件大小（50MB）
const MAX_DOWNLOAD_SIZE: usize = 50 * 1024 * 1024;

/// 临时文件前缀，用于清理时识别
const TEMP_FILE_PREFIX: &str = "weibo_reupload_";

/// URL 下载临时文件前缀
const URL_DOWNLOAD_PREFIX: &str = "picnexus_url_";

/// URL 下载临时文件序号计数器。
/// Why: Windows 下 SystemTime 实际精度通常 100ns 级，批量迁移 3 路并发同秒触发时
/// `subsec_nanos()` 会撞名 → 后写者覆盖前者文件，正在上传的进程读到错的字节。
/// 对齐 image_compress.rs 的实现风格，用原子计数器彻底消除命名竞争。
static URL_DOWNLOAD_COUNTER: AtomicU32 = AtomicU32::new(0);

/// 临时文件过期时间（1小时 = 3600秒）
const TEMP_FILE_MAX_AGE_SECS: u64 = 3600;

/// 批量检测进度事件节流：每 N 条 emit 一次（首末强制 emit 保证准确性）
/// 避免 5w+ 条批量检测下每毫秒数千事件打爆前端事件队列
const PROGRESS_EMIT_EVERY_N: usize = 10;

/// 批量检测单次最多接收的链接数，防止恶意/失误传入巨量链接耗尽 tokio 任务池
const MAX_BATCH_CHECK_LINKS: usize = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckLinkResult {
    pub link: String,
    pub is_valid: bool,
    pub status_code: Option<u16>,
    pub error: Option<String>,
    pub error_type: String, // "success" | "http_4xx" | "http_5xx" | "timeout" | "network" | "suspicious"
    pub suggestion: Option<String>,
    pub response_time: Option<u64>,
    // v3.0 新增
    pub detected_service: Option<String>,
    pub browser_might_work: bool,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
}

/// 错误分类和建议生成
fn classify_error(
    status_code: Option<u16>,
    error: Option<&reqwest::Error>,
) -> (String, Option<String>) {
    // HTTP 4xx 错误
    if let Some(code) = status_code {
        if (400..500).contains(&code) {
            return (
                "http_4xx".to_string(),
                Some("图片已被删除或无权访问，建议从其他有效图床重新上传".to_string()),
            );
        } else if code >= 500 {
            return (
                "http_5xx".to_string(),
                Some("图床服务器暂时不可用，建议稍后重试".to_string()),
            );
        } else if (200..300).contains(&code) {
            return ("success".to_string(), None);
        }
    }

    // 网络错误
    if let Some(err) = error {
        if err.is_timeout() {
            return (
                "timeout".to_string(),
                Some("请求超时，可能是网络延迟或图床响应慢".to_string()),
            );
        } else if err.is_connect() {
            return (
                "network".to_string(),
                Some("网络连接失败，请检查网络或防火墙设置".to_string()),
            );
        }
    }

    // 默认
    ("network".to_string(), Some("未知错误".to_string()))
}

/// 通用 Chrome User-Agent（版本号定期随大版本更新）
const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/// 图床服务配置（集中管理：域名识别、请求头、HEAD 支持、防盗链）
struct ServiceConfig {
    id: &'static str,
    /// Referer 头（None = 不附加）
    referer: Option<&'static str>,
    /// User-Agent（None = 使用 CHROME_UA）
    ua: Option<&'static str>,
    /// 是否不支持 HEAD（直接用 GET + Range）
    skip_head: bool,
    /// 是否有防盗链（403 时浏览器可能能访问）
    hotlink_protected: bool,
}

/// 所有已知图床的统一配置表
const SERVICE_CONFIGS: &[ServiceConfig] = &[
    ServiceConfig { id: "weibo",    referer: Some("https://weibo.com/"),     ua: None, skip_head: false, hotlink_protected: true },
    ServiceConfig { id: "bilibili", referer: Some("https://mall.bilibili.com/"), ua: None, skip_head: false, hotlink_protected: true },
    ServiceConfig { id: "jd",       referer: Some("https://jdcs.jd.com/chat/index.action?venderId=1&appId=jd.waiter&customerAppId=im.customer&entry=jd_web_EnterpriseZC"), ua: None, skip_head: false, hotlink_protected: true },
    ServiceConfig { id: "zhihu",    referer: Some("https://www.zhihu.com/"), ua: None, skip_head: true,  hotlink_protected: true },
    ServiceConfig { id: "chaoxing", referer: Some("https://notice.chaoxing.com/"), ua: None, skip_head: true,  hotlink_protected: true },
    ServiceConfig { id: "nowcoder", referer: Some("https://www.nowcoder.com/creation/write/article"), ua: None, skip_head: false, hotlink_protected: true },
    ServiceConfig { id: "baidu",    referer: None,                           ua: None, skip_head: true,  hotlink_protected: false },
    ServiceConfig { id: "github",   referer: None,                           ua: Some("PicNexus"), skip_head: false, hotlink_protected: false },
    ServiceConfig { id: "imgur",    referer: None,                           ua: None, skip_head: false, hotlink_protected: false },
    ServiceConfig { id: "oss",      referer: None,                           ua: None, skip_head: false, hotlink_protected: false },
    ServiceConfig { id: "cos",      referer: None,                           ua: None, skip_head: false, hotlink_protected: false },
    ServiceConfig { id: "qiniu",    referer: None,                           ua: None, skip_head: false, hotlink_protected: false },
    ServiceConfig { id: "smms",     referer: None,                           ua: None, skip_head: false, hotlink_protected: false },
    ServiceConfig { id: "nami",     referer: None,                           ua: None, skip_head: false, hotlink_protected: false },
];

/// 从服务 ID 查找配置
fn get_service_config(service_id: &str) -> Option<&'static ServiceConfig> {
    SERVICE_CONFIGS.iter().find(|c| c.id == service_id)
}

/// 从 URL 域名识别图床服务
fn detect_service_from_url(url: &str) -> Option<&'static str> {
    let host = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .and_then(|s| s.split('/').next())
        .unwrap_or("");

    if host.ends_with(".sinaimg.cn") || host == "sinaimg.cn" {
        return Some("weibo");
    }
    if host.contains("image.baidu.com") {
        return Some("baidu");
    }
    if host.ends_with(".hdslb.com") || host == "hdslb.com" {
        return Some("bilibili");
    }
    if host.ends_with(".360buyimg.com") || host == "360buyimg.com" {
        return Some("jd");
    }
    if host.ends_with(".zhimg.com") || host == "zhimg.com" {
        return Some("zhihu");
    }
    if host.contains("chaoxing.com") {
        return Some("chaoxing");
    }
    if host.contains("nowcoder.com") {
        return Some("nowcoder");
    }
    if host == "raw.githubusercontent.com" || host == "github.com" || host.ends_with(".github.io") {
        return Some("github");
    }
    if host == "i.imgur.com" || host == "imgur.com" {
        return Some("imgur");
    }
    if host.ends_with(".aliyuncs.com") {
        return Some("oss");
    }
    if host.ends_with(".myqcloud.com") {
        return Some("cos");
    }
    if host.ends_with(".qiniudn.com") || host.ends_with(".qnssl.com") || host.ends_with(".qbox.me")
    {
        return Some("qiniu");
    }
    if host.ends_with(".smms.app") || host == "i.loli.net" || host == "vip2.loli.io" {
        return Some("smms");
    }
    if host.ends_with(".nami.observer") || host == "nami.observer" {
        return Some("nami");
    }
    None
}

// ==================== 单元测试（放在使用点之前，便于在 tests 模块中访问） ====================

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- classify_error ----------

    #[test]
    fn classify_error_4xx_returns_http_4xx() {
        let (kind, hint) = classify_error(Some(404), None);
        assert_eq!(kind, "http_4xx");
        assert!(hint.unwrap().contains("已被删除"));
    }

    #[test]
    fn classify_error_5xx_returns_http_5xx() {
        let (kind, hint) = classify_error(Some(503), None);
        assert_eq!(kind, "http_5xx");
        assert!(hint.unwrap().contains("服务器"));
    }

    #[test]
    fn classify_error_2xx_returns_success_with_no_hint() {
        let (kind, hint) = classify_error(Some(200), None);
        assert_eq!(kind, "success");
        assert!(hint.is_none());
    }

    #[test]
    fn classify_error_edge_cases_at_boundaries() {
        assert_eq!(classify_error(Some(400), None).0, "http_4xx");
        assert_eq!(classify_error(Some(499), None).0, "http_4xx");
        assert_eq!(classify_error(Some(500), None).0, "http_5xx");
        assert_eq!(classify_error(Some(599), None).0, "http_5xx");
        assert_eq!(classify_error(Some(299), None).0, "success");
    }

    #[test]
    fn classify_error_without_status_or_error_defaults_to_network() {
        let (kind, hint) = classify_error(None, None);
        assert_eq!(kind, "network");
        assert!(hint.is_some());
    }

    #[test]
    fn classify_error_3xx_falls_through_to_default() {
        // 3xx 未被显式处理，会走到默认分支
        let (kind, _) = classify_error(Some(302), None);
        assert_eq!(kind, "network");
    }

    // ---------- detect_service_from_url ----------

    #[test]
    fn detect_weibo_from_sinaimg_host() {
        assert_eq!(
            detect_service_from_url("https://tvax1.sinaimg.cn/large/abc.jpg"),
            Some("weibo")
        );
        assert_eq!(
            detect_service_from_url("http://sinaimg.cn/foo"),
            Some("weibo")
        );
    }

    #[test]
    fn detect_bilibili_from_hdslb_host() {
        assert_eq!(
            detect_service_from_url("https://i0.hdslb.com/bfs/x.jpg"),
            Some("bilibili")
        );
        assert_eq!(
            detect_service_from_url("https://hdslb.com/x.jpg"),
            Some("bilibili")
        );
    }

    #[test]
    fn detect_jd_from_360buyimg_host() {
        assert_eq!(
            detect_service_from_url("https://img30.360buyimg.com/jfs/x.jpg"),
            Some("jd")
        );
    }

    #[test]
    fn detect_zhihu_from_zhimg_host() {
        assert_eq!(
            detect_service_from_url("https://pic1.zhimg.com/80/v2-abc.jpg"),
            Some("zhihu")
        );
    }

    #[test]
    fn detect_chaoxing_by_substring_match() {
        assert_eq!(
            detect_service_from_url("https://p.ananas.chaoxing.com/x.jpg"),
            Some("chaoxing")
        );
        assert_eq!(
            detect_service_from_url("https://notice.chaoxing.com/x.jpg"),
            Some("chaoxing")
        );
        // 注意：匹配的是 host（第一个 / 之前的部分），query 里出现 chaoxing.com 不算
        assert_eq!(
            detect_service_from_url("https://p.cldisk.com/x.jpg?from=chaoxing.com"),
            None
        );
    }

    #[test]
    fn detect_nowcoder_by_substring_match() {
        assert_eq!(
            detect_service_from_url("https://uploadfiles.nowcoder.com/files/x.jpg"),
            Some("nowcoder")
        );
    }

    #[test]
    fn detect_github_from_raw_and_io_hosts() {
        assert_eq!(
            detect_service_from_url("https://raw.githubusercontent.com/u/r/main/x.jpg"),
            Some("github"),
        );
        assert_eq!(
            detect_service_from_url("https://github.com/u/r/raw/x.jpg"),
            Some("github")
        );
        assert_eq!(
            detect_service_from_url("https://user.github.io/page.jpg"),
            Some("github")
        );
    }

    #[test]
    fn detect_imgur_only_for_exact_hosts() {
        assert_eq!(
            detect_service_from_url("https://i.imgur.com/x.jpg"),
            Some("imgur")
        );
        assert_eq!(
            detect_service_from_url("https://imgur.com/x.jpg"),
            Some("imgur")
        );
        // 非官方域名不匹配
        assert_ne!(
            detect_service_from_url("https://fake.imgur.com.evil.com/x"),
            Some("imgur")
        );
    }

    #[test]
    fn detect_oss_cos_qiniu_smms_nami() {
        assert_eq!(
            detect_service_from_url("https://bucket.oss-cn-beijing.aliyuncs.com/x"),
            Some("oss")
        );
        assert_eq!(
            detect_service_from_url("https://bucket.cos.ap-guangzhou.myqcloud.com/x"),
            Some("cos")
        );
        assert_eq!(
            detect_service_from_url("https://cdn.qiniudn.com/x"),
            Some("qiniu")
        );
        assert_eq!(
            detect_service_from_url("https://foo.qnssl.com/x"),
            Some("qiniu")
        );
        assert_eq!(
            detect_service_from_url("https://foo.qbox.me/x"),
            Some("qiniu")
        );
        assert_eq!(
            detect_service_from_url("https://s3.smms.app/x"),
            Some("smms")
        );
        assert_eq!(
            detect_service_from_url("https://i.loli.net/x.jpg"),
            Some("smms")
        );
        assert_eq!(
            detect_service_from_url("https://vip2.loli.io/x.jpg"),
            Some("smms")
        );
        assert_eq!(
            detect_service_from_url("https://api.nami.observer/x"),
            Some("nami")
        );
    }

    #[test]
    fn detect_returns_none_for_unknown_host() {
        assert_eq!(detect_service_from_url("https://example.com/x.jpg"), None);
        assert_eq!(detect_service_from_url("https://random-cdn.io/y.png"), None);
    }

    #[test]
    fn detect_handles_missing_scheme_returning_none() {
        // 没有 http/https 前缀时，host 被当成空字符串，返回 None
        assert_eq!(detect_service_from_url("example.com/x.jpg"), None);
    }

    #[test]
    fn detect_handles_http_scheme() {
        assert_eq!(
            detect_service_from_url("http://tvax1.sinaimg.cn/x.jpg"),
            Some("weibo")
        );
    }

    // ---------- image extension detection ----------

    #[test]
    fn detect_image_extension_prefers_real_png_bytes() {
        assert_eq!(
            detect_image_extension(b"\x89PNG\r\n\x1a\nrest"),
            Some("png")
        );
    }

    #[test]
    fn validate_downloaded_image_payload_rejects_fake_ico_magic() {
        let err = validate_downloaded_image_payload(&[0x00, 0x00, 0x01, 0x00], "ico")
            .expect_err("ICO header without directory entries should be rejected");

        assert!(err.to_string().contains("有效图片"));
    }

    #[test]
    fn validate_downloaded_image_payload_accepts_svg_with_viewbox() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"></svg>"#;

        validate_downloaded_image_payload(svg, "svg").expect("SVG with dimensions should pass");
    }

    #[test]
    fn extension_from_content_type_handles_uppercase_and_new_formats() {
        assert_eq!(
            extension_from_content_type("IMAGE/AVIF; charset=binary"),
            "avif"
        );
        assert_eq!(
            extension_from_content_type("image/vnd.microsoft.icon"),
            "ico"
        );
    }

    #[test]
    fn extension_from_url_supports_extended_image_formats() {
        assert_eq!(extension_from_url("https://example.com/a.avif?x=1"), "avif");
        assert_eq!(
            extension_from_url("https://example.com/a.tif#preview"),
            "tiff"
        );
        assert_eq!(extension_from_url("https://example.com/a.svg"), "svg");
    }

    #[test]
    fn infer_downloaded_image_extension_prefers_real_bytes_over_url() {
        assert_eq!(
            infer_downloaded_image_extension(
                b"\x89PNG\r\n\x1a\nrest",
                "image/jpeg",
                "https://example.com/a.jpg",
            )
            .expect("extension should be inferred"),
            "png"
        );
    }

    // ---------- get_service_config ----------

    #[test]
    fn get_service_config_finds_registered_services() {
        assert!(get_service_config("weibo").is_some());
        assert!(get_service_config("jd").is_some());
        assert!(get_service_config("github").is_some());
    }

    #[test]
    fn get_service_config_returns_none_for_unknown_id() {
        assert!(get_service_config("unknown_service").is_none());
        assert!(get_service_config("").is_none());
    }

    #[test]
    fn weibo_config_has_referer_and_hotlink_protection() {
        let c = get_service_config("weibo").unwrap();
        assert_eq!(c.referer, Some("https://weibo.com/"));
        assert!(c.hotlink_protected);
    }

    #[test]
    fn zhihu_config_skips_head_request() {
        let c = get_service_config("zhihu").unwrap();
        assert!(c.skip_head, "知乎应标记为不支持 HEAD");
    }

    #[test]
    fn github_config_uses_picnexus_ua_and_no_referer() {
        let c = get_service_config("github").unwrap();
        assert_eq!(c.ua, Some("PicNexus"));
        assert!(c.referer.is_none());
        assert!(!c.hotlink_protected);
    }

    #[test]
    fn public_oss_services_have_no_hotlink_protection() {
        for id in ["oss", "cos", "qiniu", "smms", "imgur", "nami", "github"] {
            let c = get_service_config(id).unwrap_or_else(|| panic!("{} 应该注册", id));
            assert!(!c.hotlink_protected, "{} 不应标记为防盗链", id);
        }
    }
}

/// 为请求附加服务特定的 Referer / UA 头（从统一配置表读取）
fn apply_service_headers(
    builder: reqwest::RequestBuilder,
    service: Option<&str>,
) -> reqwest::RequestBuilder {
    let config = service.and_then(get_service_config);
    let ua = config.and_then(|c| c.ua).unwrap_or(CHROME_UA);
    let builder = builder.header("User-Agent", ua);
    if let Some(referer) = config.and_then(|c| c.referer) {
        builder.header("Referer", referer)
    } else {
        builder
    }
}

/// 检测单个链接的内部实现（供 check_image_link 和 batch_check_links 共用）
async fn check_single_link(
    link: &str,
    http_client: &reqwest::Client,
    timeout_secs: u64,
) -> CheckLinkResult {
    if link.trim().is_empty() {
        return CheckLinkResult {
            link: link.to_string(),
            is_valid: false,
            status_code: None,
            error: Some("链接为空".to_string()),
            error_type: "network".to_string(),
            suggestion: Some("链接为空".to_string()),
            response_time: None,
            detected_service: None,
            browser_might_work: false,
            content_type: None,
            content_length: None,
        };
    }

    let service = detect_service_from_url(link);
    let timeout = std::time::Duration::from_secs(timeout_secs);
    let start_time = Instant::now();

    // 从统一配置表查询是否跳过 HEAD
    let skip_head = service
        .and_then(get_service_config)
        .is_some_and(|c| c.skip_head);

    let response_result = if skip_head {
        let builder = http_client
            .get(link)
            .header("Range", "bytes=0-0")
            .timeout(timeout);
        apply_service_headers(builder, service).send().await
    } else {
        let head_result = {
            let builder = http_client.head(link).timeout(timeout);
            apply_service_headers(builder, service).send().await
        };
        match &head_result {
            Ok(resp) if resp.status().as_u16() == 405 => {
                let builder = http_client
                    .get(link)
                    .header("Range", "bytes=0-0")
                    .timeout(timeout);
                apply_service_headers(builder, service).send().await
            }
            _ => head_result,
        }
    };

    match response_result {
        Ok(response) => {
            let elapsed = start_time.elapsed().as_millis() as u64;
            let status = response.status();
            let status_code = status.as_u16();

            // 提取 Content-Type 和 Content-Length
            let ct = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let cl = response
                .headers()
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .or(response.content_length());

            let is_2xx = status.is_success();

            // 疑似异常判定：200 但内容不是图片或体积过小
            // 206 是 Range 请求的正常响应，其 Content-Length/Content-Type 反映部分内容，不参与 suspicious 判定
            // SVG 图片天然体积小（badge 通常 < 1KB），豁免 content_length 检查
            let is_svg = ct.as_deref().is_some_and(|t| t.starts_with("image/svg"));
            let is_suspicious = is_2xx
                && status_code != 206
                && (ct
                    .as_deref()
                    .is_some_and(|t| !t.starts_with("image/") && !t.is_empty())
                    || (!is_svg && cl.is_some_and(|len| len > 0 && len < 1024)));

            let (mut error_type, mut suggestion) = classify_error(Some(status_code), None);

            if is_suspicious {
                error_type = "suspicious".to_string();
                suggestion = Some("返回 200 但内容类型或大小异常，可能不是有效图片".to_string());
            }

            // 防盗链判定：403 + 已知防盗链服务（从统一配置表查询）
            let browser_might_work = status_code == 403
                && service
                    .and_then(get_service_config)
                    .is_some_and(|c| c.hotlink_protected);

            let is_valid = is_2xx && !is_suspicious;

            CheckLinkResult {
                link: link.to_string(),
                is_valid,
                status_code: Some(status_code),
                error: if !is_valid {
                    Some(format!("HTTP {}", status_code))
                } else {
                    None
                },
                error_type,
                suggestion,
                response_time: Some(elapsed),
                detected_service: service.map(|s| s.to_string()),
                browser_might_work,
                content_type: ct,
                content_length: cl,
            }
        }
        Err(err) => {
            let elapsed = start_time.elapsed().as_millis() as u64;
            let error_msg = if err.is_timeout() {
                "请求超时".to_string()
            } else if err.is_connect() {
                "连接失败".to_string()
            } else {
                err.to_string()
            };

            let (error_type, suggestion) = classify_error(None, Some(&err));

            // 网络层错误（连接失败/超时）时浏览器同样无法访问，不标记为防盗链
            let browser_might_work = false;

            CheckLinkResult {
                link: link.to_string(),
                is_valid: false,
                status_code: None,
                error: Some(error_msg),
                error_type,
                suggestion,
                response_time: Some(elapsed),
                detected_service: service.map(|s| s.to_string()),
                browser_might_work,
                content_type: None,
                content_length: None,
            }
        }
    }
}

/// 带 fallback 的链接检测：主链接失败时尝试备用 URL
/// 若备用成功，返回备用结果，但 `link` 字段保持原始 URL
async fn check_link_with_fallback(
    url: &str,
    fallback_url: Option<&str>,
    http_client: &reqwest::Client,
    timeout_secs: u64,
) -> CheckLinkResult {
    let primary = check_single_link(url, http_client, timeout_secs).await;
    if primary.is_valid {
        return primary;
    }
    if let Some(fb) = fallback_url {
        if fb != url {
            let fallback = check_single_link(fb, http_client, timeout_secs).await;
            if fallback.is_valid {
                // 保持 link 字段为原始 URL，其余采用 fallback 结果
                return CheckLinkResult {
                    link: url.to_string(),
                    ..fallback
                };
            }
        }
    }
    primary
}

/// 检测单个图片链接是否有效
///
/// 使用 HEAD 请求检测链接，减少流量消耗
/// 对于百度代理链接，使用 GET + Range 头请求（百度不支持 HEAD）
/// 自动识别图床服务并附加正确的 Referer/UA 头
/// fallback_url：GitHub CDN 启用时传入 raw.githubusercontent.com 原始链接作为备选
#[tauri::command]
pub async fn check_image_link(
    link: String,
    fallback_url: Option<String>,
    http_client: tauri::State<'_, crate::HttpClient>,
) -> Result<CheckLinkResult, AppError> {
    log::debug!("[链接检测] 检测链接: {}", link);
    let result = check_link_with_fallback(&link, fallback_url.as_deref(), &http_client.0, 10).await;
    log::debug!(
        "[链接检测] {} - {:?} ({}ms)",
        if result.is_valid { "ok" } else { "fail" },
        result.status_code,
        result.response_time.unwrap_or(0)
    );
    Ok(result)
}

/// 清理过期的临时文件
/// 删除超过 TEMP_FILE_MAX_AGE_SECS 秒的旧临时文件，防止磁盘空间被耗尽
fn cleanup_old_temp_files() {
    let temp_dir = std::env::temp_dir();

    // 读取临时目录
    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(entries) => entries,
        Err(e) => {
            log::error!("[临时文件清理] 无法读取临时目录: {}", e);
            return;
        }
    };

    let now = std::time::SystemTime::now();
    let mut cleaned_count = 0;

    for entry in entries.flatten() {
        let path = entry.path();

        // 只处理以特定前缀开头的文件
        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            if !file_name.starts_with(TEMP_FILE_PREFIX)
                && !file_name.starts_with(URL_DOWNLOAD_PREFIX)
            {
                continue;
            }

            // 检查文件修改时间
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(age) = now.duration_since(modified) {
                        if age.as_secs() > TEMP_FILE_MAX_AGE_SECS {
                            // 删除过期文件
                            if let Err(e) = std::fs::remove_file(&path) {
                                log::error!("[临时文件清理] 删除失败 {:?}: {}", path, e);
                            } else {
                                cleaned_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    if cleaned_count > 0 {
        log::info!("[临时文件清理] 已清理 {} 个过期文件", cleaned_count);
    }
}

/// 从 URL 下载图片到临时目录
///
/// 用于重新上传功能：从有效图床下载图片，然后重新上传到失效图床
///
/// 安全限制：
/// - 最大文件大小：50MB
/// - 自动清理超过1小时的旧临时文件
#[tauri::command]
pub async fn download_image_from_url(
    url: String,
    http_client: tauri::State<'_, crate::HttpClient>,
) -> Result<String, AppError> {
    log::info!("[下载图片] 开始下载: {}", url);

    // 首先清理过期的临时文件，防止磁盘空间耗尽
    cleanup_old_temp_files();

    // 发送 GET 请求下载图片
    let response = http_client
        .0
        .get(&url)
        .timeout(std::time::Duration::from_secs(30)) // 30秒超时
        .send()
        .await
        .map_err(|e| {
            log::error!("[下载图片] 请求失败: {}", e);
            AppError::network(format!("下载失败: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        log::error!("[下载图片] HTTP错误: {}", status);
        return Err(AppError::network(format!(
            "下载失败: HTTP {}",
            status.as_u16()
        )));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_type_mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !content_type.is_empty() && !content_type_mime.starts_with("image/") {
        return Err(AppError::validation(format!(
            "URL 指向的不是图片（Content-Type: {}）",
            content_type
        )));
    }

    // 预检查 Content-Length（如果服务器提供）
    if let Some(content_length) = response.content_length() {
        if content_length as usize > MAX_DOWNLOAD_SIZE {
            log::warn!(
                "[下载图片] 文件过大: {} bytes (最大 {} bytes)",
                content_length,
                MAX_DOWNLOAD_SIZE
            );
            return Err(AppError::validation(format!(
                "文件过大: {} MB (最大 {} MB)",
                content_length / 1024 / 1024,
                MAX_DOWNLOAD_SIZE / 1024 / 1024
            )));
        }
    }

    // 读取响应内容
    let bytes = response.bytes().await.map_err(|e| {
        log::error!("[下载图片] 读取内容失败: {}", e);
        AppError::network(format!("读取内容失败: {}", e))
    })?;

    // 实际大小检查（防止服务器返回错误的 Content-Length）
    if bytes.len() > MAX_DOWNLOAD_SIZE {
        log::warn!(
            "[下载图片] 文件过大: {} bytes (最大 {} bytes)",
            bytes.len(),
            MAX_DOWNLOAD_SIZE
        );
        return Err(AppError::validation(format!(
            "文件过大: {} MB (最大 {} MB)",
            bytes.len() / 1024 / 1024,
            MAX_DOWNLOAD_SIZE / 1024 / 1024
        )));
    }

    log::debug!("[下载图片] 下载成功，大小: {} bytes", bytes.len());
    let ext = infer_downloaded_image_extension(&bytes, &content_type, &url)?;
    validate_downloaded_image_payload(&bytes, ext)?;

    // 创建临时文件
    let temp_dir = std::env::temp_dir();
    let file_name = format!(
        "{}{}.{}",
        TEMP_FILE_PREFIX,
        chrono::Local::now().timestamp_nanos_opt().unwrap_or(0),
        ext
    );
    let temp_path = temp_dir.join(file_name);

    // 写入文件
    std::fs::write(&temp_path, &bytes).map_err(|e| {
        log::error!("[下载图片] 写入文件失败: {}", e);
        AppError::file_io(format!("写入文件失败: {}", e))
    })?;

    let path_str = temp_path.to_string_lossy().to_string();
    log::info!("[下载图片] 已保存到: {}", path_str);

    Ok(path_str)
}

/// URL 下载结果
#[derive(Debug, Serialize)]
pub struct UrlDownloadResult {
    /// 临时文件路径
    pub file_path: String,
    /// MIME 类型
    pub content_type: String,
    /// 文件大小（字节）
    pub file_size: u64,
}

/// 从 Content-Type 推断文件扩展名
fn extension_from_content_type(content_type: &str) -> &str {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" | "image/x-ms-bmp" => "bmp",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/svg+xml" => "svg",
        "image/tiff" => "tiff",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "image/avif" => "avif",
        _ => "",
    }
}

/// 从 URL 路径推断文件扩展名
fn detect_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("jpg");
    }
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.len() >= 2 && bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.len() >= 4 && (bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*")) {
        return Some("tiff");
    }
    if bytes.len() >= 4 && bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("ico");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brands = &bytes[8..bytes.len().min(64)];
        if brands
            .windows(4)
            .any(|brand| brand == b"avif" || brand == b"avis")
        {
            return Some("avif");
        }
    }

    let preview_len = bytes.len().min(512);
    let preview = String::from_utf8_lossy(&bytes[..preview_len]);
    let trimmed = preview.trim_start_matches('\u{feff}').trim_start();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("<svg") || (lower.starts_with("<?xml") && lower.contains("<svg")) {
        return Some("svg");
    }

    None
}

fn parse_svg_number(value: &str) -> Option<f64> {
    let value = value.trim();
    let numeric = value
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | '+' | '-' | 'e' | 'E'))
        .collect::<String>();
    if numeric.is_empty() {
        return None;
    }
    numeric
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite() && *n > 0.0)
}

fn extract_svg_attr(svg: &str, attr: &str) -> Option<String> {
    for pattern in [
        format!(r#"(?is)\b{}\s*=\s*"([^"]+)""#, regex::escape(attr)),
        format!(r#"(?is)\b{}\s*=\s*'([^']+)'"#, regex::escape(attr)),
    ] {
        let re = regex::Regex::new(&pattern).ok()?;
        if let Some(captures) = re.captures(svg) {
            if let Some(value) = captures.get(1) {
                return Some(value.as_str().to_string());
            }
        }
    }
    None
}

fn has_valid_svg_dimensions(bytes: &[u8]) -> bool {
    let Ok(svg) = std::str::from_utf8(bytes) else {
        return false;
    };
    if let (Some(width), Some(height)) = (
        extract_svg_attr(svg, "width"),
        extract_svg_attr(svg, "height"),
    ) {
        if parse_svg_number(&width).is_some() && parse_svg_number(&height).is_some() {
            return true;
        }
    }

    let Some(view_box) = extract_svg_attr(svg, "viewBox") else {
        return false;
    };
    let parts = view_box
        .split(|c: char| c.is_ascii_whitespace() || c == ',')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    parts.len() == 4 && parse_svg_number(parts[2]).is_some() && parse_svg_number(parts[3]).is_some()
}

fn validate_downloaded_image_payload(bytes: &[u8], ext: &str) -> Result<(), AppError> {
    if ext == "svg" {
        if has_valid_svg_dimensions(bytes) {
            return Ok(());
        }
        return Err(AppError::validation("URL 指向的 SVG 缺少有效尺寸信息"));
    }

    let size =
        imagesize::blob_size(bytes).map_err(|_| AppError::validation("URL 指向的不是有效图片"))?;
    if size.width == 0 || size.height == 0 {
        return Err(AppError::validation("URL 指向的图片尺寸无效"));
    }
    Ok(())
}

fn extension_from_url(url: &str) -> &str {
    // 去除查询参数和锚点
    let path = url.split('?').next().unwrap_or(url);
    let path = path.split('#').next().unwrap_or(path);
    if let Some(dot_pos) = path.rfind('.') {
        let ext = &path[dot_pos + 1..];
        match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" => "jpg",
            "png" => "png",
            "gif" => "gif",
            "webp" => "webp",
            "bmp" => "bmp",
            "svg" => "svg",
            "tif" | "tiff" => "tiff",
            "ico" => "ico",
            "avif" => "avif",
            _ => "",
        }
    } else {
        ""
    }
}

fn infer_downloaded_image_extension<'a>(
    bytes: &[u8],
    content_type: &'a str,
    url: &'a str,
) -> Result<&'a str, AppError> {
    if let Some(ext) = detect_image_extension(bytes) {
        return Ok(ext);
    }

    if !content_type.is_empty() {
        let from_ct = extension_from_content_type(content_type);
        if !from_ct.is_empty() {
            return Ok(from_ct);
        }
    }

    let from_url = extension_from_url(url);
    if from_url.is_empty() {
        return Err(AppError::validation("URL 指向的不是图片"));
    }
    Ok(from_url)
}

/// 从 URL 下载图片到临时目录（通用版）
///
/// 相比 `download_image_from_url`，增加了：
/// - Content-Type 校验（确认为图片）
/// - 根据 MIME 类型自动推断扩展名
/// - 返回结构化结果（路径、类型、大小）
#[tauri::command]
pub async fn download_url_image(
    url: String,
    http_client: tauri::State<'_, crate::HttpClient>,
) -> Result<UrlDownloadResult, AppError> {
    log::info!("[URL下载] 开始下载: {}", url);

    // 验证 URL 格式
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("URL 不能为空"));
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(AppError::validation(
            "请输入有效的 URL（以 http:// 或 https:// 开头）",
        ));
    }

    // 清理过期临时文件
    cleanup_old_temp_files();

    // 发送 GET 请求
    let response = http_client
        .0
        .get(trimmed)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| {
            log::error!("[URL下载] 请求失败: {}", e);
            AppError::network(format!("下载失败: {}", e))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        log::error!("[URL下载] HTTP 错误: {}", status);
        return Err(AppError::network(format!(
            "下载失败: HTTP {}",
            status.as_u16()
        )));
    }

    // 获取 Content-Type
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // 校验是否为图片
    let content_type_mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let is_image = content_type_mime.starts_with("image/");
    if !content_type.is_empty() && !is_image {
        log::warn!("[URL下载] 非图片类型: {}", content_type);
        return Err(AppError::validation(format!(
            "URL 指向的不是图片（Content-Type: {}）",
            content_type
        )));
    }

    // 预检文件大小
    if let Some(content_length) = response.content_length() {
        if content_length as usize > MAX_DOWNLOAD_SIZE {
            return Err(AppError::validation(format!(
                "文件过大: {} MB（最大 {} MB）",
                content_length / 1024 / 1024,
                MAX_DOWNLOAD_SIZE / 1024 / 1024
            )));
        }
    }

    // 读取响应内容
    let bytes = response.bytes().await.map_err(|e| {
        log::error!("[URL下载] 读取内容失败: {}", e);
        AppError::network(format!("读取内容失败: {}", e))
    })?;

    if bytes.len() > MAX_DOWNLOAD_SIZE {
        return Err(AppError::validation(format!(
            "文件过大: {} MB（最大 {} MB）",
            bytes.len() / 1024 / 1024,
            MAX_DOWNLOAD_SIZE / 1024 / 1024
        )));
    }

    // 推断扩展名：优先真实字节，其次 Content-Type / URL 路径
    let ext = infer_downloaded_image_extension(&bytes, &content_type, trimmed)?;

    validate_downloaded_image_payload(&bytes, ext)?;

    let file_size = bytes.len() as u64;

    // 创建临时文件
    let temp_dir = std::env::temp_dir();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let seq = URL_DOWNLOAD_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = format!(
        "{}{}_{}_{}.{}",
        URL_DOWNLOAD_PREFIX,
        chrono::Local::now().format("%Y%m%d_%H%M%S"),
        nanos,
        seq,
        ext
    );
    let temp_path = temp_dir.join(file_name);

    std::fs::write(&temp_path, &bytes).map_err(|e| {
        log::error!("[URL下载] 写入文件失败: {}", e);
        AppError::file_io(format!("写入文件失败: {}", e))
    })?;

    let path_str = temp_path.to_string_lossy().to_string();
    log::info!(
        "[URL下载] 已保存到: {} ({} bytes, {})",
        path_str,
        file_size,
        content_type
    );

    Ok(UrlDownloadResult {
        file_path: path_str,
        content_type,
        file_size,
    })
}

// ===== 批量检测引擎 =====

/// 暂停状态下的轮询间隔（毫秒）。
/// 权衡：间隔短 → 恢复延迟低但 CPU 空转多；间隔长 → 反之。
/// 100ms 在用户感知上几乎即时，空转代价可忽略。
const PAUSE_POLL_INTERVAL_MS: u64 = 100;

fn is_batch_cancelled(cancel_generation: &Arc<AtomicU64>, batch_generation: u64) -> bool {
    cancel_generation.load(Ordering::SeqCst) >= batch_generation
}

/// 若当前处于 paused 状态则轮询等待直至 resume 或 cancel；
/// 返回 true 表示"应立即退出任务"（即当前批次已被取消）。
async fn await_resume_or_cancel(
    pause: &Arc<AtomicBool>,
    cancel_generation: &Arc<AtomicU64>,
    batch_generation: u64,
) -> bool {
    while pause.load(Ordering::SeqCst) && !is_batch_cancelled(cancel_generation, batch_generation) {
        tokio::time::sleep(Duration::from_millis(PAUSE_POLL_INTERVAL_MS)).await;
    }
    is_batch_cancelled(cancel_generation, batch_generation)
}

/// 批量检测取消代际（Tauri State 管理）
pub struct BatchCheckCancelFlag {
    active_generation: Arc<AtomicU64>,
    cancelled_generation: Arc<AtomicU64>,
}

impl BatchCheckCancelFlag {
    pub fn new() -> Self {
        Self {
            active_generation: Arc::new(AtomicU64::new(0)),
            cancelled_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    fn start_batch(&self) -> u64 {
        let generation = self.active_generation.fetch_add(1, Ordering::SeqCst) + 1;
        // 新批次开始时只取消更老的批次；当前批次需要保持可运行。
        self.cancelled_generation
            .store(generation.saturating_sub(1), Ordering::SeqCst);
        generation
    }

    fn cancel_active(&self) {
        let generation = self.active_generation.load(Ordering::SeqCst);
        self.cancelled_generation
            .store(generation, Ordering::SeqCst);
    }
}

/// 批量检测暂停标志（Tauri State 管理）
///
/// 与 cancel_flag 解耦：cancel 优先 pause——即使处于 paused 状态，只要 cancel flag 置位，
/// 被 pause 卡住的任务会立即退出，不会"暂停中无法取消"。
pub struct BatchCheckPauseFlag(pub Arc<AtomicBool>);

/// 批量检测请求
#[derive(Debug, Deserialize)]
pub struct BatchCheckRequest {
    /// 待检测链接列表
    pub links: Vec<BatchCheckItem>,
    /// 前端生成的批次 ID，用于隔离旧批次进度事件
    pub batch_id: Option<String>,
    /// 全局并发数（默认 10）
    pub concurrency: Option<usize>,
    /// 单图床最大并发数（默认 3）
    pub per_host_limit: Option<usize>,
    /// 单链接超时秒数（默认 10）
    pub timeout_secs: Option<u64>,
}

/// 批量检测中的单个链接
#[derive(Debug, Deserialize)]
pub struct BatchCheckItem {
    /// 待检测 URL（已经过前缀改造的最终 URL）
    pub url: String,
    /// 关联的 HistoryItem ID
    pub history_id: Option<String>,
    /// 前端传入的图床标识
    pub service_id: Option<String>,
    /// 备用检测 URL（GitHub CDN 启用时为 raw.githubusercontent.com 原始链接）
    pub fallback_url: Option<String>,
}

/// 批量检测进度（通过 Tauri 事件上报）
///
/// `recent_results`：自上次广播以来累积的逐条结果（含关联 history_id/service_id）。
/// 前端用它把每条结果实时 patch 到 `checkRows`，触发顶部 chips 与列表徽章联动刷新。
/// 节流时一次性吐出，事件频率不变（仍为 PROGRESS_EMIT_EVERY_N 控制）。
#[derive(Debug, Clone, Serialize)]
pub struct BatchCheckProgress {
    pub batch_id: Option<String>,
    pub checked: usize,
    pub total: usize,
    pub current_url: String,
    pub current_result: Option<CheckLinkResult>,
    pub recent_results: Vec<BatchCheckItemResult>,
}

/// 批量检测最终结果
#[derive(Debug, Serialize)]
pub struct BatchCheckResult {
    pub batch_id: Option<String>,
    pub results: Vec<BatchCheckItemResult>,
    pub total: usize,
    pub valid: usize,
    pub invalid: usize,
    pub timeout: usize,
    pub suspicious: usize,
    pub elapsed_ms: u64,
    pub cancelled: bool,
}

/// 批量检测中单条结果（带关联信息）
#[derive(Debug, Clone, Serialize)]
pub struct BatchCheckItemResult {
    #[serde(flatten)]
    pub check: CheckLinkResult,
    pub history_id: Option<String>,
    pub service_id: Option<String>,
}

/// 批量检测图片链接有效性
///
/// 支持全局并发控制 + 单图床限速 + 取消 + 实时进度上报
#[tauri::command]
pub async fn batch_check_links(
    window: tauri::Window,
    request: BatchCheckRequest,
    http_client: tauri::State<'_, crate::HttpClient>,
    cancel_flag: tauri::State<'_, BatchCheckCancelFlag>,
    pause_flag: tauri::State<'_, BatchCheckPauseFlag>,
) -> Result<BatchCheckResult, AppError> {
    let total = request.links.len();
    if total > MAX_BATCH_CHECK_LINKS {
        return Err(AppError::Validation {
            message: format!(
                "批量检测链接数 {} 超过上限 {}",
                total, MAX_BATCH_CHECK_LINKS
            ),
        });
    }
    let concurrency = request.concurrency.unwrap_or(10).clamp(1, 50);
    let per_host_limit = request.per_host_limit.unwrap_or(3).clamp(1, 10);
    let timeout_secs = request.timeout_secs.unwrap_or(10).clamp(3, 30);

    log::info!(
        "[批量检测] 开始: {} 条链接, 并发={}, 单图床限制={}, 超时={}s",
        total,
        concurrency,
        per_host_limit,
        timeout_secs
    );

    // 分配批次代际：取消只作用于当时的 active generation，后续新批次不会复活旧任务。
    let batch_generation = cancel_flag.start_batch();
    let batch_id = request.batch_id.clone();
    // 重置暂停标志
    pause_flag.0.store(false, Ordering::SeqCst);

    let start_time = Instant::now();
    let global_semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency));
    let cancel_generation = cancel_flag.cancelled_generation.clone();
    let pause = pause_flag.0.clone();
    let client = http_client.0.clone();

    // 构建按域名分组的限速信号量
    let host_semaphores: Arc<tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Semaphore>>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    // 已完成计数（用于进度上报）
    let checked_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    // 待广播的逐条结果缓冲：节流广播触发时 take 出来塞进事件 payload
    let pending_results: Arc<tokio::sync::Mutex<Vec<BatchCheckItemResult>>> = Arc::new(
        tokio::sync::Mutex::new(Vec::with_capacity(PROGRESS_EMIT_EVERY_N * 2)),
    );

    // 为每条链接创建异步任务
    let mut handles = Vec::with_capacity(total);

    for item in request.links {
        let global_sem = global_semaphore.clone();
        let host_sems = host_semaphores.clone();
        let cancel_generation = cancel_generation.clone();
        let pause = pause.clone();
        let client = client.clone();
        let window = window.clone();
        let checked = checked_count.clone();
        let pending = pending_results.clone();
        let total_count = total;
        let event_batch_id = batch_id.clone();

        let handle = tokio::spawn(async move {
            // 检查取消 / 暂停标志（cancel 优先 pause）
            if await_resume_or_cancel(&pause, &cancel_generation, batch_generation).await {
                return None;
            }

            // 获取全局并发许可
            let _global_permit = global_sem.acquire().await.ok()?;

            // 再次检查取消 / 暂停
            if await_resume_or_cancel(&pause, &cancel_generation, batch_generation).await {
                return None;
            }

            // 获取单域名并发许可
            let host = extract_host(&item.url);
            let host_sem = {
                let mut map = host_sems.lock().await;
                map.entry(host)
                    .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(per_host_limit)))
                    .clone()
            };
            let _host_permit = host_sem.acquire().await.ok()?;

            // 最后一次检查取消 / 暂停
            if await_resume_or_cancel(&pause, &cancel_generation, batch_generation).await {
                return None;
            }

            // 执行检测（GitHub CDN 启用时带 fallback）
            let check_result = check_link_with_fallback(
                &item.url,
                item.fallback_url.as_deref(),
                &client,
                timeout_secs,
            )
            .await;

            let result = BatchCheckItemResult {
                check: check_result.clone(),
                history_id: item.history_id,
                service_id: item.service_id,
            };

            // 先把本条结果塞进缓冲，再决定是否触发节流广播
            {
                let mut buf = pending.lock().await;
                buf.push(result.clone());
            }

            // 更新进度并上报（节流：首末强制 + 每 N 条）
            let done = checked.fetch_add(1, Ordering::SeqCst) + 1;
            let should_emit =
                done == 1 || done == total_count || done.is_multiple_of(PROGRESS_EMIT_EVERY_N);
            if should_emit {
                let recent = {
                    let mut buf = pending.lock().await;
                    std::mem::take(&mut *buf)
                };
                let _ = window.emit(
                    "link-check://progress",
                    BatchCheckProgress {
                        batch_id: event_batch_id,
                        checked: done,
                        total: total_count,
                        current_url: item.url,
                        current_result: Some(check_result),
                        recent_results: recent,
                    },
                );
            }

            Some(result)
        });

        handles.push(handle);
    }

    // 等待所有任务完成
    let mut results = Vec::with_capacity(total);
    for handle in handles {
        match handle.await {
            Ok(Some(result)) => results.push(result),
            Ok(None) => {} // 被取消的任务
            Err(e) => log::warn!("[批量检测] 任务异常: {}", e),
        }
    }

    let elapsed_ms = start_time.elapsed().as_millis() as u64;
    let cancelled = is_batch_cancelled(&cancel_flag.cancelled_generation, batch_generation);

    let valid = results.iter().filter(|r| r.check.is_valid).count();
    let invalid = results
        .iter()
        .filter(|r| {
            !r.check.is_valid
                && r.check.error_type != "timeout"
                && r.check.error_type != "suspicious"
                && !r.check.browser_might_work
        })
        .count();
    let timeout = results
        .iter()
        .filter(|r| r.check.error_type == "timeout")
        .count();
    let suspicious = results
        .iter()
        .filter(|r| r.check.error_type == "suspicious" || r.check.browser_might_work)
        .count();

    log::info!(
        "[批量检测] 完成: 总={}, 有效={}, 失效={}, 超时={}, 疑似={}, 耗时={}ms, 取消={}",
        results.len(),
        valid,
        invalid,
        timeout,
        suspicious,
        elapsed_ms,
        cancelled
    );

    Ok(BatchCheckResult {
        batch_id,
        results,
        total,
        valid,
        invalid,
        timeout,
        suspicious,
        elapsed_ms,
        cancelled,
    })
}

/// 取消正在进行的批量检测
#[tauri::command]
pub async fn cancel_batch_check(
    cancel_flag: tauri::State<'_, BatchCheckCancelFlag>,
) -> Result<(), AppError> {
    log::info!("[批量检测] 收到取消请求");
    cancel_flag.cancel_active();
    Ok(())
}

/// 暂停正在进行的批量检测
#[tauri::command]
pub async fn pause_batch_check(
    pause_flag: tauri::State<'_, BatchCheckPauseFlag>,
) -> Result<(), AppError> {
    log::info!("[批量检测] 收到暂停请求");
    pause_flag.0.store(true, Ordering::SeqCst);
    Ok(())
}

/// 恢复被暂停的批量检测
#[tauri::command]
pub async fn resume_batch_check(
    pause_flag: tauri::State<'_, BatchCheckPauseFlag>,
) -> Result<(), AppError> {
    log::info!("[批量检测] 收到恢复请求");
    pause_flag.0.store(false, Ordering::SeqCst);
    Ok(())
}

/// 从 URL 中提取域名（用于按域名限速）
fn extract_host(url: &str) -> String {
    url.strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .and_then(|s| s.split('/').next())
        .unwrap_or("unknown")
        .to_string()
}
