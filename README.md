# PicNexus

<div align="center">

**多图床并行上传工具** - 支持 8 个图床，3 个零配置开箱即用

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)]()
[![Version](https://img.shields.io/badge/Version-3.0.0-green)]()

</div>

---

## 核心特性

- **8 图床并行上传** - 同时上传到多个图床，互为备份
- **3 个零配置图床** - TCL、京东、七鱼开箱即用，无需任何设置
- **本地加密存储** - 所有敏感信息 AES-GCM 加密，数据不上传云端
- **跨平台支持** - Windows、macOS、Linux 通用

---

## 快速开始

### 零配置体验（推荐新手）

1. 下载安装应用
2. 勾选 **TCL**、**京东** 或 **七鱼**（默认已启用 TCL 和京东）
3. 拖拽图片到上传区域，完成！

**支持格式**：jpg、jpeg、png、gif、bmp、webp

---

## 支持的图床

### 一览表

| 图床 | 配置难度 | 稳定性 | 速度 | 有效期 | 推荐场景 |
|------|---------|--------|------|--------|---------|
| **TCL** | ⭐ 零配置 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 长期 | 日常使用 |
| **京东** | ⭐ 零配置 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 长期 | 追求速度 |
| **七鱼** | ⭐ 零配置 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 长期 | 企业级稳定 |
| **微博** | ⭐⭐ Cookie | ⭐⭐⭐ | ⭐⭐⭐ | ~30天 | 短期使用 |
| **知乎** | ⭐⭐ Cookie | ⭐⭐⭐ | ⭐⭐⭐ | ~30天 | 知乎发文 |
| **牛客** | ⭐⭐ Cookie | ⭐⭐⭐ | ⭐⭐⭐ | ~7-30天 | 技术博客 |
| **纳米** | ⭐⭐⭐ Cookie+Token | ⭐⭐⭐ | ⭐⭐⭐ | ~30天 | 博客托管 |
| **R2** | ⭐⭐⭐⭐ API密钥 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 永久 | 长期存储 |

### 推荐组合

- **新手入门**：TCL + 京东（零配置，开箱即用）
- **日常使用**：TCL + 京东 + 七鱼（三重备份）
- **重要图片**：TCL + 京东 + R2（长期稳定存储）
- **完整配置**：全部 8 个图床（最大冗余）

---

## 图床配置说明

### 零配置图床（无需设置）

**TCL、京东、七鱼** 这 3 个图床开箱即用，直接勾选即可上传。

### 需要 Cookie 的图床

#### 微博
1. 访问 [m.weibo.cn](https://m.weibo.cn) 并登录（必须是移动版）
2. 按 `F12` → Network → 刷新页面
3. 点击任意请求，复制 `Cookie` 请求头的值
4. 粘贴到应用设置中

#### 知乎
1. 访问 [zhihu.com](https://www.zhihu.com) 并登录
2. 按 `F12` → Network → 刷新页面
3. 点击任意请求，复制 `Cookie` 请求头的值
4. 粘贴到应用设置中

#### 牛客
1. 访问 [nowcoder.com](https://www.nowcoder.com) 并登录
2. 按 `F12` → Network → 刷新页面
3. 点击任意请求，复制 `Cookie` 请求头的值
4. 粘贴到应用设置中

#### 纳米
1. 访问 [nami.cc](https://nami.cc) 并登录
2. 按 `F12` → Network → 刷新页面
3. 复制 `Cookie` 和 `Auth-Token` 请求头的值
4. 分别粘贴到应用设置中

### 需要 API 密钥的图床

#### Cloudflare R2
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 R2 Object Storage，创建存储桶
3. 创建 API Token（权限：对象读写）
4. **配置 CORS**（必须，否则无法上传）：
```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"]
  }
]
```
5. 在应用设置中填入：Account ID、Access Key ID、Secret Access Key、Bucket Name

---

## 功能介绍

### 上传功能
- 拖拽或点击上传图片
- 多图床并行上传，每个图床独立进度显示
- 第一个成功的为主力图床，其他为备份
- 某个图床失败不影响其他

### 历史记录
- **表格视图**：显示详细信息
- **网格视图**：照片墙大图预览
- 按图床筛选、批量复制链接、删除记录

### R2 文件管理
- 浏览 R2 存储桶中的所有图片
- 预览、下载、批量删除

### 链接检测
- 批量检测历史记录中的链接是否有效
- 按图床筛选、导出检测报告

### 备份与同步
- 本地导入/导出配置和历史记录
- WebDAV 自动同步（支持坚果云、Nextcloud 等）

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Tauri | 1.5.x | 跨平台桌面框架 |
| Vue 3 | 3.5.x | 前端框架 |
| TypeScript | 5.3.x | 前端语言 |
| Rust | 1.70+ | 后端语言 |
| PrimeVue | 4.5.x | UI 组件库 |

---

## 开发指南

### 环境要求

- Node.js 18.0+
- Rust 1.70+
- 系统依赖：
  - Windows: Visual C++ Build Tools
  - macOS: `xcode-select --install`
  - Linux: `libwebkit2gtk-4.0-dev` 等

### 安装运行

```bash
# 克隆项目
git clone <repository-url>
cd PicNexus

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建生产版本
npm run tauri build
```

### 项目结构

```
PicNexus/
├── src/                      # 前端 (Vue 3 + TypeScript)
│   ├── uploaders/            # 8 个图床上传器
│   ├── components/           # Vue 组件
│   ├── core/                 # 核心业务逻辑
│   └── config/               # 配置类型
├── src-tauri/                # 后端 (Rust)
│   └── src/commands/         # Tauri 命令
└── package.json
```

### 添加新图床

项目采用插件化架构，添加新图床只需：
1. 在 `src/uploaders/` 创建上传器类
2. 在 `UploaderFactory` 中注册
3. 在 `src-tauri/src/commands/` 实现 Rust 命令

---

## 常见问题

### Q: 推荐用哪个图床？
**A**: 新手直接用 TCL + 京东，零配置开箱即用。需要长期稳定存储用 R2。

### Q: Cookie 多久过期？
**A**: 微博/知乎约 30 天，牛客约 7-30 天，R2 的 API 密钥永久有效。

### Q: 微博上传失败？
**A**: 必须从 **m.weibo.cn**（移动版）获取 Cookie，桌面版的无效。

### Q: R2 报 CORS 错误？
**A**: 必须在 Cloudflare Dashboard 配置 CORS 策略，见上方说明。

### Q: 配置文件在哪？
**A**:
- Windows: `%APPDATA%\us.picnex.app\`
- macOS: `~/Library/Application Support/us.picnex.app/`
- Linux: `~/.config/us.picnex.app/`

---

## 许可证

[MIT License](LICENSE)

---

## 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面框架
- [Vue 3](https://vuejs.org/) - 前端框架
- [PrimeVue](https://primevue.org/) - UI 组件库
- [Cloudflare R2](https://www.cloudflare.com/products/r2/) - 对象存储

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐ Star！**

</div>
