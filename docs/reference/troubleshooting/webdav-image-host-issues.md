# WebDAV 图床：配不上时按症状查

WebDAV 图床实际是两半，出问题的性质完全不同，**先分清在哪一半**：

| | 干什么 | 靠什么 | 能否泛化 |
|---|---|---|---|
| 上半段 | 把图传上去 | WebDAV 协议（RFC 4918） | ✅ dufs / OpenList / 坚果云 三个独立实现均通过 |
| 下半段 | 拼出公开链接 | 用户填的 URL 模板 | ❌ 各家自己发明，无标准 |

连接测试的提示语已经替你分好了：

- 提示里有 **「图片已上传」** → 上半段没问题，往下半段查
- 提示是 **「认证失败」/「路径不存在」/「上传失败」** → 卡在上半段

---

## 认证失败，但用户名密码反复核对都是对的

### 现象

连接测试报 `认证失败，请检查用户名和密码`。用户确认凭证正确，同一套账号在其他 WebDAV
客户端（如 Windows 映射网络驱动器、RaiDrive）能正常连上。

### 根因

**PicNexus 只支持 Basic 认证，不支持 Digest。**

[`basic_auth`](../../../src-tauri/src/commands/webdav_upload.rs#L155) 只拼 `Basic <base64>`，
整个 `webdav_upload.rs` 没有任何 Digest 相关代码。服务端若只接受 Digest，
会直接返回 401，而 `describe_status` 把 401 翻译成「认证失败，请检查用户名和密码」。

**这条提示的杀伤力不在于少支持一种认证，而在于它把用户引向反复核对密码——而密码根本没错。**

常见于：部分群晖 / 威联通的 WebDAV 配置、Apache `mod_dav` 默认配置。

### 怎么确认

用 curl 看服务端要哪种认证：

```bash
curl -sI https://你的服务器/dav/ | grep -i "www-authenticate"
```

返回 `WWW-Authenticate: Digest ...` 就是撞上这条。返回 `Basic` 则是真的密码错了。

### 现状

已作为待办登记在 [TODO.md](../../TODO.md)。当前只能建议用户在服务端启用 Basic
（多数 NAS 可切换），或换用支持 Basic 的服务。

---

## 提示「图片已上传，但公开链接打不开」

上半段是好的，问题在链接模板。按服务端类型分两类：

### 类型 A：服务端给固定规则的直链，只是模板填错了

可修。典型是 OpenList / Alist 系——直链有 `/d/` 或 `/p/` 前缀，
模板要写成 `{domain}/d/{path}` 而不是 `{domain}/{path}`。

排查顺序：

1. 服务端有没有把匿名访问关掉（OpenList 的 guest 默认停用）
2. 直链有没有带签名参数（OpenList 的全局「签名所有」默认开启）
3. 用 curl 直接打生成的链接，看到底是 404（路径不对）还是 401（权限不对）

具体到 OpenList，见 [测试环境搭建 → 四个坑](../guides/webdav-testing-environments.md#-四个默认值会让验收卡住全都不在官方-webdav-文档里)。

### 类型 B：服务端根本不给匿名直链

**无解，不是配置问题。** 坚果云、InfiniCLOUD 属于此类——官方明确说 WebDAV 地址
仅供第三方工具调用，不支持浏览器直接访问。

这类服务可以当**备份盘**用，但当不了图床。

---

## 模板拼不出来：公开链接里带逐文件生成的 token

### 现象

服务端明明有公开直链，但每个文件的链接里带一段随机 token，
比如 Nextcloud 的 `/s/<token>/download`、OpenList 开着签名时的 `?sign=xxx`。

### 根因

**这是模板机制的天花板，不是 bug。**

`render_public_url` 只支持三个变量：`{domain}` `{path}` `{filename}`
（[webdav_upload.rs:115](../../../src-tauri/src/commands/webdav_upload.rs#L115)）。
逐文件生成的 token 与文件路径无关，**任何模板都拼不出来**。

### 能不能绕

看服务端有没有开关：

| 服务 | token 来源 | 能否关掉 |
|------|-----------|---------|
| OpenList / Alist | 全局「签名所有」 | ✅ 设置 → 全局 → 关闭 `sign_all` |
| Nextcloud | 分享链接机制本身 | ❌ 无解 |

关不掉的只能换服务，或在前面自建一层能按路径直出的静态服务。

---

## 公开链接在浏览器地址栏里变成下载

### 现象

链接能打开、也确实是图片，但粘进浏览器地址栏会触发下载而不是显示。

### 根因

服务端返回了 `Content-Disposition: attachment`。**这不是 PicNexus 的缺陷。**

以 OpenList 为例，`/d/` 和 `/p/` 两种前缀都带这个头——AList/OpenList 的设计是
「保持与原始存储的响应行为一致」，不强行改写，没有开关可关。

### 影响面比看上去小

`<img>` 标签**忽略** `Content-Disposition`。已实测两种前缀在 `new Image()` 下都能正常解码：

| 用法 | 受影响 |
|------|--------|
| Markdown `![](链接)` 引用 | ❌ 不受影响 |
| PicNexus 历史记录缩略图（`safeImageUrl` + `<img>`） | ❌ 不受影响 |
| 粘进浏览器地址栏 | ✅ 会下载 |

真正的图床用法不受影响。要地址栏也内联预览，只能在服务端前面挂反向代理改写响应头，
属于用户侧部署选择。

---

## 局域网地址被拒绝

### 现象

填 `http://192.168.x.x:5005` 或 `http://nas.local:5005` 被判为不允许。

### 排查

WebDAV 是唯一被放开明文 HTTP 的链路，但有三条硬拒绝：

| 情况 | 结果 |
|------|------|
| 链路本地段（含云元数据 `169.254.169.254`） | 拒绝 |
| 公网明文 HTTP | 拒绝，要求 HTTPS |
| **fake-ip 池 `198.18.0.0/15`** | 拒绝 |

第三条最容易误伤：**开着 TUN 代理的机器上，任何主机名都会解析进 fake-ip 池**，
所以 `http://nas.local:5005` 会被拒。该段出现在 DNS 答案里只说明本机开着 TUN，
对目标的真实位置零信息量，当局域网证据会让公网明文 HTTP 全线放行。

**绕法**：填 IP 字面量而不是主机名。

另注意备份链路与图床链路走的是**两套函数**，判据不同：

| 层 | 备份 WebDAV | 图床 WebDAV |
|----|-------------|-------------|
| 前端 | `assertAllowedWebDAVUrl`（只认 IP 字面量） | `assertAllowedWebDAVStorageUrl`（主机名放行到 Rust） |
| Rust | `validate_webdav_url`（同步） | `validate_webdav_url_for_request`（异步，带 DNS 裁决） |

---

## 相关文档

- 测试环境搭建：[webdav-testing-environments.md](../guides/webdav-testing-environments.md)
- 验收记录：[docs/audits/webdav-acceptance-2026-08-14.md](../../audits/webdav-acceptance-2026-08-14.md)
- 协议层自检脚本：[`scripts/test-webdav-compat.ps1`](../../../scripts/test-webdav-compat.ps1)
