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
pub use myservice::*;
```

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

在 `src/config/services.ts` 中（如果有）：

```typescript
export const SERVICE_INFO: Record<ServiceType, ServiceInfo> = {
  // ...existing services...
  myservice: {
    id: 'myservice',
    name: 'My Service',
    icon: 'pi-cloud-upload',
    requiresAuth: true,
    authType: 'apiKey',
  },
};
```

---

## 步骤 5: 更新设置界面

在设置面板中添加配置项：

```vue
<!-- src/components/settings/MyServiceSettings.vue -->
<template>
  <div class="service-settings">
    <h3>My Service 设置</h3>

    <div class="field">
      <label>API Key</label>
      <InputText
        v-model="localConfig.apiKey"
        type="password"
        placeholder="输入 API Key"
      />
    </div>

    <div class="actions">
      <Button
        label="测试连接"
        :loading="testing"
        @click="testConnection"
      />
      <Button
        label="保存"
        :loading="saving"
        @click="save"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useConfig } from '@/composables/useConfig';

const { config, saveConfig } = useConfig();

const localConfig = reactive({
  apiKey: config.value.myservice?.apiKey || '',
});

const testing = ref(false);
const saving = ref(false);

async function testConnection() {
  testing.value = true;
  try {
    const uploader = new MyServiceUploader();
    const result = await uploader.testConnection({ apiKey: localConfig.apiKey });
    // 显示结果
  } finally {
    testing.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await saveConfig({
      ...config.value,
      myservice: {
        enabled: true,
        apiKey: localConfig.apiKey,
      },
    });
  } finally {
    saving.value = false;
  }
}
</script>
```

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
