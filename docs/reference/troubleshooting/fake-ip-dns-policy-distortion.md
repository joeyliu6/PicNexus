# fake-ip 池让 DNS 判据失真（TUN 代理环境）

- **位置**：`src-tauri/src/url_policy.rs` 的 `is_allowed_lan_addr`、`is_fake_ip_pool_ip`
- **发现于**：修复链接检测「网络不通」全量误判时（同源问题，不同路径）

## 现象

开了 TUN + fake-ip 的机器上（mihomo / sing-box 等），**任意域名都会解析进 `198.18.0.0/15`**。
这会同时打歪两处判据，方向相反：

| 模块 | 表现 |
|------|------|
| `url_policy.rs`（WebDAV） | 公网地址 `http://dav.example.com` 被判成局域网 → **明文凭证防线失效** |
| `commands/link_checker.rs`（链接检测） | 所有域名被判成内网 → **链接检测全量误判为「网络不通」** |

## 根因

fake-ip 是代理为了拦截流量而伪造的地址，**不反映目标的真实网络位置**。
把它当成「内网证据」或「外网证据」都是错的——它其实是「看不见」。

## 修法：看不见时的默认值按赌注决定

`198.18.x.x` 出现在 DNS 答案里，对目标真实位置零信息量。既然判不了，
就按「猜错的代价」决定默认动作：

| 模块 | 猜错的代价 | 对 fake-ip 的处置 |
|------|-----------|------------------|
| `commands/link_checker.rs`（只读探测 / 下载） | 多看一眼图片 | **豁免**（`dns_answer_is_forbidden`） |
| `url_policy.rs`（WebDAV 明文凭证） | 账号密码明文出公网 | **拒绝**（`is_allowed_lan_addr`） |

判据本身（`is_fake_ip_pool_ip`）提到 `url_policy.rs` 由两个模块共用——走样的后果是双向的。
`is_private_or_reserved_ipv4` 里的 `198.18/15` **一字未改**，三份实现的保留段一致性完好；
额外拒绝发生在策略层。

字面量 `http://198.18.1.1/dav` 同样拒绝（备份链路与图床链路都改了）。
前端 `isFakeIpPoolHost` 只拦字面量，主机名继续交给 Rust 按 DNS 结果裁决。

## 覆盖的 fake-ip 池

| 协议 | 范围 | 来源 |
|------|------|------|
| IPv4 | `198.18.0.0/15` | mihomo 默认 `198.18.0.1/16` + sing-box 默认 `198.18.0.0/15` |
| IPv6 | `fdfe:dcba:9876::/64` | mihomo `fake-ip-range6` 默认值 |

**v6 池不是可选项**：`lookup_host` 返回的是 A + AAAA 的**并集**，调用方逐条判定，
任意一条误判就整体失真。而 `fdfe:…` 落在 ULA（`fc00::/7`）里，
`is_private_or_reserved_ip` 会把它当内网。

> 🐛 顺带修掉一个 link_checker 存量 bug：`validate_fetch_url` 的循环里，v6 fake-ip 因为没被豁免
> 而触发「地址不能解析到内网」——双栈 + TUN 的机器上「从 URL 下载图片」实际是全量失败的，
> a83ca54 只修好了 v4 那一半。回归护栏见 `dns_answer_gate_allows_fake_ip_but_blocks_real_private`。

**已知未覆盖**：sing-box 的 v6 默认 `inet6_range = fc00::/18`。没纳入的理由——那是一整块 ULA 空间，
而 link_checker 侧有 `fc00::1` 必须拒绝的明确断言；为一个本机未实测到的池放宽一个 `/18` 的内网守卫，
代价大于收益。若将来收到 sing-box 用户的相关报障再补。

## 遗留的误伤面

这样一类用户会被误伤：

> 开着 TUN + fake-ip **且**用主机名（而非 IP）访问 NAS **且**该主机名没被代理的 `fake-ip-filter` 排除。

**实测（2026-08-08，本机 TUN + fake-ip）**：

```
dav.example.com     -> 198.18.1.47,  fdfe:dcba:9876::126
nas.local           -> 198.18.1.48,  fdfe:dcba:9876::128
```

⚠️ **`nas.local` 也被 fake-ip 了**。原以为 `*.lan` / `*.local` 会被代理默认排除，实测不成立——
[mihomo DNS 文档](https://wiki.metacubex.one/en/config/dns/) 确认内核**没有**任何内置的
`fake-ip-filter` 默认列表，`*.lan` 只是配置模板里的惯例条目。

**出路**：改填 NAS 的实际内网 IP、改用 HTTPS，或**点「测试连接」按提示显式确认**。
IP 字面量始终不受影响，而群晖等 NAS 引导用户填的默认就是 IP。

### 逃生舱（已实现）

撞上这一档时 Rust 返回专属错误类型 `WEBDAV_LAN_HTTP_UNCONFIRMED`（不是让前端去匹配文案——
文案一改分支就静默失效），前端据此弹「明文传输风险确认」，确认后写 `lanHttpConfirmed` 到该 profile。

三条约束刻在 `url_policy::LanHttpConsent` 的 doc 上：

1. **只放开 `DnsDecisionError::FakeIp` 一档**。`Blocked` 与 `Public` 在任何 consent 下硬拒绝——
   那两档不是「看不见」，是「看见了且确实不该连」。字面量 fake-ip 同样不放开。
2. **`FakeIp` 必须是最弱的裁决**。`all_dns_results_allowed` 原本一遇 fake-ip 就早退，
   于是 `[198.18.1.1, 8.8.8.8]` 返回 `FakeIp` 而那个公网地址**根本没被看到**。
   逃生舱上线前这无害（两档都是硬拒），上线后就等于放行一个确证含公网地址的目标。
   现已改成扫完全集、`Blocked`/`Public` 优先胜出。护栏：`fake_ip_never_masks_a_stricter_verdict`。
3. **改地址即作废**。授权是针对某个具体地址给的；`url` / `publicDomain` 一变就归零，
   这同时是它唯一的撤销路径。

详细排查见 [webdav-image-host-issues.md](./webdav-image-host-issues.md#局域网地址被拒绝)。

> ✅ **真机验收通过（2026-08-16）**：弹窗触发、确认后连接成功、重启后持久化、改地址即作废、
> 公网地址反向判据、批量测试不弹模态框——6 条判据全过。环境与结果见
> [webdav-digest-and-lan-http-escape-hatch-acceptance.md](../../audits/webdav-digest-and-lan-http-escape-hatch-acceptance.md)。

## 相关文档

- 链接检测侧的对应处理：[link-check-flow.md 出站策略校验小节](../../flows/link-check-flow.md#出站策略校验只读探测-vs-下载重传)
- WebDAV 图床排查：[webdav-image-host-issues.md](./webdav-image-host-issues.md)
- 真机验收记录：[webdav-digest-and-lan-http-escape-hatch-acceptance.md](../../audits/webdav-digest-and-lan-http-escape-hatch-acceptance.md)
