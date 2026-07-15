# PicNexus

<div align="center">

<img src="src-tauri/icons/icon.png" alt="PicNexus" width="128">

**多图床上传工具** — 快捷上传，随处引用

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)]()
[![Version](https://img.shields.io/badge/Version-1.0.10-green)]()

</div>

## 这是什么？

PicNexus 是一个跨平台桌面端图片上传与图床管理工具。选择图床，拖入图片，拿到链接。它支持多图床并行上传、本地历史管理、图片压缩、链接格式输出、剪贴板监听、WebDAV/本地备份同步、编辑器集成等工作流。

## 核心功能

- **多图床并行上传** — 部分服务失败不阻断整体上传。
- **多类图床支持** — 覆盖公共图床、Cookie 登录、Token/API Key、私有对象存储和自定义 S3。
- **图片压缩** — 支持 JPEG、WebP、等比缩放等本地处理。
- **上传历史管理** — SQLite 本地存储，支持分页、搜索、收藏、时间轴浏览。
- **链接格式输出** — Markdown、HTML、BBCode、纯 URL、自定义模板。
- **剪贴板监听** — 截图后可自动上传。
- **配置加密存储** — 敏感配置加密保存，密钥存系统 Keyring。
- **备份与同步** — WebDAV / 本地备份同步。
- **图床健康检测** — 定期检查服务可用性。
- **深浅色主题** — CSS 变量驱动，一键切换。
- **CLI 模式** — 命令行上传。
- **编辑器集成** — 支持 Typora / Obsidian 工作流。

## Obsidian 插件

Obsidian 插件已提交到 [Obsidian Community](https://community.obsidian.md/plugins/picnexus)。官方客户端清单同步后可在 Obsidian 中搜索 `PicNexus`；同步完成前也可以通过 BRAT 从独立仓库安装，或使用 PicNexus Release 附带的 `picnexus-obsidian-*.zip` 手动安装。

插件需要 PicNexus 桌面端保持运行，并在「设置 → 外部编辑器」中启用 Obsidian 集成、选择图床。BRAT、官方目录、手动安装和端口配置步骤见 [Obsidian 插件安装与配置](docs/reference/guides/obsidian-plugin-installation.md)。

## 支持的图床

> 注意：PicNexus 是个人非官方项目，不隶属于任何第三方平台。公共图床和第三方平台适配可能依赖非官方接口或平台行为，可能随时失效，也可能受平台规则限制。请仅在遵守相关平台条款、访问控制和合理使用边界的前提下使用，不要用于绕过限制、滥用公共资源或批量自动化滥用。

| 分类 | 图床 | 认证方式 | 说明 |
|------|------|---------|------|
| 公共图床 · 免配置 | 京东、七鱼 | 无需手动配置 | 非官方适配，风险由用户自行承担 |
| 公共图床 · Cookie 登录 | 微博、知乎、牛客、纳米、B站、超星 | 浏览器 Cookie | 非官方适配，请自行确认平台规则 |
| Token / API Key | SM.MS、GitHub、Imgur | API Token / Client ID | 按对应平台官方规则自行配置 |
| 私有存储 | R2、腾讯云 COS、阿里云 OSS、七牛云、又拍云 | Access Key | 使用用户自己的存储资源 |
| 自定义 S3 | 任何 S3 兼容存储 | Access Key | 使用用户自己的存储资源 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | Vue 3 + TypeScript + Vite |
| UI 组件 | PrimeVue 4 |
| 后端 | Rust + reqwest + tokio |
| 图片处理 | mozjpeg + imagequant + webp |
| 数据库 | SQLite |
| 加密 | AES-GCM + 系统 Keyring |

## 架构概览

```text
Vue 3 前端（Composition API）
├── Views — 上传 / 历史 / 时间轴 / 收藏 / 设置
├── Composables — 业务逻辑复用层
├── Core — MultiServiceUploader 多图床编排 + LinkGenerator 链接生成
├── Uploaders — 工厂 + 策略模式，每个图床一个上传器实现
└── Services — HistoryDatabase (SQLite) + Store (AES-GCM 加密配置)

Rust 后端（Tauri Commands）
├── 各图床上传命令（签名认证 + HTTP 请求）
├── 图片处理（压缩 / 格式转换 / 元数据提取）
└── 系统交互（剪贴板 / 文件系统 / 全局快捷键）
```

**设计亮点：**

- **工厂 + 策略模式** — 上传器可插拔，新增图床只需实现接口。
- **信号量并发控制** — 每图床最多 2 个并发，避免被限流。
- **结构化错误体系** — 统一错误码 + 可重试标记，部分失败不影响整体。
- **加密配置存储** — 敏感信息（Cookie、Token）AES-GCM 加密，密钥存系统 Keyring。
- **配置版本迁移** — 自动从旧版本配置平滑升级。

## 开发

```bash
npm ci
npm run setup:sidecars
npm run tauri dev
```

构建：

```bash
npm run tauri build
```

需要 Node.js 20+、npm 10+ 和 Rust 环境。Sidecar 二进制由源码生成，不提交到 Git；清理后可再次运行 `npm run setup:sidecars` 恢复。

## 免责声明

PicNexus 不提供任何存储服务，也不拥有、运营或代表任何第三方图床/平台。用户使用本软件、配置第三方账号/Cookie/Token/API、上传内容、修改或分发本项目时，应自行确认符合适用法律、Apache-2.0 许可证和相关平台条款，并自行承担对应行为产生的后果。

完整说明见 [DISCLAIMER.md](DISCLAIMER.md)。

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。

公共图床/第三方平台适配代码仅用于帮助用户管理自己的图片工作流。请遵守对应平台规则，不要将本项目用于绕过限流、反盗链、认证校验、访问控制或其他限制，也不要滥用公共图床资源。
