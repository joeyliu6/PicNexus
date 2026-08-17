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

### 先看提示说的是哪一句

401 提示会**自己区分**这两种情况，照着念即可（图床三条链路 + 备份的「测试连接」都有，
唯一没有的是同步过程中的 PUT/GET，见下方 ⚠️）：

| 提示 | 含义 | 怎么办 |
|------|------|--------|
| 「服务端要求 Digest 认证，PicNexus 暂不支持」 | 密码没错，是认证方式不匹配 | 在服务端启用 Basic（多数 NAS 可切换），或换用支持 Basic 的服务 |
| 「认证失败，请检查用户名和密码」 | 服务端提供了 Basic，凭证确实对不上 | 真的去核对密码 |

### 根因

**PicNexus 只支持 Basic 认证，不支持 Digest。**
[`basic_auth`](../../../src-tauri/src/commands/webdav_upload.rs) 只拼 `Basic <base64>`，
整个 `webdav_upload.rs` 没有任何 Digest 相关代码（nonce / qop / nc 递增一概没有）。

常见于：部分群晖 / 威联通的 WebDAV 配置、Apache `mod_dav` 默认配置。

### 判据是怎么来的

`describe_status` 在 401 时读响应的 `WWW-Authenticate` 头，**只有「提供 Digest 且不提供 Basic」
才换用 Digest 文案**。三个细节值得知道，改这段代码前先看一眼：

- 用 `get_all()` 遍历**所有**同名 header，不是 `get()`。RFC 7235 允许服务端把 Basic 和 Digest
  拆成两条 header 发；只看第一条会在「Digest 排前面」时误判成不支持 Basic。
- 每段只取首个空白前的 token 当方案名，所以 `Digest realm="Basic Zone"` 不会被误当成支持 Basic。
- `!has_basic` 这个守卫让判据**朝安全方向失败**：拿不准就退回通用文案，
  而不是把一个密码填错的用户支去折腾服务端配置。
- 403 **不读**这个头——那是「认过了但没权限」，不带方案协商。

### 想自己确认

```bash
curl -sI https://你的服务器/dav/ | grep -i "www-authenticate"
```

### ⚠️ 备份链路只有「测试连接」有这个区分

能不能说出 Digest 那句话，取决于**拿不拿得到响应头**：

| 位置 | 有没有 Digest 提示 | 为什么 |
|------|-------------------|--------|
| 图床上传 / 图床连接测试 / 编辑器·CLI 上传 | ✅ 有 | `upload_to_webdav_core`、`test_webdav_storage`、`server_upload_webdav` 手里都有完整响应 |
| 备份的「测试连接」按钮 | ✅ 有 | `main.rs::probe_webdav_connection` 与上面**共用同一个** `describe_status` |
| 同步过程中的 PUT / GET | ❌ 无 | 走 `webdav_request`，它只回 `{status, body}`，响应头在 Rust 侧就丢了，前端判不了认证方案 |

**为什么剩下那一档不补**：连接测试是同步的前置门槛，撞上 Digest 必然先在测试按钮上撞到，
根本走不到同步的 PUT 那一步。而为一条实际到不了的路径改 `WebDAVResponse` 结构，
要动 Rust 的组装、TS 的接口、5 处 401 判定、新增一对跨语言常量，还要跟着改三套测试 mock——
成本与收益完全不成比例。

> 📌 这里以前写的是「备份链路没有这个区分，因为 `webdav_request` 拿不到响应头」。
> 那个理由对 `test_webdav_connection` **不成立**——它手里一直握着完整的 `res`，
> 是能拿到但没读。现在读了。

两条链路的其它差异见文末对照表。

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

**两条出路**：

1. **填 IP 字面量**而不是主机名（最稳妥，IP 字面量始终不受 fake-ip 影响）。
2. **点「测试连接」按提示确认**——撞上 fake-ip 这一档时会弹出「明文传输风险确认」，
   确认后该 profile 记住 `lanHttpConfirmed`，之后不再拦。

### 逃生舱放开了什么、没放开什么

确认**只**放开「所有不合格地址都是 fake-ip」这一种情况，也就是「真的看不见」。以下在确认后**依然硬拒绝**：

| 情况 | 确认后 |
|------|--------|
| 解析结果里混有确证公网地址（如 `[198.18.1.1, 8.8.8.8]`）| ❌ 仍拒绝 |
| 链路本地 / 云元数据（`169.254.169.254`、`fe80::/10`）| ❌ 仍拒绝 |
| 字面量 fake-ip（`http://198.18.1.1/dav`）| ❌ 仍拒绝——没有人的 NAS 挂在 RFC 2544 基准测试段上 |
| URL 内嵌 `user:pass@` / 非 HTTP 协议 | ❌ 仍拒绝 |

> 🐛 混合地址集那条是实现时补上的一个**真实漏洞**。`all_dns_results_allowed` 原本
> 一遇到 fake-ip 就早退，`[198.18.1.1, 8.8.8.8]` 会返回 `FakeIp`——**那个公网地址根本没被看到**。
> 早退版本在逃生舱上线前无害（`FakeIp` 与 `Public` 都是硬拒），但一旦 `FakeIp` 可被确认放行，
> 它就等于「用户确认了一个我们以为看不见、实际确证含公网地址的目标」，明文凭证直接出公网。
> 现在改成扫完全集、`Blocked`/`Public` 优先胜出，`FakeIp` 是最弱的裁决。
> 回归护栏：`fake_ip_never_masks_a_stricter_verdict`。

**确认会在改地址时自动作废**：授权是针对某个具体地址给的。改了 `url` 或 `publicDomain`，
`lanHttpConfirmed` 归零、下次测试重新弹框——这也是它唯一的撤销路径
（见 `useStorageProfiles.updateWebdavProfile`）。

另注意备份链路与图床链路走的是**两套函数**，判据不同：

| 层 | 备份 WebDAV | 图床 WebDAV |
|----|-------------|-------------|
| 前端 | `assertAllowedWebDAVUrl`（只认 IP 字面量） | `assertAllowedWebDAVStorageUrl`（主机名放行到 Rust） |
| Rust | `validate_webdav_url`（同步） | `validate_webdav_url_for_request`（异步，带 DNS 裁决） |
| 明文 HTTP 逃生舱 | ❌ 无（前端就把主机名拦了，走不到这一档） | ✅ 有，见上 |
| Digest 提示 | ✅ 连接测试有（`test_webdav_connection`）<br>❌ 同步 PUT/GET 无（`webdav_request` 只回 `{status, body}`） | ✅ 有（上传 / 连接测试 / 编辑器·CLI 三处共用 `describe_status`） |

---

## 相关文档

- 测试环境搭建：[webdav-testing-environments.md](../guides/webdav-testing-environments.md)
- 验收记录：[docs/audits/webdav-acceptance-2026-08-14.md](../../audits/webdav-acceptance-2026-08-14.md)
- 协议层自检脚本：[`scripts/test-webdav-compat.ps1`](../../../scripts/test-webdav-compat.ps1)
