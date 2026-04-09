# PicNexus 模块依赖图

> 修改任何模块前，先查阅此文档了解影响范围。

---

## 高风险文件

| 风险 | 文件 | 原因 |
|------|------|------|
| 🔴 | `src/config/types.ts` | 核心类型，被所有模块依赖 |
| 🔴 | `src/uploaders/base/IUploader.ts` | 上传器接口，被 17 个上传器实现 |
| 🔴 | `src/services/HistoryDatabase.ts` | 历史数据库，被所有历史视图依赖 |
| 🟠 | `src/core/MultiServiceUploader.ts` | 上传编排，被 useUpload 调用 |
| 🟠 | `src/composables/useUpload.ts` | 上传管理，被 UploadView 依赖 |
| 🟠 | `src/composables/useConfig.ts` | 配置管理，被设置和上传依赖 |
| 🟠 | `src/uploaders/base/UploaderFactory.ts` | 上传器工厂，被 MultiServiceUploader 依赖 |

---

## 核心流程

### 上传流程
```
UploadView.vue
    ↓ 调用
useUpload.ts (handleFilesUpload)
    ↓ 使用
UploadQueueManager (管理队列状态)
    ↓ 调用
MultiServiceUploader.uploadToMultipleServices()
    ↓ 使用
UploaderFactory.create(serviceId)
    ↓ 返回
[Service]Uploader.upload()
    ↓ 调用
Tauri invoke → Rust commands/*.rs
    ↓ 成功后
HistoryDatabase.insert()
```

### 设置流程
```
SettingsView.vue → useConfig.ts → Store (加密) → config.json
```

### 历史浏览流程
```
HistoryView.vue / TimelineView.vue → useHistory.ts → HistoryDatabase → history.db
```

---

## 快速检查表

| 我要修改... | 必须检查... |
|------------|-------------|
| `types.ts` 的 ServiceType | 所有上传器、设置面板、UploaderFactory |
| `types.ts` 的 UserConfig | migrateConfig、DEFAULT_CONFIG、设置面板 |
| `types.ts` 的 HistoryItem | HistoryDatabase、useHistory、所有历史视图 |
| `IUploader.ts` 接口 | 所有 17 个上传器实现（`src/uploaders/*/`） |
| `MultiServiceUploader.ts` | useUpload.ts、错误处理逻辑 |
| `HistoryDatabase.ts` | useHistory、所有历史视图 |
| `useUpload.ts` | UploadView、UploadQueue |
| `useConfig.ts` | SettingsView、各设置面板、useUpload |
| 任意 Composable 返回值 | 所有使用该 Composable 的组件 |
| CSS 变量 | 检查深色/浅色主题兼容性 |
