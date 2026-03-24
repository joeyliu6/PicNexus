# PicNexus

<div align="center">

<img src="src-tauri/icons/icon.png" alt="PicNexus" width="128">

**图床上传工具** — 快捷上传，随处引用

[![License](https://img.shields.io/badge/License-PolyForm%20Shield-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)]()
[![Version](https://img.shields.io/badge/Version-1.0.2-green)]()

</div>

## 这是什么？

一个桌面端的图床上传工具。选好图床，拖入图片，拿到链接。支持同时上传到多个图床。

## 支持的图床

| 分类 | 图床 | 认证方式 |
|------|------|---------|
| 开箱即用 | 京东、七鱼 | 无需配置 |
| Cookie 认证 | 微博、知乎、牛客、纳米、哔哩哔哩、超星 | 浏览器 Cookie |
| Token / API Key | SM.MS、GitHub、Imgur | API Token |
| 私有存储 | R2、腾讯云 COS、阿里云 OSS、七牛云、又拍云 | Access Key |

## 开发

```bash
npm install
npm run tauri dev
```

构建：`npm run tauri build`

需要 Node.js 18+ 和 Rust 环境。

## 免责声明

本项目是一个图片上传辅助工具，不提供任何存储服务。用户应自行遵守所使用平台的服务条款，因使用本软件所产生的一切后果由使用者自行承担。

## 许可证

[PolyForm Shield 1.0.0](LICENSE) — 禁止用于竞争性用途
