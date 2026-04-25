# CLAUDE.md

## 项目简介

Tauri 2.x（Rust + Vue 3 / TypeScript / PrimeVue 4 + SQLite），详见 `docs/reference/architecture/overview.md`。

## 基础规范

- **中文优先**：所有回复、注释、文档使用简体中文（变量名用英文）
- **小白友好**：遇到复杂概念或方案选择时，必须用大白话额外解释一遍

## 永久规范（修改前必看）

| 规范 | 要求 | 文件 |
|------|------|------|
| ⚠️ API 使用 | **绝对禁止凭空假设 API**，不确定时先 `web_search` 官方文档确认签名/参数/返回值 | — |
| Store 单例 | ❌ 禁止 `new Store()`，必须 import `configStore`/`syncStatusStore` | `src/store/instances.ts` |
| 结构化 Logger | ❌ 禁止 `console.log/warn/error`，使用 `createLogger('Module')` | `src/utils/logger.ts` |
| Config 序列化 | 在 `useConfig.ts` 内部序列化时必须深拷贝（避免 Vue 响应式代理被持久化），禁止直接 `JSON.stringify` 响应式对象 | `src/composables/useConfig.ts` |
| 文件规模 | 单 `.vue` 文件不超过 500 行，超过必须拆分；新建前先查 `src/components/` 无重复 | — |
| 文档同步 | 修改 composable/Rust command 的公开接口时，同步更新对应文档 | `docs/reference/api/` |
| CSS 硬编码 | ❌ 颜色/间距/圆角/字号/动效/z-index 全部禁止硬编码，必须用 CSS 变量 | [tokens.md](docs/design/tokens.md)（[字号](docs/design/tokens.md#typography-scale) · [间距](docs/design/tokens.md#spacing-scale) · [圆角](docs/design/tokens.md#radius-scale) · [z-index](docs/design/tokens.md#z-index-scale)） |
| 弹窗/通知 | 新增 toast/confirm/banner 前先查通道决策树，避免 UI 状态本身已传达的"双重反馈" | [notification-patterns.md](docs/design/notification-patterns.md) |

## 高风险文件

修改以下文件前，必须先确认影响范围：

| 文件 | 修改前必须检查 |
|------|----------------|
| `src/config/types.ts` | DEFAULT_CONFIG、validators、所有使用该类型的模块 |
| `src/uploaders/base/IUploader.ts` | 所有上传器实现（见 `src/uploaders/` 各子目录） |
| `src/services/database/HistoryDatabase.ts` | useHistory、所有历史视图组件 |
| `src/core/MultiServiceUploader.ts` | useUpload.ts、错误处理逻辑 |

详细依赖图见 `docs/reference/architecture/dependencies.md`。

## 文档路由

**开发任何功能前，先读对应的流程图。** 每个流程图末尾有排查指南表格。

| 场景 | 应查阅的文档 |
|------|-------------|
| 上传相关 | `docs/flows/upload-flow.md` |
| 历史记录相关 | `docs/flows/history-flow.md` |
| 同步/备份相关 | `docs/flows/sync-flow.md` |
| 数据持久化（配置/缩略图） | `docs/flows/data-persistence.md` |
| 启动/白屏/Cookie 登录 | `docs/flows/app-lifecycle.md` |
| 链接检测/压缩 | `docs/flows/auxiliary-flows.md` |
| 链接检测（深度） | `docs/flows/link-check-flow.md` |
| 多图床镜像 fallback / 切换主服务 / 删除镜像 | `docs/flows/mirror-fallback-flow.md` |
| 文档修复 | `docs/flows/md-rescue-flow.md` |
| 批量迁移 | `docs/flows/batch-migrate-flow.md` |
| Tauri 命令/事件（新增 command、改 IPC） | `docs/flows/ipc-command-flow.md` |
| 数据库 schema 迁移（加字段/改索引） | `docs/flows/db-migration-flow.md` |
| 窗口/托盘/快捷键/CLI 参数 | `docs/flows/window-system-integration.md` |
| 日志/诊断/用户报障 | `docs/flows/logger-diagnostics-flow.md` |
| 自动更新/发布签名 | `docs/flows/auto-update-flow.md` |
| 设置面板/主题切换/新增配置项 | `docs/flows/settings-ui-architecture.md` |
| 新功能规划/定位代码层级 | `docs/flows/system-overview.md` |
| 新功能开发 | `docs/reference/patterns/`、`docs/reference/guides/`、`docs/reference/architecture/` |
| 调试/报错 | `docs/reference/troubleshooting/` |
| UI/样式 | `docs/design/`（[tokens](docs/design/tokens.md) · [themes](docs/design/themes.md) · [ui-patterns](docs/design/ui-patterns.md) · [settings-layout](docs/design/settings-layout.md)） |
| 性能问题 | `docs/reference/patterns/link-check-large-dataset.md` |
| API/接口规范 | `docs/reference/api/` |

> 🤖 本表的 `flows/` 路由已通过 [scripts/claude-hooks/flows-router.mjs](scripts/claude-hooks/flows-router.mjs) + UserPromptSubmit hook 自动触发：关键词命中时会把对应 flow 路径作为 system-reminder 注入 Claude Code 上下文。**修改或删除 hook 前请先理解这套机制**（配置见 [.claude/settings.json](.claude/settings.json)）。

## 提交约定

- 原子提交：每个提交 = 一个逻辑单元，3+ 文件改动至少 2 次提交
- 格式：`<type>(<scope>): <description>`，类型: feat/fix/docs/style/refactor/test/chore
