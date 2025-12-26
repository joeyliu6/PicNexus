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

    /// 服务不可用：图床服务暂时不可用
    #[serde(rename = "SERVICE_UNAVAILABLE")]
    ServiceUnavailable { service: String, message: String },

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
            Self::ServiceUnavailable { service, message } => {
                write!(f, "{} 不可用: {}", service, message)
            }
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

    /// 创建服务不可用错误
    pub fn service_unavailable(service: impl Into<String>, message: impl Into<String>) -> Self {
        AppError::ServiceUnavailable {
            service: service.into(),
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

/// 为 Result<T, String> 提供转换为 Result<T, AppError> 的便捷方法
pub trait ResultExt<T> {
    /// 将 Result<T, String> 转换为 Result<T, AppError>
    fn map_app_err<F>(self, f: F) -> Result<T, AppError>
    where
        F: FnOnce(String) -> AppError;
}

impl<T> ResultExt<T> for Result<T, String> {
    fn map_app_err<F>(self, f: F) -> Result<T, AppError>
    where
        F: FnOnce(String) -> AppError,
    {
        self.map_err(f)
    }
}

/// 为 Result<T, E> 提供错误消息转换的便捷方法
pub trait IntoAppError<T> {
    /// 将错误转换为网络错误
    fn into_network_err(self) -> Result<T, AppError>;

    /// 将错误转换为文件 IO 错误
    fn into_file_io_err(self) -> Result<T, AppError>;

    /// 将错误转换为配置错误
    fn into_config_err(self) -> Result<T, AppError>;
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
}
