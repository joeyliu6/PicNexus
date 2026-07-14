# PicNexus 开发文档

> 四件套：CLAUDE.md（指挥中心）、flows/（流程图）、design/（设计规范）、reference/（知识库）

## 目录结构

```
docs/
├── flows/              # 📊 流程图（Mermaid 格式）
│   ├── system-overview.md        # 系统总览
│   ├── app-lifecycle.md          # 启动/白屏/Cookie 登录
│   ├── upload-flow.md            # 上传流程
│   ├── history-flow.md           # 历史记录
│   ├── sync-flow.md              # 同步/备份
│   ├── data-persistence.md       # 配置/缩略图持久化
│   ├── auxiliary-flows.md        # 链接检测/压缩
│   ├── link-check-flow.md        # 链接检测（深度）
│   ├── md-rescue-flow.md         # 文档修复
│   ├── batch-migrate-flow.md     # 批量迁移
│   ├── ipc-command-flow.md       # Tauri 命令/事件
│   ├── db-migration-flow.md      # 数据库 schema 迁移
│   ├── window-system-integration.md  # 窗口/托盘/快捷键
│   ├── logger-diagnostics-flow.md    # 日志/诊断
│   ├── auto-update-flow.md       # 自动更新/发布签名
│   └── settings-ui-architecture.md   # 设置面板/主题
├── design/             # 🎨 设计规范
│   ├── README.md       # 核心原则 + 文件结构
│   ├── tokens.md       # CSS 变量体系
│   ├── themes.md       # 主题适配 + PrimeVue
│   ├── ui-patterns.md  # UI 模式 + 最佳实践
│   └── settings-layout.md  # 设置页面排版
└── reference/          # 📚 知识库
    ├── architecture/     # 🏗 系统架构
    │   ├── overview.md   # 技术栈、目录结构
    │   ├── frontend.md   # Vue 3 前端架构
    │   ├── backend.md    # Rust/Tauri 后端架构
    │   └── dependencies.md # 模块依赖
    ├── troubleshooting/  # 问题修复 + 踩坑记录
    ├── patterns/         # 设计模式 + 最佳实践
    ├── api/              # API 文档 + 第三方参考
    └── guides/           # 操作指南
```

## 快速导航

| 我要做什么 | 去哪里 |
|-----------|--------|
| 了解项目架构 | [reference/architecture/overview.md](./reference/architecture/overview.md) |
| 开发新功能 | 先读 [flows/](./flows/) 对应流程图 |
| 查 CSS 变量 | [design/tokens.md](./design/tokens.md) |
| 改设置页面 | [design/settings-layout.md](./design/settings-layout.md) |
| 遇到 bug | [reference/troubleshooting/](./reference/troubleshooting/) |
| 查 API 接口 | [reference/api/](./reference/api/) |
| 新增图床 | [reference/guides/add-new-uploader.md](./reference/guides/add-new-uploader.md) |
| 安装 Obsidian 插件 | [reference/guides/obsidian-plugin-installation.md](./reference/guides/obsidian-plugin-installation.md) |

> **flows/ vs reference/guides/ 的区别**：
> - `flows/` = 系统流程（"系统是怎么运转的"，Mermaid 图为主，运行时视角）
> - `guides/` = 操作流程（"人该怎么一步步操作"，步骤清单为主，开发者视角）

---

## 文档维护

### 何时新建 vs 更新

- **新建**：全新的业务流程、全新的踩坑记录、全新的设计模式
- **更新**：已有文档覆盖的主题发生了变化（比如流程新增了分支）
- **原则**：一个主题只有一个信息源，不要在两个地方写同一件事

### troubleshooting 条目模板

每个 troubleshooting 文件应包含：

1. **问题现象** — 一句话描述用户看到了什么
2. **根因分析** — 为什么会出现这个问题
3. **解决方案** — 改了什么、怎么改的
4. **关联文件** — 涉及的源码路径

### 文档清理

- 删除功能对应的代码时，同步删除或更新相关文档
- 每次大版本发布前，检查 `reference/` 下的文件是否仍然适用
- 已废弃的文档直接删除，不留 deprecated 标记（git 历史可追溯）
