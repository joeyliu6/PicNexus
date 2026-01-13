# PicNexus 架构总览

> 5 分钟了解项目的技术栈、目录结构和核心模块。

---

## 项目定位

**PicNexus** 是一个多图床上传工具，支持一次上传、多处备份。基于 Tauri 构建，提供原生桌面体验。

**核心特性**：
- 支持 10+ 图床服务（微博、京东、R2、SM.MS、GitHub 等）
- 并行上传到多个图床
- 本地历史记录管理（SQLite）
- WebDAV 云同步
- 深色/浅色主题

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面框架 | Tauri | 2.x | Rust 后端 + WebView 前端 |
| 前端框架 | Vue | 3.x | Composition API |
| 语言 | TypeScript | 5.x | 严格模式 |
| UI 组件 | PrimeVue | 4.x | PassThrough 主题定制 |
| 状态管理 | Vue Reactivity | - | ref/reactive + composables |
| 数据存储 | SQLite | - | 历史记录 |
| 配置存储 | JSON + AES-GCM | - | 加密配置文件 |
| 后端语言 | Rust | 1.70+ | 高性能上传 |

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Vue 3 前端                               │
├─────────────┬─────────────┬─────────────┬──────────────────────┤
│  UploadView │ HistoryView │ TimelineView│    SettingsView      │
│  (上传界面) │ (历史记录)  │ (时间线)    │    (设置面板)        │
├─────────────┴─────────────┴─────────────┴──────────────────────┤
│                      Composables 层                              │
│  useUpload │ useHistory │ useConfig │ useThumbCache │ useToast │
├─────────────────────────────────────────────────────────────────┤
│                        Core 层                                   │
│  MultiServiceUploader │ LinkGenerator │ UploadQueueManager      │
├─────────────────────────────────────────────────────────────────┤
│                      Uploaders 层                                │
│  WeiboUploader │ R2Uploader │ JDUploader │ SmmsUploader │ ...  │
├─────────────────────────────────────────────────────────────────┤
│                      Services 层                                 │
│  HistoryDatabase │ Store │ StorageManager │ ThumbCache          │
└─────────────────────────────────────────────────────────────────┘
                              │
                      Tauri invoke (IPC)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        Rust 后端                                 │
├─────────────────────────────────────────────────────────────────┤
│  commands/                                                       │
│  ├── upload.rs      (微博上传)                                  │
│  ├── zhihu.rs       (知乎上传)                                  │
│  ├── nami.rs        (纳米上传)                                  │
│  ├── s3_compatible.rs (S3 兼容存储: R2/COS/OSS/七牛/又拍云)    │
│  ├── github.rs      (GitHub 上传)                               │
│  ├── smms.rs        (SM.MS 上传)                                │
│  ├── clipboard.rs   (剪贴板操作)                                │
│  ├── link_checker.rs(链接检测)                                  │
│  └── image_meta.rs  (图片元数据)                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
PicNexus/
├── src/                          # 前端源码
│   ├── components/               # Vue 组件
│   │   ├── views/               # 主视图组件
│   │   │   ├── UploadView.vue   # 上传界面
│   │   │   ├── history/         # 历史记录相关
│   │   │   └── timeline/        # 时间线相关
│   │   ├── settings/            # 设置面板组件
│   │   ├── layout/              # 布局组件 (TitleBar, Sidebar)
│   │   ├── common/              # 通用组件
│   │   └── dialogs/             # 对话框组件
│   │
│   ├── composables/              # Vue Composables (状态管理)
│   │   ├── useConfig.ts         # 配置管理
│   │   ├── useHistory.ts        # 历史记录管理
│   │   ├── useUpload.ts         # 上传流程管理
│   │   ├── useThumbCache.ts     # 缩略图缓存
│   │   ├── useToast.ts          # Toast 通知
│   │   └── ...
│   │
│   ├── core/                     # 核心业务逻辑
│   │   ├── MultiServiceUploader.ts  # 多服务并行上传
│   │   ├── UploadQueueManager.ts    # 上传队列管理
│   │   └── LinkGenerator.ts         # 链接生成器
│   │
│   ├── uploaders/                # 图床上传器
│   │   ├── base/                # 基类和接口
│   │   │   ├── IUploader.ts     # 上传器接口
│   │   │   ├── BaseUploader.ts  # 基础实现
│   │   │   └── UploaderFactory.ts # 工厂类
│   │   ├── weibo/               # 微博上传器
│   │   ├── r2/                  # Cloudflare R2
│   │   ├── jd/                  # 京东
│   │   ├── smms/                # SM.MS
│   │   ├── github/              # GitHub
│   │   └── ...                  # 其他图床
│   │
│   ├── services/                 # 服务层
│   │   ├── HistoryDatabase.ts   # SQLite 历史记录
│   │   ├── storage/             # 存储服务抽象
│   │   └── ThumbCache.ts        # 缩略图缓存服务
│   │
│   ├── config/                   # 配置和类型
│   │   └── types.ts             # TypeScript 类型定义
│   │
│   ├── theme/                    # 主题系统
│   │   ├── dark-theme.css       # 深色主题变量
│   │   ├── light-theme.css      # 浅色主题变量
│   │   └── primevue-overrides.css # PrimeVue 覆盖
│   │
│   ├── utils/                    # 工具函数
│   ├── store.ts                  # 加密配置存储
│   ├── main.ts                   # 应用入口
│   └── App.vue                   # 根组件
│
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs              # Tauri 入口
│   │   ├── commands/            # Tauri 命令模块
│   │   ├── error.rs             # 统一错误处理
│   │   └── lib.rs               # 库入口
│   ├── Cargo.toml               # Rust 依赖
│   └── tauri.conf.json          # Tauri 配置
│
├── docs/                         # 开发文档
├── scripts/                      # 构建脚本
└── sidecar/                      # 辅助程序 (Chrome 自动化)
```

---

## 核心模块职责

### 前端核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **MultiServiceUploader** | `core/MultiServiceUploader.ts` | 编排多图床并行上传，处理配置验证、错误转换、确定主服务 |
| **UploadQueueManager** | `core/UploadQueueManager.ts` | 管理上传队列 UI 状态，进度更新，重试处理 |
| **UploaderFactory** | `uploaders/base/UploaderFactory.ts` | 注册和创建上传器实例 |
| **HistoryDatabase** | `services/HistoryDatabase.ts` | SQLite 数据库操作，历史记录 CRUD |
| **Store** | `store.ts` | AES-GCM 加密的配置文件存储 |

### Rust 后端模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **upload** | `commands/upload.rs` | 微博图床上传 |
| **s3_compatible** | `commands/s3_compatible.rs` | S3 兼容存储 (R2/COS/OSS/七牛/又拍云) |
| **zhihu** | `commands/zhihu.rs` | 知乎图床上传 |
| **github** | `commands/github.rs` | GitHub 仓库上传 |
| **clipboard** | `commands/clipboard.rs` | 剪贴板图片读取 |
| **link_checker** | `commands/link_checker.rs` | 图片链接有效性检测 |
| **image_meta** | `commands/image_meta.rs` | 图片元数据提取 |

---

## 数据存储

### 配置存储 (`store.ts`)

- 位置：`%APPDATA%/us.picnex.app/config.json`
- 加密：AES-GCM
- 内容：用户配置、服务凭证、界面偏好

### 历史记录 (`HistoryDatabase.ts`)

- 位置：`%APPDATA%/us.picnex.app/history.db`
- 格式：SQLite
- 内容：上传历史、图片元数据、多服务 URL

### 缩略图缓存 (`ThumbCache.ts`)

- 位置：`%APPDATA%/us.picnex.app/thumbs/`
- 格式：WebP
- 策略：LRU 缓存，自动清理

---

## 相关文档

- [前端架构](./frontend.md) - Vue 组件和状态管理详解
- [后端架构](./backend.md) - Rust 命令和错误处理
- [数据流](./data-flow.md) - 上传流程图解
- [上传器接口](../api/uploaders.md) - IUploader 接口规范

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本：创建架构总览文档 |
