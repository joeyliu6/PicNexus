# 开发待办

> 本文件是仓库内未完成开发需求的详细记录来源。其他文档只链接到对应条目，不重复维护需求内容。

## 待验收

### [~] WebDAV 图床支持

- **来源**：[GitHub Issue #1：支持 WebDAV 图床](https://github.com/joeyliu6/PicNexus/issues/1)
- **状态**：已实现，待真实 WebDAV 服务端到端验收

#### 目标

把图片上传到用户自己的 WebDAV 网盘或 NAS，通过二进制 PUT 写入，并按配置的公开 URL 模板返回可引用的图片链接。

#### 关键约束

- 图片上传目录与配置、历史记录的 WebDAV 备份目录相互隔离。
- 公开链接由用户配置的 URL 模板生成，不假设 WebDAV 地址可以匿名访问。
- 不承诺所有 WebDAV 网盘都支持图片直链；分享页或临时下载地址不能作为稳定直链。
- 保持现有 WebDAV 备份配置和旧版本配置兼容。

#### 与原调研方案的偏离

原方案计划**复用现有 WebDAV profile**（`config.webdav`）作为图床配置，实现时改为**独立配置**（`config.webdav_profiles`）：

- 图床需要 `publicDomain` / `publicUrlTemplate`，备份用不上，混在一起会让备份配置长出无用字段
- 用户的备份服务（如坚果云）与图床服务（如 OpenList）往往不是同一个，强行共用一份凭证反而别扭
- 代价是同一台服务器要填两次账号密码；换来两套配置互不干扰，备份功能零改动

#### 调研时漏掉、实现时补上的一项

网络策略会把局域网地址拦死，而群晖 / 自建 NAS（`http://192.168.1.10:5005`）正是 WebDAV 图床最主要的用户群。已为 WebDAV 单独放开，共三层——注意**备份链路与图床链路走的是两套函数**，改一边不会自动影响另一边：

| 层 | 备份 WebDAV | 图床 WebDAV |
|----|-------------|-------------|
| 1. 前端请求校验 | `assertAllowedWebDAVUrl` | `assertAllowedWebDAVStorageUrl` |
| 2. Rust 请求校验 | `validate_webdav_url`（同步） | `validate_webdav_url_for_request`（异步，带 DNS 裁决） |
| 3. 应用内图片显示 | 共用 `safeImageUrl` —— 漏掉这层会导致上传成功但历史记录缩略图全裂 | |

两条链路的差别只在 HTTP **主机名**上：备份链路在前端就拒绝 `http://主机名`（只认 IP 字面量），
图床链路放行到 Rust 侧、按 DNS 解析结果裁决，好让 `http://nas.local:5005` 这类地址能用。

放开仅作用于 WebDAV 链路，其他图床仍是 HTTPS-only；链路本地段（含云元数据 `169.254.169.254`）与公网明文 HTTP 依旧拒绝。DNS 裁决同样先拒绝链路本地/组播/保留段，再判断是否局域网——判据是 `is_allowed_lan_addr`，不能直接用 `is_private_or_reserved_host`（它的语义是"非公网"，会把云元数据地址一起放进来）。

#### 建议测试环境

- [OpenList](https://doc.oplist.org/guide/advanced/webdav)：本地端到端测试，覆盖 WebDAV 上传和固定公开直链。
- [InfiniCLOUD](https://infini-cloud.net/en/developer_webdav.html)：公网 WebDAV 协议兼容测试，不依赖其分享地址作为图片直链。

#### 验收清单

已由单元测试覆盖：

- [x] 多个 WebDAV profile 可以独立启用、选择和上传。
- [x] 图片目录与 `settings.json`、`history.json` 的备份目录隔离（两套独立配置）。
- [x] 中文、空格及需要 URL 编码的文件名可以正确上传和访问（编码逻辑单测）。
- [x] 认证失败、无写入权限、路径错误和存储空间不足时返回明确错误。
- [x] WebDAV 图床可以参与多图床上传、重试和主链接选择流程。
- [x] 配置文件中密码为密文，明文不进 formData 也不落盘。

需真实服务器验证（尚未执行）：

- [ ] 自动创建远程目录并以二进制 PUT 上传图片。
- [ ] 上传成功后按配置模板生成公开 URL，并写入上传历史。
- [ ] 连接测试能区分「传不上去」和「传上去了但链接打不开」。
- [ ] 内网 HTTP（NAS）场景下历史记录缩略图正常显示。
- [ ] 现有 WebDAV 备份功能及旧配置无需手动迁移即可继续使用。
- [ ] OpenList 本地端到端测试和 InfiniCLOUD 公网兼容测试通过。

---

## 待处理

### [ ] fake-ip 环境下 WebDAV 局域网判据失真

- **发现于**：修复链接检测「网络不通」误判时（同源问题，不同路径）
- **位置**：`src-tauri/src/url_policy.rs` 的 `is_allowed_lan_addr`

`198.18.0.0/15` 被当作**局域网地址放行**（测试 `lan_addr_gate_rejects_always_blocked_ranges` 附近有明确断言）。在开了 TUN + fake-ip 的机器上，任意公网域名都会解析进该段——包括用户填的公网 WebDAV 地址。

后果：`http://dav.example.com` 这类**公网明文 HTTP** 地址会被判成局域网而放行，明文凭证防线失效。这与链接检测那个 bug 同根（fake-ip 让 DNS 解析结果不再代表真实目标），但走的是另一套函数，本次未一并修改。

**为什么单独拆出来**：改 `is_allowed_lan_addr` 会同时打破 `lan_addr_gate_rejects_always_blocked_ranges` 和 `reserved_ranges_match_frontend_and_link_checker` 两条测试，属于独立的一次改动，需要单独设计"fake-ip 环境下如何判定局域网"的策略。

> 对照：链接检测侧的处理见 [link-check-flow.md 出站策略校验小节](./flows/link-check-flow.md#出站策略校验只读探测-vs-下载重传)。那里的结论是"探测路径干脆不查 DNS"，但 WebDAV 是**要靠 DNS 结果决定能不能走明文 HTTP**，不能照搬。
