# 又拍云链路审查（2026-08-19）

> 起因：issue #4（S3 Content-Type）收尾时发现又拍云是漏网的一条。顺着查下去，
> 发现漏的**不止 Content-Type**——又拍云是五个私有存储里唯一绕开公共上传路径的，
> 于是公共路径上的每一处改进它都没吃到。

## 一句话结论

又拍云有 **3 个真缺陷**：D1（P0 同名无声覆盖）、D2（P2 存储路径失效）**已修并真机验证**；
**Q1 已坐实且更严重——GUI 上传从来就没通过**，尚未修。Q2（region）实测排除，不用改。

实测脚本：[scripts/test-upyun-compat.ps1](../../scripts/test-upyun-compat.ps1)，
原始结论：`scripts/.upyun-result.local`（gitignored）。

## 根因：唯一一条绕开公共路径的私有存储

编辑器/CLI 链路里有条公共流程 [`build_upload_key()`](../../src-tauri/src/server/upload_handler.rs)，
干两件事：**贴 path 前缀** + **给文件名加唯一 token**（`prefix_unique_file_name`）。

| 服务 | Rust 结构体有 `path` | 调 `build_upload_key` | 走 `s3_put_object` |
|------|:---:|:---:|:---:|
| 自定义 S3 / R2 / 腾讯 COS / 阿里 OSS / 七牛 | ✅ | ✅ | ✅ |
| **又拍云** | ❌ | ❌ | ❌（独立 REST PUT） |

又拍云用的是自家 REST API（`v0.api.upyun.com` + Basic Auth），不走 S3 SDK，
所以它从一开始就不在这条公共流水线上。**这是同一个根因导致的一串缺陷，
不是几个独立的手滑**——判断后续改动是否又漏了它，看这张表即可。

## 已确认缺陷

> D1 与 D2 已于 2026-08-19 修复并真机验证，详见下方「已修」。以下保留问题原貌，供追溯。

### D1（P0，已修）编辑器链路同名文件无声覆盖

`server_upload_upyun` 直接用原始文件名拼路径，不做唯一化：

```rust
let remote_path = format!("/{}/{}", bucket, file_name);   // file_name = 原始文件名
```

对照 GUI 侧 [BaseS3Uploader.ts](../../src/uploaders/s3/BaseS3Uploader.ts) 有 `buildObjectKey`，
注释写明「同名文件重复上传不再互相覆盖」；其余四家编辑器链路则由 `build_upload_key` 兜住。

**后果**：在 Typora/Obsidian 里两次插入同名图片（`screenshot.png`、`image.png`、
微信另存的图——截图工具重名是常态），**第一张被无声覆盖，第一篇文档的配图变成第二张**。
无报错、无提示。

**为什么算 P0**：与 `docs/audits/fix-plan-2026-08-13.md` 里「MD 修复备份路径丢数据」同档——
用户不会立刻发现，发现时旧图已经找不回来了。

### D2（P2，已修）编辑器链路不认「存储路径」配置

**四**层都缺 `path`，不是某一处漏传（审查初稿只列了三层，第四层是动手前核实时发现的）：

| 层 | 位置 | 现状 |
|----|------|------|
| 前端 payload | [editorServiceConfig.ts](../../src/composables/settings/editorServiceConfig.ts) `buildServiceConfig` | R2/腾讯/阿里/七牛四行都带 `path:`，upyun 那行没有 |
| **前端变更指纹** | 同文件 `buildEditorCredentialSignature` | 同样漏了 `path`。**它是"要不要把新配置下发给正在跑的编辑器服务"的判据**——只补 payload 不补它，用户单独改「存储路径」时指纹不变，后台会一直用旧路径，直到碰了别的设置才生效。Typora/Obsidian 与 CLI 两条链路共用这个指纹 |
| Rust 结构体 | `ServerUploadConfig::Upyun` | 没定义 `path` 字段 |
| 上传函数 | `server_upload_upyun` | 不调 `build_upload_key` |

**后果**：同一张图，GUI 上传落 `images/xxx.png`，编辑器上传落根目录 `xxx.png`。
设置页填的「存储路径」对编辑器链路完全无效。

连带问题：URL 拼接用的是 `file_name` 而非 key，加了 path 前缀后必须一并改，
否则会生成指向错误位置的链接。

## 实测结果（2026-08-19，真实又拍云账号）

| 项 | 结果 | 结论 |
|----|------|------|
| A 连接测试（REST） | 通过 | 操作员凭证有效 |
| B 编辑器上传（REST） | 通过 | 编辑器链路可用 |
| B2 子目录可写 | 通过 | 裸 PUT 自动建父目录 → D1+D2 走 3 行简单修法 |
| **B3 同名覆盖** | **坐实** | 67 字节 → 126 字节，回读只剩第二张 |
| C GUI 上传（操作员凭证） | 失败 | `ErrInvalidAccessKeyID` |
| C2 对照组（S3 专用凭证） | 通过 | **Q1 坐实** |
| Q2 region | 排除 | C2 就是用写死的 `'upyun'` 过的，`getRegion()` 不动 |
| D 回读 Content-Type | `image/png` | issue #4 修复生效 |

### ⚠️ B3 第一轮实测差点把 P0 误降级

第一轮 B3 回的是 **HTTP 429 `concurrent put or delete`**，脚本判据里没有这一条，
直接打出「又拍云拒绝了同名覆盖，风险比预期小」。**429 是又拍云对同一个 key 的并发锁
（写得太密），不是拒绝覆盖**——而且是脚本自己造出来的：PUT→GET→PUT 三个动作挤在同一秒。

拉开间隔重测：67 字节 →（隔 5 秒）→ 126 字节 → 回读 **126 字节**，第一张确实没了。

**教训**：真实用户两次插图隔着秒到分钟，撞不到这个锁；用「连打」去测「覆盖」，
测的其实是限流。判据里凡是把某个失败状态码解读成"业务上被拒绝"的，
都要先确认它不是限流/并发类错误。脚本已加退避重试并把 429 单独分支。

## 疑点实测结论

### Q1（已坐实，比预期严重）GUI 上传把操作员账号密码当 S3 凭证用

[UpyunUploader.ts](../../src/uploaders/upyun/UpyunUploader.ts)：

```ts
getAccessKey(config) { return config.operator; }   // 操作员账号 -> AccessKey
getSecretKey(config) { return config.password; }   // 操作员密码 -> SecretKey
```

但[又拍云官方文档](https://help.upyun.com/knowledge-base/aws-s3%E5%85%BC%E5%AE%B9/)原文：

> 计算签名所需的 `AccessKey` 和 `SecretAccessKey` 请前往控制台「操作员-编辑」或
> 「云存储-配置-存储管理-操作员授权-S3访问凭证」中获取

即 S3 凭证是**控制台单独生成的一对**。用假凭证探测 `s3.api.upyun.com` 会回
`ErrInvalidAccessKeyID`，说明服务端确实校验 AccessKeyID 的存在性。

**已坐实**：同一个桶、同一时刻，操作员凭证 → 403 `ErrInvalidAccessKeyID`，
控制台生成的 S3 专用凭证 → 200。

**比审查时预估的更严重**：这不是"配置麻烦"，而是**GUI 上传对每一个按界面标签填写的用户
都从未成功过**——设置页把字段标成「Operator / Password」，照着填的人拿到的必然是这对
REST 凭证，而 S3 接口不认它。要修：`UpyunServiceConfig` 加 `s3AccessKey` / `s3SecretKey`
两个字段，设置页加两个输入框，属于配置结构变更。

**注意不是替换而是新增**：operator/password 必须保留——编辑器/CLI 链路走 REST + Basic Auth
用的正是它俩，实测 B 通过。两条链路各用各的凭证，这是又拍云独有的形态。

**注意这个坑**：设置页「测试连接」走的是 REST API（`test_upyun_connection`，Basic Auth），
**和 GUI 上传走的 S3 API 不是一条链路**。测试连接亮绿灯不能证明上传可用——
这也是这个问题能一直潜伏至今的原因。

### Q2（已排除）SigV4 的 region 取值

`getRegion()` 写死 `'upyun'`。实测 C2 就是用这个值签名过的（HTTP 200），
说明又拍云的 S3 端点不校验 region。**`getRegion()` 不用改。**

脚本已内置候选 region 自动重试，只在回 `SignatureDoesNotMatch`（AccessKeyID 认得、
仅签名不匹配）时触发；本轮 C 回的是 `ErrInvalidAccessKeyID`（凭证本身不认），
换 region 没有意义，因此没触发——这是设计如此，不是漏测。

## 已修

### D1 + D2（2026-08-19）

四处改动，合一个提交（D1 与 D2 共用 `build_upload_key` 这一处，拆开会改同一行两次）：

| # | 位置 | 改动 |
|---|------|------|
| ① | `editorServiceConfig.ts::buildServiceConfig` | payload 加 `path: fd.upyun.path` |
| ② | `editorServiceConfig.ts::buildEditorCredentialSignature` | 指纹加 `fd.upyun.path` |
| ③ | `ServerUploadConfig::Upyun` | 加 `path: String`，**带 `#[serde(default)]`** |
| ④ | `server_upload_upyun` | 改用 `build_upload_key`；URL 拼接从 `file_name` 换成 `key` |

③ 的 `#[serde(default)]` 不能省，理由同 `Webdav.unique_file_name`：升级前写下的
`cli-config.json` 没有这个字段，缺默认值会让整份配置反序列化失败，三条编辑器链路一起罢工。

**真机验证**（同一个又拍云桶）：模拟两次插入 `screenshot.png`，落在
`images/20260819_k5et_screenshot.png` 与 `images/20260819_glgu_screenshot.png`，
回读 67 / 126 字节两张都在，公开链接均 HTTP 200（后者同时验证了④的 URL 拼接改动）。

**回归防护**：新增 `storage_upload_paths_all_go_through_build_upload_key`（源码哨兵）。
它**默认要求所有 `server_upload_*` 都走 `build_upload_key`**，不需要的必须写进 `NO_OBJECT_KEY`
白名单并注明理由——反过来做是有意的：又拍云当初漏掉正是因为它连 `upload_path` 参数都没有，
"按参数筛"的哨兵会直接跳过它，等于没设防。加新图床时这条测试会失败，逼人显式表态。

> ⚠️ 这个哨兵第一版是**假绿**的，改它务必重做阴性对照。本仓库 `.rs` 全是 CRLF，
> 而 `include_str!` 原样保留：切分符 `"\nasync fn ..."` 能匹配（`\r\n` 里含 `\n`），
> 截断符 `"\n}\n"` 却匹配不上 `\r\n}\r\n` ——于是切分看着正常，只有最后一个函数
> （正是又拍云）悄悄吃到文件尾，把测试模块自己那行 `body.contains("build_upload_key(")`
> 也算成了"函数体里有"。**只跑正向用例证明不了哨兵还活着。**

**升级影响**：编辑器链路的新图从桶根目录改落 `path` 配置的目录下（默认 `images/`）。
存量对象与历史链接不受影响（不动存量）。

### Content-Type（2026-08-18）

`e8b24459 fix(upyun): send a real Content-Type on the editor upload path`——
编辑器链路的 Content-Type 从写死的 `image/*` 改为按扩展名推断（`server_upload_upyun`）。
`image/*` 只在请求的 `Accept` 头里合法，作为响应类型是无效值，浏览器不预览、直接当下载处理。

⚠️ **旧对象不会自愈**：Content-Type 是上传那刻写进桶的元数据，改代码不改已有对象。
验证务必用新传的图（脚本每次都用带时间戳的新文件名，不受影响）。

## 怎么测

```powershell
# 首次：交互式填凭证，填完存到 scripts\.upyun.local（gitignored），下次免填
.\scripts\test-upyun-compat.ps1 -SaveCredentials

# 之后
.\scripts\test-upyun-compat.ps1
```

需要准备（都在又拍云控制台 → 云存储 → 服务空间 → 配置 → 存储管理 → 操作员授权）：
操作员账号、密码、服务空间名、公开访问域名，以及**同一页面的「S3 访问凭证」AK/SK**（对照组，决定 Q1 的答案）。

脚本会传 3~4 张 1x1 透明 PNG（几十字节），结论存到 `scripts\.upyun-result.local`。

### 判据表

| 项 | 通过的含义 | 失败的含义 |
|----|-----------|-----------|
| A 连接测试 | 操作员凭证有效 | 账号/密码/桶名有错，后面结论都不作数 |
| B 编辑器上传 | REST 链路可用 | 编辑器模式整个不可用 |
| **B2 子目录可写** | 又拍云自动建父目录 → **D2 改 3 行即可** | 必须先调 `POST folder=true` → 改动量翻倍 |
| **B3 同名覆盖** | 「确认存在」→ **D1 坐实为 P0** | 「未复现」→ D1 降级 |
| **C GUI 上传** | Q1 不成立，代码没问题 | 见下面 C/C2 组合 |
| C2 对照组 | — | — |
| D 回读 Content-Type | 是 `image/png` → issue #4 修复生效 | 带 `*` → 修复没生效 |

**C / C2 组合怎么读**：

| C（操作员凭证） | C2（S3 专用凭证） | 结论 |
|:---:|:---:|------|
| ❌ | ✅ | **Q1 坐实**，改 `UpyunUploader.ts` + 配置结构 |
| ❌ | ❌ | 大概率是 Q2（region），加 `-Region us-east-1` 重跑 |
| ✅ | — | Q1 不成立，GUI 链路无需改动 |

## 剩下的活：Q1

| 缺陷 | 状态 |
|------|------|
| D1 + D2 | ✅ 已修 + 真机验证 + 回归哨兵（见「已修」） |
| Q2 | ✅ 实测排除，不改 |
| **Q1** | ⬜ **未修**，方案见下 |

Q1 的改动点（六处，单独一个提交——涉及配置结构变更）：

| # | 位置 | 改动 |
|---|------|------|
| ① | `serviceTypes.ts::UpyunServiceConfig` | 加 `s3AccessKey` / `s3SecretKey` |
| ② | `defaults.ts` | 两个新字段的空默认值 |
| ③ | `validators.ts` | `s3SecretKey` 加进脱敏（现在只脱敏了 `password`），否则会随日志/诊断导出泄露 |
| ④ | `UpyunUploader.ts::getAccessKey/getSecretKey` | 改读新字段 |
| ⑤ | `PrivateStorageGroup.vue` 的 `upyun.fields` | 加两个 `type: 'password'` 字段配置（表单是数据驱动的，不动模板） |
| ⑥ | `serviceRequiredFields.ts` | 见下面这个待定项 |

**⑥ 待用户拍板**：又拍云修完后要两套互不相干的凭证——编辑器/CLI 走 REST 用
operator/password，GUI 上传走 S3 用新加的这对。那么只填了前一套时算不算"配置完成"？

- **按链路分别判断**（本文推荐）：GUI 上传要求 S3 凭证，编辑器/CLI 只要 operator/password。
  各条链路按自己真正需要的东西卡。代价是要在必填表里开一个"编辑器专用"的例外（约 10 行）。
- **两套都填齐才算完成**：改动最小（必填表加两个字段名），但只用 Typora + 又拍云、
  手头没有 S3 凭证的老用户，升级后又拍云会变成"未配置"，**而编辑器那条路根本不需要它**。

> `SERVICE_REQUIRED_FIELDS` 被 6 个模块共用（`useServiceHealth` / `MultiServiceUploader` /
> `useServiceSelector` / `trayMenu` / `editorServiceConfig` / `s3ConfigValidation`），
> 动它之前先看这张消费方清单。

## 下一次接手时怎么做（给 AI 的交接说明）

**当前进度**：D1/D2/Q2 已收口；**只剩 Q1**，方案已列在上面，卡在⑥那个待拍板项。

按顺序做：

1. **先问用户⑥怎么定**，再动手（用户明确要求：先规划后执行）。
2. 凭证已存在 `scripts/.upyun.local`（gitignored），改完可直接跑
   `.\scripts\test-upyun-compat.ps1` 回归，不必再找用户要账号。
3. 改完跑 `npm run lint` + `npm run typecheck`；动了 Rust 就 `cd src-tauri && cargo check && cargo test`。

四条容易踩的：

- **改了源码哨兵就必须重做阴性对照**（把某条链路的 `build_upload_key` 去掉，确认测试会红）。
  它假绿过一次，根因是 CRLF，细节见「已修」里那段警告。

- **别把 A 和 C 的结论混用**。「测试连接」走 REST（Basic Auth）、GUI 上传走 S3（SigV4），
  是两条独立链路，A 通过完全不能推出 C 通过。
- **又拍云不走 S3 SDK**，凡是改编辑器/CLI 公共上传逻辑，先确认它吃不吃得到（见开头那张对比表）。
- **别凭空假设又拍云的 API**。本文档里凡是引用官方文档的地方都标了出处，
  要扩展结论请先查[又拍云文档中心](https://help.upyun.com/)确认签名/参数/返回值。
