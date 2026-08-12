use regex::Regex;
use std::sync::LazyLock;
use url::Url;

const MAX_PREVIEW_CHARS: usize = 160;

pub fn safe_path(path: &str) -> String {
    let basename = basename_from_any_platform_path(path).unwrap_or("path");
    format!("[path:{}#{}]", basename, short_hash(path))
}

pub fn safe_url(raw_url: &str) -> String {
    match Url::parse(raw_url) {
        Ok(parsed) => {
            let origin = parsed.origin().ascii_serialization();
            format!("{}{}#url:{}", origin, parsed.path(), short_hash(raw_url))
        }
        Err(_) => format!("[url#{}]", short_hash(raw_url)),
    }
}

pub fn summarize_text(text: &str) -> String {
    let sanitized = sanitize_text(text);
    format!(
        "len={}, hash={}, preview={}",
        text.len(),
        short_hash(text),
        truncate_chars(&sanitized, MAX_PREVIEW_CHARS)
    )
}

/// 日志脱敏：抹掉凭证、把 URL 与文件路径换成不可还原的摘要
///
/// Why 每一步都保持 `Cow` 而不是 `.to_string()`：这里是 sidecar 逐行日志的热路径
/// （`commands/nami_token.rs`、`commands/qiyu_token.rs` 对每一行输出都调一次），
/// 绝大多数行一个正则都命不中。`replace_all` 无匹配时返回 `Cow::Borrowed`，
/// 链式借用下来最后只在结尾分配一次；旧写法每步无条件 `to_string`，
/// 一行日志固定付 6 次分配。
pub fn sanitize_text(text: &str) -> String {
    let with_redacted_auth_headers =
        AUTHORIZATION_HEADER_RE.replace_all(text, |captures: &regex::Captures<'_>| {
            format!("{}=[REDACTED]", &captures[1])
        });

    let with_redacted_headers = COOKIE_HEADER_RE.replace_all(
        &with_redacted_auth_headers,
        |captures: &regex::Captures<'_>| format!("{}=[REDACTED]", &captures[1]),
    );

    let with_redacted_assignments = SENSITIVE_ASSIGNMENT_RE.replace_all(
        &with_redacted_headers,
        |captures: &regex::Captures<'_>| format!("{}=[REDACTED]", &captures[1]),
    );

    let with_safe_urls = URL_RE.replace_all(
        &with_redacted_assignments,
        |captures: &regex::Captures<'_>| safe_url(&captures[0]),
    );

    let with_safe_windows_paths =
        WINDOWS_PATH_RE.replace_all(&with_safe_urls, |captures: &regex::Captures<'_>| {
            safe_path(&captures[0])
        });

    UNIX_PATH_RE
        .replace_all(
            &with_safe_windows_paths,
            |captures: &regex::Captures<'_>| format!("{}{}", &captures[1], safe_path(&captures[2])),
        )
        .into_owned()
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let prefix = value.chars().take(max_chars).collect::<String>();
    format!("{}...<truncated:{}>", prefix, value.len())
}

fn short_hash(value: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in value.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{:08x}", hash)
}

fn basename_from_any_platform_path(path: &str) -> Option<&str> {
    path.split(['/', '\\']).rev().find(|part| !part.is_empty())
}

// 正则一次编译、全程复用（范式同 commands/md_scanner.rs）。
// 旧写法是 6 个工厂函数，`sanitize_text` 每调用一次就重新编译 6 个正则——
// 而它被 sidecar 的每一行日志调用。正则编译比匹配本身贵好几个数量级。

static SENSITIVE_ASSIGNMENT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)["']?\b(cookie|token|auth|password|secret|credential|session|authorization|apiKey|accessKey|secretKey|privateKey)\b["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^;,\s}\]]+)"#,
    )
    .expect("valid sensitive assignment regex")
});

static AUTHORIZATION_HEADER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\b(authorization)\b\s*[:=]\s*("[^"]*"|'[^']*'|(?:Bearer|Basic|token|Client-ID)\s+[A-Za-z0-9._~+/=-]+|[^;,\s}\]]+)"#,
    )
    .expect("valid authorization header regex")
});

static COOKIE_HEADER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\b(cookie)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^,\r\n}\]]+)"#)
        .expect("valid cookie header regex")
});

static URL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"https?://[^\s"'<>]+"#).expect("valid URL regex"));

static WINDOWS_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\b[A-Za-z]:[\\/][^\s"'<>|]+"#).expect("valid Windows path regex"));

static UNIX_PATH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(^|[\s"'`=({,])(/(?:Users|home|tmp|var|private|Volumes)[^\s"'<>)]*)"#)
        .expect("valid Unix path regex")
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_url_removes_query_and_fragment() {
        let result = safe_url("https://example.com/a.png?token=secret#private");

        assert!(result.starts_with("https://example.com/a.png#url:"));
        assert!(!result.contains("token=secret"));
        assert!(!result.contains("#private"));
    }

    #[test]
    fn safe_url_removes_basic_auth_credentials() {
        let result = safe_url("https://alice:secret@example.com/a.png?token=secret");

        assert!(result.starts_with("https://example.com/a.png#url:"));
        assert!(!result.contains("alice"));
        assert!(!result.contains("secret"));
    }

    #[test]
    fn safe_path_keeps_only_basename() {
        let result = safe_path(r"C:\Users\alice\Pictures\secret.png");

        assert!(result.contains("secret.png#"));
        assert!(!result.contains("Users"));
        assert!(!result.contains("Pictures"));
    }

    #[test]
    fn safe_path_handles_unix_paths() {
        let result = safe_path("/Users/alice/Pictures/secret.png");

        assert!(result.contains("secret.png#"));
        assert!(!result.contains("Users"));
        assert!(!result.contains("Pictures"));
    }

    #[test]
    fn summarize_text_does_not_include_raw_sidecar_payload() {
        let raw = r#"{"success":true,"data":{"token":"UPLOAD super-secret","cookie":"SUB=abc"}}"#;
        let result = summarize_text(raw);

        assert!(result.contains("len="));
        assert!(result.contains("hash="));
        assert!(!result.contains("super-secret"));
        assert!(!result.contains("SUB=abc"));
    }

    #[test]
    fn sanitize_text_redacts_auth_and_cookie_headers() {
        let raw = "Authorization: Bearer secret-token Cookie: SUB=abc; uid=42";
        let result = sanitize_text(raw);

        assert!(result.contains("Authorization=[REDACTED]"));
        assert!(result.contains("Cookie=[REDACTED]"));
        assert!(!result.contains("secret-token"));
        assert!(!result.contains("SUB=abc"));
    }
}
