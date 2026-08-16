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

### [~] 敏感字段密码框统一「密文常驻、明文按需」

- **来源**：2026-08-14 WebDAV 验收时用户反馈「已保存的密码再打开是空的，体验和别处不一样」
- **状态**：九处调用点全部迁移完毕，门禁与单测全通过；**备份密码那一步的真机回归还没跑**
- **契约与做法**：[sensitive-field-contract.md](./reference/patterns/sensitive-field-contract.md)

改动分布：`SensitiveField` 补多行揭示分支 → 新增 `useSensitiveDraft` → Token 4 处 /
Cookie 2 处 / S3 2 处（展开 12 个输入框）→ 抽 `useWebDAVProfileEditor`（452 → 310 行）→
备份密码改密文常驻。

#### 坚果云真机回归（备份密码专属）

用户已确认「先合入、真机事后补」。**这几条没过之前不要把本条目移进「已完成」。**

操作细节（怎么完整退出、路径在哪、日志怎么看）见
[backup-password-regression.md](./reference/guides/backup-password-regression.md)。

> ⚠️ **两个会让测试假通过的坑**：
> 1. 点窗口 X **不会退出进程**（`closeToTray` 默认 `true`）。必须托盘右键 →「退出」，
>    否则配置根本没重新从磁盘加载，"重启后仍然成功"是假的。
> 2. dev 与正式版**共用同一份** `%APPDATA%\us.picnex.app\.settings.dat` 和同一个钥匙串
>    （`identifier` 只有一个，无 dev/release 区分），且有 single-instance 拦截。
>    测之前先把正式版从托盘退干净，并备份 `.settings.dat`。

**第一轮 · 不要设备份密码**（下面五条测的是本次改动本身）

> ✅ **2026-08-15 五条全过**（坚果云 + `npm run tauri dev`，每条都走托盘退出重启）。
> 本次改动本身验收通过，剩下的只有第二轮同步链路。

> 📌 **判据在 `7e61952`（就地编辑）之后改过一轮，别照旧版执行。**
> 旧版写的是「密码框是**空的**」和「点眼睛显示明文期间点别处失焦」——
> 现在框里是圆点，展示态那个元素也没挂 blur，照旧版测会一条被判成失败、
> 一条什么都测不到。

- [x] **存得下、活得过重启**（最关键的一条，`a322dba` 挂的就是这里）
      填写坚果云 WebDAV 备份密码 → 保存 → **托盘退出后重启** → 点「测试连接」。
      **判据**：连接成功。密码框里是**一排圆点**且挂着「✓ 已保存」芯片——
      不是空框，也不是有内容但无标记。
- [x] **点眼睛能看到原值**
      重启后点密码框的眼睛。
      **判据**：显示的是当初填的那个密码（不是空串、不是乱码），手不碰它 15 秒后自动收回。
      ⚠️ 这期间**点一下那段明文会直接进入编辑态**，是 `7e61952` 有意加的，不是 bug。
- [x] **就地改一个字符能存住**（`7e61952` 的核心功能，旧判据里没有）
      分两步，**先把密码弄错、再就地改回来**。坚果云的应用密码是固定的，
      随手改一个字符只会得到一个连不上的密码，"连接失败"证明不了任何事。
      1. 在密码**末尾多打一个字符** → 点别处失焦（芯片应跳「✓ 已更新」约 2 秒）→
         **托盘退出后重启** → 测试连接。**这一步应该失败**——顺带证明改动真写盘了
      2. 点进密码框 → **只按一下退格**删掉那个多余字符 → 点别处失焦 →
         **托盘退出后重启** → 测试连接
      **判据**：第 2 步连接成功。聚焦没把原值取出来的话，框里是空的、
      退格删了个寂寞、失焦时走「空草稿不提交」，错密码原样留着——仍然连不上。
- [x] **看一眼不等于改一次**（核心不变量的人工验证，**两条路径都要走**）
      旧的结构性保证（明文压根进不了 `modelValue`）已经不存在了，现在靠
      [`commitDraft`](../src/composables/settings/useSensitiveDraft.ts) 里
      「和取出来时相比没变就不写盘」来守。两条路径分别往草稿里填值，必须分开测：
      1. **直接聚焦**：点进密码框（不点眼睛）→ 一个字符不改 → 点别处失焦
      2. **看完再改**：点眼睛 → 点一下明文进入编辑态 → 一个字符不改 → 点别处失焦
      每条走完都 **托盘退出后重启** → 测试连接。
      **判据**：两条都仍然连接成功，且失焦时芯片**不该**跳成「已更新」——跳了就是写盘了。
      路径 2 走的是 `knownPlaintext` 分支，它漏记原值的话正好被这条抓住。
- [x] **不碰就不清空**（`a322dba` 的原始缺陷）
      **全程不点密码框**，只改别的字段（如远程路径）触发保存 → 重启 → 测试连接。
      **判据**：仍然连接成功，已存密码没被清掉。

**第二轮 · 同步链路 + 真实上传**

配置同步**必须先有备份密码**（见 [sync-flow.md](./flows/sync-flow.md) 图 1 下方要点）。

- [ ] 设好备份密码 → 保存 → 重启 → 测试连接 → 触发配置同步。
      **判据**：同步成功。这条验证 `backupSyncUtils` / `useWebDAVSync` 走密文确实通——
      代码上它们本来就传 `passwordEncrypted`，但没真机跑过。
- [ ] 换过备份密码之后，用**真实可达**的 WebDAV 图床（坚果云或起一个本地 OpenList）
      传一张图。**判据**：上传成功。
      2026-08-15 那次只跑到「解密成功、连不上服务器」（本地 OpenList 没起），
      解密那一环已证明，认证与上传那一环没跑到。

> 📌 **顺序限制已经没了。** 孤儿密文缺陷已于 2026-08-15 修复（`rekeyFieldSecrets`
> 换钥匙时会把内层密文一并搬运），先填 WebDAV 密码、后设备份密码不再作废密码。
> 背景见 [orphan-field-ciphertext.md](./reference/troubleshooting/orphan-field-ciphertext.md)。

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

- [ ] **幽灵行**（2.1）
      历史页删 2 张图 → 立刻切到链接检测页（不要等）。
      **判据**：对应行已消失，顶部统计数字同步减少。
- [ ] **取消后续检不丢结果**（2.2，最值得测的一条）
      上千条全量检测 → 中途点取消 → **5 秒内**点「仅未检测」续检 → 两批都跑完 → **重启应用**。
      **判据**：取消前那批已完成的记录重启后仍是「已检测」，没有整批回退成「未检测」。
- [ ] **3xx 不再误判失效**（2.3）
      找一条会 301/302 跳转的图片 URL 检测（浏览器直接打开能看图的那种）。
      **判据**：落在「疑似」而非「失效」tab，徽章显示状态码，tooltip 写「跳转链接 (301) · 浏览器会自动跟随」——**不能**写「防盗链限制」。

> 📌 2.2 与 2.3 各自都有一条"反向判据"：2.2 要确认历史被清空时结果**不**落库（写到已删记录上），2.3 要确认防盗链 403 仍显示「防盗链限制」而不是被跳转文案抢走。两条都有单测钉住（`useLinkCheck.spec.ts` / `useLinkStatusDisplay.spec.ts`），手测时顺带看一眼即可。

#### 批次 4：S3 上传链路

改动覆盖全部 6 个 S3 系图床（阿里云 / 腾讯 / 七牛 / 又拍云 / R2 / 自定义 S3），但它们走的是**同一条** `upload_to_s3_compatible` 代码路径，所以**真机测 2 个就够**（建议阿里云 OSS + 自定义 S3——一个是标准云厂商实现，一个是第三方 S3 实现，覆盖面最广）。

- [ ] **Content-Type 正确**（4.1）
      传一张 `.png` → 复制返回的链接，在浏览器地址栏直接打开；再 `curl -I <链接>` 看响应头。
      **判据**：浏览器**显图**而不是弹下载框；`Content-Type: image/png`（不是 `application/octet-stream` 或 `binary/octet-stream`）。
      ⚠️ 用**新传**的图测。改动前上传的旧对象类型已经写进桶里了，不重传不会变。
- [ ] **同名不覆盖**（4.2）
      准备两张**内容不同但都叫 `test.png`** 的图（比如一红一蓝），连着传两次。
      **判据**：历史里两条记录的链接各指各的图（点开第一条看到红的，第二条看到蓝的）；桶里能看到两个不同对象，名字形如 `20260813_a3f9_test.png`。
      改动前的表现是：第一条记录的链接也会显示成第二张图。
- [ ] **路径前缀仍然生效**（4.2 的反向判据）
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

### [ ] `emitConfigUpdated()` 是死代码

- **来源**：同上，2026-08-16 追查广播来源时发现
- **优先级**：低——纯清理

[cacheEvents.ts](../src/events/cacheEvents.ts) 的 `emitConfigUpdated()` 全仓无任何调用点；
真正在用的广播只有 [useConfig.ts](../src/composables/useConfig.ts)（主窗口）和
[trayMenu.ts](../src/services/trayMenu.ts) 的两处（托盘）。留着会让下一个人误以为存在第三条广播路径，
排查跨窗口同步问题时平白多一个假线索。删之前确认 `emitCacheEvent` 的其他快捷方法是否也有同样情况。

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

### [ ] WebDAV 只支持 Basic 认证，不支持 Digest

- **来源**：2026-08-14 WebDAV 图床验收后的边界梳理
- **优先级**：中——不是所有人会撞上，但撞上的人会被错误文案带向完全错误的排查方向

[`basic_auth`](../src-tauri/src/commands/webdav_upload.rs#L155) 只拼 `Basic <base64>`，
整个 `webdav_upload.rs` 没有任何 Digest 相关代码。服务端若只接受 Digest 会返回 401，
而 `describe_status` 把 401 翻译成「认证失败，请检查用户名和密码」。

**危害不在于少支持一种认证，在于提示把用户引向反复核对密码——而密码根本没错。**
常见于部分群晖 / 威联通的 WebDAV 配置、Apache `mod_dav` 默认配置。

**两个方向，成本差很多**：

1. **只改文案（低成本）**：401 时补一句「若确认密码无误，可能是服务端要求 Digest 认证，PicNexus 暂不支持」。
   不解决问题但止住错误排查。
2. **真正支持 Digest（高成本）**：需要处理 401 challenge、nonce、qop、nc 递增，
   且 `reqwest` 无内置支持，要么引依赖要么自己实现。上传链路每个请求都要过一遍。

建议先做 1，收到实际报障再评估 2。排查方法见
[webdav-image-host-issues.md](./reference/troubleshooting/webdav-image-host-issues.md#认证失败但用户名密码反复核对都是对的)。

---

### [ ] WebDAV 明文 HTTP 的「显式确认」逃生舱

- **来源**：修复「fake-ip 环境下 WebDAV 局域网判据失真」时刻意留下的缺口
- **优先级**：中——比原先估计的高，见下方实测

修复后，代理 fake-ip 池不再算局域网证据。副作用是这样一类用户会被误伤：

> 开着 TUN + fake-ip **且**用主机名（而非 IP）访问 NAS **且**该主机名没被代理的 `fake-ip-filter` 排除。

**实测（2026-08-08，本机 TUN + fake-ip）**：`dav.example.com` 与 `nas.local` 都被解析进 fake-ip 池，
连 `*.local` 也不例外——[mihomo DNS 文档](https://wiki.metacubex.one/en/config/dns/) 确认内核
**没有**任何内置的 `fake-ip-filter` 默认列表。完整实测数据见
[fake-ip-dns-policy-distortion.md](./reference/troubleshooting/fake-ip-dns-policy-distortion.md#遗留的误伤面)。

**目前的出路**（已写进错误文案）：改填 NAS 的实际内网 IP，或改用 HTTPS。IP 字面量始终不受影响，
而群晖等 NAS 引导用户填的默认就是 IP，所以这不是死路——但比原先估计的更容易撞上。

**若要做逃生舱**，方案轮廓：

1. `WebDAVStorageProfile`（`src/config/serviceTypes.ts`）加确认字段，如 `lanHttpConfirmed: boolean`
2. `upload_to_webdav` / `test_webdav_storage` 两个 Tauri 命令各加一个参数，透传给 `validate_webdav_url_for_request`
3. `PrivateStorageGroup.vue` 加一行勾选，文案要讲明「勾了就是明文传账号密码」
4. 只放开 `DnsDecisionError::FakeIp` 一档；`Blocked`（链路本地/云元数据）与 `Public`（确证公网）保持硬拒绝

**为什么当初没一起做**：改动面会从 1 个 Rust 文件扩到 Rust + config schema + 设置页 UI 三层，而 WebDAV 图床本身还在「待验收」状态，此时动配置 schema 时机不好。

---

### [ ] 编辑器插件（Typora / Obsidian / CLI）支持 WebDAV 图床

- **来源**：2026-08-13 WebDAV 手动验收时发现
- **优先级**：中——主界面已可用，缺的是编辑器链路

主界面的 WebDAV 图床能用，但 Typora / Obsidian / CLI 走的是**另一条链路**，那条链路上 WebDAV 根本没接：
`ServerUploadConfig`（`src-tauri/src/server/upload_handler.rs`）的枚举里没有 WebDAV 变体。
所以这不是"前端漏传一个字段"，是整条链路缺一环。

**需要动的 5 处**：

1. Rust：`ServerUploadConfig` 加 WebDAV 变体 + `upload_handler` 里的上传分发
2. Rust 重构：`upload_to_webdav` 当前耦合了 `Window`（要 emit 进度事件），
   核心上传逻辑得抽成不依赖 `Window` 的函数，才能被 server handler 复用
3. 前端 `src/composables/settings/editorServiceConfig.ts`：
   `isCliCompatibleServiceConfigured` / `buildServiceConfig` / `buildCliServicesConfig`
   三个函数都要加 webdav 分支，最后一个还要展开 `webdav_profiles`
4. 设置页「编辑器专用图床」选择器要能列出 WebDAV profiles
5. `src-tauri/src/cli.rs`：`--service webdav:profile-1` 的解析与 service_id 映射

**⚠️ 附带的知情项（不是本任务引入的）**：`cli-config.json` 全程明文落盘
（`save_cli_config` 直接 `to_string_pretty` + `fs::write`，无加密），
`ServerUploadConfig` 里 `secret_access_key` / `password` 都是裸 `String`。
接入 WebDAV 后，NAS 账号密码会以明文进入该文件——比作用域受限的 S3 key 泄露面大。
最低限度应在启用编辑器图床时把这件事写在 UI 上；真要加密得先解决 CLI 独立进程的密钥分发，
那是独立课题。

---

## 已知取舍

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
