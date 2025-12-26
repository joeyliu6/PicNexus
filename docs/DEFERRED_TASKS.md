# PicNexus 延后处理任务开发文档

本文档记录了代码审计中发现但暂未修复的问题，供后续开发参考。

---

## 1. 统一 Rust 后端错误类型

### 问题描述

当前 Rust 后端的 Tauri 命令返回错误类型不一致：

| 命令 | 返回类型 | 位置 |
|------|----------|------|
| `test_weibo_connection` | `Result<T, String>` | src-tauri/src/main.rs |
| `upload_file_stream` | `Result<T, AppError>` | src-tauri/src/commands/upload.rs |
| 其他命令 | 混合使用 | 多个文件 |

### 影响

- 前端错误处理逻辑复杂，需要针对不同错误格式做不同处理
- 容易遗漏错误分支
- 日志格式不统一，难以追踪问题

### 修复方案

#### 步骤 1：定义统一的错误类型

```rust
// src-tauri/src/error.rs

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
pub enum AppError {
    #[error("网络错误: {0}")]
    Network(String),

    #[error("认证失败: {0}")]
    Auth(String),

    #[error("文件操作错误: {0}")]
    FileIO(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("上传失败: {0}")]
    Upload(String),

    #[error("未知错误: {0}")]
    Unknown(String),
}

// 实现 From trait 用于错误转换
impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::FileIO(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Network(err.to_string())
    }
}

// Tauri 需要的 InvokeError 实现
impl From<AppError> for tauri::InvokeError {
    fn from(err: AppError) -> Self {
        tauri::InvokeError::from(err.to_string())
    }
}
```

#### 步骤 2：迁移所有命令

1. 将所有 `Result<T, String>` 改为 `Result<T, AppError>`
2. 使用 `?` 操作符和 `From` trait 自动转换错误
3. 确保错误信息有意义且用户友好

#### 步骤 3：前端适配

```typescript
// src/utils/errorHandler.ts

interface RustError {
  type: 'Network' | 'Auth' | 'FileIO' | 'Config' | 'Upload' | 'Unknown';
  message: string;
}

export function parseRustError(error: unknown): RustError {
  if (typeof error === 'string') {
    // 解析错误字符串
    const match = error.match(/^(\w+)错误: (.+)$/);
    if (match) {
      return { type: match[1] as RustError['type'], message: match[2] };
    }
    return { type: 'Unknown', message: error };
  }
  return { type: 'Unknown', message: String(error) };
}
```

### 工作量估计

- 涉及文件：约 10 个 Rust 文件
- 预计改动：约 50 处命令定义
- 建议时间：1-2 天

### 注意事项

- 需要同步更新所有前端调用点的错误处理
- 建议分模块逐步迁移，避免大规模改动
- 需要完善单元测试覆盖

---

## 2. 完善 WebDAV 同步状态管理

### 问题描述

`src/config/types.ts` 中定义了 `SyncStatus` 类型，但从未在代码中使用：

```typescript
export interface SyncStatus {
  lastSyncTime: number;
  syncState: 'idle' | 'syncing' | 'error';
  lastError?: string;
}
```

WebDAV 同步功能实现不完整，缺少：
- 同步状态 UI 展示
- 冲突解决机制
- 同步历史记录

### 修复方案

#### 步骤 1：完善状态管理

```typescript
// src/composables/useWebDAVSync.ts

import { ref, computed } from 'vue';
import type { SyncStatus } from '../config/types';

const syncStatus = ref<SyncStatus>({
  lastSyncTime: 0,
  syncState: 'idle',
  lastError: undefined
});

export function useWebDAVSync() {
  const issyncing = computed(() => syncStatus.value.syncState === 'syncing');
  const hasError = computed(() => syncStatus.value.syncState === 'error');

  async function startSync() {
    if (syncStatus.value.syncState === 'syncing') return;

    syncStatus.value.syncState = 'syncing';
    syncStatus.value.lastError = undefined;

    try {
      // 执行同步逻辑
      await performSync();
      syncStatus.value.lastSyncTime = Date.now();
      syncStatus.value.syncState = 'idle';
    } catch (error) {
      syncStatus.value.syncState = 'error';
      syncStatus.value.lastError = error.message;
    }
  }

  return {
    syncStatus,
    issyncing,
    hasError,
    startSync
  };
}
```

#### 步骤 2：添加冲突解决

```typescript
interface SyncConflict {
  localVersion: ConfigData;
  remoteVersion: ConfigData;
  conflictType: 'both_modified' | 'deleted_remotely' | 'deleted_locally';
}

async function resolveConflict(conflict: SyncConflict, strategy: 'local' | 'remote' | 'merge'): Promise<void> {
  switch (strategy) {
    case 'local':
      await uploadToWebDAV(conflict.localVersion);
      break;
    case 'remote':
      await applyRemoteConfig(conflict.remoteVersion);
      break;
    case 'merge':
      const merged = mergeConfigs(conflict.localVersion, conflict.remoteVersion);
      await applyAndUpload(merged);
      break;
  }
}
```

#### 步骤 3：UI 展示

在设置页面添加同步状态指示器和手动同步按钮。

### 工作量估计

- 涉及文件：约 5 个文件
- 建议时间：2-3 天

### 依赖项

- 需要先确定 WebDAV 服务端配置格式
- 需要设计冲突解决 UI

---

## 3. 完善缓存失效机制

### 问题描述

`src/composables/useHistory.ts` 中的历史记录缓存存在以下问题：

1. **没有 TTL（生存时间）**：缓存一旦加载就永不过期
2. **多窗口不同步**：同一应用打开多个窗口时，缓存不共享
3. **内存泄漏风险**：大量历史记录可能占用过多内存

### 修复方案

#### 步骤 1：添加 TTL 机制

```typescript
// src/utils/cache.ts

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class TTLCache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  set(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const historyCache = new TTLCache<HistoryItem[]>();
```

#### 步骤 2：多窗口同步

使用 Tauri 事件系统实现跨窗口通知：

```typescript
// 发送缓存失效通知
import { emit } from '@tauri-apps/api/event';

async function invalidateCacheAcrossWindows(cacheKey: string): Promise<void> {
  await emit('cache-invalidate', { key: cacheKey });
}

// 监听缓存失效通知
import { listen } from '@tauri-apps/api/event';

await listen('cache-invalidate', (event) => {
  const { key } = event.payload;
  historyCache.invalidate(key);
});
```

#### 步骤 3：内存限制

```typescript
class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  set(key: string, data: T): void {
    // 如果已存在，先删除再添加（移到最后）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // 超过最大容量，删除最早的
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { data, timestamp: Date.now() });
  }
}
```

### 工作量估计

- 涉及文件：约 3 个文件
- 建议时间：1 天

### 优先级

此问题影响较低，仅在以下情况下会有明显影响：
- 用户有大量历史记录（>1000 条）
- 同时打开多个应用窗口编辑

---

## 任务优先级总结

| 任务 | 优先级 | 影响范围 | 工作量 |
|------|--------|----------|--------|
| Rust 错误类型统一 | 中 | 全局 | 大 |
| WebDAV 同步状态 | 低 | 功能缺失 | 中 |
| 缓存失效机制 | 低 | 边缘场景 | 小 |

建议按以下顺序处理：
1. 先完善缓存失效机制（工作量小，见效快）
2. 再做 Rust 错误类型统一（需要系统性改动）
3. 最后做 WebDAV 同步状态（取决于功能需求）

---

## 相关文件

- [计划文件](../.claude/plans/tidy-tickling-toast.md)：完整的审计报告
- [src/config/types.ts](../src/config/types.ts)：类型定义
- [src-tauri/src/main.rs](../src-tauri/src/main.rs)：Rust 命令定义
