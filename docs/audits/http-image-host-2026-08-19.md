# 允许明文 HTTP 图床（2026-08-19）

> 起因：验证又拍云修复时发现，又拍云免费给的域名 `*.test.upcdn.net` 只有 HTTP，
> 而 PicNexus 公开域名一律要求 HTTPS —— **这个图床整个不可用**。
> 顺查发现不是又拍云一家的问题：WebDAV 局域网图床的缩略图也一直是坏的，同一个根因。

## 一句话结论

公开访问域名允许明文 HTTP，但要用户在设置页「测试连接」时显式确认一次；
确认**跟着主机名走**，换域名自动失效。CSP 的 `img-src` 相应放开 `http:`。

这条**推翻了** [`webdav-acceptance-2026-08-14.md`](./webdav-acceptance-2026-08-14.md) 里
「放开仅作用于 WebDAV 链路，其他图床仍是 HTTPS-only……公网明文 HTTP 依旧拒绝」那条取舍。
下面记录为什么。

## 为什么推翻

### 又拍云给不出 HTTPS

[官方文档](https://help.upyun.com/knowledge-base/cdn-test-domain/)：测试域名「限速、限 CDN 节点数量、
**不能用于正式的生产环境**」。要 HTTPS 必须绑自有域名，而
[绑域名要求工信部备案](https://help.upyun.com/knowledge-base/cdn-create-service/)——不是顺手能办的。

### 一刀切拒绝的实际后果是三处全挂

| 层 | 位置 | 后果 |
|----|------|------|
| 前端预校验 | `s3ConfigValidation.ts` | 「测试连接」拒绝执行 |
| **Rust 上传** | `s3_compatible.rs::validate_https_public_domain` | **上传直接被拒**（真正的硬阻塞） |
| 应用内显示 | `networkPolicy.ts::safeImageUrl` + CSP `img-src` | 缩略图渲染不出来 |

### 连带发现：WebDAV 局域网缩略图一直是坏的

`safeImageUrl` 放行了局域网 HTTP，但 CSP `img-src` 不含它。**实测确认**：用浏览器复刻
本项目的 CSP 加载 `http://` 图片，13ms 就报
`violates the following Content Security Policy directive`，压根没走到网络。

`webdav-acceptance-2026-08-14.md` 的验收清单里**没有**「缩略图能显示」这一条，所以没人发现。

**这改变了取舍**：「不动 CSP」不是维持现状，而是让一个已经坏掉的地方继续坏着。

### 同类软件不这么做

[PicGo 不强制 HTTPS](https://picgo.github.io/PicGo-Doc/zh/guide/config.html)，自定义域名 http/https 均可。

## 实现

### 确认存主机名，不存布尔值

`HttpDomainConfirmable.httpDomainConfirmedFor?: string`（`src/config/serviceTypes.ts`），
六个 S3 系配置（R2 / 腾讯 / 阿里 / 七牛 / 又拍云 / 自定义 S3）继承它。

判据：`normalizeHost(new URL(publicDomain).hostname) === httpDomainConfirmedFor`。

**Why 不用布尔值**：域名一改，主机名自然失配、确认自动作废，不需要在每个能改域名的地方
补作废逻辑。对照 `WebDAVStorageProfile.lanHttpConfirmed`——那个布尔值得靠
`useStorageProfiles.ts` 里手写的「地址变了就置 false」兜着，漏一处就留下过期的放行。

前后端用同一判据（`isHttpDomainConfirmed` / `validate_public_domain`），
任何一侧漏了另一侧仍拦得住。

### 逃生舱挂在预校验的卡点上

`useConnectionTest.ts::executeServiceTask`。

⚠️ **不是** `testS3Connection` 里。预校验（`preValidateService`）失败会直接抛出，
下游 task 根本不执行——写在 task 里是**死代码**。这一版初稿就是这么写的，
人眼审查没看出来，是新加的单元测试把它抓出来的。

约束照搬 WebDAV 那条：只在单项测试里弹（批量会连环阻塞）、只重试一次。

### Endpoint 不吃这条逃生舱

`validate_https_endpoint` 保持 HTTPS-only。Endpoint 的请求带着 AK/SK 签名，
明文传输等于把凭证摊在链路上；公开域名只是取图，风险量级不同。

### CSP

`tauri.conf.json` 的 `img-src` 由 `... https: http://127.0.0.1:* http://localhost:*`
改为 `... https: http:`（`http:` 已覆盖回环，故删去那两项）。

**`connect-src` 与 `script-src` 一字未动**——放开的只是"能不能显示图片"，
不涉及数据外发或代码执行。

## 残余风险（如实记录）

### 1. CSP 兜底网没了

放开前，CSP 是 `safeImageUrl` 之外的第二道网。放开后，明文 HTTP 图片的加载
只剩 `safeImageUrl` 一道闸。影响面限于"加载一张图"，不涉及执行代码。

### 2. ⚠️ 收藏页与时间轴**没有这道闸**

`ThumbnailImage.vue`（历史表格、上传队列）走 `safeImageUrl`，但
`FavoritePhotoItem.vue` / `TimelinePhotoItem.vue` 走
`useThumbnailFallbackChain`，**不经过任何 URL 校验**，直接把候选 URL 塞给 `<img>`。

放开 CSP 之前，这两个视图的明文 HTTP 图片是被 CSP 顺带挡住的；放开之后，
它们处于**无校验状态**——包括 `safeImageUrl` 本会拦掉的链路本地 / 云元数据地址。

当时没一并修的理由是"过滤会破坏候选链的引用稳定性契约"——**这个理由后来查实是错的**。
引用稳定性契约属于上游缓存 `useThumbCache.getMetaThumbnailCandidates`；
`useThumbnailFallbackChain` 的 `watch` 用的是 `hasUrlListChanged`，**逐项比内容不比引用**
（正因为队列项的候选每次都是现算的新数组）。所以加过滤不会触发重置，
改动量远小于当时的判断。已在 `docs/TODO.md` 更正。

**已记入 `docs/TODO.md`。** 不要因为 `getConfirmedHttpHosts` 存在就以为全应用都拦住了。

## 代码审查补修（2026-08-19）

审查发现一处**真缺陷**：`allowConfirmedHttp` 原本无条件 `return parsed`，而上面两道
`isAlwaysBlockedHost` / `isFakeIpPoolHost` 检查挂在 `allowPrivate` 下、这条路径走不到。
后果是**已确认的 `http://169.254.169.254`（云元数据）能通过校验层**。

实际暴露有限（`safeImageUrl` 渲染时仍拦、且要用户亲手确认过该地址），但当时新增的测试
**只断言了 `safeImageUrl`**，反而造成"校验层也拦着"的错觉——这正是审查点出的问题。

已修：`allowConfirmedHttp` 分支单独再查一次 always-blocked。普通私网地址仍放行
（自建 MinIO 挂 192.168.x 是正当场景）。测试补了校验层的正反两条判据，并做过阴性对照
（撤掉修复后测试确实变红）。

顺带补掉两处欠账：`SettingsFormShape` 的五个 S3 系交叉上 `HttpDomainConfirmable`
（原先靠运行时 cast 落盘，而 `typecheck` 只覆盖 `src/`、测试里的访问从没被类型检查过）；
`docs/reference/api/uploaders.md` 的又拍云认证方式更新为 S3 凭证，并加了两条链路的对照表。

## 验证

### 已完成

- Rust：`validate_public_domain` 单测含反向判据——确认了 A **不放行** B（存布尔值的实现会在这里挂）
- 前端：`networkPolicy.spec.ts` 4 条（主机名判据 / 换域名失效 / 云元数据不开后门 / 名单合并）
- 前端：`useConnectionTest.spec.ts` 5 条（确认后写回并重试 / 拒绝不写 / 已确认不再弹 / 换域名重新弹 / HTTPS 不弹）
- `npm run lint` + `typecheck` + `vitest`（2886 passed）+ `cargo check` + `cargo test`（332 passed）

### 真机验收结果（2026-08-19，全过）

| # | 场景 | 结果 |
|---|------|------|
| 1 | 公开域名填 `http://img-ypyp.test.upcdn.net` → 测试连接 | ✅ 弹出「明文 HTTP 域名确认」 |
| 2 | 点「我已了解并继续」 | ✅ 验证成功，配置落盘 |
| 3 | Typora 插图 | ✅ 链接为真实 `http://...`，图正常显示 |
| 4 | **PicNexus「浏览」页缩略图** | ✅ **能显示**——本次改 CSP 的核心目标 |

第 4 条同时说明：`img-src` 放开 `http:` 之后，先前被 CSP 拦掉的明文 HTTP 图片
确实能渲染了，且用户机器上的 TUN fake-ip 没有干扰到真实应用（应用页面是安全上下文，
不受 Private Network Access 那条限制——这与浏览器里的探测结论不同，见上文）。

### 一个验证期间的坑（记下来免得下次误判）

为了在放开策略前先验证 Q1，曾让用户把域名临时填成 `https://img-ypyp.test.upcdn.net`
（该域名实际只有 HTTP）。这样能骗过校验把上传跑通，**但那段时间产出的历史记录链接全是死的**。
后来用户看到一条 `https://` 的旧链接，一度以为改动没生效。
**这类"为验证而填的假值"要当场说清会污染历史数据。**

### 未验证项（用户决定跳过，不是遗漏）

- **WebDAV 局域网图床的缩略图**（顺带修好的那个）——**没有真机回归**，
  用户 2026-08-19 判断风险可接受，跳过。

  跳过的依据：它与又拍云走的是同一条判据（CSP `img-src` 拦明文 HTTP），
  而又拍云那条已经真机验过能显示。所以**推断**局域网 WebDAV 也一并好了。

  但这是推断不是实测，可能推翻它的差异有两处：局域网地址会额外经过
  `isPrivateOrReservedHost` 分支；`lanHttpConfirmed` 与本次新增的
  `httpDomainConfirmedFor` 是两套独立标记，合并发生在 `getConfirmedHttpHosts`。
  哪天有人报"NAS 图床缩略图不显示"，**先查这里，别当新问题从头查起**。

  复现环境搭法见 [webdav-testing-environments.md](../reference/guides/webdav-testing-environments.md)。
