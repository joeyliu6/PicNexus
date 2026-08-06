// src-tauri/src/url_policy.rs
// 出站 URL 安全策略：统一判定哪些地址允许发起请求
//
// 拆出独立模块的原因：WebDAV 图床需要在 commands/webdav_upload.rs 里做同样的校验，
// 而安全策略重复实现一份就多一处走样的机会——两边判定不一致时，宽松的那边就是漏洞。

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::Url;

use crate::error::AppError;

/// 私有地址放行策略
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PrivateHostPolicy {
    /// 拒绝内网地址（默认；GitHub CDN、S3 publicDomain 等外部服务走这条）
    Deny,
    /// 允许局域网地址与局域网 HTTP
    ///
    /// 仅供 WebDAV 使用：群晖 / 自建 NAS 的地址通常是 `http://192.168.1.10:5005`，
    /// 按 Deny 策略会被直接拦死，而这正是 WebDAV 图床最主要的用户群。
    /// 注意即便放行，仍拒绝链路本地段（含云元数据 169.254.169.254）——
    /// 没有人的 NAS 挂在那个地址上，放行它只会平白扩大 SSRF 面。
    AllowPrivate,
}

pub fn normalize_host(host: &str) -> String {
    host.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn is_private_or_reserved_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || octets[0] == 0
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 198 && (18..=19).contains(&octets[1]))
        || octets[0] >= 240
}

fn ipv4_mapped_from_ipv6(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    let segments = ip.segments();
    if segments[0] == 0
        && segments[1] == 0
        && segments[2] == 0
        && segments[3] == 0
        && segments[4] == 0
        && segments[5] == 0xffff
    {
        let high = segments[6];
        let low = segments[7];
        return Some(Ipv4Addr::new(
            (high >> 8) as u8,
            high as u8,
            (low >> 8) as u8,
            low as u8,
        ));
    }

    None
}

pub fn is_loopback_host(host: &str) -> bool {
    let normalized = normalize_host(host);
    if normalized.eq_ignore_ascii_case("localhost") {
        return true;
    }

    normalized
        .parse::<IpAddr>()
        .map(|ip| match ip {
            IpAddr::V4(ip) => ip.is_loopback(),
            IpAddr::V6(ip) => {
                ip.is_loopback()
                    || ipv4_mapped_from_ipv6(ip)
                        .map(|mapped| mapped.is_loopback())
                        .unwrap_or(false)
            }
        })
        .unwrap_or(false)
}

pub fn is_private_or_reserved_host(host: &str) -> bool {
    if is_loopback_host(host) {
        return false;
    }

    match normalize_host(host).parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => is_private_or_reserved_ipv4(ip),
        Ok(IpAddr::V6(ip)) => {
            if let Some(mapped) = ipv4_mapped_from_ipv6(ip) {
                return is_private_or_reserved_ipv4(mapped);
            }

            ip.is_unspecified()
                || ip.is_multicast()
                || ip.segments()[0] & 0xffc0 == 0xfe80
                || ip.segments()[0] & 0xfe00 == 0xfc00
        }
        Err(_) => false,
    }
}

/// 链路本地 / 组播 / 未指定地址：任何策略下都拒绝
pub fn is_always_blocked_host(host: &str) -> bool {
    match normalize_host(host).parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            let octets = ip.octets();
            ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
                || octets[0] == 0
                || octets[0] >= 240
        }
        Ok(IpAddr::V6(ip)) => {
            if let Some(mapped) = ipv4_mapped_from_ipv6(ip) {
                let octets = mapped.octets();
                return mapped.is_link_local()
                    || mapped.is_multicast()
                    || mapped.is_broadcast()
                    || octets[0] == 0
                    || octets[0] >= 240;
            }
            ip.is_unspecified() || ip.is_multicast() || ip.segments()[0] & 0xffc0 == 0xfe80
        }
        Err(_) => false,
    }
}

pub fn validate_url_with_policy(raw_url: &str, policy: PrivateHostPolicy) -> Result<Url, AppError> {
    let parsed = Url::parse(raw_url)
        .map_err(|_| AppError::validation("地址格式不正确，请输入完整的 https:// 地址"))?;

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::validation("地址不能包含用户名或密码"));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::validation("地址缺少主机名"))?;

    let allow_private = policy == PrivateHostPolicy::AllowPrivate;

    if allow_private && is_always_blocked_host(host) {
        return Err(AppError::validation("地址不能指向链路本地或保留地址"));
    }

    match parsed.scheme() {
        "https" => {
            if !allow_private && is_private_or_reserved_host(host) {
                return Err(AppError::validation("地址不能指向内网、链路本地或保留地址"));
            }
            Ok(parsed)
        }
        "http" if is_loopback_host(host) => Ok(parsed),
        "http" if allow_private && is_private_or_reserved_host(host) => Ok(parsed),
        "http" if allow_private => Err(AppError::validation(
            "公网 HTTP 地址已禁用，请改用 HTTPS。局域网地址可使用 HTTP。",
        )),
        "http" => Err(AppError::validation(
            "外部 HTTP 地址已禁用，请改用 HTTPS。本机服务仅支持 http://localhost 或 http://127.0.0.1。",
        )),
        _ => Err(AppError::validation("地址仅支持 HTTPS，或本机回环 HTTP。")),
    }
}

pub fn validate_external_url(raw_url: &str) -> Result<Url, AppError> {
    validate_url_with_policy(raw_url, PrivateHostPolicy::Deny)
}

pub fn validate_webdav_url(raw_url: &str) -> Result<Url, AppError> {
    validate_url_with_policy(raw_url, PrivateHostPolicy::AllowPrivate)
        .map_err(|err| AppError::webdav(err.to_string()))
}

/// WebDAV 请求前的最终校验：HTTP 主机名无法在前端/同步校验阶段判定内网，
/// 这里按 DNS 解析结果裁决，局域网主机名放行、公网主机名拒绝。
pub async fn validate_webdav_url_for_request(raw_url: &str) -> Result<Url, AppError> {
    let parsed = Url::parse(raw_url)
        .map_err(|_| AppError::webdav("地址格式不正确，请输入完整的 https:// 地址"))?;

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::webdav("地址不能包含用户名或密码"));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::webdav("地址缺少主机名"))?;

    if is_always_blocked_host(host) {
        return Err(AppError::webdav("地址不能指向链路本地或保留地址"));
    }

    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if is_loopback_host(host) => Ok(parsed),
        "http" if is_private_or_reserved_host(host) => Ok(parsed),
        "http" => {
            if normalize_host(host).parse::<IpAddr>().is_ok() {
                return Err(AppError::webdav(
                    "公网 HTTP 地址已禁用，请改用 HTTPS。局域网地址可使用 HTTP。",
                ));
            }

            let port = parsed.port_or_known_default().unwrap_or(80);
            let normalized = normalize_host(host);
            let resolved = tokio::net::lookup_host((normalized.as_str(), port))
                .await
                .map_err(|e| AppError::webdav(format!("局域网主机名解析失败: {}", e)))?;

            let mut saw_addr = false;
            for addr in resolved {
                saw_addr = true;
                let ip = addr.ip().to_string();
                if !is_loopback_host(&ip) && !is_private_or_reserved_host(&ip) {
                    return Err(AppError::webdav(
                        "公网 HTTP 地址已禁用，请改用 HTTPS。局域网地址可使用 HTTP。",
                    ));
                }
            }

            if !saw_addr {
                return Err(AppError::webdav("局域网主机名未解析到可用地址"));
            }

            Ok(parsed)
        }
        _ => Err(AppError::webdav("地址仅支持 HTTPS，或本机回环 HTTP。")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_keeps_strict_policy() {
        assert!(validate_external_url("https://cdn.example.com/a").is_ok());
        assert!(validate_external_url("http://127.0.0.1:8080/a").is_ok());
        // WebDAV 的放行不能外溢到 GitHub CDN / S3 publicDomain
        assert!(validate_external_url("https://192.168.1.10/a").is_err());
        assert!(validate_external_url("http://192.168.1.10/a").is_err());
        assert!(validate_external_url("http://example.com/a").is_err());
    }

    #[test]
    fn webdav_url_allows_lan_addresses() {
        // 群晖 / 自建 NAS 的典型形态
        assert!(validate_webdav_url("http://192.168.1.10:5005/dav").is_ok());
        assert!(validate_webdav_url("http://10.0.0.5/dav").is_ok());
        assert!(validate_webdav_url("http://172.16.3.4/dav").is_ok());
        assert!(validate_webdav_url("https://192.168.1.10/dav").is_ok());
        assert!(validate_webdav_url("http://localhost:5244/dav").is_ok());
        assert!(validate_webdav_url("https://dav.example.com/dav").is_ok());
    }

    #[test]
    fn webdav_url_still_blocks_public_http_and_link_local() {
        // 公网 HTTP：明文凭证会在公网裸奔
        assert!(validate_webdav_url("http://dav.example.com/dav").is_err());
        // 云元数据地址：没有人的 NAS 挂在这里
        assert!(validate_webdav_url("http://169.254.169.254/latest").is_err());
        assert!(validate_webdav_url("https://169.254.169.254/latest").is_err());
        assert!(validate_webdav_url("http://[fe80::1]/dav").is_err());
        // 凭证内嵌
        assert!(validate_webdav_url("http://u:p@192.168.1.10/dav").is_err());
        // 非 HTTP 协议
        assert!(validate_webdav_url("file:///tmp/a").is_err());
    }

    #[test]
    fn reserved_ranges_match_frontend_and_link_checker() {
        assert!(validate_external_url("https://240.0.0.1/a").is_err());
        assert!(validate_external_url("https://198.18.1.1/a").is_err());
        assert!(validate_external_url("https://192.0.0.1/a").is_err());

        assert!(validate_webdav_url("https://240.0.0.1/a").is_err());
        assert!(validate_webdav_url("http://198.18.1.1/a").is_ok());
        assert!(validate_webdav_url("https://198.18.1.1/a").is_ok());
    }

    #[test]
    fn host_classifiers_agree_on_common_cases() {
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("127.0.0.1"));
        assert!(!is_loopback_host("10.0.0.1"));

        assert!(is_private_or_reserved_host("192.168.1.1"));
        assert!(!is_private_or_reserved_host("cdn.example.com"));

        assert!(is_always_blocked_host("169.254.169.254"));
        assert!(!is_always_blocked_host("192.168.1.1"));
    }
}
