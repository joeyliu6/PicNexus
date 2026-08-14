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

- [ ] **存得下、活得过重启**（最关键的一条，`a322dba` 挂的就是这里）
      填写坚果云 WebDAV 备份密码 → 保存 → **完全退出并重启应用** → 点「测试连接」。
      **判据**：连接成功。密码框是**空的**且挂着「✓ 已保存」芯片——不是空白无标记。
- [ ] **点眼睛能看到原值**
      重启后点密码框的眼睛。
      **判据**：显示的是当初填的那个密码（不是空串、不是乱码），15 秒后自动收回。
- [ ] **看一眼不等于改一次**（核心不变量的人工验证）
      点眼睛显示明文期间，点击页面别处让它失焦 → 再重启应用 → 测试连接。
      **判据**：仍然连接成功。若此步之后连不上，说明明文被当成新输入重新加密写回了。
- [ ] **留空不清空**（`a322dba` 的原始缺陷）
      密码留空，改一下别的字段（如远程路径）触发保存 → 重启 → 测试连接。
      **判据**：仍然连接成功，已存密码没被清掉。
- [ ] **同步链路没被波及**
      触发一次配置同步（上传 / 下载）。
      **判据**：成功。这条验证 `backupSyncUtils` / `useWebDAVSync` 走密文确实通——
      代码上它们本来就传 `passwordEncrypted`，但没真机跑过。

> 📌 反向判据：设置里**不要**顺手去设备份密码——那会触发上面「已知的孤儿密文缺陷」，
> 把这轮回归的结论搅浑。要测那个缺陷请单独开一轮。

### [~] 2026-08-13 修复计划批次 1 / 2 / 4 的手动验收

- **来源**：[docs/audits/fix-plan-2026-08-13.md](./audits/fix-plan-2026-08-13.md)（批次 1 = 文档修复数据安全，批次 2 = 链接检测正确性，批次 4 = S3 上传链路）
- **状态**：代码已合入、单测与门禁全通过；下列每条都**需要真实文件 / 真实网络**，单测覆盖不到，等用户手测

下列每一条都是先构造场景、再核对判据。判据写死了「应该看到什么」，看到别的就是回归。

#### 批次 1：文档修复（`be0ba3b` 之前的 `7d5d376` / `3e86dd5` / `7fb363c`）

- [ ] **同名文件备份不互串**（1.1，原缺陷会永久丢数据）
      两个子目录 `a/` 与 `b/` 各放一个含失效链接的 `README.md` → 文件夹模式修复 → 撤销。
      **判据**：`.picnexus-backup` 下保留子目录层级（不是平铺），撤销后两个 `README.md` 内容各归各位、逐字比对无互串。
- [ ] **备份目录不被重扫**（1.2）
      对上一步修复过的文件夹再扫一次。
      **判据**：结果里不含 `.picnexus-backup` 内的任何文件，失效数不虚高。
- [ ] **非 UTF-8 文件拒绝写回**（1.3）
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

### [ ] 设置备份密码会静默作废已保存的 WebDAV 密码

- **来源**：2026-08-14 做敏感字段统一时顺带发现
- **优先级**：高——静默丢数据，和 `a322dba` 同形状
- **状态**：⚠️ **源码推导，未实跑验证**。动手前先按下面的步骤确认现象真的存在

`secureStorage` 是单例、单把钥匙。字段级密文（`passwordEncrypted`）和整份 `.settings.dat`
的外层加密用的是**同一个 `this.key`**。而设置备份密码会换掉这把钥匙：

1. [`setBackupPassword`](../src/security/crypto.ts) 用 `invoke('set_secure_key')` 覆盖钥匙串里的旧钥匙，**无备份**
2. [`swapKeyAndReencrypt`](../src/components/settings/backup/BackupPasswordSection.vue) 换完只用新钥匙
   重写**外层信封**（`readRawAll` → 换钥匙 → `setDirect`），不会钻进 JSON 重新加密内层密文
3. → 内层密文成了「孤儿」：能解开它的钥匙已经不存在了
4. [`WebDAVClient.decryptPassword`](../src/utils/webdav.ts) 的 `catch` 吞掉错误返回 `''`

**用户看到的是密码莫名其妙没了，一句报错都没有**，而且归因不到「几天前设过备份密码」。

**复现步骤**：配好 WebDAV 图床或备份密码 → 保存 → 设置备份密码 → 重启 → 看密码还在不在。

**正确修法**：`swapKeyAndReencrypt` 换钥匙**之前**先把内层密文解开，换完再用新钥匙重新加密。
影响面是 `config.webdav_profiles[].passwordEncrypted` 与 `config.webdav.profiles[].passwordEncrypted`。

⚠️ 这条没修之前，**不要再新增字段级加密的字段**——每加一个都是在放大这个缺陷的爆炸半径。
背景见 [sensitive-field-contract.md](./reference/patterns/sensitive-field-contract.md#底下存的是明文还是密文)。

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

### [x] WebDAV 图床支持

真机验收 6/6 通过（2026-08-14），覆盖 dufs / OpenList / 坚果云三个互相独立的服务端实现。
验收记录见 [webdav-acceptance-2026-08-14.md](./audits/webdav-acceptance-2026-08-14.md)，
环境重建见 [webdav-testing-environments.md](./reference/guides/webdav-testing-environments.md)。

### [x] fake-ip 环境下 WebDAV 局域网判据失真

`198.18.0.0/15` 曾被当作局域网放行，导致 TUN 环境下公网 WebDAV 地址被判成内网、明文凭证防线失效。
修法是把 fake-ip 当「看不见」而非「内网」，两个模块按猜错的代价选不同默认值。
详见 [fake-ip-dns-policy-distortion.md](./reference/troubleshooting/fake-ip-dns-policy-distortion.md)。
