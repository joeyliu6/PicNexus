// src-tauri/src/error.rs
// 统一应用错误类型
// v2.10: 扩展错误类型覆盖所有服务

use serde::Serialize;

/// 应用统一错误类型
///
/// 前端通过 `type` 字段识别错误类型，进行差异化处理
/// 使用 `#[serde(tag = "type", content = "data")]` 实现结构化序列化
#[derive(Debug, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum AppError {
    /// 网络错误：连接失败、超时等
    #[serde(rename = "NETWORK")]
    Network { message: String },

    /// 认证错误：Cookie 过期、Token 无效等
    #[serde(rename = "AUTH")]
    Auth { message: String },

    /// 文件 IO 错误：读写文件失败等
    #[serde(rename = "FILE_IO")]
    FileIo { message: String },

    /// 上传错误：图床返回错误
    #[serde(rename = "UPLOAD")]
    Upload {
        service: String,
        code: Option<i32>,
        message: String,
    },

    /// 配置错误：配置缺失或无效
    #[serde(rename = "CONFIG")]
    Config { message: String },

    /// 剪贴板错误
    #[serde(rename = "CLIPBOARD")]
    Clipboard { message: String },

    /// 外部服务错误：sidecar 进程、浏览器检测等
    #[serde(rename = "EXTERNAL")]
    External { message: String },

    /// 验证错误：参数验证失败
    #[serde(rename = "VALIDATION")]
    Validation { message: String },

    /// WebDAV 错误
    #[serde(rename = "WEBDAV")]
    WebDAV { message: String },

    /// R2/S3 存储错误
    #[serde(rename = "STORAGE")]
    Storage { message: String },
}

// ==================== From trait 实现 ====================

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            AppError::Network {
                message: "请求超时".to_string(),
            }
        } else if err.is_connect() {
            AppError::Network {
                message: "连接失败".to_string(),
            }
        } else {
            AppError::Network {
                message: err.to_string(),
            }
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::FileIo {
            message: err.to_string(),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Validation {
            message: format!("JSON 解析失败: {}", err),
        }
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        AppError::Network { message }
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        AppError::Network {
            message: message.to_string(),
        }
    }
}

// ==================== Display trait 实现 ====================

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network { message } => write!(f, "网络错误: {}", message),
            Self::Auth { message } => write!(f, "认证错误: {}", message),
            Self::FileIo { message } => write!(f, "文件错误: {}", message),
            Self::Upload {
                service, message, ..
            } => write!(f, "{} 上传错误: {}", service, message),
            Self::Config { message } => write!(f, "配置错误: {}", message),
            Self::Clipboard { message } => write!(f, "剪贴板错误: {}", message),
            Self::External { message } => write!(f, "外部服务错误: {}", message),
            Self::Validation { message } => write!(f, "验证错误: {}", message),
            Self::WebDAV { message } => write!(f, "WebDAV 错误: {}", message),
            Self::Storage { message } => write!(f, "存储错误: {}", message),
        }
    }
}

impl std::error::Error for AppError {}

// ==================== 便捷构造方法 ====================

impl AppError {
    /// 创建网络错误
    pub fn network(message: impl Into<String>) -> Self {
        AppError::Network {
            message: message.into(),
        }
    }

    /// 创建认证错误
    pub fn auth(message: impl Into<String>) -> Self {
        AppError::Auth {
            message: message.into(),
        }
    }

    /// 创建文件 IO 错误
    pub fn file_io(message: impl Into<String>) -> Self {
        AppError::FileIo {
            message: message.into(),
        }
    }

    /// 创建上传错误
    pub fn upload(service: impl Into<String>, message: impl Into<String>) -> Self {
        AppError::Upload {
            service: service.into(),
            code: None,
            message: message.into(),
        }
    }

    /// 创建带错误码的上传错误
    pub fn upload_with_code(
        service: impl Into<String>,
        code: i32,
        message: impl Into<String>,
    ) -> Self {
        AppError::Upload {
            service: service.into(),
            code: Some(code),
            message: message.into(),
        }
    }

    /// 创建配置错误
    pub fn config(message: impl Into<String>) -> Self {
        AppError::Config {
            message: message.into(),
        }
    }

    /// 创建剪贴板错误
    pub fn clipboard(message: impl Into<String>) -> Self {
        AppError::Clipboard {
            message: message.into(),
        }
    }

    /// 创建外部服务错误
    pub fn external(message: impl Into<String>) -> Self {
        AppError::External {
            message: message.into(),
        }
    }

    /// 创建验证错误
    pub fn validation(message: impl Into<String>) -> Self {
        AppError::Validation {
            message: message.into(),
        }
    }

    /// 创建 WebDAV 错误
    pub fn webdav(message: impl Into<String>) -> Self {
        AppError::WebDAV {
            message: message.into(),
        }
    }

    /// 创建存储错误
    pub fn storage(message: impl Into<String>) -> Self {
        AppError::Storage {
            message: message.into(),
        }
    }
}

// ==================== Result 扩展 trait ====================

/// 为 Result<T, E> 提供错误消息转换的便捷方法
#[allow(dead_code)]
pub trait IntoAppError<T> {
    /// 将错误转换为网络错误
    fn into_network_err(self) -> Result<T, AppError>;

    /// 将错误转换为文件 IO 错误
    fn into_file_io_err(self) -> Result<T, AppError>;

    /// 将错误转换为配置错误
    fn into_config_err(self) -> Result<T, AppError>;

    /// 将错误转换为外部服务错误
    fn into_external_err(self) -> Result<T, AppError>;

    /// 将错误转换为存储错误
    fn into_storage_err(self) -> Result<T, AppError>;

    /// 将错误转换为 WebDAV 错误
    fn into_webdav_err(self) -> Result<T, AppError>;

    /// 将错误转换为文件 IO 错误（带自定义前缀）
    fn into_file_io_err_with(self, prefix: &str) -> Result<T, AppError>;

    /// 将错误转换为网络错误（带自定义前缀）
    fn into_network_err_with(self, prefix: &str) -> Result<T, AppError>;

    /// 将错误转换为外部服务错误（带自定义前缀）
    fn into_external_err_with(self, prefix: &str) -> Result<T, AppError>;

    /// 将错误转换为存储错误（带自定义前缀）
    fn into_storage_err_with(self, prefix: &str) -> Result<T, AppError>;

    /// 将错误转换为验证错误（带自定义前缀）
    fn into_validation_err_with(self, prefix: &str) -> Result<T, AppError>;
}

impl<T, E: std::fmt::Display> IntoAppError<T> for Result<T, E> {
    fn into_network_err(self) -> Result<T, AppError> {
        self.map_err(|e| AppError::network(e.to_string()))
    }

    fn into_file_io_err(self) -> Result<T, AppError> {
        self.map_err(|e| AppError::file_io(e.to_string()))
    }

    fn into_config_err(self) -> Result<T, AppError> {
        self.map_err(|e| AppError::config(e.to_string()))
    }

    fn into_external_err(self) -> Result<T, AppError> {
        self.map_err(|e| AppError::external(e.to_string()))
    }

    fn into_storage_err(self) -> Result<T, AppError> {
        self.map_err(|e| AppError::storage(e.to_string()))
    }

    fn into_webdav_err(self) -> Result<T, AppError> {
        self.map_err(|e| AppError::webdav(e.to_string()))
    }

    fn into_file_io_err_with(self, prefix: &str) -> Result<T, AppError> {
        self.map_err(|e| AppError::file_io(format!("{}: {}", prefix, e)))
    }

    fn into_network_err_with(self, prefix: &str) -> Result<T, AppError> {
        self.map_err(|e| AppError::network(format!("{}: {}", prefix, e)))
    }

    fn into_external_err_with(self, prefix: &str) -> Result<T, AppError> {
        self.map_err(|e| AppError::external(format!("{}: {}", prefix, e)))
    }

    fn into_storage_err_with(self, prefix: &str) -> Result<T, AppError> {
        self.map_err(|e| AppError::storage(format!("{}: {}", prefix, e)))
    }

    fn into_validation_err_with(self, prefix: &str) -> Result<T, AppError> {
        self.map_err(|e| AppError::validation(format!("{}: {}", prefix, e)))
    }
}

// ==================== 单元测试 ====================

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- 构造方法 ----------

    #[test]
    fn network_constructor_sets_message() {
        let err = AppError::network("连接超时");
        match err {
            AppError::Network { message } => assert_eq!(message, "连接超时"),
            _ => panic!("应为 Network 变体"),
        }
    }

    #[test]
    fn auth_constructor_sets_message() {
        match AppError::auth("Cookie 过期") {
            AppError::Auth { message } => assert_eq!(message, "Cookie 过期"),
            _ => panic!("应为 Auth 变体"),
        }
    }

    #[test]
    fn file_io_constructor_sets_message() {
        match AppError::file_io("权限不足") {
            AppError::FileIo { message } => assert_eq!(message, "权限不足"),
            _ => panic!("应为 FileIo 变体"),
        }
    }

    #[test]
    fn upload_constructor_has_no_code() {
        match AppError::upload("weibo", "上传失败") {
            AppError::Upload {
                service,
                code,
                message,
            } => {
                assert_eq!(service, "weibo");
                assert!(code.is_none());
                assert_eq!(message, "上传失败");
            }
            _ => panic!("应为 Upload 变体"),
        }
    }

    #[test]
    fn upload_with_code_carries_code() {
        match AppError::upload_with_code("jd", 403, "禁止访问") {
            AppError::Upload {
                service,
                code,
                message,
            } => {
                assert_eq!(service, "jd");
                assert_eq!(code, Some(403));
                assert_eq!(message, "禁止访问");
            }
            _ => panic!("应为 Upload 变体"),
        }
    }

    #[test]
    fn config_constructor_sets_message() {
        match AppError::config("缺失 token") {
            AppError::Config { message } => assert_eq!(message, "缺失 token"),
            _ => panic!("应为 Config 变体"),
        }
    }

    #[test]
    fn clipboard_constructor_sets_message() {
        match AppError::clipboard("无法访问剪贴板") {
            AppError::Clipboard { message } => assert_eq!(message, "无法访问剪贴板"),
            _ => panic!("应为 Clipboard 变体"),
        }
    }

    #[test]
    fn external_constructor_sets_message() {
        match AppError::external("sidecar 未启动") {
            AppError::External { message } => assert_eq!(message, "sidecar 未启动"),
            _ => panic!("应为 External 变体"),
        }
    }

    #[test]
    fn validation_constructor_sets_message() {
        match AppError::validation("参数为空") {
            AppError::Validation { message } => assert_eq!(message, "参数为空"),
            _ => panic!("应为 Validation 变体"),
        }
    }

    #[test]
    fn webdav_constructor_sets_message() {
        match AppError::webdav("PROPFIND 失败") {
            AppError::WebDAV { message } => assert_eq!(message, "PROPFIND 失败"),
            _ => panic!("应为 WebDAV 变体"),
        }
    }

    #[test]
    fn storage_constructor_sets_message() {
        match AppError::storage("桶不存在") {
            AppError::Storage { message } => assert_eq!(message, "桶不存在"),
            _ => panic!("应为 Storage 变体"),
        }
    }

    // ---------- Into<String> / Into<&str> 传入 ----------

    #[test]
    fn constructors_accept_string_and_str() {
        let owned = String::from("owned");
        let err1 = AppError::network(owned);
        let err2 = AppError::network("borrowed");
        // 两种输入都能正确构造
        assert!(matches!(err1, AppError::Network { .. }));
        assert!(matches!(err2, AppError::Network { .. }));
    }

    // ---------- From trait ----------

    #[test]
    fn from_io_error_maps_to_file_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err: AppError = io_err.into();
        match app_err {
            AppError::FileIo { message } => assert!(message.contains("file missing")),
            _ => panic!("io::Error 应映射到 FileIo"),
        }
    }

    #[test]
    fn from_serde_error_maps_to_validation() {
        let bad: Result<serde_json::Value, _> = serde_json::from_str("not json");
        let serde_err = bad.unwrap_err();
        let app_err: AppError = serde_err.into();
        match app_err {
            AppError::Validation { message } => {
                assert!(message.contains("JSON 解析失败"));
            }
            _ => panic!("serde_json::Error 应映射到 Validation"),
        }
    }

    #[test]
    fn from_string_maps_to_network() {
        let app_err: AppError = String::from("断网了").into();
        match app_err {
            AppError::Network { message } => assert_eq!(message, "断网了"),
            _ => panic!("String 应映射到 Network"),
        }
    }

    #[test]
    fn from_str_maps_to_network() {
        let app_err: AppError = "静态字面量".into();
        match app_err {
            AppError::Network { message } => assert_eq!(message, "静态字面量"),
            _ => panic!("&str 应映射到 Network"),
        }
    }

    // ---------- Display ----------

    #[test]
    fn display_includes_kind_prefix_for_each_variant() {
        let cases: Vec<(AppError, &str)> = vec![
            (AppError::network("x"), "网络错误"),
            (AppError::auth("x"), "认证错误"),
            (AppError::file_io("x"), "文件错误"),
            (AppError::config("x"), "配置错误"),
            (AppError::clipboard("x"), "剪贴板错误"),
            (AppError::external("x"), "外部服务错误"),
            (AppError::validation("x"), "验证错误"),
            (AppError::webdav("x"), "WebDAV 错误"),
            (AppError::storage("x"), "存储错误"),
        ];
        for (err, prefix) in cases {
            let s = format!("{}", err);
            assert!(
                s.starts_with(prefix),
                "{} 应以 {:?} 开头，实际: {}",
                s,
                prefix,
                s
            );
        }
    }

    #[test]
    fn display_upload_contains_service_name() {
        let err = AppError::upload("weibo", "500");
        let s = format!("{}", err);
        assert!(s.contains("weibo"));
        assert!(s.contains("500"));
    }

    // ---------- Serde 序列化（前端依赖的 tag/content 格式） ----------

    #[test]
    fn serde_uses_type_and_data_fields() {
        let err = AppError::network("timeout");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["type"], "NETWORK");
        assert_eq!(json["data"]["message"], "timeout");
    }

    #[test]
    fn serde_emits_renamed_tags_for_all_variants() {
        let cases: Vec<(AppError, &str)> = vec![
            (AppError::network("x"), "NETWORK"),
            (AppError::auth("x"), "AUTH"),
            (AppError::file_io("x"), "FILE_IO"),
            (AppError::config("x"), "CONFIG"),
            (AppError::clipboard("x"), "CLIPBOARD"),
            (AppError::external("x"), "EXTERNAL"),
            (AppError::validation("x"), "VALIDATION"),
            (AppError::webdav("x"), "WEBDAV"),
            (AppError::storage("x"), "STORAGE"),
            (AppError::upload("s", "m"), "UPLOAD"),
        ];
        for (err, tag) in cases {
            let json = serde_json::to_value(&err).unwrap();
            assert_eq!(json["type"], tag, "变体 tag 不一致: {:?}", json);
        }
    }

    #[test]
    fn serde_upload_preserves_service_code_and_message() {
        let err = AppError::upload_with_code("jd", 418, "teapot");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["type"], "UPLOAD");
        assert_eq!(json["data"]["service"], "jd");
        assert_eq!(json["data"]["code"], 418);
        assert_eq!(json["data"]["message"], "teapot");
    }

    #[test]
    fn serde_upload_without_code_emits_null() {
        let err = AppError::upload("jd", "msg");
        let json = serde_json::to_value(&err).unwrap();
        assert!(json["data"]["code"].is_null());
    }

    // ---------- IntoAppError 扩展 trait ----------

    fn err<T>() -> Result<T, &'static str> {
        Err("底层错误")
    }

    #[test]
    fn into_network_err_wraps_display() {
        let r: Result<(), AppError> = err().into_network_err();
        match r.unwrap_err() {
            AppError::Network { message } => assert_eq!(message, "底层错误"),
            _ => panic!("应为 Network"),
        }
    }

    #[test]
    fn into_file_io_err_wraps_display() {
        let r: Result<(), AppError> = err().into_file_io_err();
        assert!(matches!(r.unwrap_err(), AppError::FileIo { .. }));
    }

    #[test]
    fn into_config_err_wraps_display() {
        let r: Result<(), AppError> = err().into_config_err();
        assert!(matches!(r.unwrap_err(), AppError::Config { .. }));
    }

    #[test]
    fn into_external_err_wraps_display() {
        let r: Result<(), AppError> = err().into_external_err();
        assert!(matches!(r.unwrap_err(), AppError::External { .. }));
    }

    #[test]
    fn into_storage_err_wraps_display() {
        let r: Result<(), AppError> = err().into_storage_err();
        assert!(matches!(r.unwrap_err(), AppError::Storage { .. }));
    }

    #[test]
    fn into_webdav_err_wraps_display() {
        let r: Result<(), AppError> = err().into_webdav_err();
        assert!(matches!(r.unwrap_err(), AppError::WebDAV { .. }));
    }

    #[test]
    fn into_file_io_err_with_prepends_prefix() {
        let r: Result<(), AppError> = err().into_file_io_err_with("读取配置");
        match r.unwrap_err() {
            AppError::FileIo { message } => {
                assert!(message.starts_with("读取配置: "));
                assert!(message.ends_with("底层错误"));
            }
            _ => panic!("应为 FileIo"),
        }
    }

    #[test]
    fn into_network_err_with_prepends_prefix() {
        let r: Result<(), AppError> = err().into_network_err_with("调用 API");
        match r.unwrap_err() {
            AppError::Network { message } => assert!(message.starts_with("调用 API: ")),
            _ => panic!("应为 Network"),
        }
    }

    #[test]
    fn into_external_err_with_prepends_prefix() {
        let r: Result<(), AppError> = err().into_external_err_with("启动 sidecar");
        match r.unwrap_err() {
            AppError::External { message } => assert!(message.starts_with("启动 sidecar: ")),
            _ => panic!("应为 External"),
        }
    }

    #[test]
    fn into_storage_err_with_prepends_prefix() {
        let r: Result<(), AppError> = err().into_storage_err_with("上传到 R2");
        match r.unwrap_err() {
            AppError::Storage { message } => assert!(message.starts_with("上传到 R2: ")),
            _ => panic!("应为 Storage"),
        }
    }

    #[test]
    fn into_validation_err_with_prepends_prefix() {
        let r: Result<(), AppError> = err().into_validation_err_with("参数校验");
        match r.unwrap_err() {
            AppError::Validation { message } => assert!(message.starts_with("参数校验: ")),
            _ => panic!("应为 Validation"),
        }
    }

    #[test]
    fn ok_passes_through_unchanged() {
        let r: Result<i32, AppError> = Ok::<i32, &str>(42).into_network_err();
        assert_eq!(r.unwrap(), 42);
    }
}
