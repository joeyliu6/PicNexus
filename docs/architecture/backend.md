# 后端架构

> Rust/Tauri 后端命令和服务架构详解

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Rust | 1.70+ | 后端语言 |
| Tauri | 2.x | 桌面框架 |
| reqwest | - | HTTP 客户端 |
| tokio | - | 异步运行时 |
| rusqlite | - | SQLite 绑定 |
| aws-sdk-s3 | - | S3 兼容存储 |

---

## 目录结构

```
src-tauri/
├── src/
│   ├── main.rs              # Tauri 入口，命令注册
│   ├── lib.rs               # 库入口
│   ├── error.rs             # 统一错误处理
│   └── commands/            # Tauri 命令模块
│       ├── mod.rs           # 模块导出
│       ├── upload.rs        # 微博上传
│       ├── zhihu.rs         # 知乎上传
│       ├── nowcoder.rs      # 牛客上传
│       ├── bilibili.rs      # B站上传
│       ├── nami.rs          # 纳米上传
│       ├── qiyu.rs          # 七鱼上传
│       ├── smms.rs          # SM.MS 上传
│       ├── github.rs        # GitHub 上传
│       ├── s3_compatible.rs # S3 兼容存储
│       ├── clipboard.rs     # 剪贴板操作
│       ├── link_checker.rs  # 链接检测
│       ├── image_meta.rs    # 图片元数据
│       └── nami_token.rs    # 纳米 Token 获取
│
├── icons/                    # 应用图标
├── sidecar/                  # 辅助程序
├── Cargo.toml               # Rust 依赖
└── tauri.conf.json          # Tauri 配置
```

---

## 命令模块

### 上传命令

每个图床服务对应一个上传命令：

| 命令 | 文件 | 参数 | 返回值 |
|------|------|------|--------|
| `upload_file_stream` | `upload.rs` | `id, file_path, weibo_cookie` | `UploadResponse` |
| `upload_to_zhihu` | `zhihu.rs` | `id, file_path, zhihu_cookie` | `ZhihuUploadResult` |
| `upload_to_nowcoder` | `nowcoder.rs` | `id, file_path, nowcoder_cookie` | `NowcoderUploadResult` |
| `upload_to_bilibili` | `bilibili.rs` | `id, file_path, bilibili_cookie` | `BilibiliUploadResult` |
| `upload_to_nami` | `nami.rs` | `id, file_path, cookie, auth_token` | `NamiUploadResult` |
| `upload_to_qiyu` | `qiyu.rs` | `id, file_path` | `QiyuUploadResult` |
| `upload_to_smms` | `smms.rs` | `id, file_path, smms_token` | `SmmsUploadResult` |
| `upload_to_github` | `github.rs` | `id, file_path, token, owner, repo, branch, path` | `GithubUploadResult` |
| `upload_to_s3_compatible` | `s3_compatible.rs` | `id, file_path, endpoint, access_key, secret_key, ...` | `S3UploadResult` |

### 连接测试命令

| 命令 | 用途 |
|------|------|
| `test_weibo_connection` | 测试微博 Cookie 有效性 |
| `test_zhihu_connection` | 测试知乎 Cookie 有效性 |
| `test_nowcoder_connection` | 测试牛客 Cookie 有效性 |
| `test_bilibili_connection` | 测试 B站 Cookie 有效性 |
| `test_nami_connection` | 测试纳米认证有效性 |

### 工具命令

| 命令 | 文件 | 用途 |
|------|------|------|
| `clipboard_has_image` | `clipboard.rs` | 检测剪贴板是否有图片 |
| `read_clipboard_image` | `clipboard.rs` | 读取剪贴板图片到临时文件 |
| `check_image_link` | `link_checker.rs` | 检测图片链接有效性 |
| `download_image_from_url` | `link_checker.rs` | 下载远程图片 |
| `get_image_metadata` | `image_meta.rs` | 获取图片元数据（宽高、格式等） |
| `read_file_bytes` | `utils.rs` | 读取文件字节 |

### S3 管理命令

| 命令 | 用途 |
|------|------|
| `list_s3_objects` | 列出 S3 存储桶中的对象 |
| `delete_s3_object` | 删除单个对象 |
| `delete_s3_objects` | 批量删除对象 |

---

## 命令实现模式

### 标准上传命令结构

```rust
#[tauri::command]
pub async fn upload_to_service(
    window: Window,           // 用于发送进度事件
    id: String,               // 上传任务 ID
    file_path: String,        // 文件路径
    // ... 服务特定参数
) -> Result<ServiceUploadResult, AppError> {
    // 1. 验证参数
    if file_path.is_empty() {
        return Err(AppError::InvalidInput("文件路径不能为空".into()));
    }

    // 2. 读取文件
    let file_data = std::fs::read(&file_path)?;

    // 3. 发送进度事件
    window.emit(&format!("upload-progress-{}", id), ProgressPayload {
        progress: 50,
        status: "uploading".into(),
    })?;

    // 4. 执行上传
    let result = do_upload(&file_data).await?;

    // 5. 返回结果
    Ok(ServiceUploadResult {
        url: result.url,
        // ...
    })
}
```

### 进度事件

上传命令通过 Tauri 事件系统报告进度：

```rust
// Rust 发送
window.emit(&format!("upload-progress-{}", id), payload)?;

// TypeScript 监听
await listen<ProgressEvent>(`upload-progress-${id}`, (event) => {
  updateProgress(event.payload.progress);
});
```

---

## 错误处理

### AppError 枚举

统一的错误类型定义在 `error.rs`：

```rust
#[derive(Debug, thiserror::Error, Serialize)]
pub enum AppError {
    #[error("网络错误: {0}")]
    Network(String),

    #[error("认证失败: {0}")]
    Auth(String),

    #[error("文件错误: {0}")]
    File(String),

    #[error("无效输入: {0}")]
    InvalidInput(String),

    #[error("服务错误: {0}")]
    Service(String),

    #[error("未知错误: {0}")]
    Unknown(String),
}
```

### 错误转换

自动从标准错误类型转换：

```rust
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::File(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Network(err.to_string())
    }
}
```

### 前端错误处理

```typescript
try {
  const result = await invoke('upload_to_service', params);
} catch (error) {
  // error 是序列化的 AppError
  const appError = error as AppError;
  showToast(appError.message, 'error');
}
```

---

## HTTP 客户端

### 共享客户端

使用 Tauri State 共享 HTTP 客户端：

```rust
// main.rs
pub struct HttpClient(pub reqwest::Client);

fn main() {
    tauri::Builder::default()
        .manage(HttpClient(
            reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .unwrap()
        ))
        .invoke_handler(...)
        .run(...)
}

// 命令中使用
#[tauri::command]
pub async fn some_command(
    http_client: tauri::State<'_, HttpClient>,
) -> Result<..., AppError> {
    let response = http_client.0.get(url).send().await?;
    // ...
}
```

### 请求配置

常用请求配置模式：

```rust
let response = client
    .post(url)
    .header("Cookie", cookie)
    .header("User-Agent", "Mozilla/5.0 ...")
    .multipart(form)
    .timeout(Duration::from_secs(60))
    .send()
    .await?;
```

---

## Sidecar 辅助程序

某些功能需要使用 Chrome 自动化，通过 sidecar 实现：

```
sidecar/
├── nami-token.js     # 获取纳米动态 Token
└── qiyu-token.js     # 获取七鱼上传 Token
```

### 调用方式

```rust
use tauri::api::process::Command;

let output = Command::new_sidecar("nami-token")
    .expect("failed to create sidecar command")
    .args([&cookie, &auth_token])
    .output()
    .expect("failed to run sidecar");

let result: NamiToken = serde_json::from_str(&output.stdout)?;
```

---

## 安全考虑

### Cookie 处理

- Cookie 仅在内存中处理，不写入日志
- 通过加密 Store 持久化
- 不在错误信息中暴露敏感数据

### 文件访问

- 限制文件读取范围
- 临时文件自动清理
- 文件大小限制

```rust
const MAX_FILE_SIZE: u64 = 20 * 1024 * 1024; // 20MB

let metadata = std::fs::metadata(&file_path)?;
if metadata.len() > MAX_FILE_SIZE {
    return Err(AppError::InvalidInput("文件过大".into()));
}
```

---

## 添加新命令

### 步骤

1. 在 `commands/` 下创建新模块文件
2. 实现 `#[tauri::command]` 函数
3. 在 `commands/mod.rs` 中导出
4. 在 `main.rs` 的 `invoke_handler` 中注册

### 示例

```rust
// commands/my_service.rs
use crate::error::AppError;

#[derive(serde::Serialize)]
pub struct MyServiceResult {
    pub url: String,
}

#[tauri::command]
pub async fn upload_to_my_service(
    window: tauri::Window,
    id: String,
    file_path: String,
    api_key: String,
) -> Result<MyServiceResult, AppError> {
    // 实现上传逻辑
    Ok(MyServiceResult { url: "...".into() })
}
```

```rust
// main.rs
.invoke_handler(tauri::generate_handler![
    // ...existing commands...
    commands::my_service::upload_to_my_service,
])
```

---

## 相关文档

- [架构总览](./overview.md)
- [Rust 命令参考](../api/rust-commands.md)
- [添加新图床指南](../guides/add-new-uploader.md)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本 |
