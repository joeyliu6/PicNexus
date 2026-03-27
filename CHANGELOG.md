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
- **图片压缩**
  - 上传前自动压缩图片，减小文件体积、节省存储空间、提升加载速度
  - Rust 原生 `image` crate 处理，高性能，支持 JPEG 质量调整、等比缩放、WebP 格式转换
  - 设置页完整配置：开关、质量预设（高质量 90/推荐 80/高压缩 60）、高级选项（尺寸限制、WebP 转换、跳过小文件阈值）
  - 上传页 DropZone 右下角快捷压缩控件，与设置页双向同步
  - GIF 动图自动跳过；压缩后反而更大时自动使用原图；临时文件上传后自动清理
  - 默认关闭，需用户手动开启
- **编辑器兼容 HTTP Server**
  - 内置 PicGo 兼容 HTTP Server（axum），支持 `POST /upload` 接口
  - 完整兼容 Typora、Obsidian（Image Auto Upload Plugin）等编辑器粘贴图片自动上传
  - Server 专用图床配置（独立于主界面多服务选择），支持京东/GitHub/SM.MS/Imgur
  - 默认关闭，监听端口默认 36799（可自定义，避免与 PicGo/PicList 36677 冲突）
  - 支持运行时启停/端口切换，使用 tokio AbortHandle 管理 Server 生命周期
  - 设置界面新增"编辑器兼容 Server"配置区（开关、端口输入、图床选择、使用说明）
- **URL 图片下载上传**
  - 支持从图片 URL 下载并上传到图床，弹窗输入多个 URL（每行一个）
  - Ctrl+V 粘贴文字链接时自动识别图片 URL 并下载上传
  - Rust 后端新增 `download_url_image` 命令，支持 Content-Type 校验和魔术字节验证
- **收藏功能**
  - 浏览界面新增"收藏"标签页，以时间轴网格展示已收藏图片
  - 灯箱底栏新增收藏按钮（星形图标）
  - 时间轴图片右上角悬浮收藏图标
  - 浮动操作栏支持批量收藏/取消收藏
  - SQLite 数据库新增 `is_favorited` 字段，自动迁移

### Changed
- 默认主题从深色模式改为跟随系统设置（auto），首次打开自动适配系统亮/暗模式
- 上传界面压缩开关与设置界面压缩开关实现双向同步，改动任一处另一处实时更新；上传界面压缩标签新增 tooltip 提示"更改将同步到全局设置"

### Fixed
- **图床可用性检测重复触发**
  - 修复七鱼/京东可用性检测在「应用启动」和「进入图床设置页」时各触发一次的问题
  - 检测时机调整为：仅在应用启动时触发一次，此后每 12 小时周期性检测
  - 进入图床设置标签页不再重复触发检测
  - 上传成功时自动标记对应图床可用并重置计时器，避免冗余检测
  - 上传进行中时推迟周期性检测，上传完成后再执行
  - "重新检测"按钮在后台自动检测期间同步显示加载状态（spinner + disabled），防止重叠检测

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

## [Unreleased] - 2026 Q1 功能批次（2026-01-23 至 2026-03-23）

### Added

#### 核心功能
- **全局快捷键上传**：系统级快捷键在任意应用中触发图片上传；新增 ShortcutInput 可视化录入组件
- **应用内自动更新**：检测新版本、展示下载进度并自动重启；签名公钥验证安全性
- **首次使用引导流程**：4 步 onboarding 对话框（欢迎 → 上传说明 → 服务介绍 → 准备就绪），完成状态持久化
- **跨电脑配置恢复**：PNXPWD 加密格式（PBKDF2 + AES-GCM），备份密码对话框支持设置/修改/恢复三种模式
- **备份密码导入**：支持直接导入他人/跨机加密备份文件，输入备份密码完成解密恢复
- **图床健康状态系统**：四态模型（未配置/检测中/已验证/异常），HostingCard 指示灯 + tooltip，批量测试（最大并发 3）
- **链接输出配置**：默认格式、自定义模板、上传后自动复制开关，集成到常规设置面板
- **图床空状态引导**：无可用图床时展示「前往设置配置」引导，点击跳转至设置面板
- **启动时自动清理备份**：删除超过 30 天且超出数量限制（3 个）的 `.corrupted.*`/`.invalid.*` 备份文件
- **云端同步行始终可见**：BackupSync 面板未配置 WebDAV 时显示禁用态，锁图标提示，配置后自动启用
- **上传结果全量持久化**：历史记录保存全部上传结果（含失败），支持失败图床详情展示和重试入口
- **ChannelCard 状态展示**：上传队列和历史记录展示各图床的上传状态、失败原因 tooltip 和链接复制操作
- **时间线图片加载失败状态**：新增 failedImages 集合追踪失败图片，显示失败占位图标，避免重复重试
- **GitHub Actions 发布流程**：新增 `.github/workflows/release.yml` 自动化构建与发布

#### UI 增强
- **全屏沉浸式图片查看器**：从 PrimeVue Dialog 改为 Teleport 全屏遮罩，支持键盘快捷键、鼠标滚轮、拖拽平移、预加载邻图
- **历史视图滚动位置恢复**：HistoryView/TimelineView 跨 Tab 切换时自动保存/恢复滚动位置
- **历史表格空状态区分**：「无记录」与「无搜索结果」展示不同文案
- **关闭时最小化到托盘**：GeneralSettingsPanel 新增关闭行为选项（closeToTray）

### Fixed
- **Store selfHeal 死循环**：selfHeal 模式删除文件失败时抛出 StoreError，防止脏数据写入引发死循环
- **响应式 Proxy 序列化**：`useConfig` 新增 `toPlainConfig()`，修复 Proxy 对象无法 JSON.stringify 的问题
- **上传防重入**：`useUpload` 添加防重入锁，同时限制单次上传文件数量上限为 200
- **SQL 注入防护**：历史记录搜索关键词转义 LIKE 通配符（`%`/`_`/`\`）
- **Cookie 登录稳定性**：增加 SPA 轮询兜底解决未触发 NavigationCompleted 问题；微博登录改为 `m.weibo.cn`；compare_exchange 防重复保存
- **时间轴指示器日期跳变**：将最近距离匹配改为区间匹配，解决滑块在 segment 边界处日期抖动
- **WebDAV 验证 toast 结构修复**：测试成功时 toast 消息格式对齐
- **历史灯箱空值保护**：HistoryLightbox 添加 item 可选链防止 undefined 异常
- **z-index 层级冲突**：ConfirmDialog 遮罩提升至 10001，Tooltip 设为 10000
- **S3 路径穿越防护**：`image_meta` 命令添加路径规范化验证

### Changed
- **CSS Design Token 系统**：新增 `--radius-*`（圆角）、`--space-*`（间距）、`--z-*`（z-index 层级）变量族；13 个组件硬编码颜色/z-index 全部替换为 CSS 变量
- **HostingSettingsPanel 拆分**：拆为 PrivateStorageGroup / CookieServiceGroup / TokenServiceGroup / BuiltinServiceGroup 四个子组件；PrivateStorageGroup 用数据驱动 v-for 重构
- **引导流程精简**：4 步 onboarding 精简为 3 步（移除 ReadyStep），更新文案，去除装饰性大图标，硬编码颜色改为 CSS 变量
- **服务启用控件迁移**：从「常规设置」迁移到「图床设置」顶部，toggle-chip 根据健康状态着色
- **复制链接统一**：新增 `useCopyLink` composable 统一所有复制入口；新增通用 `CopyButton` 组件（支持右键格式选择）；FloatingActionBar 批量复制支持图床筛选
- **RetryService 批量重试**：支持批量重试失败项，汇总结果统一 Toast 提示
- **历史视图导航栏**：重构为标签页 + 芯片风格，图床筛选动态读取 SERVICE_DISPLAY_NAMES
- **分页查询优化**：COUNT(*) OVER() 窗口函数合并计数与分页为单次查询，新增复合索引加速
- **Bold Contrast UI 风格**：移除毛玻璃效果，实色背景，加粗标题；BatchRenameDialog 变量 chips + 内联预览重写；SyncConflictDialog 清晰冲突对比布局
- **上传摘要 Toast**：覆盖全成功/部分失败/全失败/图床部分失败等 5 种场景的差异化提示
- **微信品牌色规范化**：提取为 `--wechat-green` 等 CSS 变量，禁止硬编码

### Removed
- **CloudStorageView 云存储浏览器**：移除整个云端文件管理模块（27 个组件，~6572 行），核心上传和连接测试功能保留
- **遗留 R2 管理命令**：删除后端手写 AWS Sig V4 死代码（~544 行）

### Performance
- **Store 内存缓存**：新增 memCache / cacheLoaded 缓存完整数据对象，同一会话命中缓存后跳过文件 I/O 和 AES-GCM 解密

### Infrastructure
- **Store 单例化**：新增 `src/store/instances.ts`，消除 15 处重复 `new Store()` 实例化
- **结构化 Logger**：新增 `src/utils/logger.ts`（基于 Tauri 日志插件），替换 13 个文件的 `console.*`；后端 `println!` 全替换为 `log::*` 宏；日志轮转改为 KeepAll + 启动清理 7 天前日志
- **测试基础设施**：集成 vitest + happy-dom + Tauri mock（log/invoke/fs/path/dialog），新增单元测试覆盖 RetryService、HistoryDatabase、SecureStorage、formatters、useCopyLink、CopyButton 等核心模块
- **Arctic Minimal 色彩体系**：Slate → Zinc 纯灰系；primary Blue 500 → Blue 400；PrimeVue 主题 Sky → Blue；新增 `--primary-alpha-*` 透明度变量（6/8/10/12/15/16/18/20/22/25/30/40/50）
- **配置版本演进**：v6 → v7（LinkOutputConfig）→ v10（GlobalShortcutConfig/AutoUpdateConfig）→ v11（closeToTray）
- **linkFormatter 模块**：提取链接格式化逻辑，新增 custom 格式和模板变量替换能力
- **Tauri 安全加固**：fs/shell 权限收窄至最小原则，简化 CSP 策略，新增 `set_secure_key` 密钥更新命令

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
