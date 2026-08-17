# WebDAV 发版前收尾 · 验收记录（2026-08-17）

- **需求来源**：[GitHub Issue #1：支持 WebDAV 图床](https://github.com/joeyliu6/PicNexus/issues/1)
- **背景**：功能主体已于 2026-08-13~17 完成并验收（[图床 6/6](./webdav-acceptance-2026-08-14.md)、[编辑器/CLI](./webdav-editor-integration-acceptance.md)），
  但代码从未进入任何发布版本——最新 release `v1.0.10`（2026-07-14）里连 `WebDAVUploader.ts` 都不存在。
  本轮清掉发版前的遗留项。
- **环境重建**：[webdav-testing-environments.md](../reference/guides/webdav-testing-environments.md)

## 结论

真机验收 **10/10 通过**（G1 图床 Digest 4 条 + G2 备份 Digest 4 条 + G3 成功路径 2 条），
并在过程中挖出 **1 个既有缺陷**（连接测试全线显示 `[object Object]`，已修）。

## 本轮发现：两个「遗留理由」本身是错的

这轮最有价值的产出不是补测试，而是发现两条被写进文档的「做不到」根本不成立。

### ① Obsidian「必须装插件或拿 Token 才能验」——两处都错

[webdav-editor-integration-acceptance.md](./webdav-editor-integration-acceptance.md) 记的残留风险是
「`/upload` 没验，要么装 Obsidian 真粘一张图，要么拿认证 Token 模拟请求」。核实后：

- **端点名就错了**：插件走的是 `/upload/file`（`uploadByContent`，`plugins/obsidian/src/uploader.ts:33-44`）。
  打 `/upload` 的 `uploadByPath()` 在插件里**一次都没被调用过**，那是留给 Typora/PicGo 协议兼容的。
- **不需要 Token**：`require_upload_auth`（`server/upload_handler.rs:436-446`）在请求**不带 `Origin`** 时
  直接放行，压根不查 token。Obsidian 的 `requestUrl` 正是不带 Origin——插件能用靠的就是这条豁免。

真正的障碍只有「Server 得由设置页启动」，而 `tower::oneshot` 打 `build_router` 就绕过去了，
且路由、中间件、handler 三段都真实执行。已补两条测试（见下）。

### ② TODO 判据点名要验的模块，根本没接线

[TODO.md](../TODO.md) 那条待验收写着「验证 `backupSyncUtils` / `useWebDAVSync` 走密文确实通」。
但 `useWebDAVSync` 在 `src/` 下**零引用**，8 个导出类型也全仓零引用——**手点 UI 永远验不到它**。
UI 走的是 `useBackupSync` → `ConfigSync`。

而且它藏着一个活的安全分歧：`uploadSettings` 直接 `putFile(JSON.stringify(config))` 上传**明文**，
既无 `isPasswordMode` 门禁也无 `secureStorage.encrypt`，而 `ConfigSync.uploadSettingsCloud` 两样都有。
那份配置装着全部图床凭据。已删除（`b94a24f`），判据改指 `ConfigSync`。

## 真机验收结果

环境：dufs `http://192.168.80.1:5001`（host-only 网卡，不暴露到真实局域网）
+ `node scripts/webdav-auth-fixture.mjs` 四端口。

**前置**：`scripts/test-webdav-compat.ps1` 打 dufs **22/22 通过**——先把「服务端接不接受这串请求」
这一层排除掉，后面出问题就一定在 PicNexus 侧。

### G1 · 图床链路的 Digest 提示（4/4）

| 端口 | 服务端形态 | 实测提示 | 结果 |
|------|-----------|---------|------|
| 5011 | 只给 Digest | 服务端要求 Digest 认证，PicNexus 暂不支持。请在服务端启用 Basic 认证（多数 NAS 可切换），或改用支持 Basic 的服务。 | ✅ |
| 5012 | 只给 Basic | 认证失败，请检查用户名和密码 | ✅ |
| 5013 | 两条同名 header，Digest 在前 | 认证失败，请检查用户名和密码 | ✅ |
| 5014 ⭐ | Digest，realm 里带逗号 | 同 5011 | ✅ |

⭐ **5014 是本轮新增的场景，也是首次真机验证**：`3eee955` 修的引号切分缺陷提交于 08-17，
而上一轮真机验收是 08-16，且当时三个场景的 realm 都不带逗号——这个 case 从未在真机上跑过。

### G2 · 备份链路的 Digest 提示（4/4，本轮新增能力）

四个端口、四条判据与 G1 完全一致，全部通过。

此前备份链路**完全没有**这个区分：`test_webdav_connection` 手里一直握着完整的 `res`，
`res.headers()` 随时可读，却只判了状态码，且文案漂移成「认证失败: 用户名或密码错误」（带冒号）。
现已与图床链路**共用同一个 `describe_status`**——共用而非各写一份，漂移从结构上不再可能。

### G3 · 成功路径复核（2/2）

| 位置 | 实测 | 结果 |
|------|------|------|
| 图床 WebDAV → 测试连接 | `验证成功` / **`连接成功，公开链接可正常访问`** | ✅ |
| 备份 WebDAV → 测试连接 | `验证成功` / `WebDAV 连接正常`，卡片状态变「已连接」 | ✅ |

第一条是批次 6 的直接验收：此前 `test_webdav_storage` 的成功文案在前端被丢掉，UI 只显示通用的
「WebDAV 配置有效」。现在说出了「公开链接也验过了」——这正是 WebDAV 图床最容易配错的那一段。

第二条验的是 **207 Multi-Status 没被 401 分支的改动误伤**。PROPFIND 成功返回 207 而非 200，
是这次改 401/403 时最容易踩坏的边界（Rust 侧有 `multi_status_207_is_still_a_success` 钉着）。

> ⚠️ **判据偏差（判据错，不是产品错）**：本条原判据写的是「应看到 `WebDAV 连接成功！`」，
> 那是 `test_webdav_connection` 成功时返回的 Rust 文案。实际 UI 显示
> 「WebDAV 连接正常」——`SettingsView.handleWebDAVTest` 成功分支用的是
> `TOAST_MESSAGES.auth.success('WebDAV')`，没有透传后端那句。
>
> **不修**：与图床那条不同，Rust 的「WebDAV 连接成功！」与前端的「WebDAV 连接正常」
> **信息量完全一致**，透不透传对用户没有区别；而图床那句多说了「公开链接也验过了」，
> 那才值得透传。
>
> 📌 这条偏差本身是个教训：判据是照 Rust 源码文案写的，没核实前端会不会用它——
> 正是 [webdav-acceptance-2026-08-14.md](./webdav-acceptance-2026-08-14.md) 里
> 「容易让人按源码文案去对 UI，对不上」那个坑的又一次实例。**写真机判据要按 UI 实际渲染的文案写。**

## 验收顺带挖出的缺陷：连接测试全线显示 `[object Object]`

**这是本轮真机验收唯一的、也是最有价值的发现。**

### 现象

G2 第一次跑时，四个端口的提示**全是** `验证失败 / [object Object]`。

### 定性：既有缺陷，非本轮引入

`git log -L` 显示 `String(errorMessage)` 这行自 `87e23d0 采用 primevue` 起从未改动。
即**备份 WebDAV 的连接测试从来没显示过任何有意义的失败原因**。

> 📌 顺带更正一处文档：[webdav-image-host-issues.md](../reference/troubleshooting/webdav-image-host-issues.md)
> 曾写「备份 WebDAV 撞上 Digest 时仍然只会说『认证失败，请检查用户名和密码』」——
> 这句话太客气了，它连那句都说不出来。

### 根因

Rust 抛 `AppError`，`#[serde(tag = "type", content = "data")]` 序列化后是
`{ type, data: { message } }`。前端 `String()` 一下就成了 `[object Object]`。

项目里早有 `getErrorMessage()`（`src/types/errors.ts:114`）专门拆这个结构，
**图床链路一直在用**，`useConfig.ts` 这三处从来没用过。

### 影响面比现象大：三条链路，不止 WebDAV

| 位置 | 命令 | 本轮是否被肉眼看到 |
|------|------|-------------------|
| `useConfig.ts` 通用测试 | 动态 `invokeCommand`（S3 / Cookie 系） | ❌ 没测到，但同样坏 |
| `useConfig.ts` | `test_r2_connection` | ❌ 没测到，但同样坏 |
| `useConfig.ts` | `test_webdav_connection` | ✅ 就是这次撞上的 |

### 它把本轮改动的价值完全吞掉了

批次 1 让 Rust 侧能准确区分「密码错」与「服务端要 Digest」，
但传到界面变成 `[object Object]`——**后端说得再准，用户一个字也看不到**。
不修的话批次 1 等于白做。修复前后对比（同一组截图证据）：

- 修复前：四个端口给出同一坨 `[object Object]`
- 修复后：5011/5014 说 Digest，5012/5013 说密码

### 为什么单测没抓到

现有用例 `mockRejectedValue('Cookie 已过期')` mock 的是**字符串**——
`String()` 对字符串是恒等操作，断言永远通过；而生产环境抛的是**对象**。

这与 `a322dba`（调了两个 Rust 侧从未存在的命令，单测把它们 mock 成存在的，
于是测试全绿、生产全挂）是同一类问题：**mock 的形状与生产不一致**。

新增 3 条用例改用真实 `AppError` 形态，并额外断言结果不含 `[object Object]`。

## 自动化补充

五条新测试，**没有一条依赖 dufs 或任何外部服务端**，全部进 `ci:full`，无 `#[ignore]`。

| # | 覆盖什么 | 手段 | 落点 |
|---|---------|------|------|
| ① | 备份链路 Digest 判据（含 207/403 两条不该动的分支） | cargo · 真 TCP + 内联 axum | `main.rs::webdav_connection_tests` |
| ② | `/upload/file` → WebDAV 全链路 + 免 token 豁免的边界 | cargo · `tower::oneshot` + 内联 axum | `server/mod.rs::tests` |
| ③ | **真 AES-GCM / PBKDF2 换钥往返** | vitest · 真 `crypto.subtle` | `fieldSecretsRealCrypto.spec.ts` |
| ④ | `getWebDAVClientAndPath`（每个同步 spec 都 mock 掉的那一环） | vitest · 真 client + 假 fetch | `backupSyncUtils.spec.ts` |
| ⑤ | 换钥前抢救 `cli-config.json` | cargo · 真临时文件 + 真 GCM | `main.rs::cli_config_rescue_tests` |

**③ 值得单独说**：此前所有 `rekeyFieldSecrets` 测试用的都是假密码机（字符串拼接），
那种替身**永远不会失败**——哪怕「重新加密」是原样抄回去也照样绿。
新用例跑真 PBKDF2（十万轮）+ 真 AES-GCM，耗时 239ms 对比同批 10-17ms，
这个差距本身就是「确实在跑真加密」的证据。其中一条用换钥后的密钥新起一个
`SecureStorage` 实例去解密，**模拟换钥+重启**——mocked E2E 结构上做不到这件事
（它的 `set_secure_key` 是 no-op、密钥 getter 返回硬编码常量）。

计数变化：`cargo test` 312 → **326**；`vitest` 2815 → **2835**（214 文件）。

## 待办

- [ ] G4 · 换备份密码后的配置同步与图床上传（[TODO.md](../TODO.md) 里那两条）

这是唯一还需要真机的部分，验的是**密钥跨进程存活**——设完备份密码、托盘退出重启后，
钥匙串里那把 PBKDF2 派生的新密钥仍能解开搬运过的密文。三套测试框架都表达不了「重启」：

- vitest：`invoke` 全 mock
- mocked E2E：`set_secure_key` 是 no-op、密钥 getter 返回硬编码常量
- wdio 真机 E2E：一 session 一次启动，且 `withGlobalTauri: false` 导致无法预置状态

**风险已经不高**：解密那一环 2026-08-15 已真机证过（当时停在「解密成功、连不上服务器」），
换钥搬运本身现由测试③ 的真 AES-GCM 往返覆盖，其中一条正是用换钥后的密钥新起实例去解密。
剩下未被覆盖的只有「密钥真的写进了系统钥匙串并跨进程可读」这一段。
