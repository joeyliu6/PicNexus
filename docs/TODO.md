# 开发待办

> 本文件是仓库内未完成开发需求的详细记录来源。其他文档只链接到对应条目，不重复维护需求内容。
>
> 「已知取舍」小节记的是**故意不做**的决定：看着像缺陷、但改了会更糟的地方。写在这里是为了拦住下一个人"顺手修好"。

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

`is_allowed_lan_addr` 还会拒绝**代理的 fake-ip 池** `198.18.0.0/15`：那个段出现在 DNS 答案里只说明本机开着 TUN，对目标的真实位置零信息量，当局域网证据会让公网明文 HTTP 全线放行。详见下方「已完成」小节。

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

### [ ] WebDAV 明文 HTTP 的「显式确认」逃生舱

- **来源**：修复「fake-ip 环境下 WebDAV 局域网判据失真」时刻意留下的缺口
- **优先级**：中——比原先估计的高，见下方实测

修复后，代理 fake-ip 池不再算局域网证据。副作用是这样一类用户会被误伤：

> 开着 TUN + fake-ip **且**用主机名（而非 IP）访问 NAS **且**该主机名没被代理的 `fake-ip-filter` 排除。

**实测（2026-08-08，本机 TUN + fake-ip）**：

```
dav.example.com     -> 198.18.1.47,  fdfe:dcba:9876::126
nas.local           -> 198.18.1.48,  fdfe:dcba:9876::128
```

⚠️ **`nas.local` 也被 fake-ip 了**。原本以为 `*.lan` / `*.local` 会被代理默认排除，实测不成立——[mihomo DNS 文档](https://wiki.metacubex.one/en/config/dns/) 确认内核**没有**任何内置的 `fake-ip-filter` 默认列表，`*.lan` 只是配置模板里的惯例条目，本机配置就没带。所以 `http://nas.local:5005` 这类地址在这类机器上同样会被拒。

**目前的出路**（已写进错误文案）：改填 NAS 的实际内网 IP，或改用 HTTPS。IP 字面量始终不受影响，而群晖等 NAS 引导用户填的默认就是 IP，所以这不是死路——但比原先估计的更容易撞上。

**若要做逃生舱**，方案轮廓：

1. `WebDAVStorageProfile`（`src/config/serviceTypes.ts`）加确认字段，如 `lanHttpConfirmed: boolean`
2. `upload_to_webdav` / `test_webdav_storage` 两个 Tauri 命令各加一个参数，透传给 `validate_webdav_url_for_request`
3. `PrivateStorageGroup.vue` 加一行勾选，文案要讲明「勾了就是明文传账号密码」
4. 只放开 `DnsDecisionError::FakeIp` 一档；`Blocked`（链路本地/云元数据）与 `Public`（确证公网）保持硬拒绝

**为什么当初没一起做**：改动面会从 1 个 Rust 文件扩到 Rust + config schema + 设置页 UI 三层，而 WebDAV 图床本身还在「待验收」状态，此时动配置 schema 时机不好。

---

## 已知取舍

### 只读探测路径不做 DNS 裁决

- **状态**：故意如此，**不打算改**——看到这条之前请不要"顺手修好"
- **位置**：`src-tauri/src/commands/link_checker.rs` 的 `validate_probe_url`（同步函数，编译器保证它查不了 DNS）
- **决定于**：a83ca54，修「fake-ip 让链接检测全量误判」时

只读探测（`check_image_link` / `batch_check_links`）只做同步判据：scheme、字面量 IP、URL 内嵌凭证。
下载重传（`validate_fetch_url`）**仍然**做 DNS 裁决，两条路径的分工见
[link-check-flow.md 出站策略校验小节](./flows/link-check-flow.md#出站策略校验只读探测-vs-下载重传)。

**为什么去掉这道预检**：它从来就不是一道安全边界。`tokio::net::lookup_host` 的解析结果并不绑定 reqwest 后续的实际连接（reqwest 会自己再解析一次），所以它拦不住 DNS rebinding，只拦得住「手滑粘了个内网 URL」——而字面量 IP 判据已经覆盖了这一点。
代价却是确定的：TUN + fake-ip 的机器上**每一个**域名都解析进保留段，链接检测全量误判为「网络不通」；批量上限 10 万条，每条还要多付一次 DNS 查询。

**换来的口子（要知情）**：`https://内网主机名/x.jpg` 现在会被真的探测一次。构造场景是——别人给你一份 markdown，里面塞满内网地址，你点一下「检测链接」，等于替对方把内网扫了一遍。

**为什么接受**：结果只显示在本地、不回传给构造者，响应体也不返回给前端，泄露的信息止于「这个地址存在 / 状态码 / 耗时」，而且需要用户主动点检测。相对「所有开代理的用户功能全废」，这个赌注划算。

**真要收紧，正确的做法是在连接层做，不是把预检加回来**：

1. 给 reqwest 挂自定义 DNS resolver（`ClientBuilder::dns_resolver` / `resolve`），在解析回调里拒绝内网地址——那才是 rebinding-proof 的，因为连接用的就是这个答案
2. 同样要豁免 fake-ip 池（`is_fake_ip_pool_ip`），否则绕一圈回到原点
3. ⚠️ **不要**在 `validate_probe_url` 里加回 `lookup_host`：那正是 a83ca54 删掉的东西，加回去等于原样重新引入全量误判。回归护栏是 `probe_url_accepts_public_https_without_dns`

**重新考虑的触发条件**：收到「链接检测被拿去扫内网」的实际报障；或者 link_checker 开始把响应内容回传给前端（那时泄露的就不止存在性了）。

---

## 已完成

### [x] fake-ip 环境下 WebDAV 局域网判据失真

- **发现于**：修复链接检测「网络不通」误判时（同源问题，不同路径）
- **位置**：`src-tauri/src/url_policy.rs` 的 `is_allowed_lan_addr`

`198.18.0.0/15` 曾被当作**局域网地址放行**。在开了 TUN + fake-ip 的机器上，任意公网域名都会解析进该段——包括用户填的公网 WebDAV 地址，导致 `http://dav.example.com` 被判成局域网，明文凭证防线失效。

**修法**：把 fake-ip 池当成「看不见」而不是「内网」——`198.18.x.x` 出现在 DNS 答案里，对目标的真实网络位置零信息量。看不见时的默认值按赌注决定：

| 模块 | 猜错的代价 | 对 fake-ip 的处置 |
|------|-----------|------------------|
| `commands/link_checker.rs`（只读探测/下载） | 多看一眼图片 | **豁免**（`dns_answer_is_forbidden`） |
| `url_policy.rs`（WebDAV 明文凭证） | 账号密码明文出公网 | **拒绝**（`is_allowed_lan_addr`） |

判据本身（`is_fake_ip_pool_ip`）已提到 `url_policy.rs` 由两个模块共用——走样的后果是双向的。`is_private_or_reserved_ipv4` 里的 198.18/15 **一字未改**，三份实现的保留段一致性完好；额外拒绝发生在策略层。

字面量 `http://198.18.1.1/dav` 同样拒绝（备份链路与图床链路都改了）。前端 `isFakeIpPoolHost` 只拦字面量，主机名继续交给 Rust 按 DNS 结果裁决。

#### 覆盖的 fake-ip 池

| 协议 | 范围 | 来源 |
|------|------|------|
| IPv4 | `198.18.0.0/15` | mihomo 默认 `198.18.0.1/16` + sing-box 默认 `198.18.0.0/15` |
| IPv6 | `fdfe:dcba:9876::/64` | mihomo `fake-ip-range6` 默认值 |

**v6 池不是可选项**：`lookup_host` 返回的是 A + AAAA 的**并集**，调用方逐条判定，任意一条误判就整体失真。而 `fdfe:…` 落在 ULA（`fc00::/7`）里，`is_private_or_reserved_ip` 会把它当内网。

> 🐛 顺带修掉一个 link_checker 的存量 bug：`validate_fetch_url` 的循环里，v6 fake-ip 因为没被豁免而触发「地址不能解析到内网」——双栈 + TUN 的机器上「从 URL 下载图片」实际是全量失败的，a83ca54 只修好了 v4 那一半。回归护栏见 `dns_answer_gate_allows_fake_ip_but_blocks_real_private`。

**已知未覆盖**：sing-box 的 v6 默认 `inet6_range = fc00::/18`。没纳入的理由——那是一整块 ULA 空间，而 link_checker 侧有 `fc00::1` 必须拒绝的明确断言；为一个本机未实测到的池放宽一个 `/18` 的内网守卫，代价大于收益。若将来收到 sing-box 用户的相关报障再补。

遗留的误伤面见上方「WebDAV 明文 HTTP 的『显式确认』逃生舱」。

> 对照：链接检测侧的处理见 [link-check-flow.md 出站策略校验小节](./flows/link-check-flow.md#出站策略校验只读探测-vs-下载重传)。
