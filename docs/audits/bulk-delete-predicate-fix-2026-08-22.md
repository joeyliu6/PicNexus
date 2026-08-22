# 批量删除 / 镜像剥离三缺陷修复记录（2026-08-22）

> 对应 TODO 条目「历史记录批量删除 / 镜像剥离的三处已确认缺陷」（源头登记于
> [optimization-plan-2026-08-12.md](./optimization-plan-2026-08-12.md) 执行记录第 451-455 行附近）。
> 三条缺陷 + 一条牵连项全部修复，另顺手堵上一个新发现的体验漏洞（陈旧行删不掉）。

## 一句话总结

「可用镜像」的判断标准统一成一把尺子（上传成功**且拿到了链接**），批量删除从
「一错全错、数字虚报」改成「按记录隔离失败、报实际战果、视图只移真删掉的行」。

## 缺陷 1：「可用镜像」谓词两边不一致

- **旧状**：`removeMirror` 只看 `status === 'success'`；`stripServiceFromItem` 要求
  `status === 'success' && r.result?.url`。剥完只剩一条「success 但无 url」的镜像时，
  DB 侧保留记录、composable 侧整条删库。
- **定口径的依据**（向严格侧对齐）：严格谓词早已是事实标准——镜像菜单
  `useMirrorFallback`、批量迁移内存筛选 `sourceSelection`、`linkCheckSummary` 重算、
  `switchPrimaryService`（无 url 的目标直接抛错）全部要求 url。没有 url 的
  「成功」结果无法展示、复制、迁移，也接不了主服务的班，判它「可用」没有任何消费端受益。
- **修法**：新建 [src/utils/historyResults.ts](../../src/utils/historyResults.ts) 导出
  `isUsableMirror`（类型守卫，收窄后可直接访问 `result.url`），以下各处全部改为 import 它：
  `stripServiceFromItem`、`removeMirror`、`deriveResultColumns`、`recomputeLinkCheckSummary`、
  `useMirrorFallback`（3 处内联）、`sourceSelection`。
- **牵连项一并对齐**：`deriveResultColumns` 派生的 `success_count` /
  `successful_service_ids` 两列改按严格口径统计（这两列服务于批量迁移 SQL 预筛选，
  旧口径会放进迁不动的记录，且与 `linkCheckSummary.totalLinks` 对不上）；
  `SchemaManager` 两处回填 SQL 加 `COALESCE(je.value ->> '$.result.url', '') <> ''` 同步口径。
  存量行的两列在下次写入时自愈，期间的偏差仅影响「success 但无 url」这种异常记录。
- **行为变化**：`removeMirror` 在剩余镜像全部「无 url」时改为抛错
  「至少需要保留一条可用镜像」（旧文案是"成功镜像"）。UI 正常路径不会触发
  （镜像菜单本就只展示可用镜像），只拦异常数据。

## 缺陷 2：成功 toast 虚报条数

- **旧状**：报入参 `targets.length`，非法 / 不存在 / 未匹配的 target 全被算进「已删除」。
- **修法**：逐记录统计实际生效条数（选中且真实存在于该记录上的 serviceId 数；
  整条删除时随记录一起消失的选中链接同样计入），toast 报这个数。
  已不存在的目标不计数也不弹（见下方「陈旧行」）。

## 缺陷 3：批量删除非原子、失败后内存态脱节

- **旧状**：循环中途抛错直接进 catch——已落库的删除不回滚，`applyChanges`
  （totalCount / dataVersion / 事件广播）整体跳过，内存态与 DB 脱节；
  调用方拿到 `false` 会把整批行留在视图里，包括已经删掉的。
- **为什么不做成真事务**：tauri-plugin-sql 走 sqlx 连接池（默认 10 连接 + WAL），
  跨 `execute` 的 BEGIN/COMMIT 可能落在不同连接上，没有可靠的跨语句事务
  （详见 sql-plugin-no-rw-ordering 的结论）。与其假装原子，不如把「部分失败」做成明确契约。
- **修法**：每条记录独立 try/catch，一条抛错不拖累其余；`applyChanges` 只对真落库的
  部分生效；返回 `BulkResultDeleteReport`（`removedCount` / `resolvedHistoryIds` /
  `failedHistoryIds`），`LinkCheckView.deleteRowsByTargets` 只淡出
  `resolvedHistoryIds` 对应的行，失败的行保留供重试。
- **toast 分层**（按 notification-patterns 决策树）：全成功 → success 报实际条数；
  部分失败 → warn「部分删除失败」（新增 `TOAST_MESSAGES.common.deletePartial`，
  detail 带可重试指引）；全失败 → error 报第一条错误信息（与单条版口径一致）。

## 顺手修复：陈旧行永远删不掉

重构中发现：目标记录已被别处删掉（或选中的 serviceId 已不在记录上）时，若按
「没写库就不算处理」返回，视图会把这条陈旧行永远留在列表里，用户点删除毫无反应。
现在这类目标进 `resolvedHistoryIds`（行移除）但不计数、不弹 toast、不广播事件——
真正删它的那次操作已经广播过了。

## 验证

- 单测：全量 216 文件 2964 条通过；`useHistoryResultOps.spec.ts` 重写 5 条钉现状用例 +
  新增 2 条（部分失败隔离、全失败），`historyDatabase.spec.ts` / `dataTransformer.spec.ts`
  各新增 1 条口径用例。
- `npm run lint`、`npm run typecheck`、`npm run test:coverage`（含 useHistoryResultOps
  95% 关键文件门禁）全过。
- 文档同步：link-check-flow.md（图 5 不变量 + 排查表）、mirror-fallback-flow.md
  （图 3 守卫 + 排查表里一条已失真的旧行）、db-migration-flow.md（回填口径）。

## 真机验收结果（2026-08-22，两条判据全过）

1. **正常批量删除**：用户真机手动验收通过——选 3 条批量删除，toast 报「已删除 3 条记录」。
2. **陈旧行场景**：经 Tauri E2E（wdio + tauri-driver 驱动 debug 版真应用、真数据库）
   自动化验收通过。构造方式：应用打开链接检测列表后，由外部 Python 脚本直接从 SQLite
   删掉 `linkcheck-01.png` 的全部批次记录（应用收不到任何事件，其行成为陈旧行；
   注意**不能**在应用内的历史页删——跨页事件同步会立刻把检测页的行摘掉，陈旧行留不下来）。
   随后选中 1 条陈旧行 + 2 条真实行批量删除，四项断言全过：
   toast「已删除 2 条记录」（陈旧行不计数）、三条选中行全部消失（行数各减 1）、
   无 error toast、DB 复核 02/03 记录数各减 1。验收后数据库已从备份恢复原样。

### 自动化过程中踩到的两个 Tauri E2E 坑（与本修复无关，记录备查）

- **多 webview 窗口 attach 不确定**：应用有主窗口 + 托盘菜单等多个 webview，
  msedgedriver 会话可能连到非主窗口——表象是「`.main-layout` 60s 不出现」而应用日志
  启动全绿。解法：测试开头 `getWindowHandles()` 逐个 `switchToWindow`，
  找到 `document.querySelector('#app .main-layout')` 非空的那个。
- **PrimeVue 对话框按坐标点击会点空**：ConfirmDialog 有进入动画，wdio 元素点击
  （坐标式）可能落在动画途中的空位——click 不报错但 accept 没触发，表象是
  「点了确认但库里一条没删、toast 也不弹」。解法：`browser.execute` 里 DOM 直点，
  并在点击后断言对话框已关闭。
