# 图床平台速查

## 上传限制汇总

| 图床 | 文件大小 | 格式 | 认证 | 特殊机制 |
|------|---------|------|------|---------|
| **京东** | 15 MB | JPG/PNG/GIF | 无 | 限流重试 2 次（500/forbidden → 等 5-10s） |
| **TCL** | 未知 | JPG/PNG/GIF/HEIC/MP4/MOV | 无 | 限流重试 2 次（"操作太频繁" → 等 5s） |
| **微博** | 未知 | 未限制 | Cookie | 返回图片宽高信息 |
| **知乎** | 未知 | JPG/PNG/GIF/WebP | Cookie | MD5 秒传；超时 30s 重试 ×3（间隔 2-6s） |
| **纳米** | 未知 | JPG/PNG/GIF/WebP/BMP | Cookie + Auth-Token | SHA1 秒传；分片上传（火山引擎 TOS） |
| **牛客** | 未知 | JPG/PNG/GIF | Cookie | 自动去压缩路径返回原图；HTTP→HTTPS |
| **七鱼** | 未知 | JPG/PNG/GIF/WebP | 自动获取（需 Chrome/Edge） | 超时 45s（网易 NOS） |

---

## 缩略图 URL 格式

| 图床 | 小缩略图 | 中等缩略图 | 说明 |
|------|---------|-----------|------|
| **知乎** | `v2-{hash}_xs.webp` | `v2-{hash}_qhd.webp` | URL 后缀 |
| **七鱼** | `?imageView&thumbnail=50x0` | `?imageView&thumbnail=400x0` | NOS imageView 参数 |
| **京东** | `s76x76_jfs/...` | `s500x0_jfs/...` | URL 路径前缀 |
| **纳米** | `?x-tos-process=image/resize,l_75/quality,q_70/format,jpg` | `...l_500/quality,q_80...` | TOS 图片处理 |
| **牛客** | `?x-oss-process=image/resize,w_75,h_75,m_mfit/format,png` | `...w_400,m_mfit...` | OSS 图片处理 |
| **微博** | `/thumb150/{pid}.jpg` | `/mw690/{pid}.jpg` | URL 路径尺寸标识（还有 thumbnail/bmiddle/large） |
| **R2** | `wsrv.nl/?url={url}&w=75&h=75&fit=cover&q=75&output=webp` | `...w=800&q=80...` | 无原生处理，走 wsrv.nl 代理 |

---

## 代码位置

- 上传命令：`src-tauri/src/commands/` 下各 `*.rs`
- 缩略图生成：`src/composables/useThumbCache.ts`（`generateThumbnailUrl` / `generateMediumThumbnailUrl`）
