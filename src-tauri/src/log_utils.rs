use regex::Regex;
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

pub fn sanitize_text(text: &str) -> String {
    let with_redacted_auth_headers = authorization_header_regex()
        .replace_all(text, |captures: &regex::Captures<'_>| {
            format!("{}=[REDACTED]", &captures[1])
        })
        .to_string();
    let with_redacted_headers = cookie_header_regex()
        .replace_all(
            &with_redacted_auth_headers,
            |captures: &regex::Captures<'_>| format!("{}=[REDACTED]", &captures[1]),
        )
        .to_string();

    let with_redacted_assignments = sensitive_assignment_regex()
        .replace_all(&with_redacted_headers, |captures: &regex::Captures<'_>| {
            format!("{}=[REDACTED]", &captures[1])
        })
        .to_string();

    let with_safe_urls = url_regex()
        .replace_all(
            &with_redacted_assignments,
            |captures: &regex::Captures<'_>| safe_url(&captures[0]),
        )
        .to_string();

    let with_safe_windows_paths = windows_path_regex()
        .replace_all(&with_safe_urls, |captures: &regex::Captures<'_>| {
            safe_path(&captures[0])
        })
        .to_string();

    unix_path_regex()
        .replace_all(
            &with_safe_windows_paths,
            |captures: &regex::Captures<'_>| format!("{}{}", &captures[1], safe_path(&captures[2])),
        )
        .to_string()
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

fn sensitive_assignment_regex() -> Regex {
    Regex::new(
        r#"(?i)["']?\b(cookie|token|auth|password|secret|credential|session|authorization|apiKey|accessKey|secretKey|privateKey)\b["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^;,\s}\]]+)"#,
    )
    .expect("valid sensitive assignment regex")
}

fn authorization_header_regex() -> Regex {
    Regex::new(
        r#"(?i)\b(authorization)\b\s*[:=]\s*("[^"]*"|'[^']*'|(?:Bearer|Basic|token|Client-ID)\s+[A-Za-z0-9._~+/=-]+|[^;,\s}\]]+)"#,
    )
    .expect("valid authorization header regex")
}

fn cookie_header_regex() -> Regex {
    Regex::new(r#"(?i)\b(cookie)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^,\r\n}\]]+)"#)
        .expect("valid cookie header regex")
}

fn url_regex() -> Regex {
    Regex::new(r#"https?://[^\s"'<>]+"#).expect("valid URL regex")
}

fn windows_path_regex() -> Regex {
    Regex::new(r#"\b[A-Za-z]:[\\/][^\s"'<>|]+"#).expect("valid Windows path regex")
}

fn unix_path_regex() -> Regex {
    Regex::new(r#"(^|[\s"'`=({,])(/(?:Users|home|tmp|var|private|Volumes)[^\s"'<>)]*)"#)
        .expect("valid Unix path regex")
}

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
