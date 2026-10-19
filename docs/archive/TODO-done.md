# 已完成的待办（归档）

> 从 [TODO.md](../TODO.md)「已完成」原样搬来（只把相对链接改成从本目录出发），平时不读，按标题搜。新完成的条目先留在 TODO，TODO 满 40 KB 时再整段搬过来。

### [x] Tauri 真应用冒烟改按新界面写选择器

`tests/tauri-e2e/app-smoke.tauri.e2e.cjs` 改认新外壳与五个新页面，本机 `npm run test:tauri:e2e` 已跑通；覆盖范围见 [testing-guide.md](../reference/guides/testing-guide.md)「真实桌面壳层」。

### [x] login-titlebar 的配色并进主题令牌

标题栏改为新界面令牌的副本（侧栏底色、正文色、尺寸），由 `scripts/check-theme-token-copies.mjs` 比对；Cookie 小窗已在真应用里看过（[decisions/hosts.md](../design/redesign/decisions/hosts.md)）。

### [x] 历史表格悬停预览的两处计时器问题不再适用

`useTableInteractions.ts`（`closingTimer` 起算点、handoff 监听晚拆）随旧历史页删除，图库不做悬停预览。来源见 [scan-prerelease-1.1.2-2026-09-11.md](../audits/scan-prerelease-1.1.2-2026-09-11.md)。

### [x] Tauri E2E 在 CI 跑手上建会话失败（降权 workaround 已复验转绿）

根因是微软 by-design 的安全硬化（WebView2 150+ 在提权宿主下丢弃调试参数），不是跑手镜像问题，等不到上游修复。已用 `gsudo --integrity Medium` 把整条测试链降权，2026-09-10 复验 4 passing 并转为阻断门禁（push + dispatch，不含 PR）。详见 [tauri-e2e-runner-webview2-2026-08-21.md](../audits/tauri-e2e-runner-webview2-2026-08-21.md)。

### [x] Cookie 事件监控的降级兜底从未生效（连 `start_cookie_monitoring` 一起收掉）

降级判断挂在 `with_webview` 的返回值上，而那个 `Ok` 只代表消息投递成功、不代表闭包跑过，事件通道
真失败时三层兜底全灭、连超时都不报。已改为闭包内就地降级 + 看门狗，删掉无人调用的
`start_cookie_monitoring`，补上首份单测。详见 [cookie-monitoring-silent-failure-2026-09-09.md](../audits/cookie-monitoring-silent-failure-2026-09-09.md)。

### [x] Rust 侧 main.rs 减重：21 个内联命令归位到 commands/

`main.rs` 3050 → 644 行，只剩 `set_close_to_tray` 一个命令；新增 7 个 `commands/` 模块，
全程 `cargo test` 348 通过数不变、clippy 警告数不变。
详见 [rust-command-relocation-2026-09-09.md](../audits/rust-command-relocation-2026-09-09.md)。

### [x] `verbatimModuleSyntax` 已开启

106 条报错全是同一种（类型导入没写 `import type`），加 `consistent-type-imports` 规则后
`eslint --fix` 一把修完；eslint 忽略 `tests/**`，那边的 1 处手改。
详见 [typecheck-blind-spots-2026-09-08.md](../audits/typecheck-blind-spots-2026-09-08.md)。

### [x] 四个从未接进 UI 的同步入口已删除，「同步」补上如实反馈

`uploadHistoryMerge` / `uploadHistoryIncremental` / `downloadHistoryMerge` / `downloadSettingsMerge`
全仓零 `.vue` 调用点，连同 sync-flow.md 图 3 的虚构分支一并删除；「同步」不再无条件弹「已同步」。
详见 [orphan-sync-entries-2026-09-08.md](../audits/orphan-sync-entries-2026-09-08.md)。

### [x] `tests/` 与 `scripts/` 纳入类型检查门禁

`typecheck` 扩成四段（新增 `tsconfig.test.json` / `tsconfig.scripts.json`），首次接入的 38 条全部修完；
抓出 `useSensitiveDraft` 三处漏接必填 `confirmClear`、视觉 harness 漏传必填 prop 两条真问题。
详见 [typecheck-blind-spots-2026-09-08.md](../audits/typecheck-blind-spots-2026-09-08.md)。

### [x] md-rescue 修复确认对话框补上「替换摘要」，图 5/图 6 文档改写为实际流程

新增纯函数 `pickBackupForLink` + `summarizeRepairStrategy`，替换掉写状态又选错策略的
`autoSelectAndGetSummary`，对话框摘要预览与实际修复结果保证一致，真机验证通过。详见
[md-rescue-repair-summary-2026-09-08.md](../audits/md-rescue-repair-summary-2026-09-08.md)。

### [x] NON_IMAGE_EXTENSIONS 跨语言双份补上一致性守卫

新增 `scripts/check-non-image-extensions.mjs`，正则各自抽出 `mdParser.ts` 与 `md_scanner.rs` 的
黑名单集合做等值比较，已接入 `npm run lint`；改坏一侧验证过会报错并指出差集。

### [x] md-rescue：取消扫描后仍联网验证备用链接

真机复现坐实（真实应用日志时间线：取消请求 15:55:07 收到，15:55:16 仍单独起一批网络请求查备用链接）。
修法：`LinkChecker.ts` 取消分支不再对 `verifyBackupLinks` 传 `allowCancelled: true`，取消后备用链接候选
只查本地 DB、不再联网验证。详见 [md-rescue-cancel-backup-verify-2026-09-08.md](../audits/md-rescue-cancel-backup-verify-2026-09-08.md)。

### [x] config + mirror 扫描四条发现全部闭环

2026-09-07 扫描出的 P0-1/P1-1/P1-2/P1-3（托盘旧钥匙回写毁配置 / configStore 缓存别名 /
mirror 同步文档失真 / 灯箱重检不重算 linkCheckSummary）均已真机复测坐实并修复+提交。
详见 [scan-config-mirror-2026-09-07.md](../audits/scan-config-mirror-2026-09-07.md)。

### [x] sync + ipc 扫描产出已修复并真机验收

2026-08-24 扫描 + 修复 + 真机验收（dufs @127.0.0.1:4919，4 场景全过）+ 二次审查 2 条正确性回归全绿。
提交：`058f1cc7` / `343ca33e` / `e10b677f` / `0d25561a` / `2a16f8c1`。
详见 [scan-sync-ipc-2026-08-24.md](../audits/scan-sync-ipc-2026-08-24.md)。

### [x] history 模块扫描三缺陷（删除虚报战果 / timePeriodStats 失真 / 流程图失真）

首次 `/scan-bugs history` 扫出：单条/整行批量删除对齐「报实际战果」契约、删除/清空后重查 timePeriodStats、
history-flow.md 图 3 对齐实现；两条判据 2026-08-22 经 Tauri E2E（portable 隔离库）自动化验收全过。
详见 [scan-history-fix-2026-08-22.md](../audits/scan-history-fix-2026-08-22.md)。

### [x] 历史记录批量删除 / 镜像剥离的三处已确认缺陷

「可用镜像」谓词统一为 `isUsableMirror`（success 且有 url），批量删除改为按记录隔离失败、toast 报实际条数、
视图只移除真处理掉的行；两条真机判据 2026-08-22 全过（判据②经 Tauri E2E 自动化）。
详见 [bulk-delete-predicate-fix-2026-08-22.md](../audits/bulk-delete-predicate-fix-2026-08-22.md)。

### [x] `config-updated` 广播的消费方全量重算

`useServiceSelector` 加配置切片签名短路，真机两判据全过：无关字段 5 次保存全部跳过重算，托盘改勾选跨窗口同步正常。
源头防抖排查后确认不用改。详见 [todo-cleanup-2026-08-22.md](../audits/todo-cleanup-2026-08-22.md)。

### [x] 上传队列缩略图右下各被削 1px

根因是内外两层 wrapper 同名，父组件 scoped 样式命中了子组件根元素；外层改名 `.thumbnail-box` 根治。
删豁免后跨引擎哨兵 200/200 全绿。详见 [todo-cleanup-2026-08-22.md](../audits/todo-cleanup-2026-08-22.md)。

### [x] SettingsView.vue 顶到 500 行硬指标

副作用 handler 抽进新的 `useSettingsActions` composable，门禁口径 500 → 约 400，现有 18 条单测原样通过。
`BackupPasswordDialog.vue`（568 物理行）未动，下次改它时按 mode 拆。详见 [todo-cleanup-2026-08-22.md](../audits/todo-cleanup-2026-08-22.md)。

### [x] 2026-08-13 修复计划批次 1 / 2 / 4 的手动验收

三批共 9 条判据（含 2 条反向判据）2026-08-15 ~ 08-21 真机全过，过程中另挖出并修复多个真缺陷。
批次 1 见 [md-rescue-acceptance-2026-08-15.md](../audits/md-rescue-acceptance-2026-08-15.md)，
批次 2 / 4（含造场景的坑与本地复现脚本清单）见 [fix-plan-acceptance-2026-08-20.md](../audits/fix-plan-acceptance-2026-08-20.md)。

### [x] 灯箱 / 悬停预览 / ±1 预热接入 URL 安全闸

图库的灯箱大图、当前图与 ±1 预热、滚动预热都过 `safeImageUrl`，判据与缩略图同源（调用方清单见 `networkPolicy.ts` 的 `getConfirmedHttpHosts`）。
详见 [lightbox-gate-and-upyun-dual-chain-2026-08-20.md](../audits/lightbox-gate-and-upyun-dual-chain-2026-08-20.md)。

### [x] `emitConfigUpdated()` 死代码已删

全仓零调用点，同文件另外三个快捷方法均在用（64 / 26 / 6 处），确认只有它是死的。
真正在用的广播是 `useConfig.ts` 的 `saveConfig`（托盘与首页、设置同在主窗口，也走它）。

### [x] 收藏页与时间轴的图片 URL 校验

`useThumbnailFallbackChain` 现在把候选过一遍 `safeImageUrl`，两个视图与 `ThumbnailImage` 共用同一道闸；
已确认的明文 HTTP 域名由各视图用 `getConfirmedHttpHosts(config)` 传入。
详见 [http-image-host-2026-08-19.md](../audits/http-image-host-2026-08-19.md)（残余风险第 2 条）。

### [x] 又拍云三条缺陷 + 明文 HTTP 图床支持

真机全过（2026-08-19）：同名覆盖、存储路径失效、GUI 上传用错凭证三条都修完并验收；
顺带发现又拍云免费域名只有 HTTP 而应用一律要 HTTPS，遂支持明文 HTTP 图床（用户确认一次、按域名生效），
并修好 WebDAV 局域网缩略图一直被 CSP 拦的既有缺陷。详见 [upyun-audit-2026-08-19.md](../audits/upyun-audit-2026-08-19.md) 与 [http-image-host-2026-08-19.md](../audits/http-image-host-2026-08-19.md)。

### [x] 又拍云「测试连接」双链路验证

绿灯现在真的代表能传：REST + S3 两条链路各验一次，报错点名是哪把钥匙。
U1/U2/U3 三条真机判据 2026-08-20 全过（按钮禁用 / 红灯点名 S3 凭证 / 绿灯且上传成功）。
详见 [lightbox-gate-and-upyun-dual-chain-2026-08-20.md](../audits/lightbox-gate-and-upyun-dual-chain-2026-08-20.md)。

### [x] 敏感字段密码框统一「密文常驻、明文按需」

七条真机回归全过：第一轮 5 条（2026-08-15，坚果云）验改动本身，第二轮 2 条（2026-08-17，dufs）验换钥后的同步与上传。
契约见 [sensitive-field-contract.md](../reference/patterns/sensitive-field-contract.md)，回归步骤与两个「假通过」的坑（托盘退出、dev 与正式版共用数据）见 [backup-password-regression.md](../reference/guides/backup-password-regression.md)。
第二轮结果见 [webdav-release-wrapup-acceptance.md](../audits/webdav-release-wrapup-acceptance.md)。

### [x] WebDAV 发版前收尾（Digest 一致性 + 5 条自动化 + 死模块清理）

真机 12/12 全过（2026-08-17）。顺带挖出既有缺陷：三条链路的连接测试一直显示 `[object Object]`，
把后端区分出来的失败原因全吞掉了；并删除从未接线、且会明文上传全部图床凭据的 `useWebDAVSync`。
详见 [webdav-release-wrapup-acceptance.md](../audits/webdav-release-wrapup-acceptance.md)。

### [x] 编辑器插件（Typora / Obsidian / CLI）支持 WebDAV 图床

三条链路全部真机验收通过（2026-08-17，dufs）。三轮审查 + 验收共揪出 8 个真实缺陷，全部修完：
含 `cli-config.json` 凭证明文落盘（改为钥匙串信封加密）、四条上传路径里三条漏了文件名唯一化。
详见 [webdav-editor-integration-acceptance.md](../audits/webdav-editor-integration-acceptance.md)。

### [x] WebDAV Digest 提示 + 明文 HTTP 逃生舱

真机验收 A 半场 3/3、B 半场 6/6 全部通过（2026-08-16）。B 半场借 `pinggy.io` 隧道模拟「填主机名连得通」场景。
详见 [webdav-digest-and-lan-http-escape-hatch-acceptance.md](../audits/webdav-digest-and-lan-http-escape-hatch-acceptance.md)。

### [x] WebDAV 401 提示区分 Digest 与密码错

401 时读 `WWW-Authenticate`，只有「给 Digest 且不给 Basic」才换文案，密码真错的用户看不到 Digest 噪音。
顺带把「认证失败，请检查用户名和密码」抽成常量并登记进跨语言门禁（此前在 4 处内联重复、无人守）。
详见 [webdav-image-host-issues.md](../reference/troubleshooting/webdav-image-host-issues.md#认证失败但用户名密码反复核对都是对的)。

### [x] WebDAV 明文 HTTP 的「显式确认」逃生舱

fake-ip 那一档改回专属错误类型，前端按类型（非文案）弹确认框，确认写 `lanHttpConfirmed`、改地址即作废。
实现时补掉一个真漏洞：`all_dns_results_allowed` 早退会让 `FakeIp` 掩盖同一集合里的公网地址。
详见 [fake-ip-dns-policy-distortion.md](../reference/troubleshooting/fake-ip-dns-policy-distortion.md#逃生舱已实现)。

### [x] 设置备份密码会静默作废已保存的 WebDAV 密码

换钥匙只重写外层信封，内层 `passwordEncrypted` 成孤儿（2026-08-15 真机复现并修复）。
修法是 `rekeyFieldSecrets` 把「解开 → 换钥匙 → 用新钥匙锁上」收进一个函数，存量孤儿启动时清空并提示重填。
详见 [orphan-field-ciphertext.md](../reference/troubleshooting/orphan-field-ciphertext.md)。

### [x] WebDAV 图床支持

真机验收 6/6 通过（2026-08-14），覆盖 dufs / OpenList / 坚果云三个互相独立的服务端实现。
验收记录见 [webdav-acceptance-2026-08-14.md](../audits/webdav-acceptance-2026-08-14.md)，
环境重建见 [webdav-testing-environments.md](../reference/guides/webdav-testing-environments.md)。

### [x] fake-ip 环境下 WebDAV 局域网判据失真

`198.18.0.0/15` 曾被当作局域网放行，导致 TUN 环境下公网 WebDAV 地址被判成内网、明文凭证防线失效。
修法是把 fake-ip 当「看不见」而非「内网」，两个模块按猜错的代价选不同默认值。
详见 [fake-ip-dns-policy-distortion.md](../reference/troubleshooting/fake-ip-dns-policy-distortion.md)。
