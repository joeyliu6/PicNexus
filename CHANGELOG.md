# Changelog

所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [1.0.2] - 2025-01-22

### Changed
- 设置页面侧边栏底部版本号添加软件名称显示（PicNexus v1.0.2）

---

## [Unreleased]

### Added
- **云存储分页功能**
  - 新增 `usePagination` composable 管理 Token 缓存分页
  - 新增 `PaginationBar` 分页组件，使用 PrimeVue Paginator
  - 后端 `list_s3_objects` 支持 `delimiter` 和 `continuation_token`
  - 默认每页 30 条，支持 [30, 50, 100] 选项
- **S3 连接测试命令**
  - 支持 R2、腾讯云、阿里云、七牛云、又拍云的连接验证
  - 自动构建各服务商对应的 endpoint
  - 包含超时控制和详细错误信息
- **云存储 UI 增强**
  - 文件详情面板支持骨架屏加载动画
  - 创建文件夹对话框（支持回车确认）
  - 5 分钟定时自动刷新机制
  - stale-while-revalidate 缓存策略
- **字体系统**
  - 引入 Inter 字体（Regular/Medium/SemiBold）
  - 引入 JetBrains Mono 字体（Regular/Medium）
- 新增 Toast 消息集中化管理系统
- 新增腾讯云 COS 和阿里云 OSS 图床支持
- 新增 COS/OSS 存储管理器，支持云存储文件浏览
- 新增完整的开发文档系统

### Fixed
- **S3 存储稳定性**
  - 为 S3 操作添加 30 秒超时保护，防止请求无限挂起
  - 添加连接测试重试机制（3次，指数退避）解决 R2 dispatch failure
  - 分页 Token 缓存添加 5 分钟 TTL，避免过期 token 导致数据不一致
  - 过滤 S3 目录占位符，修复空文件夹显示空白记录
- **时间线视图**
  - 修复视图切换后图片空白问题（虚拟滚动状态同步）
  - 修复年份标签位置和时区问题（SQL localtime 修饰符）
- **云存储 UI**
  - 修复复选框选中状态不显示勾选标记
  - 修复切换存储桶时面包屑闪烁"根目录"问题
  - 修复列表视图复选框对齐问题
- 修复上传失败后队列状态仍显示"上传中"的问题

### Changed
- **组件重构**
  - `useUpload` 拆分为 `useImageMetadata`、`useHistorySaver`、`useServiceSelector` 三个模块
  - `UploadView` 拆分为 `ServiceSelector`、`UploadDropZone`、`UploadQueuePanel`
  - `BackupSyncPanel` 拆分为 4 个职责单一的子组件
  - 云存储列表重构为 Finder 风格表格（FileList/FileListItem）
  - 新增高级设置面板，整合链接前缀、缓存管理、隐私设置
- **代码简化**
  - 移除 93 个文件中的废话路径注释
  - 简化 Cookie 测试函数（6 个函数合并为通用函数，减少 120 行）
  - 统一使用 `SERVICE_DISPLAY_NAMES` 常量消除重复定义
  - 统一使用 `formatFileSize` 工具函数
- **UI 优化**
  - 设置侧边栏视觉层级优化（去线留白、弱化标题）
  - 侧边栏宽度统一（180px/200px）
  - 骨架屏从网格改为表格行布局
- 重构图床设置界面，采用扁平式卡片布局
- 重构图床图标系统，提取为独立 SVG 文件

### Performance
- 服务连接测试从串行改为并行（`Promise.allSettled`）
- 服务商状态缓存有效期 10 分钟，分页切换不再触发连接测试
- 云存储缓存优先显示，后台静默刷新
- 骨架屏延迟 150ms 显示，避免快速切换时闪烁

---

## [1.0.1] - 2025-01-10

### Fixed
- 修复设置面板样式问题
- 优化时间线年份标签位置，移至当年区域底部
- 修复时间线骨架屏样式

### Changed
- 优化图床设置界面分类和暗黑模式样式
- 统一图床设置为折叠面板界面

---

## [1.0.0] - 2025-01-01

### Added
- 初始版本发布
- 支持多图床同时上传
  - 微博图床
  - 京东图床
  - 七鱼图床
  - TCL 图床
  - 知乎图床
  - 牛客图床
  - 纳米图床
  - Cloudflare R2
- 历史记录管理
  - 表格视图
  - 网格视图
  - 时间线视图
- 链接有效性检测
- R2 文件管理器
- WebDAV 配置同步
- 深色/浅色主题支持
- 剪贴板图片上传

---

## 变更类型说明

- **Added**: 新增功能
- **Changed**: 功能变更
- **Deprecated**: 即将废弃的功能
- **Removed**: 已移除的功能
- **Fixed**: Bug 修复
- **Security**: 安全相关修复
