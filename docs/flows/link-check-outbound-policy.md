# 链接检测出站策略校验：只读探测 vs 下载重传

> 链接检测 / 文档修复发出的探测请求，与「下载后重传」请求走不同的出站校验。排查「内网图床被判拦截」「fake-ip 下全量误判网络不通」时查看。
> 检测主流程见 [link-check-flow.md 图 1](./link-check-flow.md#图-1服务感知请求流程)。

两条路径用不同的校验函数，差别只在**要不要用 DNS 解析结果做裁决**。

| 路径 | 命令 | 校验函数 | DNS 层裁决 | 理由 |
|------|------|----------|-----------|------|
| 只读探测 | `check_image_link` / `batch_check_links` | `validate_probe_url`（同步）= `validate_url_with_policy(AllowPrivate)` + 前端传入的确认主机名名单 | ❌ 不做 | 预解析结果并不绑定 reqwest 的实际连接（它会自己再解析一次），所以拦不住 DNS rebinding，只能拦「手滑粘了内网 URL」——而字面量 IP 判据已覆盖。批量上限 10 万条，每条还要多付一次 DNS 查询 |
| 下载重传 | `download_url_image` | `validate_fetch_url`（async）= `validate_external_url(Deny)` + DNS 裁决 | ✅ 做，但豁免 fake-ip 池 | 取回的字节会被重新上传到公网图床，误操作必须拦 |

除 DNS 外，两条路径 2026-08-21 起还差一个 **scheme × 地址段** 维度（探测对齐了上传 / 渲染 /
CSP 三处 2026-08 为局域网图床放开的判据，下载重传保持旧口径）：

| URL 形态 | 只读探测 | 下载重传 |
|----------|---------|---------|
| `https://` 公网 | ✅ | ✅（DNS 裁决通过后） |
| `http://` 回环 | ✅ | ✅ |
| `http://192.168.x.x` 等局域网字面量 | ✅ | ❌（字节会重传公网） |
| `https://` 内网字面量 | ✅ | ❌ |
| `http://nas.local` 等**已确认**主机名（fake-ip 逃生舱，前端随请求传名单） | ✅ | ❌（fetch 没有名单入口） |
| `http://` 公网 / 未确认主机名 | ❌ `PUBLIC_HTTP_DISABLED_MESSAGE` | ❌ |
| 链路本地 / 云元数据 / 文档段 / fake-ip 字面量 / 带凭证 | ❌ 任何 scheme | ❌ |

确认名单的语义与前端 `networkPolicy.ts` 的 `allowConfirmedHttp` 分支逐字对齐：命中名单仍复查
always-blocked 与凭证。名单由 5 个 invoke 调用点传入（`useLinkCheck.ts` 四处 +
`useMirrorFallback.ts` 一处），漏传的直接后果是已确认主机名图床被误判「策略拦截」。

> 📌 「探测路径不查 DNS」换来的口子（内网主机名会被真的探测一次）、为什么接受、以及真要收紧该怎么做，记在 [docs/TODO.md 已知取舍](../TODO.md#只读探测路径不做-dns-裁决)。**不要**用「把 DNS 预检加回来」来收紧——那正是被 a83ca54 删掉的东西。

**fake-ip 豁免**（`dns_answer_is_forbidden`）：`198.18.0.0/15` 是 RFC 2544 基准测试段，公网 BGP 不路由、企业内网不使用；现实中它只作为 Clash / sing-box / Surge 的**默认 fake-ip 池**出现（范围取 /15 是为了同时覆盖 mihomo 的 `198.18.0.1/16` 与 sing-box 的 `198.18.0.0/15`）。开了 TUN 的机器上任意域名都会解析进该段，把它当内网证据会让功能全废。

**v6 池同样豁免** `fdfe:dcba:9876::/64`（mihomo `fake-ip-range6` 默认值）：`lookup_host` 返回的是 A + AAAA 的**并集**，`validate_fetch_url` 逐条判定、任意一条被拒就整体失败。而 `fdfe:…` 落在 ULA（`fc00::/7`）里会被 `is_private_or_reserved_ip` 判成内网——只豁免 v4 的话，双栈 + TUN 的机器上「从 URL 下载图片」依然全量失败。判据都在 `is_fake_ip_pool_ip`。

> 📍 **基础判据的位置**：`normalize_host` / `is_loopback_host` / `is_loopback_ip` /
> `is_private_or_reserved_host` / `is_private_or_reserved_ip` 全部住在 `src-tauri/src/url_policy.rs`，
> `commands/link_checker.rs` 只 `use` 不实现。曾经两边各写一份，然后漂移了——link_checker
> 那份多拒 IPv6 文档段 `2001:db8::/32`，url_policy 那份没有，同一个地址两边结论相反。
> 合并时把漂移的那一半**吸收**进 url_policy（同时进 `is_always_blocked_host`，否则 WebDAV 会
> 反过来把文档段当局域网放行明文凭证）。本模块保留的只有策略层差异：fake-ip 的豁免方向。

> ⚠️ 豁免只发生在 **DNS 答案**判定点。字面量 `https://198.18.1.1/x.jpg` 仍然拒绝，`is_private_or_reserved_ipv4` 里的 198.18/15 一字未改——`src-tauri/src/url_policy.rs` 的跨模块一致性测试 `reserved_ranges_match_frontend_and_link_checker` 依赖它。

#### 同一判据的另一面：WebDAV 是**拒绝** fake-ip

判据 `is_fake_ip_pool_ip` 住在 `src-tauri/src/url_policy.rs`，由两个模块共用，但**默认值相反**：

| 模块 | 判定点 | 猜错的代价 | 对 fake-ip 的处置 |
|------|--------|-----------|------------------|
| 本模块（只读探测 / 下载重传） | `dns_answer_is_forbidden` | 多看一眼图片 | **豁免**（不拒绝） |
| `url_policy.rs`（WebDAV 明文 HTTP） | `is_allowed_lan_addr` | 账号密码明文出公网 | **拒绝**（不放行） |

共同前提是同一句话：`198.18.x.x` 出现在 DNS 答案里，对目标的真实网络位置**零信息量**——代理只是随手编了个号。分歧只在「零信息量时默认怎么办」，而那取决于赌注。

> 这也是为什么本模块「探测路径干脆不查 DNS」的结论**不能照搬**到 WebDAV：WebDAV 恰恰要靠 DNS 结果决定能不能走明文 HTTP，不查 DNS 这条路走不通。
>
> ⚠️ 改动 `is_fake_ip_pool_ip` 会同时影响两个方向——放宽会让 WebDAV 凭证泄露，收紧会让链接检测全量误判。修改前先看两侧的护栏测试：本模块的 `dns_answer_gate_allows_fake_ip_but_blocks_real_private` 与 url_policy 的 `fake_ip_pool_is_not_lan_evidence` / `real_lan_ranges_survive_the_fake_ip_gate`。
