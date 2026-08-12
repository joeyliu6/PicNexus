// src-tauri/src/url_policy.rs
// 出站 URL 安全策略：统一判定哪些地址允许发起请求
//
// 拆出独立模块的原因：WebDAV 图床需要在 commands/webdav_upload.rs 里做同样的校验，
// 而安全策略重复实现一份就多一处走样的机会——两边判定不一致时，宽松的那边就是漏洞。

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::Url;

use crate::error::AppError;

/// fake-ip 地址被当成局域网时的统一文案
///
/// 与前端 `src/security/networkPolicy.ts` 的 `FAKE_IP_HOST_MESSAGE` 保持逐字一致：
/// 同一件事在设置页和上传时说两种话，用户会以为是两个不同的问题。
///
/// 这条一致性由 `scripts/check-cross-language-constants.mjs` 在 `npm run lint` 阶段守着，
/// 不再只是口头约定；改名或挪窝时同步更新那里的 `PAIRS`。
///
/// 文案要给出路而不只是拒绝——被拦的用户有两条现成的路：填内网 IP，或改 HTTPS。
pub(crate) const FAKE_IP_HOST_MESSAGE: &str =
    "该地址属于代理软件的 fake-ip 地址池（198.18.x.x），无法确认它是局域网。请改填 NAS 的实际内网 IP（如 http://192.168.1.10:5005），或改用 HTTPS。";

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

/// 代理软件的 fake-ip 默认池（198.18.0.0/15）
///
/// 严格说这是 RFC 2544 的基准测试段（RFC 6890 scope = Benchmarking）：公网 BGP
/// 不路由它，企业内网也不会用它。现实里 198.18.x.x 只有一个来源——本机代理
/// （Clash / sing-box / Surge 等）把域名映射进来的虚拟地址。连它等于连回代理
/// 隧道再出公网，不是连内网服务。
///
/// v4 范围取 /15 是为了同时覆盖 mihomo 的默认 `198.18.0.1/16` 与 sing-box 的
/// 默认 `198.18.0.0/15`；v6 覆盖 mihomo 的默认 `fake-ip-range6`
/// `fdfe:dcba:9876::1/64`。
///
/// **v6 池不能省**：`lookup_host` 返回的是 A + AAAA 的并集，调用方逐条判定，
/// 任意一条被误判就整体失真。而 `fdfe:…` 落在 ULA（`fc00::/7`）里，
/// [`is_private_or_reserved_host`] 会把它当内网——只盖 v4 等于没盖。
///
/// 已知未覆盖：sing-box 的 v6 默认 `fc00::/18`。没纳入是因为那是一整块 ULA
/// 空间，而 `fc00::1` 这类地址在 link_checker 侧有明确的"必须拒绝"断言；
/// 为一个未实测到的池放宽一个 /18 的内网守卫，代价大于收益。见 docs/TODO.md。
///
/// 放在本模块而不是各自复制一份：判据走样的后果是**双向**的——链接检测那边
/// 靠它豁免（漏判 = 功能全废），WebDAV 这边靠它拒绝（漏判 = 凭证明文出公网）。
pub fn is_fake_ip_pool_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_fake_ip_pool_ipv4(ip),
        IpAddr::V6(ip) => match ipv4_mapped_from_ipv6(ip) {
            Some(mapped) => is_fake_ip_pool_ipv4(mapped),
            None => is_fake_ip_pool_ipv6(ip),
        },
    }
}

fn is_fake_ip_pool_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 198 && (18..=19).contains(&octets[1])
}

/// mihomo `fake-ip-range6` 默认值 `fdfe:dcba:9876::1/64`
///
/// 前 64 位是固定魔数。ULA 的 40 位 global ID 本应随机生成，真实局域网撞上
/// `fdfe:dcba:9876` 的概率可以忽略，所以按这个前缀识别不会误伤自建 IPv6 内网。
fn is_fake_ip_pool_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    segments[0] == 0xfdfe && segments[1] == 0xdcba && segments[2] == 0x9876 && segments[3] == 0
}

/// [`is_fake_ip_pool_ip`] 的主机名版本：解析不出 IP 的主机名一律返回 false
pub fn is_fake_ip_pool_host(host: &str) -> bool {
    normalize_host(host)
        .parse::<IpAddr>()
        .map(is_fake_ip_pool_ip)
        .unwrap_or(false)
}

/// DNS 解析出的地址能否作为 WebDAV 局域网 HTTP 的连接目标
///
/// Why 不直接用 `is_private_or_reserved_host` 当放行判据：它回答的是"这不是公网地址"，
/// 而那个筐里除了局域网，还装着链路本地（含云元数据 169.254.169.254）、组播、
/// `0.0.0.0/8`、`240/4`。拿它当"可以连"用，等于把 `is_always_blocked_host`
/// 想拦的段又原样放了回来。
///
/// 顺序不能颠倒：必须先查黑名单再查白名单——反过来正是本函数要修掉的那个缺陷。
///
/// fake-ip 池同理但理由不同：`198.18.x.x` 出现在 DNS 答案里，对目标的真实网络位置
/// **零信息量**——代理只是随手编了个号，等真去连的时候再在内核层换成真地址。
/// 拿它当"这是局域网"的证据，等于在每一台开了 TUN 的机器上把明文凭证防线整个拆掉：
/// 用户填的 `http://dav.example.com` 也会被编进这个段。
///
/// 链接检测（commands/link_checker.rs）对同一个池的处置**相反**——那边豁免它。
/// 判据一致，默认值相反，因为赌注相反：只读探测猜错顶多多看一眼图片，
/// WebDAV 猜错则是账号密码明文出公网。
fn is_allowed_lan_addr(ip: &str) -> bool {
    if is_always_blocked_host(ip) {
        return false;
    }

    if is_fake_ip_pool_host(ip) {
        return false;
    }

    is_loopback_host(ip) || is_private_or_reserved_host(ip)
}

/// DNS 解析结果集合的放行判定：**每一个**地址都必须符合局域网判据。
///
/// 只检查首个地址会漏掉"前几个是内网、后面混着公网"的多地址记录——
/// reqwest 建连时可能选中集合里的任意一个，所以集合里出现一个公网地址
/// 就必须整体拒绝。
#[derive(Debug, PartialEq, Eq)]
enum DnsDecisionError {
    Blocked,
    /// 解析进了代理的 fake-ip 池：不是"这是公网"，而是"看不见"
    ///
    /// 单独分一个变体是为了给用户不同的出路：`Public` 的解法是改 HTTPS，
    /// `FakeIp` 的解法是改填内网 IP。混成一句会把用户引到错误的方向。
    FakeIp,
    Public,
}

fn all_dns_results_allowed(ips: &[String]) -> Result<(), DnsDecisionError> {
    for ip in ips {
        let ip = ip.as_str();
        if is_always_blocked_host(ip) {
            return Err(DnsDecisionError::Blocked);
        }
        if is_fake_ip_pool_host(ip) {
            return Err(DnsDecisionError::FakeIp);
        }
        if !is_allowed_lan_addr(ip) {
            return Err(DnsDecisionError::Public);
        }
    }
    Ok(())
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

    // fake-ip 字面量：`AllowPrivate` 下 198.18/15 本会被 `is_private_or_reserved_host`
    // 当局域网放行，但没有人的 NAS 挂在 RFC 2544 基准测试段上。
    // `Deny` 策略不需要这条——那边保留段本来就全拒。
    if allow_private && is_fake_ip_pool_host(host) {
        return Err(AppError::validation(FAKE_IP_HOST_MESSAGE));
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
///
/// 注意这是**尽力而为**的裁决，不是最终裁决：校验阶段解析出的地址并没有绑定到
/// 后续连接，reqwest 发请求时会自己再解析一次。校验时解析到局域网、请求时解析到
/// 别处（DNS rebinding 或轮询 DNS）的场景拦不住。要真正堵住需要用
/// `ClientBuilder::resolve` 把地址钉死，但那是 client 级设置，
/// 而 `HttpClient` 是全局单例——每次请求新建 client 会丢掉连接池复用。
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

    if is_fake_ip_pool_host(host) {
        return Err(AppError::webdav(FAKE_IP_HOST_MESSAGE));
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

            let ips = resolved
                .map(|addr| addr.ip().to_string())
                .collect::<Vec<_>>();
            if ips.is_empty() {
                return Err(AppError::webdav("局域网主机名未解析到可用地址"));
            }

            match all_dns_results_allowed(&ips) {
                Ok(()) => {}
                Err(DnsDecisionError::Blocked) => {
                    return Err(AppError::webdav(
                        "主机名解析到链路本地或保留地址，已拒绝连接",
                    ));
                }
                Err(DnsDecisionError::FakeIp) => {
                    return Err(AppError::webdav(FAKE_IP_HOST_MESSAGE));
                }
                Err(DnsDecisionError::Public) => {
                    return Err(AppError::webdav(
                        "公网 HTTP 地址已禁用，请改用 HTTPS。局域网地址可使用 HTTP。",
                    ));
                }
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

    /// 跨模块一致性：三份 IP 判据（本模块 / commands/link_checker.rs /
    /// src/security/networkPolicy.ts）对保留段的认定必须对齐。
    ///
    /// 注意 `is_private_or_reserved_ipv4` 里的 198.18/15 **一字未改**——WebDAV 对
    /// fake-ip 的额外拒绝发生在策略层，不是从共享判据里挖掉一块。挖掉的话
    /// link_checker 的 `literal_ip_gate_still_treats_fake_ip_pool_as_reserved`
    /// 会同时变红，那才是真正打破一致性。策略层的态度归
    /// [`fake_ip_pool_is_not_lan_evidence`] 管。
    #[test]
    fn reserved_ranges_match_frontend_and_link_checker() {
        assert!(validate_external_url("https://240.0.0.1/a").is_err());
        assert!(validate_external_url("https://198.18.1.1/a").is_err());
        assert!(validate_external_url("https://192.0.0.1/a").is_err());

        assert!(validate_webdav_url("https://240.0.0.1/a").is_err());
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

    /// fake-ip 池的边界判据（从 commands/link_checker.rs 搬来）
    ///
    /// 判据现在由两个模块共用，方向相反：链接检测靠它豁免、WebDAV 靠它拒绝。
    /// 边界一旦走样，两边同时出事，所以护栏留在判据所在的模块。
    #[test]
    fn fake_ip_pool_matches_proxy_default_range() {
        for ip in ["198.18.0.0", "198.18.1.172", "198.19.255.255"] {
            assert!(
                is_fake_ip_pool_ip(ip.parse().unwrap()),
                "{} should be inside the fake-ip pool",
                ip
            );
        }
        for ip in ["198.17.255.255", "198.20.0.0", "8.8.8.8", "192.168.1.1"] {
            assert!(
                !is_fake_ip_pool_ip(ip.parse().unwrap()),
                "{} should be outside the fake-ip pool",
                ip
            );
        }
        // v4-mapped 形式不能绕过识别
        assert!(is_fake_ip_pool_ip("::ffff:198.18.1.1".parse().unwrap()));
        assert!(!is_fake_ip_pool_ip("fe80::1".parse().unwrap()));

        // v6 池：mihomo 的 fake-ip-range6 默认 fdfe:dcba:9876::1/64
        for ip in ["fdfe:dcba:9876::1", "fdfe:dcba:9876::126", "fdfe:dcba:9876::ffff"] {
            assert!(
                is_fake_ip_pool_ip(ip.parse().unwrap()),
                "{} should be inside the v6 fake-ip pool",
                ip
            );
        }
        // 相邻但不同的 ULA 前缀是别人家的真实内网，不能顺手多吃
        for ip in [
            "fdfe:dcba:9876:1::1",
            "fdfe:dcba:9875::1",
            "fd00::1",
            "fc00::1",
            "2001:4860:4860::8888",
        ] {
            assert!(
                !is_fake_ip_pool_ip(ip.parse().unwrap()),
                "{} should be outside the v6 fake-ip pool",
                ip
            );
        }
    }

    /// DNS 解析结果的放行判据不能等同于"非公网"
    ///
    /// 这条盯着的正是曾经的缺陷：`is_private_or_reserved_host` 对下面这批地址
    /// 全部返回 true，拿它当放行判据就会把云元数据地址放进来。
    #[test]
    fn lan_addr_gate_rejects_always_blocked_ranges() {
        // 真正的局域网 / 本机目标：必须放行，否则群晖、自建 NAS 全部误伤
        assert!(is_allowed_lan_addr("127.0.0.1"));
        assert!(is_allowed_lan_addr("192.168.1.10"));
        assert!(is_allowed_lan_addr("10.0.0.5"));
        assert!(is_allowed_lan_addr("172.16.3.4"));

        // 以下每一个 is_private_or_reserved_host 都返回 true，但绝不能连
        assert!(!is_allowed_lan_addr("169.254.169.254"));
        assert!(!is_allowed_lan_addr("fe80::1"));
        assert!(!is_allowed_lan_addr("224.0.0.1"));
        assert!(!is_allowed_lan_addr("240.0.0.1"));
        assert!(!is_allowed_lan_addr("0.0.0.0"));

        // 公网地址：明文 HTTP 下凭证会裸奔
        assert!(!is_allowed_lan_addr("8.8.8.8"));
        assert!(!is_allowed_lan_addr("2001:4860:4860::8888"));
    }

    /// fake-ip 池不构成「这是局域网」的证据
    ///
    /// 开了 TUN + fake-ip 的机器上，**任意**域名都会被代理编进 198.18.0.0/15
    /// （实测 `img30.360buyimg.com` → 198.18.1.172、`sm.ms` → 198.18.1.15）。
    /// 旧实现把这个段当局域网放行，于是用户填的公网 `http://dav.example.com`
    /// 也被判成 NAS，明文凭证防线在这类机器上整个失效。
    ///
    /// 与 link_checker 的 `dns_answer_gate_allows_fake_ip_but_blocks_real_private`
    /// 是同一判据的相反用法：那边猜错只是多看一眼图片，这边猜错是密码裸奔。
    #[test]
    fn fake_ip_pool_is_not_lan_evidence() {
        // 实测到的三个 fake-ip 地址
        for ip in ["198.18.1.172", "198.18.1.15", "198.18.1.230"] {
            assert!(
                !is_allowed_lan_addr(ip),
                "{} is a fake-ip answer and proves nothing about the target",
                ip
            );
        }
        // v4-mapped 形式不能绕过
        assert!(!is_allowed_lan_addr("::ffff:198.18.1.1"));

        // v6 fake-ip 同样不算局域网证据：它落在 ULA 里，
        // is_private_or_reserved_host 本会把它当内网放行
        assert!(is_private_or_reserved_host("fdfe:dcba:9876::126"));
        assert!(!is_allowed_lan_addr("fdfe:dcba:9876::126"));
        assert!(validate_webdav_url("http://[fdfe:dcba:9876::126]/dav").is_err());

        // DNS 集合裁决要能把 fake-ip 与「确实是公网」区分开——两者出路不同
        assert_eq!(
            all_dns_results_allowed(&["198.18.1.172".to_string()]),
            Err(DnsDecisionError::FakeIp)
        );
        assert_eq!(
            all_dns_results_allowed(&["192.168.1.10".to_string(), "198.18.1.172".to_string()]),
            Err(DnsDecisionError::FakeIp)
        );

        // 字面量路径同样拒绝（从 reserved_ranges_match_frontend_and_link_checker 挪来，
        // 期望值随策略翻转）：没有人的 NAS 挂在 RFC 2544 基准测试段上
        assert!(validate_webdav_url("http://198.18.1.1/a").is_err());
        assert!(validate_webdav_url("https://198.18.1.1/a").is_err());
    }

    /// 防过修护栏：修 fake-ip 不能顺手把真实局域网一起拒了
    ///
    /// 群晖 / 自建 NAS 是 WebDAV 图床最主要的用户群，这几个段一旦误伤，
    /// 功能对他们等同于不存在。
    #[test]
    fn real_lan_ranges_survive_the_fake_ip_gate() {
        for ip in ["127.0.0.1", "192.168.1.10", "10.0.0.5", "172.16.3.4"] {
            assert!(is_allowed_lan_addr(ip), "{} must stay allowed", ip);
        }

        assert!(validate_webdav_url("http://192.168.1.10:5005/dav").is_ok());
        assert!(validate_webdav_url("http://10.0.0.5/dav").is_ok());
        assert!(validate_webdav_url("http://localhost:5244/dav").is_ok());

        // fake-ip 池的边界外侧是普通公网，不能被判据"顺手"多吃一格
        assert!(!is_fake_ip_pool_host("198.17.255.255"));
        assert!(!is_fake_ip_pool_host("198.20.0.0"));
    }

    /// DNS 结果集合必须整体放行：混进一个公网地址就要拒绝，
    /// 不能因为集合里先出现内网地址就当没看见。
    #[test]
    fn dns_result_set_requires_all_addrs_lan() {
        assert_eq!(
            all_dns_results_allowed(&["192.168.1.10".to_string(), "10.0.0.5".to_string()]),
            Ok(())
        );
        assert_eq!(
            all_dns_results_allowed(&["192.168.1.10".to_string(), "8.8.8.8".to_string()]),
            Err(DnsDecisionError::Public)
        );
        assert_eq!(
            all_dns_results_allowed(&["8.8.8.8".to_string(), "192.168.1.10".to_string()]),
            Err(DnsDecisionError::Public)
        );
        assert_eq!(
            all_dns_results_allowed(&["192.168.1.10".to_string(), "169.254.169.254".to_string()]),
            Err(DnsDecisionError::Blocked)
        );
        assert_eq!(all_dns_results_allowed(&[]), Ok(()));
    }

    /// 请求前校验的非 DNS 分支
    ///
    /// 这些用例全部在 `lookup_host` 之前就返回，所以不出网、结果确定。
    #[tokio::test]
    async fn request_validation_covers_non_dns_branches() {
        // 局域网字面量与回环：放行
        assert!(validate_webdav_url_for_request("http://192.168.1.10:5005/dav")
            .await
            .is_ok());
        assert!(validate_webdav_url_for_request("http://localhost:5244/dav")
            .await
            .is_ok());
        assert!(validate_webdav_url_for_request("https://dav.example.com/dav")
            .await
            .is_ok());

        // 链路本地字面量：任何策略下都拒绝
        assert!(validate_webdav_url_for_request("http://169.254.169.254/latest")
            .await
            .is_err());
        assert!(validate_webdav_url_for_request("http://[fe80::1]/dav")
            .await
            .is_err());

        // 公网 HTTP 字面量：不该退化成"解析不出来就放行"
        assert!(validate_webdav_url_for_request("http://8.8.8.8/dav")
            .await
            .is_err());

        // fake-ip 字面量：在 lookup_host 之前就被拦下，两种 scheme 都拒
        assert!(validate_webdav_url_for_request("http://198.18.1.1/dav")
            .await
            .is_err());
        assert!(validate_webdav_url_for_request("https://198.18.1.1/dav")
            .await
            .is_err());

        // 凭证内嵌与非 HTTP 协议
        assert!(validate_webdav_url_for_request("http://u:p@192.168.1.10/dav")
            .await
            .is_err());
        assert!(validate_webdav_url_for_request("file:///tmp/a").await.is_err());
    }

    // Why DNS 分支本身没有实网单测：解析结果由运行环境说了算，断言不了。
    // 实测过一版拿 `.invalid`（RFC 2606 保留 TLD）当"必然解析失败"的冒烟，
    // 在开了 TUN fake-ip 的机器上直接翻车——fake-ip 把任意主机名都映射进
    // 198.18.0.0/15，于是"解析失败"和"解析到公网"两条预期路径一条都没走到。
    // DNS 循环真正的判据是 `is_allowed_lan_addr`，已由上面那条纯函数测试覆盖。
}
