# WeiboDR-Uploader

<div align="center">

**多图床并行上传工具 - 支持 5 个图床服务的跨平台桌面应用**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)]()
[![Version](https://img.shields.io/badge/Version-3.0-green)]()
[![图床数量](https://img.shields.io/badge/%E5%9B%BE%E5%BA%8A%E6%95%B0%E9%87%8F-5%E4%B8%AA-brightgreen)]()
[![架构](https://img.shields.io/badge/%E6%9E%B6%E6%9E%84-%E6%8F%92%E4%BB%B6%E5%8C%96-orange)]()

[简体中文](#) | [English](#)

</div>

---

## 📖 目录

- [项目简介](#-项目简介)
- [核心特性](#-核心特性)
- [图床对比](#-图床对比)
- [技术栈](#-技术栈)
- [快速开始](#-快速开始)
- [使用指南](#-使用指南)
- [配置说明](#-配置说明)
- [常见问题](#-常见问题)
- [项目结构](#-项目结构)
- [开发指南](#-开发指南)
- [文档导航](#-文档导航)
- [许可证](#-许可证)

---

## 🎯 项目简介

WeiboDR-Uploader 是一个基于 Tauri 框架开发的**多图床并行上传工具**，支持 5 个图床服务的跨平台桌面应用。通过插件化架构设计，实现多图床并行上传、智能备份和链接管理。

### 为什么选择 WeiboDR-Uploader v3.0？

- 🚀 **开箱即用** - TCL 和京东图床零配置，安装即用
- ⚡ **并行上传** - 最多 3 个图床同时上传，第一个成功作为主力
- 🔧 **插件化架构** - 基于 IUploader 接口，轻松扩展新图床
- 🔒 **安全可靠** - 所有敏感信息加密存储在本地（AES-GCM）
- 📊 **实时监控** - 每个图床独立进度显示
- 💾 **多重备份** - 支持 5 个图床互为冗余，数据永不丢失
- 🎯 **智能管理** - 历史记录网格视图、按图床筛选、WebDAV 同步
- 🌐 **跨平台** - Windows/macOS/Linux 通用

---

## ✨ 核心特性

### 1. 多图床并行上传

**支持 5 个图床服务**：
- **微博图床** - 需要 Cookie（30 天有效期）
- **Cloudflare R2** - 需要 API 密钥（永久有效）
- **TCL 图床** - 开箱即用，零配置 ✨
- **京东图床** - 开箱即用，速度极快 ✨
- **牛客图床** - 需要 Cookie（7-30 天有效期）

**并行上传特性**：
- 最多 3 个图床同时上传
- 每个图床独立进度显示
- 第一个上传成功的作为主力图床
- 其他图床自动成为备份（互为冗余）
- 智能降级：某个图床失败不影响其他

### 2. 开箱即用图床

**TCL 图床**：
- ✅ 无需配置，直接使用
- ✅ 稳定性高（⭐⭐⭐⭐）
- ✅ 速度快（⭐⭐⭐⭐）
- ✅ 适合日常使用

**京东图床**：
- ✅ 无需配置，直接使用
- ✅ 稳定性极高（⭐⭐⭐⭐⭐）
- ✅ 速度极快（⭐⭐⭐⭐⭐）
- ✅ 适合追求速度的场景

### 3. 需要配置的图床

**微博图床**：
- 需要获取 Cookie（约 10 分钟）
- Cookie 约 30 天过期
- 支持微博代理前缀管理
- 适合短期使用和对微博链接有需求的场景
- 配置指南：[微博 Cookie 获取指南](docs/guides/OFFICIAL_LOGIN_GUIDE.md)

**Cloudflare R2**：
- 需要 API 密钥（约 30 分钟配置）
- API 密钥永久有效
- 适合长期存储和重要图片备份
- 商业级稳定性
- 配置指南：[Cloudflare R2 配置指南](docs/guides/R2_SETUP_GUIDE.md)

**牛客图床**：
- 需要 Cookie（约 10 分钟）
- Cookie 约 7-30 天过期
- 适合技术博客配图
- 配置指南：[牛客图床配置指南](docs/guides/NOWCODER_SETUP_GUIDE.md)

### 4. 智能链接管理

**微博代理前缀管理**：
- 支持多个代理前缀（百度图片代理、CDN JSON 等）
- 快速切换代理前缀
- 自定义前缀添加和删除
- 提高微博图片访问稳定性

### 5. 历史记录管理

- **表格视图** - 显示详细信息（文件名、时间、所有图床链接）
- **网格视图（照片墙）** - 大图预览，视觉化浏览
- **图床筛选** - 按图床类型筛选（全部/微博/R2/TCL/京东/牛客）
- **批量操作** - 复制、导出、删除
- **懒加载优化** - 每次加载 50 条，流畅体验
- **WebDAV 同步** - 自动备份到 WebDAV 服务（坚果云、Nextcloud 等）

### 6. R2 文件管理器

- 网格布局展示 R2 存储桶中的所有图片
- 预览与下载：点击图片查看大图和原始链接
- 批量删除：删除不需要的图片文件
- 智能缓存：按需刷新机制，减少 API 调用

### 7. 配置与测试

- 自动保存：配置修改后自动保存，无需手动点击
- 连接测试：提供各图床的连接测试功能
- 加密存储：使用 AES-GCM 加密存储敏感信息
- 详细反馈：测试失败时提供详细错误信息和解决建议

---

## 📊 图床对比

| 图床 | 配置难度 | 稳定性 | 速度 | Cookie/密钥 | 有效期 | 推荐场景 |
|------|---------|--------|------|------------|--------|---------|
| **TCL** | ⭐ 零配置 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 无需 | 长期 | 日常使用 |
| **京东** | ⭐ 零配置 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 无需 | 长期 | 追求速度 |
| **微博** | ⭐⭐⭐ 简单 | ⭐⭐⭐ | ⭐⭐⭐ | Cookie | 30天 | 短期使用 |
| **R2** | ⭐⭐⭐⭐ 复杂 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | API 密钥 | 永久 | 长期存储 |
| **牛客** | ⭐⭐⭐ 简单 | ⭐⭐⭐ | ⭐⭐⭐ | Cookie | 7-30天 | 技术博客 |

**推荐组合**：
- **新手推荐**：TCL + 京东（零配置，开箱即用）
- **日常使用**：TCL + 京东 + 微博（多种链接格式）
- **重要图片**：TCL + 京东 + R2（三重保障）
- **完整配置**：微博 + R2 + TCL + 京东 + 牛客（最大冗余）

---

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Tauri** | 1.5.x | 跨平台桌面应用框架 |
| **Vue 3** | 3.5.x | UI 框架 |
| **TypeScript** | 5.3.x | 前端开发语言 |
| **Rust** | 1.70+ | 后端开发语言 |
| **Vite** | 5.0.x | 前端构建工具 |
| **AWS SDK (S3)** | 3.490+ | Cloudflare R2 交互 |

**架构特性**：
- 插件化上传器设计（IUploader 接口 + BaseUploader 抽象类）
- 工厂模式管理上传器（UploaderFactory）
- 多图床编排器（MultiServiceUploader）
- AES-GCM 加密本地存储

---

## 🚀 快速开始

### 零配置体验（推荐新手）

1. **下载并安装应用**
   - 下载最新版本的安装包
   - 双击运行安装程序

2. **打开应用**
   - 启动 WeiboDR-Uploader

3. **选择图床**
   - 在上传窗口勾选 **TCL** 或 **京东**（或两者都勾选）

4. **上传图片**
   - 拖拽图片到上传区域，或点击选择文件
   - 立即开始上传！

**就是这么简单！** 🎉 无需任何配置，TCL 和京东图床开箱即用。

### 配置其他图床（可选）

如果需要更多图床选项，可以配置以下图床：

- [微博 Cookie 获取指南](docs/guides/OFFICIAL_LOGIN_GUIDE.md) - 约 10 分钟
- [Cloudflare R2 配置指南](docs/guides/R2_SETUP_GUIDE.md) - 约 30 分钟
- [牛客图床配置指南](docs/guides/NOWCODER_SETUP_GUIDE.md) - 约 10 分钟
- [TCL 和京东使用指南](docs/guides/TCL_JD_GUIDE.md) - 了解更多

### 环境要求（开发者）

在开始开发之前，请确保已安装以下环境：

- **Node.js** 18.0 或更高版本
- **Rust** 1.70 或更高版本
- **系统依赖**（根据操作系统）

#### Windows
- Microsoft Visual C++ Build Tools
- 下载地址：https://visualstudio.microsoft.com/visual-cpp-build-tools/

#### macOS
```bash
xcode-select --install
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

### 安装步骤（开发者）

#### 1. 克隆项目
```bash
git clone <repository-url>
cd WeiboDR-Uploader
```

#### 2. 安装依赖
```bash
npm install
```

#### 3. 开发模式运行
```bash
npm run tauri dev
```

#### 4. 构建生产版本
```bash
npm run tauri build
```

构建完成后，可执行文件位于：
- **Windows**: `src-tauri/target/release/WeiboDR-Uploader.exe`
- **macOS**: `src-tauri/target/release/bundle/macos/WeiboDR-Uploader.app`
- **Linux**: `src-tauri/target/release/weibodr-uploader`

---

## 📚 使用指南

### 1. 选择图床

在上传窗口勾选要使用的图床（建议勾选 2-3 个互为备份）。

**推荐组合**：
- **日常使用**：TCL + 京东
- **重要图片**：TCL + 京东 + R2
- **临时图片**：仅 TCL 或京东

### 2. 上传图片

#### 方式一：拖拽上传
1. 将图片文件拖拽到上传区域
2. 有效文件会自动添加到上传队列
3. 实时查看每个图床的上传进度
4. 上传完成后点击按钮复制链接

#### 方式二：点击上传
1. 点击上传区域
2. 在文件对话框中选择一个或多个图片
3. 后续流程同拖拽上传

**支持的文件格式**：jpg、jpeg、png、gif、bmp、webp

**并发上传**：最多同时上传 3 个图床，超过部分会自动排队等待

### 3. 查看进度

每个图床独立显示上传进度：
- **等待中** - 灰色
- **上传中** - 蓝色进度条（显示百分比）
- **成功** - 绿色勾选标记
- **失败** - 红色叉号（显示错误信息）

**主力图床标识**：第一个上传成功的图床会被标记为"主力"，其他为"备份"。

### 4. 复制链接

上传完成后，可以复制以下格式的链接：
- **主力图床链接** - 第一个成功的图床链接
- **微博原始链接** - 微博图床原始 URL
- **微博代理链接** - 带代理前缀的微博链接
- **R2 链接** - Cloudflare R2 公开访问链接
- **其他图床链接** - TCL、京东、牛客的链接

### 5. 管理历史记录

#### 表格视图
- 显示详细信息（文件名、上传时间、图床链接）
- 支持排序和搜索
- 适合管理和查找

#### 网格视图（照片墙）
- 大图预览，视觉化浏览
- 懒加载优化（每次加载 50 条）
- 点击图片查看大图

#### 图床筛选
支持按图床类型筛选历史记录：
- **全部** - 显示所有历史记录
- **微博** - 只显示微博上传的记录
- **R2** - 只显示 R2 上传的记录
- **TCL** - 只显示 TCL 上传的记录
- **京东** - 只显示京东上传的记录
- **牛客** - 只显示牛客上传的记录

#### WebDAV 自动备份
配置 WebDAV 后，历史记录会自动同步到云端（坚果云、Nextcloud 等）。

配置指南：[WebDAV 自动备份配置](docs/guides/WEBDAV_SETUP_GUIDE.md)

### 6. 管理 R2 文件

1. 点击左侧导航栏的 **R2 管理器** 按钮
2. 首次进入会自动加载 R2 存储桶中的所有图片
3. 点击图片可查看大图和原始链接
4. 点击删除按钮可删除不需要的文件
5. 刷新按钮可手动重新加载列表

---

## ⚙️ 配置说明

### 微博代理前缀管理

**功能说明**：为微博图床链接添加代理前缀，提高访问稳定性和速度。

**预设前缀**：
1. **百度图片代理**：`https://image.baidu.com/search/down?thumburl=`
2. **CDN JSON**：`https://cdn.cdnjson.com/pic.html?url=`

**使用方法**：
1. 在设置页面找到"链接前缀管理"部分
2. 勾选"使用链接前缀"以启用
3. 从下拉菜单选择要使用的前缀
4. 配置自动保存

**自定义前缀**：
1. 点击"添加自定义前缀"按钮
2. 输入前缀 URL（必须以 `https://` 开头）
3. 点击"保存"
4. 新前缀会出现在下拉菜单中

**注意事项**：
- 前缀只对微博图床有效
- 预设前缀无法删除
- 删除前缀不会影响已上传的图片链接

### 自动保存机制

v3.0 所有配置修改后自动保存，无需手动点击保存按钮。

**保存时机**：
- 输入框失去焦点时
- 下拉菜单选择后
- 复选框状态改变后

**保存确认**：页面底部会显示"✓ 已自动保存"消息

### 安全性说明

- **本地存储** - 所有配置信息存储在本地，使用 AES-GCM 加密
- **不上传数据** - 不会向任何第三方服务器发送敏感信息
- **Cookie 安全** - Cookie 仅用于对应图床上传，不会被滥用
- **密钥保护** - R2 密钥和 WebDAV 密码加密存储

---

## ❓ 常见问题

### Q1: 推荐使用哪个图床？

**A**: 根据使用场景选择：

- **新手**：TCL + 京东（零配置，开箱即用）
- **日常使用**：TCL + 京东 + 微博（多种链接格式）
- **重要图片**：TCL + 京东 + R2（三重保障，长期稳定）
- **技术博客**：TCL + 京东 + 牛客（适合技术内容）

### Q2: 必须配置所有图床吗？

**A**: 不需要。TCL 和京东开箱即用，其他图床根据需求选择配置。

### Q3: Cookie 多久过期？

**A**:
- **微博**：约 30 天
- **牛客**：约 7-30 天
- **R2**：API 密钥永久有效（除非手动删除）

过期后按照对应指南重新获取即可。

### Q4: 可以同时上传多少个图床？

**A**: 最多 **3 个图床并行上传**，超过部分会自动排队等待。这是为了避免过多并发请求导致失败。

### Q5: 微博上传失败，提示 Cookie 无效？

**A**: 可能的原因和解决方法：

1. **Cookie 过期** - 微博 Cookie 通常 30 天过期，请重新获取
2. **从错误的地方获取** - 必须从 **m.weibo.cn**（移动版）获取，不能从 weibo.com（桌面版）获取
3. **Cookie 不完整** - 确保复制了完整的 Cookie 字符串，包含 SUB、SUBP 等字段
4. **网络问题** - 检查网络连接是否正常

详见：[微博 Cookie 获取指南](docs/guides/OFFICIAL_LOGIN_GUIDE.md)

### Q6: R2 备份失败，提示 CORS 错误？

**A**: 这是最常见的 R2 问题。解决方法：

1. 在 Cloudflare R2 Dashboard 中进入您的存储桶
2. 点击 **Settings** → **CORS Policy**
3. 添加 CORS 规则（参考 [R2 配置指南](docs/guides/R2_SETUP_GUIDE.md)）
4. 保存后等待几分钟让设置生效
5. 重新测试连接

### Q7: 可以和其他图床工具一起使用吗？

**A**: 可以！WeiboDR-Uploader 是独立的桌面应用，不会影响浏览器插件或其他图床工具的使用。

### Q8: 历史记录最多保存多少条？

**A**: 默认保存最近 **500 条**记录。WebDAV 备份会保存完整的历史记录 JSON 文件。

### Q9: 如何备份配置？

**A**: 配置文件位于：
- **Windows**: `%APPDATA%\com.weibodr.uploader\`
- **macOS**: `~/Library/Application Support/com.weibodr.uploader/`
- **Linux**: `~/.config/com.weibodr.uploader/`

可以手动备份该目录下的配置文件。

### Q10: 图片无法访问怎么办？

**A**:
1. 检查网络连接
2. 尝试使用其他图床的链接（如果有备份）
3. 对于微博链接，尝试切换代理前缀或使用原始链接
4. 如果所有图床都失败，建议重新上传

---

## 📁 项目结构

```
WeiboDR-Uploader/
├── src/                          # 前端源码
│   ├── uploaders/                # 图床上传器（插件化）
│   │   ├── base/                # 基础抽象
│   │   │   ├── IUploader.ts     # 核心接口
│   │   │   ├── BaseUploader.ts  # 抽象基类
│   │   │   ├── UploaderFactory.ts # 工厂模式
│   │   │   └── types.ts         # 共享类型
│   │   ├── weibo/               # 微博上传器
│   │   │   ├── WeiboUploader.ts
│   │   │   └── WeiboError.ts
│   │   ├── r2/                  # R2 上传器
│   │   │   ├── R2Uploader.ts
│   │   │   └── R2Error.ts
│   │   ├── tcl/                 # TCL 上传器
│   │   │   └── TCLUploader.ts
│   │   ├── jd/                  # 京东上传器
│   │   │   └── JDUploader.ts
│   │   └── nowcoder/            # 牛客上传器
│   │       └── NowcoderUploader.ts
│   ├── core/                    # 核心业务逻辑
│   │   ├── MultiServiceUploader.ts  # 多图床编排器
│   │   ├── UploadOrchestrator.ts    # 流程编排
│   │   └── LinkGenerator.ts         # URL 生成
│   ├── config/                  # 配置管理
│   │   └── types.ts             # 配置类型定义
│   ├── ui/                      # UI 组件模块
│   │   └── modal.ts             # 模态框管理
│   ├── components/              # Vue 组件
│   │   └── BackupView.vue       # 备份视图
│   ├── main.ts                  # 应用入口
│   ├── uploadQueue.ts           # 上传队列管理
│   ├── r2-manager.ts            # R2 管理器逻辑
│   ├── store.ts                 # 本地存储操作封装
│   ├── crypto.ts                # AES-GCM 加密
│   └── style.css                # 全局样式
│
├── src-tauri/                   # Rust 后端
│   ├── src/
│   │   ├── commands/            # Rust 命令实现
│   │   │   ├── weibo.rs         # 微博上传
│   │   │   ├── r2.rs            # R2 上传
│   │   │   ├── tcl.rs           # TCL 上传
│   │   │   ├── jd.rs            # 京东上传
│   │   │   └── nowcoder.rs      # 牛客上传
│   │   └── main.rs              # Tauri 主文件
│   ├── Cargo.toml               # Rust 依赖配置
│   ├── tauri.conf.json          # Tauri 应用配置
│   └── icons/                   # 应用图标
│
├── docs/                        # 文档目录
│   ├── guides/                  # 用户指南
│   │   ├── README.md            # 指南索引
│   │   ├── OFFICIAL_LOGIN_GUIDE.md # 微博 Cookie 获取
│   │   ├── R2_SETUP_GUIDE.md    # R2 配置
│   │   ├── NOWCODER_SETUP_GUIDE.md # 牛客配置
│   │   ├── TCL_JD_GUIDE.md      # TCL/京东使用指南
│   │   ├── SETTINGS_V3_USER_GUIDE.md # v3.0 设置指南
│   │   ├── WEBDAV_SETUP_GUIDE.md # WebDAV 配置
│   │   └── WEBDAV_PATH_GUIDE.md  # WebDAV 路径说明
│   └── archive/                 # 历史文档
│
├── index.html                   # 主窗口 HTML
├── package.json                 # Node.js 依赖和脚本
├── tsconfig.json                # TypeScript 配置
├── vite.config.ts               # Vite 构建配置
├── README.md                    # 项目文档（本文件）
├── CHANGELOG.md                 # 更新日志
├── CONTRIBUTING.md              # 贡献指南
├── record.md                    # 开发记录
└── .gitignore                   # Git 忽略规则
```

### 核心模块说明

| 模块 | 文件 | 功能 |
|------|------|------|
| **插件化上传器** | `src/uploaders/` | 所有图床上传器实现 |
| **多图床编排** | `src/core/MultiServiceUploader.ts` | 并行上传调度和编排 |
| **配置管理** | `src/config/types.ts` | UserConfig、HistoryItem 类型定义 |
| **加密存储** | `src/store.ts` + `src/crypto.ts` | AES-GCM 加密的配置存储 |
| **上传队列** | `src/uploadQueue.ts` | 上传队列管理和进度跟踪 |
| **R2 管理** | `src/r2-manager.ts` | R2 文件浏览、删除、刷新 |
| **Rust 后端** | `src-tauri/src/commands/` | 各图床的 Rust 上传实现 |

---

## 🔧 开发指南

### 代码风格规范

项目遵循严格的代码风格规范，详见 `.cursorrules` 文件。

**TypeScript:**
- 使用 TypeScript 严格模式
- 函数使用 `async/await` 处理异步操作
- 使用 `const` 和 `let`，避免 `var`
- 函数和变量使用驼峰命名（camelCase）
- 所有错误处理必须包含详细的错误信息

**Rust:**
- 遵循 Rust 官方代码风格（rustfmt）
- 使用 `Result<T, E>` 进行错误处理
- 函数名使用 snake_case
- 添加文档注释（`///`）

### 添加新图床

基于插件化架构，添加新图床非常简单：

#### 1. 定义配置类型 (`src/config/types.ts`)
```typescript
interface NewServiceConfig extends BaseServiceConfig {
  apiKey: string;
  // ... 其他字段
}
```

#### 2. 实现 TypeScript 上传器 (`src/uploaders/newsvc/NewUploader.ts`)
```typescript
export class NewUploader extends BaseUploader {
  readonly serviceId = 'newsvc';
  readonly serviceName = '新图床';

  protected getRustCommand(): string {
    return 'upload_to_newsvc';
  }

  async validateConfig(config: any): Promise<ValidationResult> {
    // 验证配置
  }

  async upload(filePath, options, onProgress?): Promise<UploadResult> {
    const result = await this.uploadViaRust(filePath, {...}, onProgress);
    return { serviceId: 'newsvc', fileKey: ..., url: ... };
  }

  getPublicUrl(result: UploadResult): string {
    return result.url;
  }
}
```

#### 3. 注册到工厂 (`src/uploaders/base/UploaderFactory.ts`)
```typescript
case 'newsvc':
  return new NewUploader();
```

#### 4. 实现 Rust 命令 (`src-tauri/src/commands/newsvc.rs`)
```rust
#[tauri::command]
async fn upload_to_newsvc(id: String, file_path: String, api_key: String)
    -> Result<NewUploadResult, String> {
  // 实现上传逻辑
}
```

#### 5. 更新配置类型
将 `'newsvc'` 添加到 `ServiceType` 类型定义

详细开发指南请查看 [开发记录](record.md)

### 调试技巧

**前端调试**：
```bash
# 开发模式运行（自动打开 DevTools）
npm run tauri dev
```

**后端调试**：
```rust
// 在 main.rs 中添加日志
println!("[Rust] Debug info: {:?}", variable);
```

**查看应用日志**：
- Windows: `%APPDATA%\com.weibodr.uploader\logs\`
- macOS: `~/Library/Application Support/com.weibodr.uploader/logs/`
- Linux: `~/.config/com.weibodr.uploader/logs/`

### 贡献指南

欢迎提交 Issue 和 Pull Request！

**提交 PR 前请确保**：
1. 代码符合项目规范
2. 所有功能正常工作
3. 没有 TypeScript 或 Rust 编译错误
4. 添加了必要的注释和文档
5. 测试了主要功能流程

详见：[贡献指南](CONTRIBUTING.md)

---

## 📚 文档导航

### 快速开始
- [README.md](README.md) - 项目主文档（本文件）
- [CHANGELOG.md](CHANGELOG.md) - 版本更新记录
- [TCL/京东图床使用指南](docs/guides/TCL_JD_GUIDE.md) - 零配置快速开始

### 配置指南
- [微博 Cookie 获取](docs/guides/OFFICIAL_LOGIN_GUIDE.md) - 10 分钟
- [Cloudflare R2 配置](docs/guides/R2_SETUP_GUIDE.md) - 30 分钟
- [牛客图床配置](docs/guides/NOWCODER_SETUP_GUIDE.md) - 10 分钟
- [WebDAV 自动备份](docs/guides/WEBDAV_SETUP_GUIDE.md) - 15 分钟

### 完整指南
- [v3.0 设置完全指南](docs/guides/SETTINGS_V3_USER_GUIDE.md) - 所有配置选项详解
- [用户指南索引](docs/guides/README.md) - 所有指南列表

### 开发文档
- [开发记录](record.md) - v3.0 架构演进和技术细节
- [贡献指南](CONTRIBUTING.md) - 如何参与开发

### 历史文档
- [docs/archive/](docs/archive/) - v1.x 和 v2.x 历史文档

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

```
MIT License

Copyright (c) 2025 WeiboDR-Uploader

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 🎉 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Weibo-Picture-Store](https://github.com/Semibold/Weibo-Picture-Store) - 微博图床上传参考
- [Cloudflare R2](https://www.cloudflare.com/products/r2/) - 对象存储服务
- [AWS SDK for JavaScript](https://aws.amazon.com/sdk-for-javascript/) - S3 兼容 SDK

---

## 📮 联系方式

- **Issues**: [GitHub Issues](https://github.com/your-username/WeiboDR-Uploader/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/WeiboDR-Uploader/discussions)

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐ Star！**

Made with ❤️ by WeiboDR-Uploader Team

[⬆ 回到顶部](#weibodr-uploader)

</div>
