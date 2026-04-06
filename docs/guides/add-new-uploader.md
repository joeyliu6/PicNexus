# 添加新图床指南

> 从零实现新图床支持的完整步骤

---

## 概览

添加新图床需要以下步骤：

1. **实现 Rust 上传命令**（后端）
2. **创建 TypeScript 上传器**（前端）
3. **注册上传器**
4. **添加配置类型**
5. **更新设置界面**
6. **测试验证**

预计耗时：2-4 小时（根据图床 API 复杂度）

---

## 步骤 1: 实现 Rust 上传命令

### 1.1 创建命令文件

在 `src-tauri/src/commands/` 下创建新文件：

```rust
// src-tauri/src/commands/myservice.rs

use crate::error::AppError;
use serde::Serialize;
use tauri::Window;

#[derive(Serialize)]
pub struct MyServiceUploadResult {
    pub url: String,
    pub delete_url: Option<String>,
}

#[tauri::command]
pub async fn upload_to_myservice(
    window: Window,
    id: String,
    file_path: String,
    api_key: String,  // 根据服务需要的认证参数
) -> Result<MyServiceUploadResult, AppError> {
    // 1. 验证参数
    if file_path.is_empty() {
        return Err(AppError::InvalidInput("文件路径不能为空".into()));
    }

    // 2. 读取文件
    let file_data = std::fs::read(&file_path)
        .map_err(|e| AppError::File(e.to_string()))?;

    // 3. 报告进度
    let _ = window.emit(&format!("upload-progress-{}", id), serde_json::json!({
        "progress": 30,
        "status": "uploading"
    }));

    // 4. 构造请求
    let client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(file_data)
            .file_name("image.png"));

    // 5. 发送请求
    let response = client
        .post("https://api.myservice.com/upload")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    // 6. 解析响应
    if !response.status().is_success() {
        return Err(AppError::Service(format!(
            "上传失败: HTTP {}",
            response.status()
        )));
    }

    let result: serde_json::Value = response.json().await
        .map_err(|e| AppError::Service(e.to_string()))?;

    // 7. 报告完成
    let _ = window.emit(&format!("upload-progress-{}", id), serde_json::json!({
        "progress": 100,
        "status": "complete"
    }));

    Ok(MyServiceUploadResult {
        url: result["data"]["url"].as_str().unwrap_or("").to_string(),
        delete_url: result["data"]["delete"].as_str().map(String::from),
    })
}

// 可选：连接测试命令
#[tauri::command]
pub async fn test_myservice_connection(
    api_key: String,
) -> Result<String, AppError> {
    // 测试 API Key 有效性
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.myservice.com/profile")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    if response.status().is_success() {
        Ok("连接成功".to_string())
    } else {
        Err(AppError::Auth("API Key 无效".into()))
    }
}
```

### 1.2 注册命令

在 `src-tauri/src/commands/mod.rs` 中导出：

```rust
pub mod myservice;
```

> 注意：项目中只需 `pub mod` 声明，不需要 `pub use *` 重导出。

在 `src-tauri/src/main.rs` 中注册：

```rust
.invoke_handler(tauri::generate_handler![
    // ...existing commands...
    commands::upload_to_myservice,
    commands::test_myservice_connection,
])
```

---

## 步骤 2: 创建 TypeScript 上传器

### 2.1 创建上传器目录

```
src/uploaders/myservice/
├── index.ts
├── MyServiceUploader.ts
└── MyServiceError.ts  (可选)
```

### 2.2 实现上传器

```typescript
// src/uploaders/myservice/MyServiceUploader.ts

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { nanoid } from 'nanoid';
import type {
  IUploader,
  UploadOptions,
  UploadResult,
  ValidationResult,
  ConnectionTestResult,
} from '../base/types';
import type { UserConfig } from '@/config/types';

export class MyServiceUploader implements IUploader {
  readonly serviceId = 'myservice' as const;
  readonly serviceName = 'My Service';

  async validateConfig(config: UserConfig): Promise<ValidationResult> {
    if (!config.myservice?.apiKey) {
      return { valid: false, message: '请先配置 API Key' };
    }
    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: (progress: number) => void
  ): Promise<UploadResult> {
    const id = nanoid();
    const config = options.config.myservice!;

    // 设置进度监听
    let unlisten: (() => void) | undefined;
    if (onProgress) {
      unlisten = await listen<{ progress: number }>(
        `upload-progress-${id}`,
        (event) => {
          onProgress(event.payload.progress);
        }
      );
    }

    try {
      const result = await invoke<{ url: string; delete_url?: string }>(
        'upload_to_myservice',
        {
          id,
          filePath,
          apiKey: config.apiKey,
        }
      );

      return {
        url: result.url,
        deleteUrl: result.delete_url,
      };
    } finally {
      unlisten?.();
    }
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }

  async testConnection(config: { apiKey: string }): Promise<ConnectionTestResult> {
    try {
      const message = await invoke<string>('test_myservice_connection', {
        apiKey: config.apiKey,
      });
      return { success: true, message };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }
}
```

### 2.3 导出

```typescript
// src/uploaders/myservice/index.ts
export { MyServiceUploader } from './MyServiceUploader';
```

---

## 步骤 3: 注册上传器

在 `src/uploaders/index.ts` 中注册：

```typescript
import { UploaderFactory } from './base/UploaderFactory';
import { MyServiceUploader } from './myservice';

export function initializeUploaders(): void {
  // ...existing registrations...
  UploaderFactory.register('myservice', () => new MyServiceUploader());
}
```

---

## 步骤 4: 添加配置类型

### 4.1 更新类型定义

在 `src/config/types.ts` 中：

```typescript
// 添加服务类型
export type ServiceType =
  | 'weibo'
  | 'r2'
  // ...existing types...
  | 'myservice';

// 添加服务配置接口
export interface MyServiceConfig {
  enabled: boolean;
  apiKey: string;
  // 其他配置项...
}

// 更新 UserConfig
export interface UserConfig {
  // ...existing fields...
  myservice?: MyServiceConfig;
}
```

### 4.2 更新服务信息

> 注意：项目中没有独立的 `src/config/services.ts` 文件。服务类型统一在 `src/config/types.ts` 的 `ServiceType` 中定义，服务配置在 `UserConfig` 接口中声明。以下为示例，实际请参考 `types.ts` 中已有服务的写法。

```typescript
// 在 types.ts 中：
// 1. ServiceType 联合类型中添加新值
export type ServiceType = '...' | 'myservice';

// 2. 添加服务配置接口
export interface MyServiceConfig {
  apiKey: string;
}

// 3. 在 UserConfig 中添加字段
export interface UserConfig {
  // ...existing fields...
  myservice?: MyServiceConfig;
}
```

---

## 步骤 5: 更新设置界面

> **注意**：项目中**不为每个图床创建单独的 Settings 组件**。设置面板采用分组架构：
> - `src/components/settings/HostingSettingsPanel.vue` — 图床设置总面板
> - `src/components/settings/hosting/BuiltinServiceGroup.vue` — 内建图床组（无需配置）
> - `src/components/settings/hosting/CookieServiceGroup.vue` — Cookie 类图床组
> - `src/components/settings/hosting/TokenServiceGroup.vue` — Token/API Key 类图床组
> - `src/components/settings/hosting/PrivateStorageGroup.vue` — 私有存储图床组
>
> 根据新图床的认证方式，将配置项添加到对应的分组组件中。参考已有图床的写法即可。

---

## 步骤 6: 测试验证

### 测试清单

- [ ] Rust 命令编译通过
- [ ] TypeScript 类型检查通过
- [ ] 配置验证正常工作
- [ ] 上传成功返回正确 URL
- [ ] 进度回调正常触发
- [ ] 错误处理正确（网络错误、认证失败等）
- [ ] 连接测试功能正常
- [ ] 设置界面显示正常
- [ ] 深色/浅色主题适配

### 测试命令

```bash
# Rust 编译
cd src-tauri && cargo build

# 前端类型检查
npm run type-check

# 开发模式运行
npm run tauri dev
```

---

## 常见问题

### Q: 如何处理需要 Cookie 认证的服务？

参考 `WeiboUploader` 实现，使用 `openCookieWebView` 获取 Cookie。

### Q: 如何实现文件大小限制？

在 Rust 命令中检查：

```rust
const MAX_SIZE: u64 = 10 * 1024 * 1024; // 10MB
let metadata = std::fs::metadata(&file_path)?;
if metadata.len() > MAX_SIZE {
    return Err(AppError::InvalidInput("文件过大，最大支持 10MB".into()));
}
```

### Q: 如何支持多种 URL 格式？

在 `getPublicUrl` 方法中处理：

```typescript
getPublicUrl(result: UploadResult): string {
  const format = this.config.urlFormat || 'direct';
  switch (format) {
    case 'markdown':
      return `![](${result.url})`;
    case 'html':
      return `<img src="${result.url}" />`;
    default:
      return result.url;
  }
}
```

---

## 相关文档

- [上传器接口](../api/uploaders.md)
- [Rust 命令参考](../api/rust-commands.md)
- [后端架构](../architecture/backend.md)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本 |
