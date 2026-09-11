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

（暂无——新的待验收条目登记在这里）

---

## 待处理

### [ ] 灯箱 `pendingClose` 路径下收回计时器与真实 close 事件脱钩

- **来源**：2026-09-11 发版前扫描（[scan-prerelease-1.1.2-2026-09-11.md](./audits/scan-prerelease-1.1.2-2026-09-11.md)）
- **症状**：`src/composables/history/useTableInteractions.ts` 的 `closingTimer` 以 `lightboxVisible=false` 起算，
  但 `usePhotoSwipeBridge.ts` 在开场闸门关着时只记 `pendingClose`，真实 `close()` 推迟到 `openingAnimationEnd`（≈380ms 后）。
  timer 会在大图仍在缩小时把 phase 置 `idle`，卡片提前显形；随后 resolve 再写 `landing`/`dismissing`，此时已无 timer，
  phase 停在非 idle 直到下一次 mouseenter/leave
- **定性**：疑似缺陷（静态追踪，未真机复现），置信度 🟡
- **优先级**：低——触发要在开灯箱后 ~160-380ms 内完成"点删除 + 确认框"，人手基本做不到，且自愈；修法是让 timer
  起点跟随 `resolveLightboxCloseTargetMode()`（真实 close 事件）或让 bridge 回传"已延迟"

**当前处置**：待验证

### [ ] 灯箱 keep 分支下 handoff 监听器晚拆

- **来源**：同上
- **症状**：`useTableInteractions.ts` 的 `closingTimer` 回调在 `keepHoverPreviewAfterClose` 为真时只写 `idle`，
  不调 `stopHoverHandoffTracking()`；document 上 5 个 capture 监听 + window 2 个要等鼠标离开源缩略图才拆。
  灯箱动画重做之前（`f3e3af79`）结构相同，非本次回归
- **定性**：确认与文档"用完即拆"描述不符，置信度 🔴；影响面小（监听器最终会拆，只是晚）
- **优先级**：低

**当前处置**：待修复

### [ ] 给"try 里 await invoke、catch 里 `String(err)`"加静态护栏

- **来源**：同上。本次人工扫出 6 处把 Rust `AppError` 渲染成 `[object Object]` 的站点（08-24 已修过一处同类），
  全靠人眼追 try/catch，没有门禁下次还会漏
- **要做的**：写 `scripts/check-app-error-rendering.mjs`：在 `src/` 里找 try 块内含 `invoke(`（或 `shellOpen` 这类薄封装）、
  对应 catch 块内用 `String(x)` / `` `${x}` `` / `x instanceof Error ? x.message : String(x)` 的组合，报错并提示改用
  `getErrorMessage()`。需要括号配对不是一行 grep；`useConnectionTest.ts:100/114` 那种 catch 的是 fetch 错误的要能放行
  （只看 try 体里有没有 invoke）
- **优先级**：中——发版后做

**当前处置**：待处理

### [ ] login-titlebar 的配色自成一套，未并进主题令牌

- **来源**：2026-08-22 tsconfig 盲区清单的最后一项；同条目的其余部分（`scripts/`、`tests/`、
  主题 class 命名、`verbatimModuleSyntax`）已于 2026-09-08 全部收掉
- **优先级**：低——它工作正常，不是缺陷

[login-titlebar.html](../login-titlebar.html) 用的 `#111827` / `#f8fafc` 是另起的一套配色，
不是主题令牌的副本，所以 `scripts/check-theme-token-copies.mjs` 刻意没收编它。
要收编得先把整套色值对到令牌上，**那是一次独立的视觉改动，必须真机看过标题栏与下方 WebView
的接缝再定**——单看代码判断不了对不对。

---

## 已知取舍

### 灯箱关闭动画播放期间快速重开会抢走自绘 UI 的挂载点

- **状态**：故意如此，短期不改——影响面很小，根治代价明显大于收益
- **位置**：`src/composables/history/usePhotoSwipeBridge.ts` 的 `pswpEl`（供
  `HistoryLightbox.vue` 的 `<Teleport :to="pswpEl">` 挂载模糊背景/底栏/导航箭头）；
  `openPswp()` 里 `pswp.on('destroy', ...)` 的守卫注释指到这里

**为什么看着像缺陷**：关闭一张图后、约 200ms 收回动画播完之前，若用户又打开另一张图，
`pswpEl` 会从正在淡出的旧实例改指向新实例，Vue 把自绘的模糊背景/底栏/导航箭头整体
搬到新实例身上，旧实例剩下的淡出帧会瞬间丢掉这层背景装饰。

**为什么不做**：这些自绘 UI 只共用一个 `pswpEl` ref、对应一个 Teleport 目标，同一时刻
只能属于一个实例，这是设计如此。真要让新旧实例互不干扰，得给每个 PhotoSwipe 实例发一份
独立的 Teleport 目标（例如按实例 id 建一个 Map），而不是一个共享 ref——这会改变
`HistoryLightbox.vue` 的挂载结构，还要重新审计 `usePhotoSwipeBridge.ts` 里另外 8 处
只判断"`pswp` 是否非空"的调用点（它们现在默认"非空 = 当前唯一活跃实例"，一旦允许
新旧并存这个假设就不成立）。而触发场景本身要求用户在 200ms 内连续触发两次开关，且
新实例大概率会整体盖住旧实例——肉眼基本看不出来，也不会崩溃或泄漏（PhotoSwipe 自己的
`element.remove()` 不受这个 ref 影响）。

**重新考虑的触发条件**：收到"快速切换图片时背景/底栏闪烁"的实际反馈，或者以后要支持
多个灯箱实例同时存在（例如画中画）。

### 不给 WebKit 建像素基准图

- **状态**：故意如此，**不打算改**——看到这条之前请不要"顺手 `--update-snapshots` 补上"
- **位置**：`playwright.config.ts` 的 `layout-chromium` / `layout-webkit` 两个 project，
  它们只收 `*.probe.spec.ts`，永远不产生任何 PNG

**为什么看着像缺陷**：既然已经把 WebKit 引擎接进来了，最直觉的做法就是让它也拍一套截图，
和 Chromium 那 172 张一样做像素比对。跑一次 `test:visual:update` 就能生成，看起来白捡覆盖率。

**为什么不做**：两条硬理由。

1. **必然误报**。跨引擎的字体栅格化与抗锯齿差异必然超过 `maxDiffPixelRatio: 0.01`；
   而把阈值放宽到能容忍差异（实测要 0.1+）之后，它就再也抓不到任何真实回归了——
   两头都不成立。这种门禁的结局只有一个：被关掉。
2. **问错了问题**。像素比对回答的是「两张照片一样吗」，我们要问的是「排版会不会塌」。
   而且本机 Playwright WebKit 用的是微软雅黑，真 macOS 用苹方 / SF Pro，
   字体压根不同——比出来的差异有一半是假信号。

**替代方案**：`tests/visual/cross-engine/` 断言由 CSS 直接决定的绝对不变式（裁切 / 溢出 /
越界 / 地标尺寸），换引擎不会变，零基准图。范式来自 `dialog-consistency.visual.spec.ts`。
`probe-self-check.probe.spec.ts` 用注入的已知塌陷证明这套规则真有牙齿。

**重新考虑的触发条件**：拿到能跑 macOS runner 的 CI 额度，且愿意为 mac 单独维护一套基准。
届时也应该在 macOS 上生成、只与 macOS 自身的历史比对，而不是跨引擎比。

### 第三方图床 multipart 里的 `image/*` 不改

- **状态**：故意如此，**不打算改**——看到这条之前请不要"顺手修好"
- **位置**：共 7 处 `.mime_str("image/*")`——`commands/` 下 `imgur.rs` / `jd.rs` / `nowcoder.rs` /
  `smms.rs` 各一处（GUI 链路），`server/upload_handler.rs` 里 jd / smms / nowcoder 各一处
  （编辑器 / CLI 链路）。**imgur 的 server 侧没有**：它走 base64 表单，压根没这个字段

**为什么看着像缺陷**：`image/*` 的星号形式只在请求的 `Accept` 头里合法，作为「这是什么类型」
的声明是无效值。又拍云编辑器链路正因为写了它被判为缺陷并在 `e8b24459` 修掉——所以扫到这四处
的人第一反应通常是「还有漏网的」。

**为什么不是同一回事**：又拍云那处是 PUT 进**自家桶**，标签会作为对象元数据存下来，成为这张图的
永久身份证，浏览器据此决定显示还是弹下载框，且改代码救不回旧对象。这四家是**第三方图床**，
`image/*` 只出现在发给对方 API 的 multipart part 声明里；对方收图后自行判类型、自行存储、
自行生成链接，我们写的标签用完即弃，落不进任何我们控制的桶。改了对最终链接零影响。

**代价**：四家都是靠抓包对出来的私有接口，动请求体就得四个图床各真机回传一次才敢说没坏。
零收益换四次回归，不划算。

**重新考虑的触发条件**：某一家开始因 `Content-Type` 拒收——表现为上传突然失败且错误信息里
提到 MIME / content type。届时按扩展名推断即可，复用 `server/upload_handler.rs::object_content_type`。

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

> 📌 **2026-08-21 更新**：探测的字面量判据已委托 `url_policy` 的 `AllowPrivate` 策略并接收
> 前端传入的已确认明文 HTTP 主机名名单（对齐 2026-08 上传/渲染/CSP 三处放开局域网图床的
> 判据）。`validate_probe_url` **依然是同步函数、依然不查 DNS**——本条取舍不变，
> `probe_url_accepts_public_https_without_dns` 回归护栏原样保留。

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

### [x] Tauri E2E 在 CI 跑手上建会话失败（降权 workaround 已复验转绿）

根因是微软 by-design 的安全硬化（WebView2 150+ 在提权宿主下丢弃调试参数），不是跑手镜像问题，等不到上游修复。已用 `gsudo --integrity Medium` 把整条测试链降权，2026-09-10 复验 4 passing 并转为阻断门禁（push + dispatch，不含 PR）。详见 [tauri-e2e-runner-webview2-2026-08-21.md](audits/tauri-e2e-runner-webview2-2026-08-21.md)。

### [x] Cookie 事件监控的降级兜底从未生效（连 `start_cookie_monitoring` 一起收掉）

降级判断挂在 `with_webview` 的返回值上，而那个 `Ok` 只代表消息投递成功、不代表闭包跑过，事件通道
真失败时三层兜底全灭、连超时都不报。已改为闭包内就地降级 + 看门狗，删掉无人调用的
`start_cookie_monitoring`，补上首份单测。详见 [cookie-monitoring-silent-failure-2026-09-09.md](./audits/cookie-monitoring-silent-failure-2026-09-09.md)。

### [x] Rust 侧 main.rs 减重：21 个内联命令归位到 commands/

`main.rs` 3050 → 644 行，只剩 `set_close_to_tray` 一个命令；新增 7 个 `commands/` 模块，
全程 `cargo test` 348 通过数不变、clippy 警告数不变。
详见 [rust-command-relocation-2026-09-09.md](audits/rust-command-relocation-2026-09-09.md)。

### [x] `verbatimModuleSyntax` 已开启

106 条报错全是同一种（类型导入没写 `import type`），加 `consistent-type-imports` 规则后
`eslint --fix` 一把修完；eslint 忽略 `tests/**`，那边的 1 处手改。
详见 [typecheck-blind-spots-2026-09-08.md](audits/typecheck-blind-spots-2026-09-08.md)。

### [x] 四个从未接进 UI 的同步入口已删除，「同步」补上如实反馈

`uploadHistoryMerge` / `uploadHistoryIncremental` / `downloadHistoryMerge` / `downloadSettingsMerge`
全仓零 `.vue` 调用点，连同 sync-flow.md 图 3 的虚构分支一并删除；「同步」不再无条件弹「已同步」。
详见 [orphan-sync-entries-2026-09-08.md](audits/orphan-sync-entries-2026-09-08.md)。

### [x] `tests/` 与 `scripts/` 纳入类型检查门禁

`typecheck` 扩成四段（新增 `tsconfig.test.json` / `tsconfig.scripts.json`），首次接入的 38 条全部修完；
抓出 `useSensitiveDraft` 三处漏接必填 `confirmClear`、视觉 harness 漏传必填 prop 两条真问题。
详见 [typecheck-blind-spots-2026-09-08.md](audits/typecheck-blind-spots-2026-09-08.md)。

### [x] md-rescue 修复确认对话框补上「替换摘要」，图 5/图 6 文档改写为实际流程

新增纯函数 `pickBackupForLink` + `summarizeRepairStrategy`，替换掉写状态又选错策略的
`autoSelectAndGetSummary`，对话框摘要预览与实际修复结果保证一致，真机验证通过。详见
[md-rescue-repair-summary-2026-09-08.md](audits/md-rescue-repair-summary-2026-09-08.md)。

### [x] NON_IMAGE_EXTENSIONS 跨语言双份补上一致性守卫

新增 `scripts/check-non-image-extensions.mjs`，正则各自抽出 `mdParser.ts` 与 `md_scanner.rs` 的
黑名单集合做等值比较，已接入 `npm run lint`；改坏一侧验证过会报错并指出差集。

### [x] md-rescue：取消扫描后仍联网验证备用链接

真机复现坐实（真实应用日志时间线：取消请求 15:55:07 收到，15:55:16 仍单独起一批网络请求查备用链接）。
修法：`LinkChecker.ts` 取消分支不再对 `verifyBackupLinks` 传 `allowCancelled: true`，取消后备用链接候选
只查本地 DB、不再联网验证。详见 [md-rescue-cancel-backup-verify-2026-09-08.md](audits/md-rescue-cancel-backup-verify-2026-09-08.md)。

### [x] config + mirror 扫描四条发现全部闭环

2026-09-07 扫描出的 P0-1/P1-1/P1-2/P1-3（托盘旧钥匙回写毁配置 / configStore 缓存别名 /
mirror 同步文档失真 / 灯箱重检不重算 linkCheckSummary）均已真机复测坐实并修复+提交。
详见 [scan-config-mirror-2026-09-07.md](audits/scan-config-mirror-2026-09-07.md)。

### [x] sync + ipc 扫描产出已修复并真机验收

2026-08-24 扫描 + 修复 + 真机验收（dufs @127.0.0.1:4919，4 场景全过）+ 二次审查 2 条正确性回归全绿。
提交：`058f1cc7` / `343ca33e` / `e10b677f` / `0d25561a` / `2a16f8c1`。
详见 [scan-sync-ipc-2026-08-24.md](./audits/scan-sync-ipc-2026-08-24.md)。

### [x] history 模块扫描三缺陷（删除虚报战果 / timePeriodStats 失真 / 流程图失真）

首次 `/scan-bugs history` 扫出：单条/整行批量删除对齐「报实际战果」契约、删除/清空后重查 timePeriodStats、
history-flow.md 图 3 对齐实现；两条判据 2026-08-22 经 Tauri E2E（portable 隔离库）自动化验收全过。
详见 [scan-history-fix-2026-08-22.md](./audits/scan-history-fix-2026-08-22.md)。

### [x] 历史记录批量删除 / 镜像剥离的三处已确认缺陷

「可用镜像」谓词统一为 `isUsableMirror`（success 且有 url），批量删除改为按记录隔离失败、toast 报实际条数、
视图只移除真处理掉的行；两条真机判据 2026-08-22 全过（判据②经 Tauri E2E 自动化）。
详见 [bulk-delete-predicate-fix-2026-08-22.md](./audits/bulk-delete-predicate-fix-2026-08-22.md)。

### [x] `config-updated` 广播的消费方全量重算

`useServiceSelector` 加配置切片签名短路，真机两判据全过：无关字段 5 次保存全部跳过重算，托盘改勾选跨窗口同步正常。
源头防抖排查后确认不用改。详见 [todo-cleanup-2026-08-22.md](./audits/todo-cleanup-2026-08-22.md)。

### [x] 上传队列缩略图右下各被削 1px

根因是内外两层 wrapper 同名，父组件 scoped 样式命中了子组件根元素；外层改名 `.thumbnail-box` 根治。
删豁免后跨引擎哨兵 200/200 全绿。详见 [todo-cleanup-2026-08-22.md](./audits/todo-cleanup-2026-08-22.md)。

### [x] SettingsView.vue 顶到 500 行硬指标

副作用 handler 抽进新的 `useSettingsActions` composable，门禁口径 500 → 约 400，现有 18 条单测原样通过。
`BackupPasswordDialog.vue`（568 物理行）未动，下次改它时按 mode 拆。详见 [todo-cleanup-2026-08-22.md](./audits/todo-cleanup-2026-08-22.md)。

### [x] 2026-08-13 修复计划批次 1 / 2 / 4 的手动验收

三批共 9 条判据（含 2 条反向判据）2026-08-15 ~ 08-21 真机全过，过程中另挖出并修复多个真缺陷。
批次 1 见 [md-rescue-acceptance-2026-08-15.md](./audits/md-rescue-acceptance-2026-08-15.md)，
批次 2 / 4（含造场景的坑与本地复现脚本清单）见 [fix-plan-acceptance-2026-08-20.md](./audits/fix-plan-acceptance-2026-08-20.md)。

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

### [x] 又拍云「测试连接」双链路验证

绿灯现在真的代表能传：REST + S3 两条链路各验一次，报错点名是哪把钥匙。
U1/U2/U3 三条真机判据 2026-08-20 全过（按钮禁用 / 红灯点名 S3 凭证 / 绿灯且上传成功）。
详见 [lightbox-gate-and-upyun-dual-chain-2026-08-20.md](./audits/lightbox-gate-and-upyun-dual-chain-2026-08-20.md)。

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
