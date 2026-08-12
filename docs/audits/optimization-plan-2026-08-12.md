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
| A | `src/core/UploadQueue.ts` 补齐 `UploadQueueManager` 单测（当前 8.44%） | 上传主链路核心，需要认真设计用例，不是顺手活 |
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
