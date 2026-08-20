# 灯箱安全闸 + 又拍云双链路测试连接（2026-08-20）

> 起因：发版前把 36 个未推送提交当"要发的新版本"逐条复核，发现两处会直接打到用户身上的洞。
> 两处都不是新引入的 bug，而是**前一批改动留下的敞口**——一处是安全网撤掉后没补齐，
> 一处是老缺陷修好了但检测手段没跟上。

## 一句话结论

1. 灯箱大图、表格悬停预览、±1 预热三条路补上 `safeImageUrl`，与缩略图同判据。
2. 又拍云「测试连接」改成 REST + S3 两条链路各验一次，报错点名是哪把钥匙。

---

## 缺陷一：CSP 撤网后，三条取图路径一道闸都没有

### 事实

`2ab296af feat(csp): allow http: in img-src` 把 CSP 的 `img-src` 放开到含 `http:`。
那条提交的信息里已经诚实记下了代价，并当场补掉了收藏页 / 时间线的缩略图
（`527fdaf5`）。但**同一批地址还有三条路没补**：

| 路径 | 位置 | 消费的地址 |
|------|------|-----------|
| 灯箱大图 + 模糊占位 | `HistoryLightbox.vue` 的 `imageSrc` / `mediumSrc` | 原始 URL，未过闸 |
| 表格悬停预览 | `useTableInteractions.ts::syncHoverPreviewToItem` / `handlePreviewEnter` | `thumbCache.getMediumImageUrl` 原值 |
| 灯箱 ±1 预热 | 同上的 `getItemImageUrl` → `warmImages` / `resolveAdjacentUrl` | `getPrimaryImageUrl` 原值 |

灯箱由 `HistoryTableView` / `FavoritesView` / `TimelineView` **三家共用**，
所以收藏页和时间线虽然缩略图有闸，点开大图照样绕过。

### 两层后果，第二层才是用户会碰到的

- **安全**：`safeImageUrl` 明确拉黑的云元数据地址（`169.254.169.254`）、链路本地地址，
  在这三条路上畅通无阻。预热那条尤其隐蔽——`warmImage` 不挂在任何可见元素上，
  被拦与否用户看不出来，只有网络面板里会多一条指向内网的请求。
- **行为自相矛盾**：同一个未确认的明文 HTTP 域名，在收藏页缩略图上裂图、
  在历史页 hover / 灯箱里却看得见。用户读不出"安全策略"，只会读成"某个页面坏了"。

### 修法

新增 `src/composables/history/useGatedImageUrls.ts`：把「从 `HistoryItem` 取地址」
这件事收成一个入口，内部统一过 `safeImageUrl`，拦下返回空串。

**Why 返回空串而不是抛错**：空串是下游各处**早就在处理**的「没有地址」——
`warmImage` 直接 return、悬停预览收起、`resolveAdjacentUrl` 当没有相邻图、
`openPswp` 不开灯箱。抛错反而要求每个调用点新写一个 catch 分支。

灯箱走 prop（`confirmedHttpHosts`）而非直接调 composable，与 `ThumbnailImage` 的
接线方式保持一致，三个父视图各传一份自己算好的名单。

### 一个必须一起做的配套：被拦下要有解释

`openPswp` 在 `imageSrc` 为空时直接 return，于是**用户点了缩略图什么都不会发生**。
缩略图上的「加载失败」只说了坏，没说为什么坏、更没说去哪儿修。

按 [notification-patterns.md](../design/notification-patterns.md) 的决策树，
这属于「用户主动触发 + 结果有歧义」→ `toast.warn`，detail 末尾带指引：

> 图片来源未确认 / 该链接是明文 HTTP 或指向内网地址，已拦下未请求。
> 请到设置页对这个图床的公开域名「测试连接」并确认一次。

为此灯箱多留了一个未过闸的 `rawImageSrc`：**区分「本来就没图」和「有图但被拦」**，
只有后者该弹。不留这一份的话两种情况都是空串，分不开。

不会和既有的 `handleLoadError` 撞车：被拦下的地址压根没发出过请求，
走不到 PhotoSwipe 的 load 失败回调，两条提示互斥。

### 副作用：`useTableInteractions.ts` 撞了 500 行门禁

加完闸后有效行数 507。把闸抽成 `useGatedImageUrls` 顺带解决——它本来就是个横切关注点，
不该长在表格交互里。

---

## 缺陷二：又拍云「测试连接」绿灯不代表能传

### 事实

又拍云有两套**互不通用**的凭证：

| 凭证 | 端点 | 认证 | 谁在用 |
|------|------|------|--------|
| 操作员账号 / 密码 | `v0.api.upyun.com` | Basic Auth | Typora / Obsidian / CLI |
| S3 AccessKey / SecretKey | `s3.api.upyun.com` | SigV4 | 软件内 GUI 上传 |

`b8b49fc9` 修好了 GUI 上传用错凭证的老缺陷，但**检测手段没跟上**：
`test_s3_connection` 里 `service_id == "upyun"` 被单独截胡走 REST，
而 `S3TestConfig::get_access_key()` 的取值链里根本没有 `s3AccessKey`，最后落到 `operator`。

于是：**测试连接只验 REST，绿灯与 GUI 上传能不能跑毫无关系。**
这正是老缺陷能潜伏那么久的原因——绿灯一直在替它打掩护。

### 升级影响（发布说明必须写）

`serviceRequiredFields.ts` 已把 `s3AccessKey` / `s3SecretKey` 列进 GUI 必填项。
**所有现存又拍云用户升级后，服务健康都会标「未配置」**，必须去控制台
「操作员授权 → S3 访问凭证」补一对。旧版本 GUI 上传本来就从没成功过，
所以这不是功能倒退，但用户视角是"升级把我的图床搞坏了"。

### 修法

`test_upyun_connection` 改成两条链路各验一次，任一条挂就红灯：

```
REST  GET v0.api.upyun.com/{bucket}/    Basic(operator:password)
S3    ListObjectsV2 s3.api.upyun.com    SigV4(s3AccessKey/s3SecretKey), region=upyun
```

**Why S3 那条用 ListObjectsV2 而不是 HeadBucket**：又拍云官方 S3 兼容清单里
**没有 HeadBucket**（2026-08-20 核对 <https://help.upyun.com/knowledge-base/s3-api/>，
只列了 ListBuckets / ListObjectsV2 / Put / Get / HeadObject / Delete / Copy / 分片几类）。
拿一个它不实现的动作去探测，会把好凭证判成坏的——**比不测更糟**。

**Why 探测放 Rust 而不是前端自己发一次**：GUI 上传本身就是把 endpoint/AK/SK 交给
`upload_to_s3_compatible`，同一个 SDK、同一套签名。在 Rust 里探测才是"测的就是传的"。

**Why 报错要点名是哪把钥匙**：两套凭证长得一样、填在同一张卡片上。
只说「认证失败」会把用户支去改那把本来没错的钥匙。

`ErrInvalidAccessKeyID` 是又拍云自家拼法（不是 AWS 的 `InvalidAccessKeyId`），
两种都要认，否则最常见的那种失败会掉进兜底分支、退回没有指向性的「连接失败」。

### 端点与 region 登记进跨语言常量守卫

`UPYUN_S3_ENDPOINT` / `UPYUN_S3_REGION` 在 Rust 与 `UpyunUploader.ts` 各写一份，
已加进 `scripts/check-cross-language-constants.mjs` 的 `PAIRS`。

理由不是洁癖：两边一旦漂移，测试连接验的就不是上传真正会去的那台服务器，
**绿灯重新退化成没有意义的绿灯**——正是这次要修的那个形态。

### 前端预校验刻意不动

`validateS3Config` 仍用 REST 口径（不卡 `s3AccessKey`）。**这不是说测试连接只验 REST**，
而是「缺 S3 凭证」这件事交给 Rust 报更合适：

- Rust 的 `UPYUN_S3_CREDENTIAL_MISSING` 会告诉用户去哪个页面生成；
  前端只能吐一句 `s3AccessKey 格式无效（至少 2 个字符）`，读完仍然不知道钥匙在哪。
  **老用户升级后必然撞上这一句，措辞就是全部价值。**
- 不存在多跑一趟网络的代价：Rust 侧取凭证在发任何请求之前，缺了就地返回。

---

## 验证

### 自动化

| 范围 | 结果 |
|------|------|
| Rust `cargo test` s3_compatible | 11 passed（新增 6：两种拼法点名凭证 / 桶与凭证分开报 / 未知错误原样透出 / 空白当没填 / 两套凭证不串 / camelCase 反序列化） |
| `historyLightbox.spec.ts` | 12 passed（新增 5 条安全闸） |
| `useTableInteractions.spec.ts` | 23 passed（新增 4 条安全闸） |
| 跨语言常量守卫 | 通过 |
| `typecheck` / `eslint` | 通过 |

### 阴性对照（做过，不是声称）

把 `useGatedImageUrls.gateImageUrl` 与 `HistoryLightbox.imageSrc` 的 `safeImageUrl`
同时摘掉 → **5 条变红**（灯箱 2 + 表格 3）。放行类用例（局域网 / 已确认主机）
在变异下仍绿，符合预期——它们断言的就是放行。

### 真机验收结果（2026-08-20）

| # | 场景 | 结果 |
|---|------|------|
| U1 | 清空 S3 凭证后「测试连接」 | ✅ **按钮直接禁用**（必填项没填齐），比弹红灯更早一步拦住 |
| U2 | S3 AccessKey 填错 | ✅ 红灯，提示点名「S3 访问凭证」并告知去哪儿生成 |
| U3 | 两对都填对 | ✅ 绿灯（日志三行齐：REST 通过 / S3 通过 / 两条均通过）**且上传成功** |
| 4.1a | GUI 链路 Content-Type | ✅ `image/png`，13291 字节与日志一致 |
| 4.1b | **编辑器 / CLI 链路** Content-Type | ✅ `image/png`。这条链路 2026-08-18 前**必然**返回 `application/octet-stream`，所以它同时证明修复真的生效；顺带验了编辑器链路的存储路径（落 `images/`）与文件名唯一化（`20260820_4mfv_`），即 `4cb258eb` 的成果 |
| 4.2 | 同名不覆盖 | ✅ 两张都叫 `test.png`，落成 `20260820_arqf_` / `20260820_ncnk_`，读回字节数 178 / 4877 各归各位 |
| — | 路径前缀 + 文件名唯一化 | ✅ key 为 `images/20260820_xxxx_...png`，不以 `/` 开头 |
| — | 清空即删除 + 确认框 | ✅ 弹框正常，清除后芯片消失 |
| P2 | **WebDAV 局域网缩略图** | ✅ dufs `http://192.168.80.1:5001`，历史页缩略图与点开大图**都能显示**——推翻了「只是推断」的状态，也顺带验了灯箱安全闸对局域网地址的放行 |

> 📌 **U1 的判据当初写错了。** 原本写的是「应红灯并说去操作员授权生成」，但
> `HostingCard` 在必填项没填齐时**直接禁用「测试连接」按钮**，那句 Rust 提示
> 从 GUI 根本走不到。它仍然有用（编辑器 / CLI 不经过这个按钮），但不是 GUI 用户
> 会看到的东西。写验收判据时**先确认那条路径在界面上真的走得到**。

### 真机挖出的缺陷（单测全绿也没拦住）

**`SdkError` 直接 `to_string()` 只给五个字 `service error`**，真正的错误码在
source 链里。于是所有 `contains("ErrInvalidAccessKeyID")` 这类分类**一条都命中不了**，
全落进兜底分支——用户看到「连接失败: service error」，等于什么也没说。

单测为什么没拦住：喂给分类函数的是手搓字符串（`"ErrInvalidAccessKeyID: ..."`），
**那种形态现实中不会出现**。测试和现实对不上，绿得很安心。

同一个毛病共三处，都是既有缺陷：

| 位置 | 症状 |
|------|------|
| 通用 S3 测试连接 | R2 / 腾讯 / 阿里 / 七牛 / 自定义 S3 密钥填错，同样只显示 `service error` |
| 又拍云 S3 链路 | 本次改动新引入 |
| **S3 上传失败提示** | 6 个图床任何上传失败都只说 `上传失败: service error`——**用户看得最多的一处** |

修法：`describe_sdk_error` 同时取 `ProvideErrorMetadata::code()`（服务端错误码）
和 `DisplayErrorContext`（完整 source 链）。

**又要分两份**：摊平后的错误链是整个 HTTP 响应（响应头 + XML 正文），上千字符。
日志里是排查金矿，塞进 toast 就是一堵墙。所以 `SdkErrorText { full, brief }`——
`full` 进日志和分类匹配，`brief` 给用户（优先错误码，没有就按**字符**截断 120）。

**防复发**：源码哨兵 `sdk_errors_never_go_through_plain_display`，因为这个坑
靠喂字符串的单测永远抓不到。它上线第一次就把自己抓了（`code.to_string()` 也以
`e.to_string()` 结尾），所以判断收紧成「前一个字符不是标识符的一部分」，
并给哨兵本身也配了正反用例。三种变异都做过阴性对照。

### 真机挖出的第二个缺陷：收藏页不认「新增收藏」

在历史页点收藏 → 切到收藏页**看不到**，得刷新才出来。既有缺陷，与本次改动无关。

根因在 `useFavoritesData` 的 `watch(favoriteSet)`：整段增量逻辑只算
**「从当前页里移走了几条」**。新增时一条都没移走，`removedCount === 0` 直接 return，
新收藏那条永远进不来。0 → 1 那个特例有单独分支兜着，所以"从没有收藏到有第一条"是好的，
**列表非空时再加就丢了**——这也是它能潜伏至今的原因。

修法：检测到 `favoriteSet` 里出现了 `oldSet` 没有的 id 就 `reloadFromStart()`。

- **不能就地插入**：列表按时间倒序，收藏一张旧图时它落在中间甚至下一页，
  光凭 id 算不出插哪儿（这个 composable 手里只有 id，没有 meta）。
- **必须挡住「加载在途」**：`firstPageLoaded` 在 `loadFirstPage` 一进门就置真，而
  `favoriteSet` 往往在同一轮被 `loadStats` 填上；不挡就会每次首屏都白查两遍。
- **必须比内容而不是比引用**：配置保存广播极频繁，`favoriteSet` 每次都产出新 Set。

三部分各有测试盯着，三种变异（退回改动前 / 换引用就重查 / 去掉在途保护）
分别红 3、3、9 条。

> 📌 中途我多加了一道「已经显示出来的 id 不重查」的收窄，阴性对照发现**它怎么改都不红**——
> 那条路径根本走不到。已删。**变异测试的价值不只是证明测试有效，也会告诉你哪段代码是死的。**

### 一个环境坑（不是产品缺陷，但会浪费下一个人半小时）

`src-tauri/target/release/data/portable.json`（2026-07-16 某次便携版打包留下的）会让
**release 版进入便携模式**，去 exe 旁边的 `data/` 找 `cli-config.json`，而应用写的是
`%APPDATA%\us.picnex.app\`。表现为 CLI 报「未找到配置文件」，路径一看就不对。

本次改用 `target/debug/picnexus.exe` 跑通（同一份代码，只是没优化）。
要用 release 版测 CLI，先挪走那个 marker。

### 链接检测批次 2（2026-08-21 全过）

| # | 场景 | 结果 |
|---|------|------|
| 2.1 | 幽灵行 | ✅ 删 2 张后立刻切页，行消失、统计同步减少 |
| 2.2 | 取消后续检不丢结果 | ✅ 取消时「超时 6 / 未检测 22」→ 续检至 0 → 重启后仍为 0 |
| 2.3 | 3xx 不误判失效 | ✅ 徽章 `301` + 「跳转」标签，tooltip「浏览器会自动跟随」，不是「防盗链限制」 |

### 又一个真机才暴露的问题：链接检测拦掉所有局域网图床

`link_checker.rs::validate_probe_url` 的明文 HTTP **只放行回环**，
`192.168.x.x` 一律判「策略拦截」。但同一张图**上传和显示都是允许的**——
`url_policy.rs`（上传）、`networkPolicy.ts`（渲染）、CSP `img-src` 三处都放行局域网 HTTP。

后三处是 2026-08 那两批专门为局域网图床做的，检测器这条判据没跟着更新。
用户视角：NAS 用户一点链接检测，自己所有的图全红，分不清真失效还是策略拒绝。

⚠️ 这**不是** TODO「已知取舍」里那条「只读探测不做 DNS 裁决」。那条讲的是不查 DNS，
这条是另一条判据。已交由独立会话出方案，**本次未改**。

它还顺手坑了验收本身：2.2 的第一版场景「传 15 张到 dufs 再停掉 dufs」完全失效——
那些链接在发请求之前就被判「拦截」了，停不停服务一个样。

### 真机验收全部完成（2026-08-21）

本次涉及的判据一条不剩。**两条挂账另开会话处理，本次未修**：

1. **收藏页不认「新增收藏」** —— 已改一版（`useFavoritesData` 检测新增就重查，带测试、
   变异全红），但**真机上问题依旧**。怀疑是竞态：`toggleFavorite` 先乐观改 `favoriteSet`、
   后 `await historyDB.setFavorite`，watcher 在写盘落地前就去查了，拿回旧数据。**未验证。**
   改动留在工作区，下一手可以推翻重来。
2. **链接检测拦掉局域网图床** —— 见上一节，只出方案不动代码。

