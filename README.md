# WeiboDR-Uploader (微博灾备上传器)

一个轻量级的跨平台桌面应用，用于自动完成"上传微博"、"备份到R2"和"生成百度代理链接"三个核心任务。

## 功能特性

- 🚀 **一键上传**: 拖拽图片即可自动完成上传、备份和链接生成
- 🔒 **安全存储**: Cookie 和 R2 密钥使用加密存储
- 📋 **自动复制**: 上传成功后自动复制链接到剪贴板
- 📊 **历史记录**: 保存最近 20 条上传记录
- 🎯 **系统托盘**: 常驻系统托盘，快速访问设置和历史

## 技术栈

- **框架**: Tauri (Rust + TypeScript)
- **前端**: TypeScript + Vite
- **存储**: tauri-plugin-store (加密存储)
- **R2 SDK**: @aws-sdk/client-s3

## 开发环境要求

- Node.js 18+
- Rust 1.70+
- 系统依赖（请参考 [Tauri 官方文档](https://tauri.app/v1/guides/getting-started/prerequisites)）

## 安装与运行

### 1. 安装依赖

```bash
npm install
```

### 2. 开发模式运行

```bash
npm run tauri dev
```

### 3. 构建生产版本

```bash
npm run tauri build
```

## 使用说明

### 首次使用

1. 运行应用后，右键点击系统托盘图标
2. 选择"打开设置"
3. 配置以下信息：
   - **微博 Cookie**: 从 m.weibo.cn 获取的完整 Cookie 字符串
   - **R2 配置** (可选): Cloudflare R2 的账户信息
   - **输出格式**: 选择链接格式（百度代理/微博原始/R2链接）

### 上传图片

1. 将图片文件拖拽到主窗口
2. 等待上传完成
3. 链接会自动复制到剪贴板
4. 系统会弹出成功通知

### 查看历史

- 右键系统托盘图标 → 选择"上传历史"
- 可以查看最近 20 条上传记录
- 点击"复制"按钮快速复制链接

## 项目结构

```
WeiboDR-Uploader/
├── src/                    # 前端源码
│   ├── main.ts            # 主窗口逻辑
│   ├── coreLogic.ts       # 核心上传工作流
│   ├── weiboUploader.ts   # 微博上传实现
│   ├── config.ts          # 配置类型定义
│   ├── settings.ts        # 设置窗口逻辑
│   ├── history.ts         # 历史记录逻辑
│   └── *.html, *.css      # UI 文件
├── src-tauri/             # Rust 后端
│   ├── src/main.rs        # Rust 主文件
│   └── tauri.conf.json    # Tauri 配置
└── package.json           # 项目配置
```

## 核心工作流

1. **步骤 A - 上传微博** (串行, 阻塞性)
   - 使用配置的 Cookie 上传图片到微博
   - 获取返回的 HASH.jpg 文件名和 large 尺寸链接

2. **步骤 B - 备份R2** (并行, 异步)
   - 将原始图片上传到 R2
   - 使用微博返回的 HASH.jpg 作为文件名
   - 失败时仅弹出警告，不影响主流程

3. **步骤 C - 生成链接** (并行)
   - 根据配置的格式生成最终链接
   - 自动复制到剪贴板

## 注意事项

- ⚠️ **微博 API**: 微博的上传接口可能随时变更，如遇问题请检查 Cookie 是否有效
- 🔐 **安全**: 所有敏感信息（Cookie、密钥）均加密存储在本地，不会上传到任何第三方服务器
- 📦 **R2 配置**: R2 备份是可选的，如果未配置将自动跳过

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

