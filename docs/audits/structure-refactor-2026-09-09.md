# 项目结构整理（2026-09-09）

分支 `refactor/project-structure`，14 个提交，438 个文件改动，净删 1292 行。

## 为什么做

十个月、1450 次提交之后，找东西的成本在涨。具体是三类破口：

| 判据 | 破口 |
|------|------|
| **唯一性**：一个东西只有一个位置、一个名字 | `HistoryDatabase` 有三个入口且导出的符号集互不相同；`upload` 组件横跨两个同名目录；`linkcheck`/`link-check`/`batchMigrate` 三种拼法；`favicon.ico` 与 `icon.ico` 是同一个文件的两份 |
| **就近性**：一起改的东西住在一起 | `history/` 里有十个文件，`useHistory` 却在根目录；上传队列四个组件散在三层目录，每个只有一个消费者 |
| **可寻址性**：指向一个文件的写法要短且稳定 | `@/` 别名早已配好、测试里用了 482 处，源码里只用了 1 处，另外 1079 处在数 `../`，最深六级 |

`src/uploaders/` 三条全满足——每个图床一格、一个 `index.ts` 入口。整理的目标就是把这个柜子的规矩推广出去，**不是换一套新架构**。

横向调研支持这个克制：[PicGo](https://github.com/Molunerfinn/PicGo)（同类）和 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)（大型 Tauri 应用）都是层式结构，没做功能切片。

## 结果

| 指标 | 改造前 | 改造后 |
|------|-------|-------|
| `composables/` 根平铺文件 | 41 | **15** |
| `src/` 里 `../` 形式的 import | 1079 | **0** |
| `@/` 别名使用 | 1 | **1127** |
| 最深相对路径 | 六级 `../` | 无（全别名） |
| `tests/unit/helpers/` | 7 个文件 | **4** |
| `favicon.ico` | 361,102 字节 | **5,117** |
| `src/` 文件数 | 440 | 430 |

覆盖率未覆盖数全程未上升；视觉回归 392 通过；E2E 8 通过。

## 逐批次

1. **路径别名化**——1114 处改写（静态 import 1079、CSS `@import` 25、动态/内联 `import()` 10）。加 ESLint `no-restricted-imports` 防退化，并用探针文件实测过它确实拦得住。
2. **消灭分身**——拆 4 个兼容垫片；三个目录统一 kebab；上传组件链合并；`chips/` 层合并；删空目录 `src/test/` 及其在 lint 脚本里的豁免；favicon 重新生成；测试辅助收敛。
3. **归位**——25 个 composables 进入功能域，新建 `image/`（跟图片本身打交道的能力）和 `service/`（图床可用性与选择）；`storeErrors`/`storeCleanup` 从 `utils/` 移回 `store/`。
4. **死代码**——删 3 条无人调用的链路，每条都追到了它被下线的那次提交。

## 计划调整（到现场后改的主意）

原计划有五处没有照做，理由记在这里，免得下一个人以为是漏掉了：

**1. 数据库入口没有指向实现文件，而是修好了 barrel。** 原计划让 48 个消费者直指 `services/database/HistoryDatabase.ts`。实际发现三个入口的导出符号集不同——正式 barrel 手写的清单落后于实现（少了 `DayStats`、`DayStatsFilter`、两个 `FavoritesMeta*`），所以大家才绕开它走垫片。改成 `export * from './HistoryDatabase'`：永远完整，不需要有人记得同步。直指实现文件的话，下次拆分还会再断一遍。

**2. `migrate/components/` 没有压平。** 原计划把它整个上提。到现场看，`migrate/` 内部按 `components/` + `composables/` 分层是合理的——它是自成一体的功能模块。压平会变成 14 个文件平铺，反而更乱。只去掉了真正多余的 `chips/`（只装 2 个文件却让路径深到六层）。

**3. `utils/` 没有做四分法。** 原计划分成 `utils`/`lib`/`platform`/`messages`。`lib`（有份量的算法）和 `utils`（小函数）的界线是主观的，分完之后找东西要先猜类别。而 `utils/` 的文件名都自解释，也没有 `composables/` 那种"同一个域散在两处"的真问题——37 个平铺是可接受的。只做了 `storeErrors`/`storeCleanup` 归位（那两个修的是方向倒置）。

**4. 三条"方向倒置"的依赖没有修。** `core → composables`、`services → composables`、`utils → services` 确实存在，但修它们要改运行时逻辑（依赖注入或搬模块），风险远高于本次其余的纯移动。而且三个环的回边都是 `import type`，编译期擦除，运行时不构成真循环。留作独立工作。

**5. `useStatusChip` 没有接线，而是删掉了。** 原计划认为它是 `MigrateItemRow` 的重复实现，应该接上去消除重复。实际读代码发现是两种不同的 UI 设计：`getStatusChipMeta` 返回整行一个状态胶囊，而 `MigrateItemRow` 渲染的是圆点 + 按图床的服务徽章。接上去等于把界面从"按图床显示"退回"整行一个胶囊"，信息量反而变少。所以删掉从未落地的那份，改文档描述真实实现。

## 顺带发现的既有问题（不是本次引入）

- **视觉回归有 2 个红灯**：`markdown-repair` 的确认对话框，明暗各一，约 3% 像素差异。已回到改动前的提交实测确认与本次无关。根因是 `86bc7e90 feat(md-rescue): 显示实时替换摘要` 给对话框加了一行，内容变高导致居中后整体上移 26px，基准图没更新。CI 的 visual job 不在 push main 时跑，所以长期潜伏。**待决定**：确认当前 UI 符合预期后更新这两张基准图。
- **`EncryptedStore.ts` 覆盖率 62.2%**（477 行，AES-GCM + 文件 I/O），`instances.ts` 42.9%，`startupFlags.ts` 0%。本次把 `src/store/**` 纳入覆盖率 include 后才可见；不是回归，但现在是被测量的了。
- **`stylelint.config.mjs` 与 `wdio.tauri.e2e.conf.cjs` 不受任何类型检查**（`tsconfig.node.json` 的 include 是手写清单）。试着把前者纳入会产生 5 个 `Config` 类型不匹配的错误，修它们属于独立工作，本次未做。
- **`pre-commit` 在大批量提交时会杀死自己**：Windows 命令行 8191 字符上限让 lint-staged 把文件切成多个 chunk，默认并发执行会同时起多个 `vitest related`，被系统 SIGKILL，表现为"测试失败"实为资源耗尽。已改为 `--concurrent 1`。
- **两处文档描述了从未落地的设计**：`batch-migrate-flow.md` 指向未被调用的 `getStatusChipMeta`，`settings-ui-architecture.md` 指向不存在的 `LinkPrefixEditDialog.vue`。两处都已改成描述真实实现。

## 第七批：Rust 侧 main.rs 减重（本次未做，已于同日单独完成）

> ✅ 已在独立分支完成，`main.rs` 3050 → 644 行，全程 348 个测试通过数不变。
> 落点、四处计划调整与踩到的坑见 [rust-command-relocation-2026-09-09.md](rust-command-relocation-2026-09-09.md)。
> 下面是当时的勘察结论，保留以对照。

`src-tauri/src/main.rs` 3050 行，内联了 **22 个 `#[tauri::command]`**（占全部 77 个的 28.6%），而 `commands/` 目录已有 25 个按域拆好的文件。另外还塞着 Cookie 校验的 8 个私有函数、4 个配置结构体，`fn main()` 本身跨 470 行。

本次未做，因为它与前六批性质不同：前六批是"移动文件 + 改路径"，编译器和测试能完全兜底；Rust 侧要处理模块可见性，且 WebDAV/R2 连接命令的正确性只能真机验证。混在同一个分支会让整体不好回滚。

已勘察的耦合度，供后续参考：

| 分组 | 命令数 | 难度 | 说明 |
|------|-------|------|------|
| WebDAV / R2 连接测试 | 3 | **最适合先做** | 已 grep 确认**不引用 main.rs 的任何私有辅助函数**，只依赖 `R2Config`/`WebDAVConfig`/`WebDAVRequest`/`WebDAVResponse` 四个结构体（1984–2030 行）；`webdav_connection_tests` 测试模块（2772 行）跟着搬 |
| 路径三兄弟 | 3 | 容易但收益小 | 仅约 15 行，只依赖 `portable` 模块 |
| 安全密钥 | 2 | 容易但收益小 | 约 10 行 |
| 系统操作 / CLI / 编辑器服务 | 7 | 中等 | 需要逐个查依赖 |
| Cookie 登录 | 5 | **最难** | 缠着 8 个私有辅助函数（1839–1985 行），多个命令共用 |

另：AGENTS.md 只对 `.vue` 定了 500 行硬指标，Rust 侧无规范——13 个 `.rs` 超过 500 行，占 Rust 总行数 71%。

## 可复用的做法

- **移动文件前先算断链，别等 build 报错。** 批次 2 单独搬 `UploadQueue.vue` 时漏了它的 `./common/InlineEmptyState.vue`——`vue-tsc` 没抓到，一直到 `vite build` 才报。此后每次移动都先跑一遍相对引用完整性检查（解析所有 `./` 与 `../` 说明符，逐条确认目标存在，含后缀补全），批次 3 靠它当场抓到 3 处。
- **改路径 glob 时按清单人工核对，不要靠 grep。** `vitest.config.ts` 把 backup 阈值写成 `{BackupSyncPanel.vue,backup/**}`，按目录名 `settings/backup` 去 grep 是搜不到的。漏改不会让测试变红，只会让那 4 个组件悄悄从 70% 函数阈值掉回 45%。
- **删代码后看"未覆盖数"而不是百分比。** 删掉覆盖率高于平均的死代码，百分比必然下降（本次 87.16% → 87.1%），但那是算术效应。未覆盖数不上升才说明没有代码脱离测试。
- **`sed` 的分隔符不能和正则元字符撞车。** 用 `|` 作分隔符时模式里的 `\|`（或操作符）会失效，替换会静默不生效。
