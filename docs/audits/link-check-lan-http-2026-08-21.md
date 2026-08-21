# 链接检测放行局域网图床（2026-08-21）

## 一句话

`validate_probe_url` 对明文 HTTP 只放行回环、对内网 HTTPS 字面量也拒，落后于 2026-08
为局域网图床放开的三处判据（上传 / 渲染 / CSP）——经 git 考古确认是**遗漏**而非有意保留，
本次修复：探测对齐三处判据 + 支持已确认主机名，下载重传保持不放宽。

来源：[lightbox-gate-and-upyun-dual-chain-2026-08-20.md](./lightbox-gate-and-upyun-dual-chain-2026-08-20.md)
「链接检测拦掉所有局域网图床」挂账条目。

## 为什么判定是遗漏（考古证据）

- 该判据 2026-05-06（`51ff9442`）随 `validate_external_url_policy` 引入，commit 只有一行标题，无理由说明。
- 2026-08 放开局域网 HTTP 的两批共 14 个 commit（`00416ba7`…`2ab296af` 等），message 与 diff
  **零提及** link_checker；`a83ca54d` 拆出 `validate_probe_url` 时原样继承、未讨论 scheme 判据。
- 2026-08-20 的 audit 自己写明「检测器这条判据没跟着更新」，且 TODO.md 一度留有指向
  不存在条目的悬空引用（本次已闭环）。
- flow 文档里「这是设计行为」的表述出自 `682ed748`（2026-08-08），**早于**放开局域网的
  两批工作，属过期表述，不构成有意保留的证据。

## 同类软件坐标系

lychee（最主流 Rust 链接检查器）默认检查私网/回环，排除是 opt-in（`--exclude-all-private`）；
linkinator、markdown-link-check 对内网零拦截。硬拒私网的是**服务端**取链方（Discourse
onebox、Slack unfurl、OWASP SSRF 指南）——共享服务器替人取链才有 SSRF。桌面工具
（取链方 = 用户本人）业界默认放行；Obsidian/Typora 打开 markdown 是零点击自动加载局域网图。

## 「替人扫内网」口子定性

新增风险 ≈ 零。TODO「只读探测路径不做 DNS 裁决」条目早已接受同款且更大的口子
（`https://内网主机名` 一直可被探测），接受理由一字不差地适用：结果只落本地、不回传构造者、
响应体不进前端、需用户主动点检测。本项目渲染层本来就对局域网图自动发请求。
链路本地/云元数据、fake-ip 字面量、公网明文 HTTP 在所有路径保持硬拒；
重新收紧的触发条件沿用 TODO 既有条目。

## 改了什么

| 位置 | 改动 |
|------|------|
| `url_policy.rs` | 「公网 HTTP 地址已禁用…」提升为 `PUBLIC_HTTP_DISABLED_MESSAGE` 常量（纯重构），登记进跨语言门禁 PAIRS |
| `link_checker.rs::validate_probe_url` | 委托 `validate_url_with_policy(AllowPrivate)`；新增确认主机名名单参数（语义对齐 `networkPolicy.ts` 的 `allowConfirmedHttp`：凭证、always-blocked 仍拒） |
| `link_checker.rs::validate_fetch_url` | 改走 `validate_external_url`（Deny，= 放宽前的旧探测判据），下载重传不放宽、不接名单 |
| 两个检测命令 | `check_image_link` 加平铺参数 `confirmed_http_hosts`；`BatchCheckRequest` 加同名字段，批次内 `Arc<HashSet>` 共享 |
| 前端 5 个 invoke 点 | `useLinkCheck.ts` 四处 + `useMirrorFallback.ts` 一处随请求传 `getConfirmedHttpHosts(config)` 名单 |
| 测试 | Rust 翻转/新增 9 条（含「fetch 仍拒局域网」「名单不放宽云元数据」两条反向护栏）；前端补名单传参断言 |
| 文档 | link-check-flow.md 出站小节加 scheme 矩阵、排查表两行；TODO.md 悬空引用闭环 + 已知取舍补记 |

## 验收

- `cargo test` 348 通过；vitest 2959 通过；`npm run lint` / `typecheck` 全绿（2026-08-21）。
- 真机全过（2026-08-21，dufs `-A -a admin:…@/:rw -a @/` 绑局域网 IP 模拟 NAS）：
  1. WebDAV 图床「测试连接」绿，上传成功；
  2. 链接检测对 `http://192.168.31.173:5244/…` 判**有效**（修复前全屏「策略拦截」）；
  3. 停掉 dufs 重检 → 「网络不通 · 无法连接到图床服务器 · 2025ms」——真的发了请求，
     不再是 0ms 同步拦截；恢复服务重检可翻回有效；
  4. 反向：文档修复扫描含两条链接的 md，局域网那条不进异常列表，
     `http://example.com` 那条带「拦截」标签落「需手动」。
- 未真机验：确认主机名（`http://nas.local`）逃生舱链路——要改 hosts 且 TUN 开着会失真，
  已由 6 条单测钉住（`probe_url_allows_confirmed_http_hostname` 等），留待 TUN 关闭时补。

## 教训

放开一条安全判据时，要枚举的是**所有出站路径**，不只是加载图片的路径——2026-08-19 那次
的教训写的是「枚举所有加载图片的路径」，结果探测这条只读出站路径整整晚了两天才被真机撞出来。
