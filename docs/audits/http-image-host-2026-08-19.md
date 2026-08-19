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

没有一并修的原因：统一这道闸要改缩略图候选链，而那里有明确的**引用稳定性契约**
（`useThumbCache.getMetaThumbnailCandidates` 的注释：同一 meta + 同一配置指纹必须返回
同一个数组引用），过滤会产生新数组、破坏契约，触发的正是
`37886c36 fix(thumbnail): stop false failure reports and stuck skeletons on chain updates`
刚修过的那类 bug。

**已记入 `docs/TODO.md`。** 不要因为 `getConfirmedHttpHosts` 存在就以为全应用都拦住了。

## 验证

### 已完成

- Rust：`validate_public_domain` 单测含反向判据——确认了 A **不放行** B（存布尔值的实现会在这里挂）
- 前端：`networkPolicy.spec.ts` 4 条（主机名判据 / 换域名失效 / 云元数据不开后门 / 名单合并）
- 前端：`useConnectionTest.spec.ts` 5 条（确认后写回并重试 / 拒绝不写 / 已确认不再弹 / 换域名重新弹 / HTTPS 不弹）
- `npm run lint` + `typecheck` + `vitest`（2886 passed）+ `cargo check` + `cargo test`（332 passed）

### 待真机验收

⚠️ **本机验证有失真风险**：用户机器开着 TUN，任意域名都解析进 fake-ip 池
（实测 `img-ypyp.test.upcdn.net` → `198.18.1.102`），浏览器按 Private Network Access
把它当内网处理。若缩略图仍不显示，**先关掉 TUN 再复验**，别直接判定改动无效。

1. 设置页域名填 `http://...` → 点「测试连接」→ 应弹确认框
2. 确认后：测试通过；上传成功，链接为 `http://...`
3. 在 Typora / 浏览器打开该链接 → 图正常（这条不受 PicNexus CSP 管，最可靠）
4. PicNexus「浏览」页 → 缩略图能显示（本次改动的核心目标）
5. 重启应用再测 → 不再弹窗（确认已落盘）
6. **反向判据**：确认过 A 域名后，把域名改成另一个 `http://` 地址 → **应重新弹窗**
7. WebDAV 局域网图床的缩略图现在应该也能显示了（顺带修好的那个）
