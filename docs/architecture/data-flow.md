# 数据流

> 上传流程、状态管理和数据存储的完整数据流图解

---

## 上传数据流

### 完整上传流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                           用户操作                                   │
│  拖拽图片 / 点击选择 / 粘贴剪贴板                                    │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        UploadView.vue                                │
│  1. 接收文件路径列表                                                 │
│  2. 调用 useUpload().handleFilesUpload(filePaths)                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         useUpload.ts                                 │
│  1. 验证文件（大小、格式）                                           │
│  2. 获取图片元数据 (invoke: get_image_metadata)                      │
│  3. 添加到上传队列 (UploadQueueManager.addFile)                      │
│  4. 创建 MultiServiceUploader 实例                                   │
│  5. 调用 uploader.upload()                                           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MultiServiceUploader.ts                           │
│  1. 获取启用的服务列表 (selectedServices)                            │
│  2. 验证每个服务的配置                                               │
│  3. 并行调用各服务上传器                                             │
│  4. 收集结果，确定主服务                                             │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│WeiboUploader│ │ R2Uploader  │ │ JDUploader  │  ... (并行)
└─────────────┘ └─────────────┘ └─────────────┘
        │               │               │
        ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Tauri invoke (IPC)                              │
│  upload_file_stream / upload_to_s3_compatible / upload_to_jd        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Rust 后端命令                                 │
│  1. 读取文件                                                         │
│  2. 构造 HTTP 请求                                                   │
│  3. 上传到目标服务                                                   │
│  4. 发送进度事件 (window.emit)                                       │
│  5. 返回上传结果 (URL, key, etc.)                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    结果处理 (useUpload.ts)                           │
│  1. 更新队列状态 (UploadQueueManager.updateProgress)                │
│  2. 生成最终链接 (LinkGenerator)                                     │
│  3. 保存历史记录 (HistoryDatabase.insert)                           │
│  4. 复制链接到剪贴板                                                 │
│  5. 显示 Toast 通知                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 进度更新流

```
┌─────────────────┐
│   Rust 上传命令  │
│  (upload.rs)    │
└────────┬────────┘
         │ window.emit("upload-progress-{id}", payload)
         ▼
┌─────────────────┐
│   Tauri 事件    │
│   Event System  │
└────────┬────────┘
         │ listen("upload-progress-{id}")
         ▼
┌─────────────────┐
│ MultiService    │
│ Uploader.ts     │
│ (onProgress)    │
└────────┬────────┘
         │ callback(serviceId, progress)
         ▼
┌─────────────────┐
│ UploadQueue     │
│ Manager.ts      │
│ updateProgress()│
└────────┬────────┘
         │ queueState.value = newState
         ▼
┌─────────────────┐
│ useQueueState   │
│ (reactive)      │
└────────┬────────┘
         │ Vue reactivity
         ▼
┌─────────────────┐
│ UploadView.vue  │
│ UI 更新         │
└─────────────────┘
```

---

## 配置数据流

### 配置加载

```
应用启动
    │
    ▼
useConfig.loadConfig()
    │
    ▼
Store.get("config")
    │
    ▼
读取 config.json (AES-GCM 解密)
    │
    ▼
config.value = parsedConfig
    │
    ▼
组件通过 useConfig().config 访问
```

### 配置保存

```
用户修改设置
    │
    ▼
useConfig.saveConfig(newConfig)
    │
    ▼
Store.set("config", newConfig)
    │
    ▼
AES-GCM 加密
    │
    ▼
写入 config.json
    │
    ▼
emit("config-changed") 通知其他组件
```

---

## 历史记录数据流

### 保存历史

```
上传成功
    │
    ▼
useUpload.saveHistoryItem(filePath, results)
    │
    ▼
构造 HistoryItem 对象
    │
    ├── id: nanoid()
    ├── filePath: 原始路径
    ├── uploadTime: Date.now()
    ├── services: { weibo: url1, r2: url2, ... }
    ├── metadata: { width, height, size, format }
    └── primaryUrl: 主服务 URL
    │
    ▼
HistoryDatabase.insert(item)
    │
    ▼
SQLite INSERT
    │
    ▼
更新内存缓存 (imageMetas)
```

### 查询历史

```
┌─────────────────────────────────────────────────────────────────────┐
│                        查询入口                                      │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│ loadHistory()   │ loadPageByNumber│ searchHistory(keyword)          │
│ (全量加载)      │ (分页加载)      │ (搜索)                          │
└────────┬────────┴────────┬────────┴────────┬────────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     HistoryDatabase                                  │
│  SELECT * FROM history WHERE ... ORDER BY upload_time DESC          │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     imageMetas (ShallowRef)                          │
│  组件通过 useHistory().imageMetas 响应式访问                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 缩略图缓存流

```
请求缩略图 (ThumbnailImage.vue)
    │
    ▼
useThumbCache.getThumb(imagePath)
    │
    ├── 检查内存缓存 (Map)
    │   └── 命中 → 返回缓存 URL
    │
    ├── 检查磁盘缓存 (thumbs/)
    │   └── 命中 → 加入内存缓存 → 返回
    │
    └── 未命中
        │
        ▼
    生成缩略图 (Canvas/OffscreenCanvas)
        │
        ▼
    保存到磁盘 (WebP 格式)
        │
        ▼
    加入内存缓存
        │
        ▼
    返回缩略图 URL
```

---

## WebDAV 同步流

### 上传同步

```
配置变更 / 手动触发
    │
    ▼
useWebDAVSync.sync()
    │
    ▼
读取本地配置和历史
    │
    ▼
WebDAVClient.putFile(remotePath, data)
    │
    ▼
HTTP PUT 请求
    │
    ▼
更新同步时间戳
```

### 下载同步

```
应用启动 / 手动触发
    │
    ▼
useWebDAVSync.pull()
    │
    ▼
WebDAVClient.getFile(remotePath)
    │
    ▼
比较版本/时间戳
    │
    ├── 远程较新 → 覆盖本地
    ├── 本地较新 → 保持本地
    └── 冲突 → 显示 SyncConflictDialog
```

---

## 状态管理总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        全局状态 (Composables)                        │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│   useConfig     │   useHistory    │      useUpload                  │
│   ─────────     │   ──────────    │      ────────                   │
│   config        │   imageMetas    │      selectedServices           │
│   isLoading     │   isLoading     │      isUploading                │
│   isSaving      │                 │      serviceConfigStatus        │
└────────┬────────┴────────┬────────┴────────┬────────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        持久化层                                      │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│   Store         │ HistoryDatabase │      ThumbCache                 │
│   (JSON+AES)    │   (SQLite)      │      (File System)              │
└─────────────────┴─────────────────┴─────────────────────────────────┘
```

---

## 相关文档

- [架构总览](./overview.md)
- [前端架构](./frontend.md)
- [后端架构](./backend.md)
- [Composables API](../api/composables.md)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本 |
