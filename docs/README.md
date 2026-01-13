# PicNexus 开发文档

> 本文档中心为开发者提供架构设计、API 参考和开发指南。

## 快速导航

### 新手入门

| 文档 | 描述 |
|------|------|
| [架构总览](./architecture/overview.md) | 5 分钟了解项目结构 |
| [开发环境搭建](../README.md#开发) | 运行项目 |
| [贡献指南](../CONTRIBUTING.md) | 如何贡献代码 |

### 架构文档

| 文档 | 描述 |
|------|------|
| [架构总览](./architecture/overview.md) | 技术栈、目录结构、核心模块 |
| [前端架构](./architecture/frontend.md) | Vue 3 + TypeScript + PrimeVue |
| [后端架构](./architecture/backend.md) | Rust/Tauri 命令和服务 |
| [数据流](./architecture/data-flow.md) | 上传流程、状态管理、数据存储 |

### API 参考

| 文档 | 描述 |
|------|------|
| [上传器接口](./api/uploaders.md) | IUploader 接口规范和实现指南 |
| [Composables](./api/composables.md) | Vue Composables API 文档 |
| [Rust 命令](./api/rust-commands.md) | Tauri invoke 命令参考 |

### 开发指南

| 文档 | 描述 |
|------|------|
| [添加新图床](./guides/add-new-uploader.md) | 步骤详解：从零实现新图床支持 |

### 规范与约定

| 文档 | 描述 |
|------|------|
| [样式设计](./style-design.md) | CSS 变量体系和主题适配 |
| [测试指南](./testing-guide.md) | 测试规范和用例 |
| [技术决策](./decisions/) | Architecture Decision Records |

### 问题修复记录

| 文档 | 描述 |
|------|------|
| [修复记录索引](./fixes/) | 所有问题修复记录 |
| [时间线优化](./fixes/timeline-fixed.md) | 快速滚动闪烁问题 |
| [UI 修复](./fixes/ui-fixed.md) | 表格滚动条、骨架屏偏移 |

### 外部参考

| 文档 | 描述 |
|------|------|
| [参考文档索引](./references/) | 第三方 API 和服务限制 |
| [第三方 API](./references/third-party-apis.md) | 各图床 API 文档汇总 |
| [TC 图床 API](./references/tc-api.md) | TC 图床接口详解 |
| [TC 限制](./references/tc-limits.md) | TC 图床使用限制 |

---

## 文档维护

本文档采用 **AI 自动化维护** 机制：

1. **代码变更时**：AI 自动更新相关文档和 CHANGELOG
2. **架构变更时**：更新 `.claude/context/` 下的上下文文件
3. **重要修复时**：在 `docs/fixes/` 添加修复记录

详见 [CLAUDE.md](../CLAUDE.md) 中的文档维护规范。

---

## 文档结构

```
docs/
├── README.md                 # 本文件 - 文档索引
├── architecture/             # 架构文档
│   ├── overview.md          # 架构总览
│   ├── frontend.md          # 前端架构
│   ├── backend.md           # 后端架构
│   └── data-flow.md         # 数据流
├── api/                      # API 参考
│   ├── uploaders.md         # 上传器接口
│   ├── composables.md       # Vue Composables
│   └── rust-commands.md     # Rust 命令
├── guides/                   # 开发指南
│   └── add-new-uploader.md  # 添加新图床
├── decisions/                # 技术决策记录
│   └── template.md          # ADR 模板
├── fixes/                    # 问题修复记录
│   ├── README.md            # 修复记录索引
│   ├── timeline-fixed.md    # 时间线优化
│   └── ui-fixed.md          # UI 修复
├── references/               # 外部参考文档
│   ├── README.md            # 参考文档索引
│   ├── third-party-apis.md  # 第三方 API
│   ├── tc-api.md            # TC 图床 API
│   └── tc-limits.md         # TC 限制
├── style-design.md          # 样式设计规范
└── testing-guide.md         # 测试指南
```
