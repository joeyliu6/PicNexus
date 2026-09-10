# history 模块扫描三缺陷修复记录（2026-08-22）

> 来源：首次 `/scan-bugs history` 主动扫描（意图一致性视角，无 diff 前提）。
> 扫描以 [bulk-delete-predicate-fix-2026-08-22.md](./bulk-delete-predicate-fix-2026-08-22.md)
> 确立的「报实际战果」契约为尺子，发现表格视图的兄弟删除路径未同步对齐，另有
> 时间段统计失效链路缺口与流程图失真。三条同日修复。

## 一句话总结

删除路径全面对齐「报实际战果」契约（单条/整行批量删除按 `rowsAffected`/存在性预查
报实数、陈旧目标静默),并补上删除/清空后时间段统计的刷新，时间轴侧边栏不再残留幽灵月份。

## 缺陷 1：单条与整行批量删除虚报删除数（中优先级）

- **旧状**：`bulkDeleteRecords` 的 toast 报入参条数、`totalCount` 按入参扣减、
  `emitHistoryDeleted` 广播全部入参 id——陈旧目标（已被别处删除）被算进「已删除」，
  且其他窗口收到事件后按 ids 长度再扣一遍（双重漂移）。`deleteHistoryItem` 单条路径同理。
- **依据**：08-22 审计已为 `bulkDeleteHistoryResults`（链接检测路径）定下契约——
  「已不存在的目标不计数也不弹、真正删它的那次操作已经广播过」。同一概念两把尺子。
- **修法**：
  - `HistoryDatabase.delete` 改返回 `boolean`（`rowsAffected > 0`）；
  - `HistoryDatabase.deleteMany` 改为「先查实际存在的 id 再删这批 id」，返回实际删除的
    id 列表（SELECT 与 DELETE 间的理论并发窗口极小，且删的就是查到的批次，报告自洽）；
  - `deleteHistoryItem` / `bulkDeleteRecords` 按返回值报实数、只对真删掉的 id
    扣减/广播；陈旧目标不计数、不弹 toast、不广播，但返回 `true` 让视图移除行
    （与 `bulkDeleteHistoryResults` 口径一致）。
- **行为变化**：目标全部陈旧时批量删除完全静默（行消失即反馈）；部分陈旧时 toast
  报实际条数并在日志留痕。

## 缺陷 2：删除/清空后 timePeriodStats 与 DB 失真（低优先级，状态卫生）

- **旧状**：`sharedTimePeriodStats` 只跟随 `history-updated` 事件刷新（`reloadSharedData`），
  而三条删除路径广播的都是 `history-deleted`/`history-cleared`；`invalidateCache()` 也不
  重置它——删除/清空后这份模块级共享状态与 DB 永久失真，直到下次上传/同步或重启。
- **⚠️ 定性修正（2026-08-22 二次核实）**：扫描报告最初写「时间轴侧边栏残留已删月份」，
  追到消费端后发现**不成立**——侧边栏指示器（`TimelineIndicator` 的 `periods`）吃的是
  `filteredTimePeriodStats`，由 `dayStats` 聚合而来（TimelineView.vue L83-105），
  它响应删除事件会正确更新。`sharedTimePeriodStats` 的唯一真实消费端是 `jumpToMonth`
  的月份存在性校验，而删除方向的失真（stats 比现实**多**月份）没有 UI 入口能点到幽灵
  月份，**现有界面路径下无用户可见症状**。本条实为状态卫生修复：共享状态不再对 DB
  说谎，防止未来新消费者踩坑。原「幽灵月份」验收判据作废（修不修都会过）。
- **修法**：`useHistory.ts` 新增模块级 `refreshTimePeriodStats()`（未加载过则跳过，
  内部自 catch）；单条删除、`bulkDeleteRecords`、`bulkDeleteHistoryResults`
  （仅整条删除时，剥镜像不动 timestamp）、跨窗口 `history-deleted` 处理器均触发重查；
  本地清空与跨窗口 `history-cleared` 直接置空 `sharedTimePeriodStats`。
- **牵连项**：`BulkOpsContext` / `ResultOpsContext` 新增 `refreshTimePeriodStats` 字段。

## 缺陷 3：history-flow.md 图 3 与实现不符（低优先级）

- **旧状**：图 3 写「逐条 historyDB.delete」「emit 'history-updated'」；实际是
  `deleteMany` 单条 IN 删除、广播 `history-deleted`。排查表「删除后列表未更新 →
  检查 history-updated 监听」会把排查带偏。
- **修法**：图 3 节点、缓存表失效条件、排查表事件名全部改为与实现一致，并新增
  「toast 条数与预期不符（陈旧目标契约）」「时间轴侧边栏残留月份」两行排查项。

## 验证

- 单测：全量 216 文件 **2970 条**（较修前 +6）通过。新增用例：
  `useHistory.spec` 单条陈旧目标 / 批量部分陈旧 / 批量全部陈旧 3 条；
  `useHistoryBulkOps.spec` 部分陈旧 / 全部陈旧 2 条（含只广播真删 id 断言）；
  `historyDatabase.spec` `deleteMany` 返回值与陈旧 id 排除 2 条（MockDatabase 补
  `SELECT id ... WHERE id IN` 分支）。
- `npm run typecheck`、`npm run lint` 全过；`npm run test:coverage` 见执行记录。
- 文档同步：history-flow.md（图 3 + 缓存表 + 排查表）。

## 真机验收判据（自动化，Tauri E2E）

验收脚本：`tests/tauri-e2e/scan-history-fix-acceptance.tauri.e2e.cjs`
（`PICNEXUS_ACCEPTANCE=1` 门控，常规 `npm run test:tauri:e2e` 跳过）。
**portable 隔离**：在 `src-tauri/target/debug/data/` 放 `portable.json` 标记，debug 版
应用的全部数据走该目录（`src-tauri/src/portable.rs`），完全不碰真实用户数据；
造数脚本按 SchemaManager 最新 DDL 建库插 6 条 `e2e-*` 记录。

> 2026-09-09 补：当初的造数脚本是临时写的、跑完就删了，导致这条验收 spec 之后一直
> 没法直接重跑（会卡在 `waitForDataRows(6)`）。现已补成常驻脚本
> `scripts/seed-tauri-e2e-portable.mjs`（`--clean` 负责收尾），DDL 从 `SchemaManager.ts`
> 运行时抽取、不留第二份副本。用法见
> [testing-guide.md](../reference/guides/testing-guide.md)。
**⚠️ 验收后必须删掉整个 `target/debug/data/` 目录**，否则以后 `tauri dev` 会静默进入
portable 模式读错数据。

1. **正常批量删除**：表格选 2 行删除 → toast「已删除 2 条记录」。
2. **陈旧行批量删除**（修复 1 的核心场景）：外部 Python 直删 DB 中 1 行（应用收不到
   事件，其行成为陈旧行）→ 全选 4 行删除 → toast 报「3 条记录」（修复前虚报 4）、
   无失败 toast、4 行全部消失、DB 复核 0 行。
   构造要点同 [bulk-delete-predicate-fix-2026-08-22.md](./bulk-delete-predicate-fix-2026-08-22.md)：
   不能在应用内删（跨页事件会把行先摘掉），必须外部删库。

## 真机验收结果（2026-08-22，两条判据全过）

Tauri E2E（wdio + tauri-driver 驱动 debug 版真应用 + portable 隔离库）自动化验收：

1. **判据 1 通过**：表格选 2 行批量删除，toast「已删除 2 条记录」。
2. **判据 2 通过**：外部 Python 直删 1 行构造陈旧行 → 全选 4 行删除 → toast 报
   「3 条记录」（修复前会虚报 4）、无失败 toast、4 行全部消失、DB 复核 0 行。

验收后 `target/debug/data/` 已整体删除（portable 标记 + 测试库），进程验尸无残留。

### 过程中踩到的两个坑（记录备查）

- **portable 首启会弹新手引导**：全新数据目录 = 首次启动，OnboardingDialog
  （「跳过引导|下一步」）会截胡按 `.p-dialog` 找确认框的逻辑。解法：测试开头先点
  「跳过引导」，且确认框查找改为「扫所有 dialog 找含目标按钮的那个」。
- **删空后空态组件未必出现**：`.history-empty-state-wrapper` 等 60s 未显示（空态渲染
  条件与预期不符），但 DB 复核 0 行 + 数据行数归零均通过。断言应锚定「数据行归零」
  而非空态组件。

## 执行记录

- 2026-08-22 修复合入，单测/lint/typecheck/coverage（逐文件棘轮门禁）全绿。
- 2026-08-22 Tauri E2E 自动化验收两判据全过（`PICNEXUS_ACCEPTANCE=1` 门控 spec）。
