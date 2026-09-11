# 发版前缺陷扫描：v1.1.1 → v1.1.2（2026-09-11）

> 来源：发版前对 v1.1.1 之后 84 个提交做的定向扫描。没按 scan-bugs 技能"12 个模块各开一个会话"
> 全量扫（各模块最近一次扫描与真机验收都在 08-22~09-10 之间），而是按"这段时间改了什么"
> 挑三块最大、最没在真机跑过的改动，各派一个只读代理扫，每条发现回源码复核过行号与消费端。
>
> **一句话结论：搬家和重构本身干净；顺带挖出两类一直存在、用户能看见的缺陷，已随本次发版修掉。**

## 扫描范围与结论

| 范围 | 提交 | 已有验证 | 本次结论 |
|------|------|---------|---------|
| Rust 21 个命令从 main.rs 搬到 commands/ + IPC 语义 | `f0d7eba3..917cd35b` | cargo test 348 绿；Cookie 登录 09-10 真机六步全过 | 六项全干净；顺带挖出 **A-1** |
| 前端目录重构（`@/` 别名、砍 shim / 死代码 / 4 个同步入口、verbatimModuleSyntax） | `586bc1af..29772c95` | typecheck + lint + 3010 单测绿 | 六项全干净；3 处文档漂移 |
| 灯箱动画重做 + 悬浮预览状态机（[lightbox-motion-2026-09-11.md](./lightbox-motion-2026-09-11.md) 自述"待审查"） | `f3e3af79..724d4930` | 单测绿；真机逐帧采样过一次 | 无阻塞缺陷；1 条 🟡；顺带挖出 **C-1** |

CI 在 `origin/main`（f3e3af79）上全绿（三 OS 矩阵 + Tauri 桌面 E2E 阻断 + 定时 visual）。
本地领先的 13 个灯箱提交在本次修复后一并 push。

## 发现与修法

### A-1 🔴 Tauri 命令失败时 `AppError` 被渲染成 `[object Object]`（已修）

**大白话**：Rust 报错回来是个"盒子"（`{type, data:{message}}`，`src-tauri/src/error.rs:11-13`），
前端有 6 个地方没开盒直接 `String(盒子)`，用户看到的错误原因就是 `[object Object]`。
08-24 修过一处同类（`343ca33e` webdav），这些是漏网的。

| # | 位置 | 触发命令 | 修前用户看到 |
|---|------|---------|-------------|
| 1 | `src/composables/useConfig.ts` `openCookieWebView` | `open_login_window` 失败 | toast「打开登录窗口失败：[object Object]」 |
| 2 | `src/login-webview.ts` `handleStartLogin` | `setup_cookie_event_monitoring` 失败 | `alert`「启动 Cookie 监控失败 [object Object]」。**macOS/Linux 必达**：`cookie_login.rs` 非 Windows 一律返回 AppError，"当前操作系统暂不支持…"被整句吃掉 |
| 3 | `RescueBrokenGroups.vue` `withErrorToast` | `open_path`（三个调用者） | toast「无法打开文件夹/文件/链接：[object Object]」 |
| 4 | `useLightboxActions.ts` `openInBrowser` | `open_path`（经 `security/shellOpen.ts`） | 灯箱「在浏览器打开」失败 toast |
| 5 | `useConnectionTest.ts` `testCookieConnection` | 6 个 `test_*_cookie` 命令 | 设置页 Cookie 测试失败 toast |
| 6 | `CliCard.vue` `errorToMessage` | `get_cli_path_status` / `add_cli_to_path` / `remove_cli_from_path` | 退成「操作失败，请稍后重试」——只认顶层 `message` 不认 `data.message` |

同类但只进日志：`src/security/crypto.ts` `init()`（`get_or_create_secure_key`）rethrow 的文案里带 `[object Object]`，顺手改。

**修法**：全部改用现成的 `getErrorMessage()`（`src/types/errors.ts`，AppError / Error / string / 带 message 的对象四种形状都认）；
`useConnectionTest` 用同文件已注入的 `errorToString`（底层 `normalizeError` 同样开盒）；`CliCard` 的 `errorToMessage` 加一行 `isAppError` 分支。

**验收**：6 个 spec 各加一条"invoke reject AppError 形状 → 文案含后端原因、不含 `[object Object]`"，
其中 `useLightboxActions.spec` 用回滚源码的方式反向验证过（回滚后如期报 `[object Object]`）。
写测试时踩的坑：`isAppError` 只认 `error.rs` 那 11 种 `serde(rename)` 类型，随手编的 `'IO'` 会被判成非 AppError——
测试里必须用真实类型（`FILE_IO` / `EXTERNAL` / `CONFIG` / `AUTH`）。

已排除（追到消费端确认无影响）：`useClipboardImage.ts` `readClipboardImage`（`result.error` 无人消费）、
`useConfig.ts` 三处外层 catch（不可达）、`useSettingsActions.ts` `handleClearAppCache` / `AboutUpdatePanel.vue` `openExternal`（catch 的是 Tauri 插件 API，不是 AppError）。

### C-1 🔴 6 个 CSS 变量全项目无定义，样式静默失效（已修）

**大白话**：`var(--xxx)` 引用了从没定义过的名字，浏览器不报错，整条声明作废。`git log -S` 确认这些名字
在 `src/` 历史里**从未定义过**——从写下那天起就没生效。lint 全绿抓不到这类。

| 变量 | 位置 | 实际后果 | 修法 |
|------|------|---------|------|
| `--border-color` | `TimelineTrack.vue`（轨道线、年份分隔线） | **时间轴轨道线与分隔线不可见** | → `--border-subtle` |
| `--bg-hover` | `TimelineYearLabels.vue` `.year-label:hover` | hover 时背景整条失效 | → `--hover-overlay` |
| `--error-alpha-20` | `PrivateStorageGroup.vue` `.delete-profile-btn` | 删除 profile 按钮无边框 | → `--error-border` |
| `--weight-normal` | `MigrateFilterPopover.vue` | 字重退回继承 | → `--weight-regular` |
| `--shadow-md` | `app.css` `.p-popover` | 所有 Popover 无阴影 | → `--shadow-float` |
| `--primary-light` | `MdRescueInline.vue` `.progress-bar-fill` | 靠 fallback `#60a5fa` 撑着；深色主题下 fallback 恰好等于 `--primary`，渐变退化成纯色 | → `--primary-gradient`（两主题都定义了亮端） |
| `--theme-transition-duration` | `src/theme/transitions.css` | 整份文件是死的：加 `.theme-transitioning` 的 JS 在 2026-03 `b91ca17d` 重构 ThemeManager 时删了 | **删除文件**及 `main.ts` / `login-webview.ts` / 视觉 harness 三处 import |
| （死 CSS） | `app.css` `.gallery-grid` ~ `.gallery-item-filename` 整段（153 行） | 全仓无模板引用，`shimmer` keyframes 也只有它在用 | 删除整段 |

**护栏**：新增 [`scripts/check-css-undefined-vars.mjs`](../../scripts/check-css-undefined-vars.mjs) 接入 `npm run lint`，
拿 `src/**` 的 `var(--name` 引用与全项目 `--name:` 定义（含 TS 对象键、`setProperty`）做差集；带 fallback 的照样算未定义；
`--p-*` 是 PrimeVue 库内令牌跳过。用回滚 `TimelineTrack.vue` 反向验证过能抓到。规范说明补进 [tokens.md](../design/tokens.md)。

**验收**：`node scripts/check-css-undefined-vars.mjs` 退出 0（225 个定义 / 4697 处引用）；`npm run lint` 全绿；
本地 `playwright test` 视觉回归 194 张全过（这些元素不在 harness 截图范围内，没有基准要更新）。
**真机看一眼**：时间轴视图轨道线 / 年份分隔线现在可见；年份标签 hover；任意 Popover 有阴影；私有存储 profile 删除按钮有红边。深浅主题各扫一遍。

### 🟡 灯箱：`pendingClose` 路径下收回计时器与真实 close 事件脱钩（疑似，登记 TODO 不修）

`useTableInteractions.ts` 的 `closingTimer` 以 `lightboxVisible=false` 起算，但 `usePhotoSwipeBridge.ts` 在开场闸门关着时
只记 `pendingClose`，真实 `close()` 推迟到 `openingAnimationEnd`（≈380ms 后）。触发条件是开灯箱后 ~160-380ms 内完成
"点删除 + 确认框"——人手基本做不到，且下一次 mouseenter/leave 自愈。状态机刚调好、没真机复现，不动它。

## 各维度"未发现问题"（不凑数，记下来免得下次重扫）

**Rust 命令搬家 / IPC**：74 个 `#[tauri::command]` 与 `generate_handler!`（`main.rs:279-354`）集合相等；`check-invoke-args.mjs` 只查
`#[tauri::command]` 属性不查登记表，这个缺口本次人工补了；前端 45 个字面量 invoke 名 + 10 处动态派发回溯后全部在册；
`cookie_login.rs` / `open_target.rs` 的非 Windows 分支无孤儿 import（本机只编 Windows 那半，CI 三 OS 矩阵兜底）；
18 个搬动命令签名与 `917cd35b^` 逐字一致；`webdav_request` 的 `timeoutMs` 毫秒 ↔ `Duration::from_millis` 等语义核对一致。

**前端目录重构**：`vi.mock` 403 处目标全部存在（含 barrel 与实现文件的隔离核对——被测模块没有绕过 barrel 直引实现）；
9 个 `check-*.mjs` 硬编码路径全部存在且都有"扫到 0 硬失败"自检；`vitest.config.ts` coverage 目录名与现状一致；
动态 import 只有 2 处裸模块，`import.meta.glob` 唯一一处（`icons.ts`）命中 16 个 svg；被删的 4 个同步入口 + 16 个死导出全仓零引用；
Tauri 事件 listen / emit 双向配对无单侧悬空；`check-e2e-mock-parity.mjs` 实跑通过。`verbatimModuleSyntax` 下 `import { type X }`
内联形式会保留成副作用导入（esbuild 实测），扫出 7 处都没引入新的模块执行或循环。

**灯箱动画**：`hoverPreview.phase` 10 个写入点无悬空路径，两条关闭路径（Esc / 灯箱内删除）判据一致；`onDeactivated` / 失焦 /
跨页导航都回 idle；`resolveFlipElement` 删掉半个条件对收藏 / 时间轴视图行为逐字节不变（`.photo-item` 恒 ≥100px，
时间轴竖图 <100px 的改动前后都是 fade）；`close` 事件同步派发早于首帧动画（`photoswipe.esm.js:6767-6776`）；
`forceDestroy` 走完整清理无提前 return；reduced-motion 兜底特异性正确。

## 范围外线索（一句话一条，未验证不定性）

- `useTableInteractions.ts` keep 分支下 handoff 监听器晚拆（timer 回调不调 `stopHoverHandoffTracking()`），改动前即如此 → 登记 TODO
- 时间轴竖图（比例 <0.5）瓦片宽度 <100px 恒走 fade，lightbox-motion 文档"恒 ≥100px"那句对时间轴不成立 → 已在该文档第 11 节订正
- 灯箱内删除最后一条记录会让整个子视图卸载，灯箱无收回动画瞬间消失；改动前走 `destroy()` 同样瞬切，非回归
- `eslint.config.mjs` 未启用 `@typescript-eslint/no-import-type-side-effects`，内联 `{ type X }` 单独成句的导入今后不会被拦
- `src/utils/icons.ts` 的 `import.meta.glob('../assets/...')` 是 `src/` 内仅存的 `../` 引用，eslint 管不到 `import.meta.glob`，目录再搬会静默匹配 0 个
- `check-e2e-mock-parity.mjs` 对动态 `import()` 解构完全不计入也不打印 skipped，与其注释承诺不符
- `cookie_login.rs` 非 Windows 构建下 `save_cookie_from_login` 整条链无调用者 → ubuntu/macos 出 `dead_code` 警告，CI 无 `-D warnings` 静默
- 登记了但前端零调用的命令：`download_image_from_url`、`fetch_qiyu_token`、`upload_to_r2`
- `useConnectionTest.ts:100/114`、`useHistory.ts` 五处、`useSettingsActions.ts:96` 等仍用 `String(error)`，catch 的都不是 AppError（fetch / 插件 API / JS Error），只是文案会带 `Error:` 前缀，非缺陷；"try 里 await invoke、catch 里 String(err)"的静态护栏登记 TODO

## 执行记录

- 2026-09-11 批次 1（A-1，7 处源码 + 6 个 spec）：lint / typecheck 绿，118 用例绿，回滚验证测试有牙
- 2026-09-11 批次 2（C-1，7 处 CSS + 删 `transitions.css` + 删死 gallery 段 + 新护栏脚本）：lint / typecheck 绿，视觉回归 194 张全过
- 2026-09-11 批次 3（本文 + lightbox-motion 第 11 节 + TODO 3 条 + 3 处文档漂移）
