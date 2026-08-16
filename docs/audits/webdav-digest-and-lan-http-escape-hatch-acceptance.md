# WebDAV Digest 提示 + 明文 HTTP 逃生舱 验收记录（2026-08-16）

- **结论**：真机验收 **A 半场 3/3、B 半场 6/6，全部通过**
- **代码改动**：`0b8287a`（Digest 提示）、`b6cf813` + `3979805`（逃生舱）、`8c0839d`（文案跨语言登记）
- **设计文档**：[webdav-image-host-issues.md](../reference/troubleshooting/webdav-image-host-issues.md#认证失败但用户名密码反复核对都是对的)、
  [fake-ip-dns-policy-distortion.md#逃生舱已实现](../reference/troubleshooting/fake-ip-dns-policy-distortion.md#逃生舱已实现)
- **环境重建**：[webdav-testing-environments.md](../reference/guides/webdav-testing-environments.md)

## A 半场：Digest 提示（3/3 通过）

用 `node scripts/webdav-auth-fixture.mjs` 起三个只回 401 的假服务端，验的是文案分支不是协议实现——
PicNexus 本来就不支持 Digest，测的是「认不出来时说的话对不对」。

| 端口 | 服务端形态 | 判据 | 结果 |
|------|-----------|------|------|
| 5011 | 只给 `WWW-Authenticate: Digest` | 提示「服务端要求 Digest 认证，PicNexus 暂不支持…」 | ✅ |
| 5012 | 只给 `WWW-Authenticate: Basic` | 提示「认证失败，请检查用户名和密码」，无 Digest 字样 | ✅ |
| 5013 | 两条同名 header，Digest 在前 | 同 5012（`get_all()` 没把「两种都支持」误判成「只支持 Digest」） | ✅ |

5013 是最关键的一条：只看第一条 header 的实现会在这里判错，5011/5013 用 `127.0.0.1` 走回环分支，
不受 fake-ip 影响，两项验收互不干扰。

## B 半场：明文 HTTP 逃生舱（6/6 通过）

### 环境：为什么不用真实 NAS

原计划找一台真实 NAS 验（群晖 / 自建），但用户的群晖在 DSM 7.2+ 已下架 WebDAV Server 套件，
临时找不到「填主机名连得通」的真实设备。改用等价替代：本机起 `dufs`（复用 Digest 夹具同款工具），
借 `pinggy.io` 的免费 SSH TCP 隧道把它发布成一个**真实公网可达**的域名——

```powershell
dufs C:\Users\<你>\webdav-escape-test -b 127.0.0.1 -p 5021 -A -a "admin:<随机密码>@/:rw" -a "@/"
```

```bash
ssh -p 443 -R0:localhost:5021 tcp@free.pinggy.io
# → tcp://arczg-206-189-46-232.run.pinggy-free.link:37195
```

验证成立的两个前提，用前都已确认：

1. 本机开着 TUN，该域名被 `Resolve-DnsName` 解析成 `198.18.0.250`——落在 fake-ip 池，
   本机判不清它在不在局域网（正是逃生舱要拦的那一档）。
2. 公网直接 `curl -X PROPFIND` 该域名拿到 `207`——隧道确实把请求转发到了本地 dufs，
   连接这一步是真实成立的，不是只测到了弹窗。

搭建细节与踩过的坑（`serveo.net` 匿名 TCP 转发已失效、免费额度 60 分钟到期）已归档到
[webdav-testing-environments.md#pinggy-隧道fake-ip-逃生舱](../reference/guides/webdav-testing-environments.md#pinggy-隧道fake-ip-逃生舱)，
供下次改动这条链路时复用，不用重新摸索。

### 验收清单

| # | 场景 | 判据 | 结果 |
|---|------|------|------|
| 1 | WebDAV 地址填隧道给的主机名 → 测试连接 | 弹出「明文传输风险确认」（截图确认，非笼统报错） | ✅ |
| 2 | 点「我已了解并继续」 | 自动重试并连接成功（`验证成功 / WebDAV 1 配置有效`，截图确认） | ✅ |
| 3 | 托盘退出应用、重新启动 → 再测 | 不再弹窗，直接成功——确认状态真的写盘了，不是内存里的临时状态 | ✅ |
| 4 | 把地址改一个字符 → 再测 | 又弹一次——确认随地址作废，这也是唯一的撤销路径 | ✅ |
| 5 | 反向判据：地址改成 `http://example.com/dav` | 依然被拒——确认过的标记不能让公网明文放行 | ✅ |
| 6 | 地址改回隧道地址（重新未确认）→ 顶部「全部测试」批量跑 | 撞上 fake-ip 时不弹模态框阻塞批量流程 | ✅ |

第 3 条按已知的陷阱执行：只关窗口不会真正退出进程（`closeToTray` 默认 `true`），
必须走托盘右键退出才能让配置真的从磁盘重新加载，否则"重启后仍然成功"是假阳性。

## 本次未发现新缺陷

两半场全部一次通过，代码与门禁此前已完成（见 `0b8287a` / `b6cf813` / `3979805` / `8c0839d`），
本次是纯真机回归，未额外发现问题。
