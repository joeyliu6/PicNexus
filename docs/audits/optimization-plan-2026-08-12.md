# 优化执行计划（2026-08-12 审查）

> 本计划由 2026-08-12 的三路代码审查（前端 / Rust 后端 / 工程配置）汇总而来，供 AI 执行者按批次落地。
> 每一批是一个独立执行会话；批内条目可以一起改，批与批之间必须分开验证。

## 执行须知（每批开工前必读）

1. **先读项目规则**：`AGENTS.md`（Store 单例、禁 console、CSS 变量、.vue 500 行上限等）。
2. **提交约定**：原子提交，格式 `<type>(<scope>): <description>`，提交信息用英文；代码注释、文档用简体中文。**未获用户明确授权不得 push**。
3. **验收门禁**：
   - 前端改动：`npm run lint` + `npm run typecheck` + `npm run test:unit`
   - Rust 改动：`cd src-tauri && cargo check && cargo test`
   - 涉及 CI/构建配置：额外跑 `npm run ci:prepush`
4. 每条目标注了 ⚠️ 的地方是踩坑点，改之前先看。
5. 只改本计划列出的文件，不顺手重构无关代码。

---

## 第一批：Rust 后端正确性与性能（全部在 `src-tauri/`）

一个会话完成，验收统一跑 `cargo check && cargo test`。建议按下面顺序改，拆成 3~4 个原子提交（1-1/1-2 一个，1-3~1-5 一个，1-6~1-9 一个）。

### 1-1. Server 上传锁串行化（最高优先级）

- **位置**：`src-tauri/src/server/upload_handler.rs:621`（handle_upload）、`:752`（handle_file_upload）、`:702`（handle_status）
- **问题**：`state.upload_config.lock().await` 的 guard 被持有贯穿整个上传网络 IO（可达 60s）。并发上传完全串行；`/status` 等同一把锁，上传期间 Typora/Obsidian 探活会挂死。
- **修法**：给 `ServerUploadConfig` 派生 `Clone`；在 guard 作用域内 `let cfg = guard.as_ref().cloned()` 后立即 `drop(guard)`，后续 IO 用克隆值。配置对象很小，clone 成本可忽略。
- **验收**：现有测试通过；人工确认三个 handler 中没有任何 `.await` 发生在锁 guard 存活期间。

### 1-2. Nami 上传 client 缺 timeout

- **位置**：`src-tauri/src/commands/nami.rs:563`
- **问题**：全库唯一没设 timeout 的 `Client::builder()`。服务端挂住时 command 永久 hang。
- **修法**：补 `.timeout(...)`。参考同类：`qiyu.rs:101` 45s、`zhihu.rs:206` 30s、`nami.rs:696` 15s。上传大文件路径建议 60s。

### 1-3. 文件对话框阻塞 tokio 线程

- **位置**：`src-tauri/src/commands/user_files.rs:79,96`
- **问题**:`blocking_save_file()` / `blocking_pick_file()` 在 async command 内直接调用，对话框开着期间占死一条 worker 线程。
- **修法**：包进 `tokio::task::spawn_blocking`，或改用 dialog 插件的 async API（⚠️ 改前先 `web_search`/查文档确认 tauri-plugin-dialog 的 async API 签名，禁止凭空假设）。

### 1-4. `From<String>` 把一切错误标成 Network

- **位置**：`src-tauri/src/error.rs:95-99`
- **问题**：`impl From<String> for AppError` 无条件映射到 `AppError::Network`，文件 IO / 校验失败也被前端当网络错误分支处理。
- **修法**：删除该 impl（或收窄）。⚠️ 会引起编译错误连锁——逐个修复调用点，按真实语义映射到正确的 `AppError` 变体，不要偷懒统一转回 Network。
- **验收**：`cargo check` 通过后，grep 确认没有新增的 `AppError::Network` 兜底滥用。

### 1-5. 安全判据双份实现已漂移（安全问题）

- **位置**：`src-tauri/src/commands/link_checker.rs:202-300` 重复实现了 `src-tauri/src/url_policy.rs` 的整套函数（`normalize_host`/`ipv4_mapped_from_ipv6`/`is_loopback_host`/`is_private_or_reserved_ipv4`/`is_private_or_reserved_host`）。
- **已漂移点**：`link_checker.rs:290` 额外拒绝 IPv6 文档段 `2001:db8::/32`，而 `url_policy.rs:111-114` 没有——同一地址两边判定不一致。
- **修法**（顺序不能反）：
  1. 先把 `2001:db8::/32` 判据**合并进** `url_policy.rs` 的 `is_private_or_reserved_host`；
  2. 再删除 `link_checker.rs` 的副本，改为 `use crate::url_policy::...`；
  3. 保留 link_checker 全部现有测试（⚠️ 测试模块在文件中段 419-959 行），尤其 `dns_answer_gate_allows_fake_ip_but_blocks_real_private` 回归护栏必须继续通过。
- **⚠️ 背景**：fake-ip 池（`198.18.0.0/15`、`fdfe:dcba:9876::/64`）在两个模块的处置**故意不同**（link_checker 豁免、url_policy 拒绝），依据见 `docs/TODO.md` 已完成小节。合并时**只合并重复的基础判据函数**，不要动 fake-ip 的策略层差异。

### 1-6. 日志脱敏每次调用编译 6 个正则

- **位置**：`src-tauri/src/log_utils.rs:31-69`（`sanitize_text`）及 `:93-122` 的 6 个 regex 工厂函数
- **问题**：每次调用 `Regex::new` × 6 + 6 个中间 String，且处于 sidecar 逐行日志热路径（`nami_token.rs:61`、`qiyu_token.rs:40`）。
- **修法**：改 `std::sync::LazyLock<Regex>`，范式照抄 `md_scanner.rs:20-30`。

### 1-7. 每次下载图片全量扫描系统临时目录

- **位置**：`src-tauri/src/commands/link_checker.rs:1194-1245`（`cleanup_old_temp_files`），调用点 `:1262`
- **问题**：async 上下文里同步遍历整个 `%TEMP%`（Windows 常有上万条目），每次下载都跑。
- **修法**：包进 `spawn_blocking`，并加节流——每 N 分钟至多执行一次（用 `AtomicI64` 存上次清理时间戳即可）。

### 1-8. 遥测锁中毒 panic 整个应用

- **位置**：`src-tauri/src/analytics/mod.rs:103,107`、`src-tauri/src/analytics/heartbeat.rs:53`
- **问题**：`.lock().expect("analytics state poisoned")`——遥测是非关键路径，不该拖垮进程。
- **修法**：照抄 `commands/upload.rs:221-228` 的 `poisoned.into_inner()` 恢复范式。

### 1-9. async 内的同步文件 IO（同文件顺手修）

- **位置**：`src-tauri/src/server/upload_handler.rs:790,816,828,843,844`（`std::fs::create_dir_all`/`write` 写整个请求体）
- **修法**：改 `tokio::fs::*` 等价调用。⚠️ `:829,843,844` 的 `let _ = remove_*` 清理失败静默忽略——顺手加 `log::warn!`。

---

## 第二批：前端性能与死代码（全部在 `src/`）

一个会话完成，验收统一跑 `npm run lint && npm run typecheck && npm run test:unit`。建议 2~3 个原子提交。

### 2-1. N+1 查询——批量接口早已存在（性价比最高）

- **位置**：`src/composables/useImageDetailCache.ts:100-119`
- **问题**：逐个 `historyDB.getById(id)`，N 次 Tauri IPC + SQL 往返。`:107` 的 TODO 注释写"等批量接口"，但 `src/services/database/HistoryDatabase.ts:618` 的 `getItemsByIds(ids)` **已经存在**。
- **修法**：改用 `getItemsByIds` 一次取回，删掉过期 TODO 注释。

### 2-2. 缩略图候选数组绕过了同文件的 LRU 缓存

- **位置**：`src/composables/useThumbCache.ts:131-140`（`getMetaThumbnailCandidates`）
- **问题**：每次调用新建数组（map+filter+Set+spread），被模板逐行调用（`FavoritesView.vue:237`、`TimelinePhotoGrid.vue:146`），引用抖动强制子组件全量 re-render。同文件 `:223` 已为 `HistoryItem` 版本实现了带 LRU 的 `thumbnailCandidatesCache`。
- **修法**：给 `ImageMeta` 版本接入同样的 LRU 缓存（key 可用 `meta.id` + config 指纹）。⚠️ 注意镜像列表变化时缓存要失效——参考 `:223` 现有实现的失效策略。

### 2-3. 收藏页 O(n²) 数组累加

- **位置**：`src/composables/favorites/useFavoritesData.ts:198`
- **问题**：`loadedMetas.value = [...loadedMetas.value, ...result.items]` 每页全量复制。项目在 `useLinkCheck.ts:290` 已踩过同一坑并留了注释。
- **修法**：`loadedMetas` 已是 `shallowRef`（`:63`），改 `loadedMetas.value.push(...result.items)` + `triggerRef(loadedMetas)`。

### 2-4. 全量结果集上的 O(n) computed

- **位置**：`src/composables/link-check/useCheckFilter.ts:380-384`
- **问题**：`filteredRowKeys`（全量 map 新数组）和 `isAllSelected`（全量 every）对整个 filteredRows 求值，链接检测场景可达数万行。
- **修法**：`isAllSelected` 改为计数比较（`selectedIds.size === filteredRows.length`，前提是维持"选中项必属于 filtered"的不变式——确认 `handleToggleSelect:387` 及清空逻辑满足）；`filteredRowKeys` 只在 shift-range 多选场景按需构建。

### 2-5. 滚动条 hover 未做 rAF 节流

- **位置**：`src/components/views/timeline/TimelineIndicator.vue:330-332`（绑定于 `:415` `@mousemove`）
- **修法**：接入现成的 `src/utils/rafScheduler.ts:20` `createRafScheduler()`（用法参考 `useLinkCheck.ts:721`）。

### 2-6. 死代码清理

- **位置**：`src/config/configInterface.ts:60-61` 的 `export type OutputFormat = WeiboProxyMode;`
- **说明**：全库零引用（⚠️ grep 时排除无关的 `CompressionOutputFormat`），直接删。
- **⚠️ 不要动**：`src/config/historyTypes.ts:161-162` 的 `lastJdCheck` 虽标 `@deprecated` 但仍被 legacy 迁移使用，保留。

---

## 第三批：CI / 构建 / 测试守卫（配置层）

一个会话完成。⚠️ 涉及 CI 配置，改完除本地门禁外，建议用户在下次 push 后观察一次 Actions 运行确认生效。建议 2~3 个原子提交（CI 缓存一个、重复步骤删减一个、覆盖率守卫一个）。

### 3-1. Release 构建补缓存（收益最大）

- **位置**：`.github/workflows/release.yml`
- **问题**：
  - `build` job 的 `setup-node@v5`（约 :63-65）漏配 `cache: 'npm'`（同文件 `web-smoke` job :19-22 配了，照抄）；
  - `build` job 完全没有 Rust cache（`ci.yml:72-76` 有 `Swatinem/rust-cache@v2`，照抄）。
- **影响**：3 平台矩阵每次 release 全量重下依赖 + 全量重编译 Rust。

### 3-2. CI 重复步骤删减

- **位置**：`.github/workflows/ci.yml` + `package.json`
- **改动**：
  1. `package.json:15` 的 `build: "tsc && vite build"` 改为 `build: "vite build"`——`tsc`（noEmit）是 `typecheck`（vue-tsc）的真子集，CI 和 prepush 都先跑 typecheck，纯重复。⚠️ 确认 `ci:prepush`、CI workflow 中 build 之前都有 typecheck 步骤后再删。
  2. `ci.yml:95-100`：ubuntu 上 `test:unit` 与 `test:coverage` 是同一套 suite 跑两遍，删掉 `test:unit` 那步（coverage 已含全量执行）。

### 3-3. 覆盖率守卫盯错对象

- **位置**：`scripts/check-critical-coverage.mjs`
- **问题**：现有 6 个"关键文件"阈值全是 35，但实际覆盖率已 97%+，守卫形同虚设；真正的洼地 `src/core/UploadQueue.ts`（行覆盖 8.44%，全仓库无任何测试实例化 `UploadQueueManager`）不在名单。
- **修法（棘轮策略，本批不写新测试）**：
  1. 旧 6 个文件的阈值从 35 提到接近当前实际值（如当前值减 5 个百分点），锁住存量成果；
  2. 新增低覆盖核心文件条目，阈值定在**当前值附近**防继续下滑（如 `UploadQueue.ts: 8`）。名单参考：`UploadQueue.ts` 8.44%、`useHistoryResultOps.ts` 8.42%、`useTimelineDragAndSkeleton.ts` 3.8%。
  3. ⚠️ 给 `UploadQueue.ts` 补真实单测是第四批的独立任务，本批只装"防回退棘轮"。
- **数据来源**：`coverage/coverage-summary.json`（若过期先跑 `npm run test:coverage` 重新生成）。

### 3-4. 依赖位置与小修

- `package.json:63`：`@vitejs/plugin-vue` 从 `dependencies` 挪到 `devDependencies`（仅构建配置引用，零运行时引用）。
- `vite.config.ts`：`server.strictPort` 改为 `true`——当前 `false` 与注释及 `src-tauri/tauri.conf.json:8` 硬编码的 `devUrl: http://localhost:1420` 矛盾，端口被占时 `tauri dev` 会静默白屏。改 `true` 后端口冲突直接报错，可诊断。

---

## 暂缓·单独立项（本计划不执行，仅登记）

以下动作面大或需回归验证，每项应单独立项、单独排期，不要混进上面三批：

| 项 | 内容 | 为什么暂缓 |
|---|---|---|
| A | ~~`src/core/UploadQueue.ts` 补齐 `UploadQueueManager` 单测（当前 8.44%）~~ **已于 2026-08-13 完成**，见本文件底部记录 | 上传主链路核心，需要认真设计用例，不是顺手活 |
| B | `FavoritesView.vue` 接入虚拟滚动（复用 `useVirtualTimeline`） | 涉及布局与滚动行为，需人工视觉验收 |
| C | Rust `reqwest` 0.11 → 0.12 升级（`src-tauri/Cargo.toml:26`），连带消除 hyper 0.14 / h2 0.3 / EOL 的 rustls 0.21 | API 有破坏性变更，需全量回归所有网络功能 |
| D | .vue 500 行口径统一：`AGENTS.md` 与 `eslint.config.mjs:42`（`skipBlankLines/skipComments`）二选一对齐；6 个超标文件 style 块外置（照 `timeline-jumping.css` 先例）；`UploadView.vue` 449 行 script 拆 composable | 涉及制度决策（口径选哪个）需用户拍板 |
| E | `main.rs`（2688 行）拆 `cookie_monitor` / `tray` / `secure_key` 模块 | 纯结构重构，需完整回归 |
| F | `server_upload_*` 17 个函数与 `commands/*` 双份图床实现收敛 | 动作最大，需先设计共享抽象 |
| G | 镜像 fallback 三处复制抽 `useMirrorSrcFallback`；`patchConfig` 统一配置写入口 | 与 2-2 有交互，等第二批落地后再做 |
| H | `tests/`、`scripts/` 纳入 tsc/eslint 覆盖（当前既不 lint 也不类型检查） | 存量告警可能较多，需单独清理 |
| I | `docs/reference/api/composables.md` 索引补齐（16/118 收录）+ 修复不可编译示例（`@/composables` barrel 不存在）；`third-party-apis.md` 落后 3 个月需核对 | 文档专项 |

---

## 执行完成后

每批完成时如实报告：改了哪些文件、门禁输出（含失败）、有哪些条目跳过及原因。全部三批完成后，在本文件底部追加执行记录（日期、批次、提交 hash）。

---

## 执行记录

### 2026-08-13 · 第一批（Rust 后端）· 已完成

9 条全部落地，无跳过项。门禁：`cargo check --all-targets` 通过，`cargo test` **264 passed / 0 failed**。

| 提交 | 覆盖条目 | 主要文件 |
|------|---------|---------|
| `cd25352` | 1-1、1-2 | `server/upload_handler.rs`、`commands/nami.rs` |
| `f266019` | 1-3、1-4 | `commands/user_files.rs`、`error.rs` |
| `d5f956c` | 1-5 | `url_policy.rs`、`commands/link_checker.rs`、`docs/flows/link-check-flow.md` |
| `5c84f3b` | 1-6~1-9 | `log_utils.rs`、`commands/link_checker.rs`、`analytics/{mod,heartbeat}.rs`、`server/upload_handler.rs` |

**与原计划的三处偏离**（执行前已与用户确认）：

1. **1-2 超时值**：不是计划写的 60s，改为 `connect_timeout(15s)` + `timeout(300s)`。原因：该 client 同时承载小 JSON 请求与 `upload_part` 的一次性 50MB PUT，且 `upload_part` 没有单请求超时。60s 会在慢网络下打断大文件上传——等于把「永久 hang」换成「上传失败」。
2. **1-5 多改一处**：`2001:db8::/32` 除了并进 `is_private_or_reserved_ip`，**同时**加进 `is_always_blocked_host`。原因：`is_allowed_lan_addr` 拿 `is_private_or_reserved_host` 当白名单条件，只做前者会让 WebDAV 反过来把 `http://[2001:db8::1]/dav` 当局域网 NAS 放行明文凭证——合并判据却放宽了另一侧边界，方向反了。
3. **1-4 多删一个 impl**：`From<&str> for AppError` 与 `From<String>` 缺陷完全相同（都无条件映射 Network），一并删除。`cargo check` 确认两者在业务代码中均为死代码，无编译连锁。

**执行中发现、计划文档未记的两点**：

- 1-7 的 `cleanup_old_temp_files` 调用点有**两处**（`link_checker.rs` 的 `download_image_from_url` 与 `download_url_image`），计划只列了前者。两处已统一走新的 `schedule_temp_cleanup()`。
- 1-9 所在函数里有一个局部变量 `let safe_path = ...`，会遮蔽 `log_utils::safe_path`。加日志时必须先把它改名（已改为 `requested_path`）。

**顺手做了、属同类问题**：`user_files.rs` 两个 async command 里的 `std::fs::{write,read_to_string,metadata}` 一并改 `tokio::fs`（导入路径最大读 50MB）。

**明确未做**（留待另立条目）：`upload_handler.rs:645` 的 `std::fs::canonicalize` 与 `:656` 的 `validate_image_file` 同样是 async 里的同步 IO，但计划未列，且后者会牵出一串 `Result<_, String>` 改造。

**未验**：1-1 的并发冒烟（一边 `POST /upload/file` 大文件、一边 `curl /status`）需要跑起 GUI，本次只做了静态核对——三个 handler 的锁 guard 作用域内均无 `.await`。

---

### 2026-08-13 · 第二批（前端性能与死代码）· 已完成

6 条全部落地，无跳过项。门禁：`npm run lint` 通过、`npm run typecheck` 通过、`npm run test:unit` **193 文件 / 2326 passed / 0 failed**（改动前基线 2315，新增 11 条测试）。

| 提交 | 覆盖条目 | 主要文件 |
|------|---------|---------|
| `0252577` | 2-1 | `useImageDetailCache.ts`、`useHistoryViewState.ts`、`history/useHistoryBulkOps.ts` |
| `dea5d82` | 2-2、2-3 | `useThumbCache.ts`、`favorites/useFavoritesData.ts` |
| `a4435db` | 2-4、2-5、2-6 | `link-check/useCheckFilter.ts`、`timeline/TimelineIndicator.vue`、`config/configInterface.ts` |

**与原计划的四处偏离**（执行前已与用户确认）：

1. **2-1 收益判断被推翻，改动范围扩大**：`prefetchDetails`（含那句 "TODO: 优化为批量查询"）**全库零生产调用点**——唯一引用是测试 mock。按计划字面改它，运行时收益为 0。真正在跑 N+1 的是 `useHistoryViewState.ts:78`（按图床批量复制链接）与 `history/useHistoryBulkOps.ts:34`（批量导出 JSON），两处都在用户选中集上 `selectedIds.map(id => getDetail(id))`。最终在 `ImageDetailCache` 上新增 `getMany(ids)`，三处一并接入。
2. **2-2 不照抄现有失效策略**：计划让"参考 `:223` 现有实现"，但那套 watch 挂在 `initModuleWatchers` 上，**只在 `useThumbCache()` 首次调用时注册**，而全库唯一调用点是 `useTableInteractions.ts:75`（历史表格视图）。时间轴/收藏页走的是 `getMetaThumbnailCandidates` 且从不调用 `useThumbCache()`——照抄会得到一个改配置、切主图床都不失效的脏缓存。改为 **WeakMap 以 meta 对象为键 + 条目内 config 指纹**：镜像变化必然经 DB 重查产生新 `ImageMeta` 对象，天然未命中；配置维度由指纹兜底，与 watcher 是否注册无关。
3. **2-4 前提不成立，改用保语义的等价优化**：计划要求的"选中项必属于 filtered"不变式被四条路径打破——检测完成后 hold 行离场、`applyCurrentFilter` 丢弃 held 行、单行删除（不走 `clearAfterBulk`）、`searchQuery` 被 `CheckFilterBar` 直写而重置守卫挂在 debounced 的 `searchInput` 上。改成计数比较后，"1 个幽灵 key + 漏选 1 行"会让 size 恰好相等而误判为全选，用户点"取消全选"反而清空整个选择。最终保留 `filtered ⊆ selected` 语义，只加 `size < length` 的 O(1) 必要条件短路，并把 `filteredRowKeys` 从 computed 降级为按需调用的普通函数。
4. **2-5 多改一处**：同文件 `onDrag:358` 同样未节流且更重（每次 mousemove 一次 `getBoundingClientRect` + 一个 `emit` 触发父组件滚动），一并接入 rAF。

**执行中发现、计划文档未记的四点**：

- **2-4 的 `filteredRowKeys` 有三个消费点，不是两个**。计划说"只在 shift-range 多选场景按需构建"，但 `toggleSelectAll:402` 也需要全量 keys。另外 `handleToggleSelect` 原本无条件求值它（不管 `shiftKey`），而 `shiftSelect` 的非 shift 分支根本不读 `orderedIds`——普通点击白建一次数万条数组。
- **2-3 需要多改一行**：`useFavoritesData.ts:177` 的 `loadedMetas.value = result.items` 把 DB 查询结果数组直接别名给 ref。改成原地 push 之后，`:198` 会反过来改写 `fetchPage` 返回的数组。已改为 `.slice()` 切断别名。
- **`getMany` 的返回值不能回读缓存**：`DETAIL_CACHE_SIZE = 200`，批量导出选中数超过 200 时先写进去的条目会被 LRU 挤掉。必须从本地 `resolved` Map 构造结果。
- **2-2 顺带补上一个既有缺口**：现有 config watch 只盯 `linkPrefixConfig.enabled` 与 `selectedIndex`，用户编辑当前选中前缀的 URL 模板时那两项都不变 → 微博缩略图 URL 永久陈旧。新的指纹取 `getActivePrefix(config)?.template` 本身，ImageMeta 路径不再有这个问题（HistoryItem 路径的旧缓存未动，缺口仍在，留待单独立项）。

**计划文档勘误**：2-3 写"项目在 `useLinkCheck.ts:290` 已踩过同一坑并留了注释"——`src/composables/useLinkCheck.ts` 只有 3 行 re-export shim，真实注释在 `src/composables/link-check/useLinkCheck.ts:720-727`，且那是**反例**（因跨组件 prop 传递被迫放弃 `triggerRef` 改用引用替换）。正面范式是 `batchMigrate/preloadPending.ts:95-105`。其余条目的行号（2-1 / 2-4 / 2-5 / 2-6）与 `lastJdCheck` 的 ⚠️ 均核实属实。

**补的测试**（原本三处都是零覆盖）：

- `getMetaThumbnailCandidates` 7 条，含引用稳定性契约三条（同 meta+同配置返回同一引用、配置指纹变化重算、换新 meta 对象重算）——**暂缓项 G 的 `useMirrorSrcFallback` 会依赖这个契约**；
- `useCheckFilter` 3 条：空筛选结果时 `isAllSelected` 为 false（`[].every()` 返回 true 的守卫）、计数相等但集合不同时不算全选、shift+click 范围多选；
- 批量取回整体失败与"记录查不到"的分野各 1 条。

**明确未做**（留待另立条目）：

- 历史表格视图那条 `thumbnailCandidatesCache`（`id` 键 + watch 失效）未动。`ThumbnailImage.vue:49` 的 watch 是**按引用**比较的，那个缓存的引用稳定性是它的隐性正确性依赖，动它需要连带验证表格视图；上面提到的"改前缀模板不失效"缺口也还在那条路径上。
- `initModuleWatchers` 只在 `useThumbCache()` 被调用时注册这件事本身没改——本批用不依赖它的方案绕开了，但它对旧缓存仍是隐患。
- `selectedIds` 的幽灵 key 没有剪枝（剪枝本身是 O(n)，且会改变"选择跨提交保留"的现有行为）。本批只保证 `isAllSelected` 不因此误判。

**未验**（需跑起 GUI）：2-2 在真实滚动下的帧率收益、2-5 的拖拽手感与 hover 气泡 1 帧延迟、2-4 在数万行链接检测数据下的实际表现。

---

### 2026-08-13 · 第三批（CI / 构建 / 测试守卫）· 已完成

4 条全部落地，无跳过项（3-1 的 Rust 缓存半边按下述理由**有意不做**）。门禁：`npm run lint` 通过、`npm run typecheck` 通过、`npm run test:unit` **193 文件 / 2326 passed / 0 failed**、`npm run ci:prepush` **首次运行即通过**（未触发已知的覆盖率偶发误报）。

| 提交 | 覆盖条目 | 主要文件 |
|------|---------|---------|
| `c326ece` | 3-1 | `.github/workflows/release.yml` |
| `f768ac7` | 3-2 | `package.json`、`.github/workflows/{ci,release}.yml`、`docs/reference/guides/testing-guide.md` |
| `9ee9879` | 3-3 | `scripts/check-critical-coverage.mjs` |
| `6ddb0e6` | 3-4 | `package.json`、`package-lock.json`、`vite.config.ts` |

计划建议 3 个提交（缓存 / 去重 / 覆盖率），但未给 3-4 安排位置，故拆为 4 个。

**与原计划的三处偏离**（执行前已与用户确认）：

1. **3-2 第 1 条：删 `tsc` 的同时必须给 release 补类型闸门**。计划的 ⚠️ 写「CI 和 prepush 都先跑 typecheck，纯重复」——对 `ci.yml`（typecheck 在 build 之前）和 `ci:prepush` 成立，但 **`release.yml` 全文没有任何 typecheck 步骤**，发版路径唯一的类型检查就是 `tauri.conf.json` 的 `beforeBuildCommand: npm run build` 里那个 `tsc`。字面删除会让发版构建彻底不做类型检查。已在 release job 的 `npm ci` 之后、lint 之前插入 `Type check before release`。副作用是好的：发版路径的类型检查从 `tsc` 升级为 `vue-tsc`，多覆盖 `.vue` 的 props/emits/模板。
2. **3-2 第 2 条：不整步删 `test:unit`，改为加 `if` 条件**。`ci.yml` 的 `test:unit` 无 `if:`、三平台都跑，而 `test:coverage` 带 `if: matrix.os == 'ubuntu-latest'`——**重复只发生在 ubuntu**。引入两者的提交 `2f1b608`（"ci: strengthen test gates"）是同时加的、故意不对称。整步删会让 Windows / macOS 不再跑任何单元测试（对以 Windows 为主要目标的桌面应用尤其糟）。已改为 `if: matrix.os != 'ubuntu-latest'`，每平台恰好跑一遍。
3. **3-1 的 Rust 缓存有意不做**。`release.yml` 只由 `on.push.tags: v*` 触发。GitHub 官方文档明确：「为 tag `release-a` 创建的缓存不能被 tag `release-b` 的运行读取」；而 `Swatinem/rust-cache` 默认 `add-job-id-key: true` 把 job id 编进 key，`release` job 的 key ≠ `ci.yml` 中 `test` job 的 key，所以也读不到 main 上已有的缓存。照抄一份过去 = 永远 0 命中，还会往仓库 10GB 缓存配额里塞 tag 作用域的死缓存，按 LRU 挤掉 main 上有用的那些。npm 缓存半边无此问题（`setup-node` 的 cache key 只含平台 + 架构 + lockfile 哈希，不含 job），能命中 `ci.yml` 在 main 上存下的缓存，收益是实的——故只补 npm 缓存。

**计划文档勘误**（执行中核实，共 5 处）：

- **3-3 的覆盖率数字并未过期**。`coverage/coverage-summary.json` 的 LastWriteTime 是 `2026-08-13 10:32:39`，晚于当时的 HEAD `e01a4f1`（10:26:28）且工作区干净，已包含第二批新增的 11 条测试。重跑 `test:coverage` 后确认：8.44% / 8.42% / 3.8% 三个数字与文档完全一致（新测试没碰这三个文件），total 为 lines 83.44 / functions 76.18 / branches 81.36。
- **守卫脚本有两个静默通过的洞**。`check-critical-coverage.mjs` 原第 45-46 行：某指标 key 缺失时 `实际值 < undefined` 恒为 `false` → 该指标**完全不检查且无任何提示**。新增条目若漏写一项，棘轮等于没装。已加名单自检（缺项直接报错退出，超出计划字面的加固）。另一个洞是 `:35` 的 `endsWith` + `.find()` 取首个匹配、无唯一性校验；已实测当前 9 个目标各命中恰好 1 条 coverage 条目，暂无歧义，未改。
- **三个新条目的 `branches` 现值 100% 是假象**，分母分别只有 2 / 1 / 0。设成接近 100 的阈值会在真补测试、分母变大时立刻误报，故一律设 0，并在脚本注释里写明原因。
- **`vitest.config.ts` 拦不住这三个洼地**。它已有全局阈值 + 6 组 glob 阈值，其中 `src/{utils,services,core,composables,uploaders}/**` 要求 lines 70——但 vitest 的 glob 阈值是**聚合**比较，靠组内高覆盖文件把均值拉过线。这正是逐文件的 `check-critical-coverage.mjs` 存在的意义。本批**未动** `vitest.config.ts`（它是已知覆盖率偶发误报的来源，无必要不碰）。
- **`useTimelineDragAndSkeleton` 被 `vi.mock` 挡着**。`tests/unit/components/timelineComponents.spec.ts:194` mock 掉了整个模块，3.8% 的 10/263 行只是 mock factory 求值的残留，functions 0/1 意味着真实函数体一次都没跑过。**将来补测试必须写在别的 spec 文件里直连真实实现**，否则覆盖率不会动。

**顺手做了、属同类问题**：`ci.yml` 的步骤名 `Build (tsc + vite)` 改为 `Build (vite)`（否则名字与实际命令不符）；`docs/reference/guides/testing-guide.md:119`、`:150` 同步 CI 步骤清单（原文写「前端：typecheck、lint、build、test:unit」已不准确）。

**3-3 阈值明细**（存量 6 个 = 当前值 − 5pp 向下取整；新增 3 个 = 略低于当前值，留 1~3pp 余量以免文件长大时因分母变化误报）：

| 文件 | 当前 lines/stmts/funcs/branches | 新阈值 |
|------|------|------|
| `useGlobalShortcut.ts` | 86.73 / 86.73 / 100 / 61.03 | 81 / 81 / 95 / 56 |
| `useClipboardImage.ts` | 97.84 / 97.84 / 100 / 82.14 | 92 / 92 / 95 / 77 |
| `useCompressionTask.ts` | 100 / 100 / 100 / 67.64 | 95 / 95 / 95 / 62 |
| `useImageLoadManager.ts` | 96.24 / 96.24 / 100 / 88.23 | 91 / 91 / 95 / 83 |
| `NamiUploader.ts` | 97.87 / 97.87 / 100 / 88.23 | 92 / 92 / 95 / 83 |
| `ImgurUploader.ts` | 100 / 100 / 100 / 94.11 | 95 / 95 / 95 / 89 |
| `UploadQueue.ts`（新） | 8.44 / 8.44 / 10 / 100(2÷2) | 7 / 7 / 5 / **0** |
| `useHistoryResultOps.ts`（新） | 8.42 / 8.42 / 20 / 100(1÷1) | 7 / 7 / 15 / **0** |
| `useTimelineDragAndSkeleton.ts`（新） | 3.8 / 3.8 / 0 / 100(0÷0) | 3 / 3 / 0 / **0** |

> ⚠️ 本批把这 6 个文件的阈值从统一的 35 提到 81~95，覆盖率偶发误报时的敏感面比以前大。补救方式不变：**先原地重跑一次**，不改代码、不 `--no-verify`。

**已在本地验证的部分**：

- `npm run build` 去掉 `tsc` 后单独跑通，4 个入口（`index` / `login-webview` / `login-titlebar` / `tray-menu`）的 HTML 与 JS 均正常产出，耗时 4.62s。
- 守卫脚本三种行为实测：正常通过（exit 0）、阈值超过实际值时拦住并打印差值（exit 1）、漏写指标时报「阈值配置不完整」（exit 1）。
- 4 个 workflow YAML 用本地 `yaml` 包解析通过；`ci.yml` 的 `test` job 步骤序列确认 `test:unit`（`if: matrix.os != 'ubuntu-latest'`）与 `test:coverage`（`if: matrix.os == 'ubuntu-latest'`）互斥；`release.yml` 的 `Type check before release` 落在 `npm ci`（step 4）之后、`tauri-action`（step 13）之前。
- `package-lock.json` 的 diff 经逐行核对：158 行新增 `dev` 标记 + 17 行 `devOptional` → `dev` + 1 处 `@vitejs/plugin-vue` 归类移动，**零** version / resolved / integrity 变更，无包新增或删除。

**未验 —— 需下次 push 后看 Actions 才能确认**（本批改的是 CI 配置，本地门禁验不出真效果）：

- 3-1 的 npm 缓存是否真命中（依赖 main 上 `ci.yml` 已为对应平台存下 `setup-node` 缓存）。
- 3-2 的 `if: matrix.os != 'ubuntu-latest'` 在真实矩阵里是否按预期只在 win/mac 跑、ubuntu 只跑 coverage。
- 3-2 给 `release.yml` 新增的 `Type check before release` **要真打一个 tag 才会执行到**，本地只能靠 `npm run typecheck` 等价验证（已通过）。
- 本地无 `actionlint`，YAML 检查只到语法层，不校验 Actions 语义（表达式求值、step 依赖）。

**明确未做**（留待另立条目）：

- 给 `UploadQueue.ts` / `useHistoryResultOps.ts` / `useTimelineDragAndSkeleton.ts` 补真实单测——即暂缓项 A，本批只装防回退棘轮。
- 守卫脚本 `endsWith` 匹配的唯一性校验未加（当前无歧义，但 `src/components/UploadQueue.vue` 与 `src/core/UploadQueue.ts` 同名不同扩展，将来若出现同名 `.ts` 会静默取错文件）。
- `vitest.config.ts` 的 glob 聚合阈值未改（见勘误第 4 条）。
- `vite.config.ts` 的 `server` 段有一段 3 空格缩进的历史异常（与文件其余 2 空格不一致），属无关改动未动。

---

### 2026-08-13 · 第三批补遗 · 本地打包路径的类型闸门

第三批 3-2 把 `npm run build` 从 `tsc && vite build` 削成 `vite build`，并给 `release.yml` 补了显式的 `Type check before release` 步骤兜底。但 `src-tauri/tauri.conf.json:7` 的 `beforeBuildCommand` **同样指向 `npm run build`**——该路径当时未被识别，结果是：开发者在本地直接 `npm run tauri build` 出包时，**一次类型检查都不做**。

`pre-push` 钩子里的 `ci:prepush` 确实跑 `typecheck`，正常提交流程绕不过去；缺口只在「不 push、本地打包直接分发」这一种用法上。已把 `beforeBuildCommand` 改为 `npm run typecheck && npm run build`。

**为什么不顺手删掉 `release.yml` 的显式步骤**（即：有意保留这一处重复）：

改完之后发版路径确实有了双重闸门（显式 step + `tauri-action` 内的 `beforeBuildCommand`）。之所以不合并成一处，是风险不对称——`release.yml` 只有真打 tag 才会执行到，改错了要等到下次发版才暴露；而纯加法的 `beforeBuildCommand` 改动本地就能验完。重复的代价实测只有约 8 秒（见下），远小于把已验证的发版闸门推倒重来的风险。**后续若有人想消重，请删 `beforeBuildCommand` 里的 `typecheck` 而不是删 `release.yml` 的步骤**，因为前者失败位置在 `tauri-action` 内部、日志更深。

**验证**（`beforeBuildCommand` 在 Windows 上由 `cmd /C` 执行，故直接按该字符串原样测，不用 bash 近似）：

| 场景 | 结果 |
|------|------|
| 正常链式执行 `cmd /C "npm run typecheck && npm run build"` | exit 0，4 个入口产物正常，总耗时 12.97s（typecheck 约 8s） |
| 注入类型错误（临时 `src/__typecheck_probe.ts`，`const x: number = 'str'`） | 报 `TS2322` 后 exit 非 0，且输出中**无任何 vite 行**——`&&` 正确短路，`vite build` 完全未执行 |
| `npm run lint` | exit 0（确认 `check-cross-language-constants.mjs` 不涉及该配置项） |

探针文件测完即删，`git status` 已确认工作区只剩 `tauri.conf.json` 一处改动。

**未验**：`npm run tauri build` 全流程未实跑（Rust 编译耗时长），但 `beforeBuildCommand` 的语义就是「在 cargo 构建前执行该 shell 命令」，上表已按 Tauri 实际使用的 shell 验过该字符串的两种行为，剩余风险仅在 Tauri 是否调用该字段本身——而这未被本次改动触及。

---

### 2026-08-13 · 暂缓项 A 落地 · UploadQueueManager 单测

第三批只给 `src/core/UploadQueue.ts` 装了防回退棘轮（7/7/5/0），棘轮防跌不催涨，洞还在。本次补齐单测并把棘轮抬到实测新值。

**覆盖率变化**（`npm run test:coverage` 逐文件实测）：

| 文件 | 补测前 lines/stmts/funcs/branches | 补测后 | 棘轮阈值 旧 → 新 |
|------|------|------|------|
| `src/core/UploadQueue.ts` | 8.44 / 8.44 / 10 / 100(2÷2) | 100 / 100 / 100 / 97.22(105÷108) | 7/7/5/**0** → 95/95/95/**92** |

`branches` 分母从 2 涨到 108——正是上一批注释里预告的「假 100%」现形：补完测试后百分比反而从 100 掉到 97.22。所以阈值按实测新值重新定线，没有沿用旧数字。取值沿用本文件既有约定（当前值 − 5pp 向下取整），`UploadQueue.ts` 同时从「低覆盖核心文件」组移入「存量高覆盖文件」组。

剩下 3 个未覆盖分支是取不到的防御性兜底：`UploadQueue.ts:311` 的 `latestItem ? ... : {}`（几行前刚 `getItem` 成功，中间没有删除时机）、`:395-397` 的 `weiboProgress ?? 0` 与 `r2Progress ?? 0`（`addFile` 必定把这两个字段初始化为 0）。为把百分比凑到 100 而伪造畸形队列项，只会让用例看起来像在测不存在的场景，故不做。

**新增** `tests/unit/core/uploadQueueManager.spec.ts`（75 条用例，按 `addFile` / `updateServiceProgress` / `markItemComplete` / `markItemFailed` / `createProgressCallback` / `resetItemForRetry` / `resetServiceForRetry` / `trimQueue` / 队列基础操作 / 多项并发隔离 十组拆分）。

覆盖率能从 8.44 一步到 100，是因为此前**全库没有任何 spec 实例化过 `UploadQueueManager`**——相关的 4 个 spec 只 import 了 `QueueItem` / `ServiceProgress` 类型。也没有任何 spec 用 `vi.mock` 遮挡该模块，所以本次直连真实实现，未引入替身。

`tests/unit/factories/uploadFactory.ts` 只做加法：`QUEUE_SERVICE_STATUS`（状态文案常量）、`createUploadedServiceProgress`、`createFailedServiceProgress`、`createLegacyQueueItem`。既有导出零改动，引用该工厂的其余 spec 不受影响。

> 加状态文案常量的原因：`UploadQueueManager` 是按状态**文本**判定的（`status === '等待中...'` 判定服务从未启动、`status.includes('失败')` 判定不要收口成完成），而工厂原有的 `createServiceProgress` 默认状态是英文 `'waiting'`，直接拿来构造前置状态会静默走不到目标分支。

**测试写法上的一处取舍**：`updateServiceProgress` 对 error/success 项请求改写整体状态的那两个分支，无法从最终状态观察到——`useQueueState.flushPendingUpdates` 对 error/success 项会整体丢弃节流队列（见 `docs/reference/troubleshooting/upload-queue-status-race-condition.md`）。这两条改为 spy `updateItemThrottled` 断言提交给节流层的 payload，并额外断言「守卫确实把它丢了」，等于把这层竞态保护也钉住了。

**顺带发现的现状（未修，仅记录）**：`resetItemForRetry` 清得掉顶层的 `weiboLink` / `r2Link`（显式传 `undefined`），却清不掉 `serviceProgress[x].link` 与 `.error`。原因是 `useQueueState.updateItem` 对 `serviceProgress` 做深度合并（`{...currentProgress, ...value}`），而重置用的新等待态对象里根本没有 `link` / `error` 键，合并后旧值原样留存。后果：全量重试若在某个图床上再次失败，该图床的进度表里仍挂着上一轮的成功链接，与顶层字段行为不一致。已用一条明确标注「现状记录、非期望行为」的用例钉住当前行为，修复留待另立条目。

**门禁**：`npm run lint`、`npm run typecheck`、`npm run test:coverage`（194 文件 / 2401 用例全绿，关键文件覆盖率检查通过）、`npm run ci:prepush` 均 exit 0。

**未做**：

- 上一批记录里与 A 并列提到的另两个文件（`useHistoryResultOps.ts`、`useTimelineDragAndSkeleton.ts`）不在本次范围，棘轮仍是 7/7/15/0 与 3/3/0/0。
- `vitest.config.ts` 的 glob 聚合阈值未动（逐文件断言归 `check-critical-coverage.mjs` 管，且该文件是已知的覆盖率偶发误报来源）。
- 上面那条 `resetItemForRetry` 的链接残留未修——本次是补测试任务，改生产代码超出范围。
