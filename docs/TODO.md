# 开发待办

> 本文件是仓库内**未完成**开发需求的详细记录来源。其他文档只链接到对应条目，不重复维护需求内容。
>
> 「已知取舍」小节记的是**故意不做**的决定：看着像缺陷、但改了会更糟的地方。写在这里是为了拦住下一个人"顺手修好"。

## 归档规则（由 `scripts/check-todo-hygiene.mjs` 强制）

本文件是**待办索引**，不是档案馆。条目做完后正文必须搬走，否则完成的记录只进不出，
文件会无限膨胀（曾经一条已完成条目占到全文件 58%）。

| 小节 | 允许的详细程度 |
|------|---------------|
| 待验收 / 待处理 | 可以写详细——正在做的事需要上下文 |
| 已知取舍 | 可以写详细——决定的理由就是它的价值 |
| **已完成** | **每条正文不超过 3 行**：一句话结论 + 指向归档文档的链接 |

完成时按内容性质分流，别一股脑塞进同一个地方：

| 内容性质 | 去处 |
|---------|------|
| 验收过程与结果、设计决策记录 | `docs/audits/` |
| 环境搭建、操作步骤 | `docs/reference/guides/` |
| 症状 → 根因 → 修法 | `docs/reference/troubleshooting/` |
| 可复用的做法 | `docs/reference/patterns/` |
| 链路流程与排查表 | `docs/flows/` |

两条机械规则由 `npm run lint` 拦截：**待验收 / 待处理下不得出现 `### [x]`**；
**已完成下单条正文不得超过 3 行**。

---

## 待验收

### [~] 2026-08-13 修复计划批次 1 / 2 / 4 的手动验收

- **来源**：[docs/audits/fix-plan-2026-08-13.md](./audits/fix-plan-2026-08-13.md)（批次 1 = 文档修复数据安全，批次 2 = 链接检测正确性，批次 4 = S3 上传链路）
- **状态**：代码已合入、单测与门禁全通过；下列每条都**需要真实文件 / 真实网络**，单测覆盖不到，等用户手测

下列每一条都是先构造场景、再核对判据。判据写死了「应该看到什么」，看到别的就是回归。

#### 批次 1：文档修复（`be0ba3b` 之前的 `7d5d376` / `3e86dd5` / `7fb363c`）

> ✅ **2026-08-15 三条全过**，构造方法与结果见
> [md-rescue-acceptance-2026-08-15.md](./audits/md-rescue-acceptance-2026-08-15.md)。
> 跑的过程中另外挖出两个真缺陷（inject 上下文、拖放白名单），均已修复。

- [x] **同名文件备份不互串**（1.1，原缺陷会永久丢数据）
      两个子目录 `a/` 与 `b/` 各放一个含失效链接的 `README.md` → 文件夹模式修复 → 撤销。
      **判据**：`.picnexus-backup` 下保留子目录层级（不是平铺），撤销后两个 `README.md` 内容各归各位、逐字比对无互串。
- [x] **备份目录不被重扫**（1.2）
      对上一步修复过的文件夹再扫一次。
      **判据**：结果里不含 `.picnexus-backup` 内的任何文件，失效数不虚高。
- [x] **非 UTF-8 文件拒绝写回**（1.3）
      记事本存一个 ANSI 编码、含中文的 `.md`（单文件拖入模式）→ 修复。
      **判据**：提示「编码不受支持」并跳过，**不是**「修复成功」后中文变 `�`；文件本身未被改动。

#### 批次 2：链接检测（`be0ba3b` / `a375d29` / `a88c500`）

- [x] **幽灵行**（2.1，2026-08-20 过）
      删 2 张后立刻切页，对应行已消失、顶部统计数字同步减少。
- [x] **取消后续检不丢结果**（2.2，2026-08-21 过）
      取消时「超时 6 / 未检测 22」→ 续检至 0 → 重启应用后「未检测」仍为 0，结果没丢。
      > **造场景比判据本身还费劲，记下来免得重来。** 原判据写「上千条」，实际库里只有 18 条、
      > 秒结束根本来不及点取消。第一版方案「传 15 张到 dufs 再停掉 dufs」也不行：局域网 HTTP
      > 会被 `validate_probe_url` **同步判成「拦截」**，压根不发请求，停不停服务毫无区别。
      > 最后用 `scripts/.acceptance-2026-08-20.local/blackhole-server.js`（回环上只接连接、
      > 不回响应）当公开域名，每条卡满 10 秒超时，15 条约 20 秒才够操作。
- [x] **3xx 不再误判失效**（2.3，2026-08-20 过）
      本机起了个 301 跳转服务当公开域名，实测：徽章 `301` + 紫色「跳转」标签，
      tooltip「跳转链接 (301) · 浏览器会自动跟随，通常可正常显示；检测器出于安全不跟随」。
      **不是**「失效」，也没写成「防盗链限制」。
      > 原判据写的「落在『疑似』tab」已过期：界面现在是独立的「跳转」标签、归在「问题」下。
      > 复现脚本见 `scripts/.acceptance-2026-08-20.local/redirect-server.js`（必须绑回环，
      > 见下面那条「链接检测拦掉局域网图床」）。

> 📌 2.2 与 2.3 各自都有一条"反向判据"：2.2 要确认历史被清空时结果**不**落库（写到已删记录上），2.3 要确认防盗链 403 仍显示「防盗链限制」而不是被跳转文案抢走。两条都有单测钉住（`useLinkCheck.spec.ts` / `useLinkStatusDisplay.spec.ts`），手测时顺带看一眼即可。

### [ ] 又拍云「测试连接」双链路（2026-08-20 新增）

- **来源**：[lightbox-gate-and-upyun-dual-chain-2026-08-20.md](./audits/lightbox-gate-and-upyun-dual-chain-2026-08-20.md)
- **状态**：代码已改、单测与门禁全过；判据要真实的又拍云账号，单测覆盖不到

改动前「测试连接」只验 REST，绿灯与 GUI 上传能不能跑毫无关系。下面三条是验"绿灯现在真的有意义"。

- [x] **只填操作员凭证 → 应红灯**（U1，2026-08-20 过）
      S3 AccessKey / SecretKey 留空，其余填对 → 测试连接。
      **实测结论与原判据不同**：必填项没填齐时 `HostingCard` 直接**禁用**测试连接按钮，
      比弹红灯更早一步拦住。那句 Rust 提示从 GUI 走不到（编辑器 / CLI 仍会用到）。
- [x] **S3 凭证填错 → 应红灯且点名是 S3 那把**（U2，2026-08-20 过）
      操作员凭证填对，S3 AccessKey 随便改几个字符 → 测试连接。
      **判据**：提示里出现「S3 访问凭证」字样，**不能**说成操作员账号密码的问题
      （说错会把用户支去改本来没错的那一格）。
- [x] **两对都填对 → 绿灯，且上传真的能跑**（U3，2026-08-20 过）
      测试连接通过后，立刻在主界面传一张图。
      **判据**：绿灯 + 上传成功。这条是整个改动的意义所在——
      改动前正是"绿灯但传不了"，只验前半段等于没验。

#### 批次 4：S3 上传链路

改动覆盖全部 6 个 S3 系图床（阿里云 / 腾讯 / 七牛 / 又拍云 / R2 / 自定义 S3），但它们走的是**同一条** `upload_to_s3_compatible` 代码路径，所以**真机测 2 个就够**（建议阿里云 OSS + 自定义 S3——一个是标准云厂商实现，一个是第三方 S3 实现，覆盖面最广）。

> ⚠️ **4.1 现在有两条链路要各测一次。** 2026-08-13 的修复只覆盖了桌面 GUI 走的 `upload_to_s3_compatible`；
> 编辑器 / CLI / 本地 server 走的是另一个函数 `server/upload_handler.rs::s3_put_object`，它一直没带
> Content-Type，直到 issue #4 才被发现并补上。**只测 GUI 会漏掉一半。**

- [x] **Content-Type 正确 · GUI 链路**（4.1a，2026-08-20 过：又拍云返回 image/png）
      在应用里传一张 `.png` → 复制返回的链接，在浏览器地址栏直接打开；再 `curl -I <链接>` 看响应头。
      **判据**：浏览器**显图**而不是弹下载框；`Content-Type: image/png`（不是 `application/octet-stream` 或 `binary/octet-stream`）。
      ⚠️ 用**新传**的图测。改动前上传的旧对象类型已经写进桶里了，不重传不会变（补救见 [s3-legacy-content-type.md](./reference/troubleshooting/s3-legacy-content-type.md)）。
- [x] **Content-Type 正确 · 编辑器/CLI 链路**（4.1b，2026-08-20 过：又拍云 CLI 返回 image/png）
      用 Obsidian 插件或 CLI（`picnexus --service r2 <图片路径>`）传一张 `.png` 到同一个桶。
      **判据**：同 4.1a。这条链路在 2026-08-18 之前**必然**返回 `application/octet-stream`，
      所以它同时也是「修复是否真的生效」的判据——不是走过场。
- [x] **同名不覆盖**（4.2，2026-08-20 过）
      准备两张**内容不同但都叫 `test.png`** 的图（比如一红一蓝），连着传两次。
      **判据**：历史里两条记录的链接各指各的图（点开第一条看到红的，第二条看到蓝的）；桶里能看到两个不同对象，名字形如 `20260813_a3f9_test.png`。
      改动前的表现是：第一条记录的链接也会显示成第二张图。
- [x] **路径前缀仍然生效**（4.2 的反向判据，2026-08-20 随 U3 一并过）
      配置里填了存储路径（如 `images`）时上传。
      **判据**：对象落在 `images/` 下，不是桶根目录，也没有多出一层空目录（key 不以 `/` 开头）。

---

## 待处理

### [ ] 设置页编辑时的 `config-updated` 广播过于频繁，消费方全量重算

- **来源**：2026-08-16 修托盘缓存陈旧时，从 dev 日志里量出来的
- **优先级**：低——用户感知不到，但属于"用得越复杂越吵"的那类浪费

实测数据（真机 dev 日志，见 `docs/flows/window-system-integration.md` 缓存契约一节）：

| 时段 | 场景 | `[useConfig] ✓ 配置保存成功` | 下游全量刷新 |
|------|------|------------------------------|--------------|
| 08:34:46-48 | 托盘改勾选 | 4 次 | 4 次 |
| 08:35:05-18 | 设置页填一个新 S3 profile | **26 次** | 26 次 |

⚠️ 先澄清一个容易误判的点：**广播与处理是严格 1:1 的，没有重复放大、没有监听器泄漏**。
受控实验（干净启动 + 只点一次）确认单次操作只触发一次刷新。26 次的来源是**26 次真实保存**——
设置页在编辑过程中自动保存得太密。所以要治的是"保存/广播频率"，不是"重复处理"。

两个自然切入点：

1. **消费方加值比较短路**。`useGlobalShortcut` 已经这么做了（日志里 26 条
   `配置未变化，跳过重新注册`），而 [useServiceSelector.loadServiceButtonStates](../src/composables/useServiceSelector.ts)
   每次都全量读盘解密 + 重算按钮状态。同样的短路可以照搬。
2. **源头降频**。设置页表单的自动保存防抖窗口偏小，值得确认是不是每个字段变更都独立触发了一次保存。

注意别退化成"只广播不刷新"：托盘和主窗口互相依赖这个事件做跨 webview 同步（缓存契约见上文），
砍广播必须同时保证两边仍能拿到最新配置。

### [ ] SettingsView.vue 顶到 500 行硬指标，下一次改必撞

- **来源**：2026-08-15 给它加一行事件监听（`@secrets-rekeyed`）直接报
  `File has too many lines (501). Maximum allowed is 500`
- **优先级**：中——不阻塞功能，但**任何**对设置页的改动都会先被 lint 拦下

现状（`max-lines` 数的是**去掉空行与注释后**的有效行，不是物理行）：

| 文件 | 物理行 | 门禁口径 |
|------|--------|---------|
| [SettingsView.vue](../src/components/views/SettingsView.vue) | 579 | **正好 500，一行不剩** |
| [BackupPasswordDialog.vue](../src/components/dialogs/BackupPasswordDialog.vue) | 568 | 逼近上限 |

2026-08-15 那次是把两个属性挤到同一行才过的关——**这种腾挪只剩这一次机会了**。

自然切线（别做机械拆分）：`SettingsView` 按 tab 拆面板，`BackupPasswordDialog` 按 mode 拆子组件。
两个文件都已经有单测覆盖（`settingsView.spec.ts` / `backupPasswordDialog.spec.ts`），
拆分属于纯重构，靠现有单测兜住即可。

---

## 已知取舍

### WebDAV 上传要求整条文件路径是合法 UTF-8

- **状态**：接受，短期不改；改的话影响面覆盖全部 server 上传器
- **位置**：`src-tauri/src/commands/utils.rs::probe_upload_file_size(path: &str)`，
  经 `commands/webdav_upload.rs::upload_to_webdav_core` 命中

兄弟的 `server_upload_r2` / `server_upload_jd` 等走 `tokio::fs::read(path: &Path)`，只要求**文件名**
是合法 UTF-8；WebDAV 这条路径因为要流式 PUT（先探大小、再按需从磁盘读），底层两个函数都收 `&str`，
于是**整条路径**都必须是 UTF-8。任何目录层级带非 UTF-8 字节就会失败。

2026-08-17 的 P3 修复**没有拉平这个差距**（当时验收文档写成「不再比其它上传器更差」，是错的，已更正）。
它实际解决的是：转换失败从 panic 变成清晰的 `AppError::validation`，且转换点从两处收敛到一处。
回归护栏 `upload_to_webdav_core_rejects_non_utf8_path_instead_of_panicking`。

**真要拉平**：把 `probe_upload_file_size` / `put_file_stream` 的签名从 `&str` 换成 `&Path`。
两者都只是拿去开文件，改起来不难，但要一并回归全部 server 上传器。

**重新考虑的触发条件**：收到「路径带特殊字符导致 WebDAV 传不上去」的实际报障。
注意 Windows 上正常中文/emoji 路径都是合法 UTF-8，**不会**命中这一条——真要触发得是未配对代理项
那种畸形字节，日常几乎遇不到。

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

### [x] 灯箱 / 悬停预览 / ±1 预热接入 URL 安全闸

CSP 撤网后仅剩的三条无闸取图路径已统一收进 `useGatedImageUrls`，判据与缩略图同源；被拦下时给可执行的提示。
详见 [lightbox-gate-and-upyun-dual-chain-2026-08-20.md](./audits/lightbox-gate-and-upyun-dual-chain-2026-08-20.md)。

### [x] `emitConfigUpdated()` 死代码已删

全仓零调用点，同文件另外三个快捷方法均在用（64 / 26 / 6 处），确认只有它是死的。
真正在用的广播仍是 `useConfig.ts`（主窗口）与 `trayMenu.ts`（托盘）两处。

### [x] 收藏页与时间轴的图片 URL 校验

`useThumbnailFallbackChain` 现在把候选过一遍 `safeImageUrl`，两个视图与 `ThumbnailImage` 共用同一道闸；
已确认的明文 HTTP 域名由各视图用 `getConfirmedHttpHosts(config)` 传入。
详见 [http-image-host-2026-08-19.md](./audits/http-image-host-2026-08-19.md)（残余风险第 2 条）。

### [x] 又拍云三条缺陷 + 明文 HTTP 图床支持

真机全过（2026-08-19）：同名覆盖、存储路径失效、GUI 上传用错凭证三条都修完并验收；
顺带发现又拍云免费域名只有 HTTP 而应用一律要 HTTPS，遂支持明文 HTTP 图床（用户确认一次、按域名生效），
并修好 WebDAV 局域网缩略图一直被 CSP 拦的既有缺陷。详见 [upyun-audit-2026-08-19.md](./audits/upyun-audit-2026-08-19.md) 与 [http-image-host-2026-08-19.md](./audits/http-image-host-2026-08-19.md)。

### [x] 敏感字段密码框统一「密文常驻、明文按需」

七条真机回归全过：第一轮 5 条（2026-08-15，坚果云）验改动本身，第二轮 2 条（2026-08-17，dufs）验换钥后的同步与上传。
契约见 [sensitive-field-contract.md](./reference/patterns/sensitive-field-contract.md)，回归步骤与两个「假通过」的坑（托盘退出、dev 与正式版共用数据）见 [backup-password-regression.md](./reference/guides/backup-password-regression.md)。
第二轮结果见 [webdav-release-wrapup-acceptance.md](./audits/webdav-release-wrapup-acceptance.md)。

### [x] WebDAV 发版前收尾（Digest 一致性 + 5 条自动化 + 死模块清理）

真机 12/12 全过（2026-08-17）。顺带挖出既有缺陷：三条链路的连接测试一直显示 `[object Object]`，
把后端区分出来的失败原因全吞掉了；并删除从未接线、且会明文上传全部图床凭据的 `useWebDAVSync`。
详见 [webdav-release-wrapup-acceptance.md](./audits/webdav-release-wrapup-acceptance.md)。

### [x] 编辑器插件（Typora / Obsidian / CLI）支持 WebDAV 图床

三条链路全部真机验收通过（2026-08-17，dufs）。三轮审查 + 验收共揪出 8 个真实缺陷，全部修完：
含 `cli-config.json` 凭证明文落盘（改为钥匙串信封加密）、四条上传路径里三条漏了文件名唯一化。
详见 [webdav-editor-integration-acceptance.md](./audits/webdav-editor-integration-acceptance.md)。

### [x] WebDAV Digest 提示 + 明文 HTTP 逃生舱

真机验收 A 半场 3/3、B 半场 6/6 全部通过（2026-08-16）。B 半场借 `pinggy.io` 隧道模拟「填主机名连得通」场景。
详见 [webdav-digest-and-lan-http-escape-hatch-acceptance.md](./audits/webdav-digest-and-lan-http-escape-hatch-acceptance.md)。

### [x] WebDAV 401 提示区分 Digest 与密码错

401 时读 `WWW-Authenticate`，只有「给 Digest 且不给 Basic」才换文案，密码真错的用户看不到 Digest 噪音。
顺带把「认证失败，请检查用户名和密码」抽成常量并登记进跨语言门禁（此前在 4 处内联重复、无人守）。
详见 [webdav-image-host-issues.md](./reference/troubleshooting/webdav-image-host-issues.md#认证失败但用户名密码反复核对都是对的)。

### [x] WebDAV 明文 HTTP 的「显式确认」逃生舱

fake-ip 那一档改回专属错误类型，前端按类型（非文案）弹确认框，确认写 `lanHttpConfirmed`、改地址即作废。
实现时补掉一个真漏洞：`all_dns_results_allowed` 早退会让 `FakeIp` 掩盖同一集合里的公网地址。
详见 [fake-ip-dns-policy-distortion.md](./reference/troubleshooting/fake-ip-dns-policy-distortion.md#逃生舱已实现)。

### [x] 设置备份密码会静默作废已保存的 WebDAV 密码

换钥匙只重写外层信封，内层 `passwordEncrypted` 成孤儿（2026-08-15 真机复现并修复）。
修法是 `rekeyFieldSecrets` 把「解开 → 换钥匙 → 用新钥匙锁上」收进一个函数，存量孤儿启动时清空并提示重填。
详见 [orphan-field-ciphertext.md](./reference/troubleshooting/orphan-field-ciphertext.md)。

### [x] WebDAV 图床支持

真机验收 6/6 通过（2026-08-14），覆盖 dufs / OpenList / 坚果云三个互相独立的服务端实现。
验收记录见 [webdav-acceptance-2026-08-14.md](./audits/webdav-acceptance-2026-08-14.md)，
环境重建见 [webdav-testing-environments.md](./reference/guides/webdav-testing-environments.md)。

### [x] fake-ip 环境下 WebDAV 局域网判据失真

`198.18.0.0/15` 曾被当作局域网放行，导致 TUN 环境下公网 WebDAV 地址被判成内网、明文凭证防线失效。
修法是把 fake-ip 当「看不见」而非「内网」，两个模块按猜错的代价选不同默认值。
详见 [fake-ip-dns-policy-distortion.md](./reference/troubleshooting/fake-ip-dns-policy-distortion.md)。
