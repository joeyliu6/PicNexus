# 知识库

项目开发过程中积累的经验记录，按类型分五个子目录。

## architecture/ — 系统架构

| 文件 | 内容 |
|------|------|
| [overview.md](./architecture/overview.md) | 技术栈、目录结构、核心模块 |
| [frontend.md](./architecture/frontend.md) | Vue 3 前端架构 |
| [backend.md](./architecture/backend.md) | Rust/Tauri 后端架构 |
| [dependencies.md](./architecture/dependencies.md) | 模块依赖图 + 修改检查表 |

## troubleshooting/ — 问题修复 + 踩坑

### 前端 / UI

| 文件 | 内容 |
|------|------|
| [timeline-fixed.md](./troubleshooting/timeline-fixed.md) | 时间线快速滚动闪烁（itemMap 重建 + margin 偏差） |
| [timeline-view-switch-blank.md](./troubleshooting/timeline-view-switch-blank.md) | 切换时间线视图白屏（KeepAlive 缓存 + isLoading 状态） |
| [ui-fixed.md](./troubleshooting/ui-fixed.md) | 表格滚动条 + 骨架屏偏移修复 |
| [upload-queue-status-race-condition.md](./troubleshooting/upload-queue-status-race-condition.md) | 上传队列状态竞态（RAF 节流回调覆盖最终状态） |
| [primevue-scoped-css-width-not-applied.md](./troubleshooting/primevue-scoped-css-width-not-applied.md) | PrimeVue scoped CSS 不生效（`:deep()` 穿透） |
| [primevue-virtualscroller-fixed-itemsize.md](./troubleshooting/primevue-virtualscroller-fixed-itemsize.md) | VirtualScroller itemSize 必须固定值 |

### 前端 / 语言

| 文件 | 内容 |
|------|------|
| [json-parse-type-assertion.md](./troubleshooting/json-parse-type-assertion.md) | `JSON.parse() as T` 无运行时校验陷阱 |
| [vue-watch-object-prop-spread.md](./troubleshooting/vue-watch-object-prop-spread.md) | Vue watch + 对象展开运算符触发意外副作用 |

### 后端 / Tauri

| 文件 | 内容 |
|------|------|
| [sleep-resume-white-screen.md](./troubleshooting/sleep-resume-white-screen.md) | 休眠白屏（SQLite 连接丢失 + WebView reload 失败） |
| [tauri-async-runtime-spawn-no-abort-handle.md](./troubleshooting/tauri-async-runtime-spawn-no-abort-handle.md) | Tauri async_runtime::spawn 无 abort_handle（改用 tokio） |
| [tauri-csp-nonce-blocks-primevue-styles.md](./troubleshooting/tauri-csp-nonce-blocks-primevue-styles.md) | Tauri CSP nonce 阻断 PrimeVue 运行时样式 |

## patterns/ — 设计模式 + 最佳实践

### 设计系统

| 文件 | 内容 |
|------|------|
| [motion-token-system.md](./patterns/motion-token-system.md) | 动效 Token 集中管理 |

### UI / 交互

| 文件 | 内容 |
|------|------|
| [batch-operation-target-first.md](./patterns/batch-operation-target-first.md) | UX 模式：先选目标，自动算范围 |
| [toast-messages-centralization.md](./patterns/toast-messages-centralization.md) | Toast 消息集中管理 |
| [vite-glob-import.md](./patterns/vite-glob-import.md) | import.meta.glob 动态资源加载 |

### 测试

| 文件 | 内容 |
|------|------|
| [playwright-bridge-testing.md](./patterns/playwright-bridge-testing.md) | Playwright Bridge 测试模式 |
| [auto-testing-pipeline.md](./patterns/auto-testing-pipeline.md) | 三层自动化测试流水线 |

### 性能

| 文件 | 内容 |
|------|------|
| [link-check-large-dataset.md](./patterns/link-check-large-dataset.md) | 5 万条记录链接检测性能优化 |

## api/ — API 文档 + 第三方参考

| 文件 | 内容 |
|------|------|
| [composables.md](./api/composables.md) | Vue Composables 导航索引 |
| [rust-commands.md](./api/rust-commands.md) | Rust 命令导航索引 + 进度事件/错误处理 |
| [uploaders.md](./api/uploaders.md) | 上传器导航索引 + 实现列表 |
| [tc-platforms.md](./api/tc-platforms.md) | 图床平台速查（上传限制 + 缩略图格式） |
| [third-party-apis.md](./api/third-party-apis.md) | 第三方库使用约定与陷阱 |

## guides/ — 操作指南

| 文件 | 内容 |
|------|------|
| [add-new-uploader.md](./guides/add-new-uploader.md) | 新增图床完整步骤 |
| [testing-guide.md](./guides/testing-guide.md) | 测试规范与 Mock 策略 |
| [obsidian-plugin-installation.md](./guides/obsidian-plugin-installation.md) | Obsidian 插件的 BRAT、官方目录、手动安装与连接配置 |
| [obsidian-plugin-release.md](./guides/obsidian-plugin-release.md) | Obsidian 插件构建、发布、BRAT 测试与官方提交 |
