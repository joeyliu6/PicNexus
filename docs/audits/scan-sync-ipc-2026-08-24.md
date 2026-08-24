# 存量扫描：sync + ipc 两模块（2026-08-24）

> 来源：`/scan-bugs` 存量扫描，Claude 侧「意图一致性」视角——只查**文档/注释声明的行为 vs 代码实际行为**的偏差，
> 不做对抗性构造反例（那是 Codex 侧孪生版的活，两侧结论应互补）。
>
> 选这两个模块的理由：`sync` 是模块地图里唯一「已知历史坑」为空、从未被专项审过的模块，且出错代价是数据丢失；
> `ipc` 的参数名笔误已被 `scripts/check-invoke-args.mjs` 守住，但**语义**（单位/错误码/可选性/默认值）无人守护。
>
> 所有 file:line 为 2026-08-24 快照，写入本文前已逐条回源码二次核对。

## 给执行 AI 的总纪律

沿用 [fix-plan-2026-08-13.md](./fix-plan-2026-08-13.md) 的「总纪律」全文（先 grep 再动手、按批次顺序、
每批跑 `npm run lint` + `npm run typecheck`、原子提交且 commit 前经用户确认、行为变化同步改 `docs/flows/`）。
本文只补一条：

- **P0 两条都改的是错误路径，改完必须有单测钉住**。这两处恰恰是「人工点不出来、只有单测能守」的地方：
  P0-1 要造一个 0 字节 / 非数组的云端文件，P0-2 要让 Rust 侧报错。现成 spec 文件已存在，往里加用例即可。

---

## 批次 P0：会静默丢数据 / 让用户完全看不懂报错

### P0-1 「云端数据不可用」判定不完整，合并/增量/双向同步会静默用本地覆盖云端

- **置信度**：🔴 已验证（代码路径确定成立；触发需要一个空或非数组的云端 `history.json`）

- **问题（大白话）**：
  「同步」这个动作是两步：**先把云端拉下来跟本地合并，再把合并结果整份推回云端**。第二步是覆盖式写入
  （`putFile`），所以第一步只要没真正读到云端数据，第二步就等于「拿本地那份把云端清了」——只存在于另一台
  设备的记录会被抹掉，而界面还报「已同步」。

  作者其实想到了这一点，`HistorySync.ts:331-334` 专门写了注释：*「只容忍『文件不存在』（404 / 路径不存在），
  其他错误必须抛出，让外层 catch 标记 failed 并提示用户，避免覆盖云端」*。但这道闸门只拦得住**抛异常**的情况。
  有两种情况根本不抛异常，直接从闸门底下溜过去：

  1. `getFile` 返回**空字符串**。`src/utils/webdav.ts:233` 是 `return response.body ?? ''`，
     而 Rust 侧（`src-tauri/src/main.rs:2255-2263`）只有 GET 才填 body，`response.text()` 对 0 字节文件
     返回 `""`。于是 `if (content)` 判 false，和「文件不存在」走同一条路。
  2. `JSON.parse` 成功但**不是数组**。`if (Array.isArray(parsed))` 判 false 后**什么都不做**，
     `cloudItems` 保持 `[]`，代码继续往下走。

- **位置**（三处同构，必须一起改）：
  - `src/composables/backup-sync/HistorySync.ts:85-91`（`uploadHistoryMerge`）
  - `src/composables/backup-sync/HistorySync.ts:152-158`（`uploadHistoryIncremental`）
  - `src/composables/backup-sync/HistorySync.ts:320-329`（`syncHistory`，危害最大：它还先做了本地合并再上传）

- **同一判定在本仓库有三套口径**（这是判定它是缺陷而非设计的关键证据）：

  | 路径 | 云端内容为空串 | 云端内容非数组 |
  |------|---------------|---------------|
  | `downloadHistoryOverwrite` (`HistorySync.ts:226-234`) | `throw '云端历史记录文件不存在'` | `throw '云端数据格式错误：期望数组格式'` |
  | `downloadHistoryMerge` (`HistorySync.ts:268-276`) | `throw` | `throw` |
  | `syncConfig` (`ConfigSync.ts:204-206`) | 静默跳过 ⚠️ | `throw '云端配置文件内容格式无效'` |
  | `syncHistory` / `uploadHistoryMerge` / `uploadHistoryIncremental` | 静默跳过 ⚠️ | 静默跳过 ⚠️ |

  配置链路已经做对了「非法内容必须抛」，历史链路两种形态都没做。

- **修法**：把「拿不到云端数据」拆成三态，只有第一态允许继续走全量上传：

  1. `getFile` 返回 `null` → 云端文件不存在（404），**首次同步的正常路径**，`cloudItems = []` 继续。
  2. 返回 `''` → 云端文件存在但是空的 → `throw new Error('云端历史文件为空，已中止以避免覆盖云端数据')`。
  3. `JSON.parse` 出来非数组 → `throw new Error('云端数据格式错误：期望数组格式')`（复用 `downloadHistoryMerge` 的现成文案）。

  三处逻辑一模一样，抽一个 `parseCloudHistory(content: string | null): HistoryItem[]` 放进
  `backupSyncUtils.ts`，三个调用点共用——三处各写一遍正是当前口径漂移的成因。
  抛出的错误会被现有的 `catch (downloadError)` 接住，`isWebDAVNotFoundError` 对这两句文案都返回 false，
  自然会往外抛并走到「同步失败」分支，**不需要额外改错误处理**。

- **验收**：
  - 单测（`tests/unit/composables/backup-sync/historySync.spec.ts`，现成文件）新增 6 个用例：
    `syncHistory` / `uploadHistoryMerge` / `uploadHistoryIncremental` ×（`getFile` 返回 `''`｜返回 `'{"items":[]}'`）
    → 断言 `putFile` **未被调用**、`updateHistorySyncStatus` 收到 `'failed'`。
  - 回归保护：`getFile` 返回 `null` 的用例必须仍然走全量上传（别把首次同步一起堵死）。
  - 命令：`npx vitest run tests/unit/composables/backup-sync/historySync.spec.ts`

- **⚠️ 踩坑点**：
  - **现有测试给了假安全感**。`historySync.spec.ts:249` / `:267` / `:347` 三个用例覆盖的是「非 404 WebDAV
    错误必须中止」——即**抛异常**那条路；`:285` 覆盖非数组，但只测了 `downloadHistoryOverwrite`（本来就 throw 的那条）。
    合并/增量/双向三条路径上的空串与非数组，一个用例都没有。别看到「已有中止测试」就以为守住了。
  - 别顺手把 `ConfigSync.ts:198` 的空串分支也改成 throw 而不加测试——配置链路的 `hasCloudData` 标志位
    还联动着 `needsReload` 和外层 catch 的两套 toast 文案（`ConfigSync.ts:252-254`、`261-269`），改动面比历史链路大。
    建议本批只修历史链路，配置链路的空串问题单开一条。

---

### P0-2 `invoke` 抛出的 AppError 是普通对象不是 `Error`，两条链路把它硬转成了 `[object Object]`

- **置信度**：🔴 已验证（触发条件是「网络断了 / WebDAV 服务器连不上 / 请求超时」，即最常见的失败路径）

- **问题（大白话）**：
  Rust 命令报错传到前端时，**不是**一个 JS 的 `Error` 对象，而是一个普通对象
  `{ type: 'WEBDAV', data: { message: '无法连接到 WebDAV 服务器，请检查 URL 或网络' } }`
  （`src-tauri/src/error.rs:11-12` 的 `#[serde(tag = "type", content = "data")]`）。
  前端要用 `getErrorMessage()`（`src/types/errors.ts:114`）才能把里面的中文取出来。

  图床上传那边 15 个以上的文件都老老实实这么做了。唯独**备份同步的 WebDAV 链路**和**图片压缩链路**
  用的是 `error instanceof Error ? error.message : String(error)`——AppError 对象不是 `Error` 实例，
  于是走 `String(对象)`，结果就是 `"[object Object]"`。Rust 侧精心写的那几句中文错误，一个字都到不了用户面前。

- **位置**：
  - `src/utils/webdav.ts:188-192`（`putFile` 的 catch）与 `src/utils/webdav.ts:217-221`（`getFile` 的 catch）
  - `src/composables/useCompressionTask.ts:146`（`errorMsg.value` 直接渲染在
    `src/components/dialogs/compression-preview/CompressionPreviewState.vue:33` 的 `{{ errorMsg }}`）

- **完整传播链**（以「拔网线后点历史同步」为例，已逐跳核对）：

  1. `src-tauri/src/main.rs:2245-2253`：`builder.send()` 失败 → `Err(AppError::webdav("无法连接到 WebDAV 服务器，请检查 URL 或网络"))`
  2. invoke reject 值 = `{type:'WEBDAV', data:{message:'无法连接到…'}}`（普通对象）
  3. `src/utils/webdav.ts:218` → `String(error)` = `"[object Object]"` → `throw new Error("WebDAV 下载失败: [object Object]")`
  4. `backupSyncUtils.ts:47-97` 的 `extractErrorCode`：两条 HTTP 正则无数字可匹配；`ECONNREFUSED`/`ETIMEDOUT`
     等分支全部落空（Rust 早就把 reqwest 错误翻成中文了，英文错误码根本不会出现）；
     `/^[一-龥]/` 测首字符 `'W'` 判 false → 原样返回该字符串
  5. 该字符串同时落到**三个出口**：`toast.error('下载失败', …)`、`writeSyncLog(..., 'failed', errorCode)`
     写进 `sync_log` 表、`updateHistorySyncStatus(profile, 'failed', errorCode)` 持久化进同步状态
     → 设置页的同步状态行、同步日志、用户报障时导出的记录，**全是 `[object Object]`**

- **对照证据**：`src/uploaders/webdav/WebDAVUploader.ts:170` 是同一个 WebDAV 协议的**图床**链路，
  用的就是 `getErrorMessage(error)`。同一个协议两条链路两套错误解析——这与 `sync-flow.md` 里已经记着的
  *「⚠️ `handleWebDAVTest` 绕开了 `fromEncryptedConfig` …改这条链路时两处都要顾到」* 是同一个老毛病的另一面。

- **文档已经把这个症状当「已知现象」记着**：`docs/flows/ipc-command-flow.md` 排查指南
  *「错误 Toast 显示 `[object Object]` ｜ 前端直接打印了 err，没解析 JSON」*。代码里是活的实例。

- **修法**：
  1. `src/utils/webdav.ts` 两处 catch 改用 `getErrorMessage(error)`（`import { getErrorMessage } from '../types/errors'`）。
  2. `src/composables/useCompressionTask.ts:146` 同上。
  3. 更彻底一层：`backupSyncUtils.ts` 的 `extractErrorCode` 开头先过一遍 `getErrorMessage(error)` 再做后续匹配，
     这样将来任何一条漏网的链路都能被兜住。

- **验收**：
  - 单测（`tests/unit/composables/useCompressionTask.spec.ts`、
    `tests/unit/composables/backup-sync/backupSyncUtils.spec.ts`，均为现成文件）：
    mock 的 invoke reject 一个 `{type:'WEBDAV', data:{message:'无法连接到 WebDAV 服务器，请检查 URL 或网络'}}`
    → 断言最终文案**包含该中文**且**不含 `[object Object]`**。
  - 真机：设置里填一个连不上的 WebDAV 地址（如 `https://127.0.0.1:9/`）→ 点「历史记录 - 双向同步」
    → toast 与设置页同步状态行应显示中文原因。
  - 命令：`npx vitest run tests/unit/composables/useCompressionTask.spec.ts tests/unit/composables/backup-sync/backupSyncUtils.spec.ts`

- **⚠️ 踩坑点**：
  - **不能靠 `assertAllowedWebDAVUrl` 兜底**。它（`src/security/networkPolicy.ts:119`）在前端同步抛的是真
    `Error`，所以 URL 格式类错误的文案是好的——正因如此这个 bug 在「填错地址」时看不出来，只在**网络层失败**时暴露。
    验收千万别用「填个非法 URL」来测，那条路是好的。
  - 别顺手给备份链路加 `isLanHttpUnconfirmedError` 逃生舱。已核实 `webdav_request` 走的是
    `validate_webdav_url`（`src-tauri/src/url_policy.rs:387`，同步版），**永远不会**返回
    `WebDAVLanHttpUnconfirmed`；那一档只出自 `validate_webdav_url_for_request`（同文件 :400），是图床链路专用。
  - `src/types/errors.ts:83-96` 的 `validTypes` 目前是 Rust 侧枚举的**超集**（多一个 Rust 不存在的
    `SERVICE_UNAVAILABLE`），所以今天不会漏判。但反向漂移（Rust 加了新 variant 而前端 `validTypes` 没加）
    会让 `isAppError` 返回 false，`getErrorMessage` 一路掉到兜底的 `'未知错误'`——**没有任何门禁守这个**。
    改这块时顺手评估登记进 `scripts/check-cross-language-constants.mjs`。

---

## 批次 P1：口径不一致 / 数字失真（不丢数据，但会误导用户和排障）

### P1-1 历史记录导入有两套合法性谓词，本地导入与云端下载对同一份文件结论不同

- **置信度**：🟡 疑似（两套谓词的差异是逐行比对出的代码事实；要让用户撞上需要非 PicNexus 自己导出的历史文件）

- **问题（大白话）**：判断「这条历史记录合不合法」，仓库里有两把尺子，而且**互相不包含**：

  | 检查项 | `isValidHistoryItem`（`src/config/validators.ts:203-232`，本地导入用） | 内联谓词（`src/services/database/ImportExportService.ts:83-91`，所有导入的底层） |
  |--------|:---:|:---:|
  | `id` 非空 | 要求 | 不查（还会在 `:101-106` 自动补 id） |
  | `timestamp` | 只要是有限数（**允许 ≤ 0**） | 要求 **> 0** |
  | `localFileName` | 只要是字符串（**允许空串**） | 要求非空 |
  | `primaryService` | 只要是字符串（**允许空串**） | 要求非空 |
  | `results` 逐项深度校验 | 要求（`isValidUploadResultEntry`） | 只查 `Array.isArray` |

  调用关系：`useBackupLocal.ts:213` 在调底层导入**之前**先用第一把尺子筛一遍，云端下载路径则直接进底层。

- **两个可观察后果**：
  1. `ImportExportService.ts:101-106` 那段「预处理：确保所有记录都有 ID」的兜底，在本地导入路径上**永远走不到**
     ——前置校验在 `validators.ts:211` 已经把缺 id 的记录整份拒掉了（`useBackupLocal.ts:215` 抛「第 N 条记录格式无效」）。
     同一份文件走云端下载却能进。
  2. 反向：前置校验放行但底层全过滤时（如所有记录 `timestamp` 为 0），用户看到的是
     `'导入数据格式不匹配，请检查文件是否为 PicNexus 导出的历史记录'`（`ImportExportService.ts:94`）
     ——与真实原因（时间戳非法）毫无关系的误导性报错。

- **修法**：以 `isValidHistoryItem` 为唯一真相源，把 `ImportExportService.ts:83-91` 的内联谓词换成它，
  同时把 `isValidHistoryItem` 里 `timestamp` 的条件补成 `> 0`、`localFileName`/`primaryService` 补成非空
  （对齐当前底层的实际行为，避免放宽）。`id` 一项要保留底层的宽松：
  校验**放行**缺 id 的记录，由 `:101-106` 的兜底补 id——这样两条路径行为一致，且不砍掉已有的兼容能力。
  相应地 `useBackupLocal.ts:213` 的前置校验可以简化成「只报第一条不合法记录的序号」，判定本身交给底层。

- **验收**：`npx vitest run tests/unit/services/database/importExportService.spec.ts tests/unit/composables/backup-sync/useBackupLocal.spec.ts`
  ——新增用例：一份缺 `id` 的历史 JSON，本地导入与云端合并下载**结果一致**（都成功且自动补 id）。

- **⚠️ 踩坑点**：`src/config/validators.ts` 是 `src/config/types.ts` 的邻居，属 AGENTS.md「高风险文件」辐射范围
  ——`isValidHistoryItem` 还被别处引用，改它前先 `grep -rn "isValidHistoryItem" src/ tests/` 把消费端列全。
  「收紧 timestamp 到 > 0」这一步尤其要确认没有别的调用方依赖它放行 0。

### P1-2 历史下载的条数文案报的是云端原始条数，不是实际入库条数

- **置信度**：🟡 疑似（文案失真是代码事实；实际偏差幅度取决于云端文件里有多少条过不了校验，PicNexus 自产的文件通常是 0 条）

- **位置**：
  - `src/composables/backup-sync/HistorySync.ts:236` 丢弃了 `importFromJSON` 的返回值（**实际导入条数**），
    `:242-243` 改用 `cloudItems.length`（**解析出的原始条数**）报数并写同步日志。
    中间的 `ImportExportService.ts:83-99` 会静默过滤非法记录，只留一条 `log.warn`。
  - `HistorySync.ts:292` 的 `合并 ${cloudItems.length - addedCount} 条`：把「id 已存在但内容没变、被跳过」的记录
    也算进了「已合并」。真正被 `INSERT OR REPLACE` 的条数在 `ImportExportService.ts:125` 有日志，没往上传。

- **修法**：`importFromJSON` 的返回值接住，toast 与 `writeSyncLog` 都改用它；
  「合并 N 条」改为 `实际导入 - 新增`，或干脆去掉这个数（`notification-patterns.md` 的口径：说不准的数字不如不说）。

- **⚠️ 踩坑点**：`downloadHistoryMerge` 的 `addedCount = countAfter - countBefore`（`:287`）用的是全表计数差。
  云端同步期间主窗口如果还在上传新图，那几条会被算进「新增」——`acquireCloudSync` 只锁云端操作，不锁本地上传。
  改这段时别只换分子不换分母。

---

## 附录：文档与代码的偏差（不占批次，随手可改）

本次扫描的主视角就是「文档说 A、代码做 B」，以下四条是纯文档侧偏差，不影响运行：

| 文档位置 | 声明 | 实际 |
|---------|------|------|
| `docs/flows/sync-flow.md` 图 2（H2/H3 节点） | 历史记录下载有「加密?→解密」分支 | **历史链路完全没有加解密**。`HistorySync.ts` 未 import 任何 crypto；`tryDecryptContent` 经 `BackupCloudDeps` 传进来但从未被使用（只有 `ConfigSync.ts` 用）。云端 `history.json` 始终明文 |
| `docs/reference/architecture/frontend.md:79` | 列出 `useAutoSync.ts # 自动同步` | `src/composables/` 下**不存在**该文件；`sync-flow.md:220` 与 `auxiliary-flows.md:260` 的「useBackupSync / useAutoSync 接口索引」同样失真 |
| `docs/flows/ipc-command-flow.md` 图 3「关键源文件」 | `src/utils/errorHandler.ts` | 该文件不存在，实际是 `src/types/errors.ts` |
| `docs/flows/ipc-command-flow.md` 图 4 事件表 | `link-check://progress` payload 为 `{checked, total, current_url, current_result}` | Rust `BatchCheckProgress`（`src-tauri/src/commands/link_checker.rs:1943-1950`）还有 `batch_id` 与 `recent_results` 两个字段，且前端 `useLinkCheck.ts:459/461` 两个都在用 |

> 第一条值得优先改：一个照着流程图排查的人会以为「历史记录同步失败 = 备份密码不对」，
> 而真实原因永远不在那里。它同时是 P0-1 的背景——正因为历史文件是裸 JSON，
> 「合法 JSON 但不是数组」才成为一个需要单独判定的状态。

---

## 范围外线索（未验证，不定性，仅登记）

- `src/components/views/linkcheck/rescue/RescueBrokenGroups.vue:69` 的
  `catch (err) { toast.error(errorMsg, String(err)) }` 是 P0-2 的同类写法（无 `Error` 判别的裸 `String(err)`）。
  该文件属 md-rescue / link-check 模块，本次未追其是否包裹 invoke 调用。
- `src/App.vue`、`src/components/settings/backup/BackupPasswordSection.vue:167`、
  `src/composables/batchMigrate/migrateCore.ts`、`src/composables/history/useMirrorFallback.ts`、
  `src/composables/link-check/useLinkCheck.ts`、`src/security/crypto.ts` 六个文件同时满足
  「含 `invoke(` 」且「用 `String(error)` 兜底」且「未 import `getErrorMessage`」。
  是否真的会拿到 AppError 对象需逐个追调用点，本次未追。

---

## ⚠️ 定性声明

**本文所有条目均为「疑似」，未经真机验收。** 本项目的经验是：从没在真机跑过的批次是缺陷高发区
（见 `project_audit_pending_batches`），登记 ≠ 确认。P0 两条虽然代码路径已逐跳核对到 🔴，
但「实际触发频率」仍是推断——P0-1 需要一个空或非数组的云端文件才会发作，P0-2 需要网络层失败。
修复后必须补单测钉住，不要只靠人工点一遍就认为闭环。

---

## 执行记录

<!-- 每完成一个任务在此追加一行：日期 / 任务号 / commit / 验收结果 -->

### 2026-08-24 全部条目已修复（未提交）

**动手前先做了一轮前提核实（8 个并行核查），结果推翻了本文原方案的三处**，以下按修正后的方案执行：

| 本文原方案 | 核实结论 | 实际改法 |
|-----------|---------|---------|
| P1-1「把 `ImportExportService` 内联谓词换成 `isValidHistoryItem`」 | ❌ 会引入回归：`isValidHistoryItem` 要求 `id` 非空，而底层**明确支持**缺 id 并自动补；换过去会让那段兼容逻辑变死代码 | 新增 `isImportableHistoryItem`（不要求 id），两条路径共用 |
| P1-1「顺便加 `results` 逐项深检」 | ❌ 是净收紧：导出侧零校验，深检会打破无损往返；更糟的是 replace 模式下被判无效的记录会**连带删掉本地同 id 的行** | 不加深检；深检留给 `isValidHistoryItem`（判「完整形状」，用途不同） |
| P0-1「在 `try` 里 throw」 | ❌ 会被静默吞掉：内层 catch 先过 `isWebDAVNotFoundError`，它是**子串匹配**，文案里出现「文件不存在」/404 就当成「云端没这个文件」继续覆盖 | 置标志位，在 catch 块**之外**抛出，与文案措辞彻底解耦 |

核实还额外挖出一条本文没写的缺陷，一并修了：

- **replace 模式下，一条云端坏记录会静默删掉本地同 id 的完好记录**。`importIdSet` 原本由**过滤后**的
  `items` 算出，坏记录的 id 不在其中 → 本地那行落进删除集被 `DELETE`。它既没被 INSERT 覆盖过，
  也没有任何提示。改为「云端整份 payload 里出现过的 id 都认领」，replace 语义不变。

**改动清单**

| 文件 | 改了什么 |
|------|---------|
| `src/utils/webdav.ts` | `putFile` / `getFile` 的 catch 改用 `getErrorMessage`（P0-2 真正的根因点） |
| `src/composables/useCompressionTask.ts` | `errorMsg` 改用 `getErrorMessage` |
| `src/composables/backup-sync/backupSyncUtils.ts` | 新增 `parseCloudHistoryForUpload` 三态解析；`extractErrorCode` / `isWebDAVNotFoundError` 改用 `getErrorMessage` 兜底 |
| `src/composables/backup-sync/HistorySync.ts` | 三个上传点改用三态解析 + 标志位中止；下载条数改用真实导入统计 |
| `src/composables/backup-sync/ConfigSync.ts` | `syncConfig` 对 `rawContent === ''` 中止（`null` 仍走首次同步） |
| `src/composables/backup-sync/useBackupLocal.ts` | 移除分叉的前置校验，判定权归底层；条数改用真实统计 |
| `src/config/validators.ts` | 新增 `isImportableHistoryItem`，与 `isValidHistoryItem` 分工写进 doc |
| `src/services/database/ImportExportService.ts` | 共用谓词；修 replace 删除窗口；返回 `HistoryImportResult` |
| `src/services/database/HistoryDatabase.ts` | `importFromJSON` 签名与类型再导出 |

**测试**（新增 2 份 spec + 4 份扩充，共 +47 条）

- `tests/unit/composables/backup-sync/cloudPayloadAndErrors.spec.ts`（新）——
  `parseCloudHistoryForUpload` / `extractErrorCode` / `isWebDAVNotFoundError` 此前**零真实覆盖**
- `tests/unit/config/historyValidators.spec.ts`（新）—— 谓词此前**零真实覆盖**（唯一消费端 spec 把它整个 mock 掉了）
- `historySync.spec.ts` —— 6 条「拒绝覆盖云端」+ 1 条「首次同步仍全量上传」反向回归
- `configSync.spec.ts` —— 空文件中止 + null 首次同步
- `importExportService.spec.ts` —— replace 模式保住坏记录对应的本地行
- `webdav.spec.ts` / `useCompressionTask.spec.ts` —— AppError 对象解包
- 两份 spec 里手抄的 `isWebDAVNotFoundError` 副本（已漏 `/file.*not.*exist/i`）换成 `vi.importActual` 真实现

**非空断言验证**：把 `src/` 临时 stash 回 HEAD 后重跑，新断言在旧代码上失败 6 条（P0-1）+ 31 条（P0-2/谓词），
确认不是空断言。

**门禁**：`npm run lint` ✅ ／ `npm run typecheck` ✅ ／ 全量单测 3050 通过 0 失败（219 文件）✅ ／
`npm run test:coverage` 关键文件覆盖率检查通过 ✅（`webdav.ts`、`validators.ts` 均 100%）。

**✓ 真机验收（2026-08-24，dufs 本地 WebDAV @127.0.0.1:4919，portable 隔离数据）——4 场景全过**

| 场景 | 云端前置 | 实测结果 | 判定 |
|------|---------|---------|------|
| 排障 1「云端 0 字节」 | `history.json` 0 字节 | 双向同步中止；云端文件逐字节未变；日志 failed「云端历史文件为空，已中止…请改用强制覆盖云端」 | ✅ 盘/库/日志三绿 |
| 排障 2「合法 JSON 非数组」 | `{"items":[]}` | 中止；云端 43 字节未变；日志 failed「云端历史数据格式错误：期望数组格式，已中止…」 | ✅ |
| 反向回归「首次同步」 | 云端无文件（404） | 正常全量上传 2 条；坏记录不入库；日志 success | ✅ 成功路径未误伤 |
| P0-2「服务器不可达」 | dufs 关停 | toast 与 sync_log 均为中文「无法连接到 WebDAV 服务器」，**无 [object Object]** | ✅ |

附加验证：本地导入种子（2 好 + 1 坏）→ 日志「新增 2 条，共 2 条，**跳过 1 条格式无效记录**」，
坏记录 `qa-invalid-gamma` 未入库、未上传——P1「跳过数上抛」修复真机生效。
验收完成后已清理 dev 实例与 portable 隔离数据目录（`src-tauri/target/debug/data/`）。

### 2026-08-24 二次审查修复（/code-review 发现 2 条正确性问题 + 2 个探针，已处理）

| 发现 | 核实 | 修法 |
|------|------|------|
| **P1 `results:[null]` 会崩**：`isImportableHistoryItem` 只查 `Array.isArray`，`[null]` 放行后在 `DataTransformer.deriveResultColumns` 被 `isUsableMirror(null)` 访问 `r.status` 抛 TypeError；导入无事务，>500 条会先写几批再崩 | 属实。`isUsableMirror`（historyResults.ts:27）确实 `r.status`。这条路径在我谓词统一前只存在于云端下载，被我扩展到了本地导入 | ① `isImportableHistoryItem` 加「results 条目必须非空对象」（只拒非对象，不做完整形状深检，保住无损往返）；② `deriveResultColumns` 加运行时容错（跳过 null/非对象）——防止 DB 里已被第三方污染的坏行在重存时崩 |
| **P1 重复 id**：载荷含两个同 id 时都计「新增」，`INSERT OR REPLACE` 只留一行；且 SQLite 对多行同 id 保留**最后一行**，输入序「新后旧」会让旧记录覆盖新记录 | 属实，且我的新增统计把数字放大了 | 导入前按 id 用 `mergeHistoryItem` 折叠去重，结果与输入顺序无关；`skipped` 改用独立计数（不能用 `parsed.length - items.length`，会把去重误算成跳过） |
| **两个探针文件** `__scratch_refute.spec.ts` / `__tmp_dup_probe.spec.ts`（含 console.log、恒真断言，被 Vitest 自动收集） | 属实 | 已删除 |

新增回归：`historyValidators.spec`（5 条非对象条目拒绝）、`importExportService.spec`（重复 id 去重 + 计数 + 落库为较新版本）、`dataTransformer.spec`（null/原始值容错）。
门禁：typecheck / lint / 全量单测 **3059 通过 0 失败** ✅。

### 2026-08-24 第三轮 · 自我再审（逐行过 src + tests 全 diff）

- **核对通过的关键点**：四个中止点（三历史 + 一配置）的 throw 都在内层 catch 之外，绕开
  `isWebDAVNotFoundError` 子串匹配；配置空文件用 `=== ''` 判定，`null`（首次同步）不误伤；
  空数组 `[]` 是合法数据不中止（`parseCloudHistoryForUpload` 只拦 0 字节与非数组）；
  `importFromJSON` 无残留把返回值当 number 的调用方；`results:[null]` 三道防线
  （谓词拦截 + `deriveResultColumns` 容错 + 真机验证）闭环。
- **发现并修正一处文档/代码不一致**：`CLOUD_DATA_ABORT_MARKER` 注释声称 ConfigSync 的 toast
  据此不拼后缀，但配置实际用另一短语 `已中止同步以避免…` 且根本不调用该判定。已把配置空文件
  文案收进共享常量 `CLOUD_CONFIG_EMPTY_REASON`（复用同一标记），注释如实改写，
  并新增不变式测试：三个「已中止」文案都必须命中标记且只命中一次。
- **未改的低危项（登记，非本批）**：`downloadHistoryOverwrite/Merge` 对空串云端会
  `JSON.parse('')` 抛 SyntaxError、toast 显示英文解析错误（下载方向不丢数据，本就中止）；
  云端缺 id 的记录每次同步会换新随机 id（预存量边）；数字 id 只在 replace 删除集归一化、
  merge 查找未归一（人为构造的低频）。

**⚠️ 仍未闭环的一处**：`downloadHistoryOverwrite` / `downloadHistoryMerge` 的 `if (!content) throw`
把「云端文件不存在（null）」和「云端文件是空的（''）」报成同一句「云端历史记录文件不存在」。
下载方向不会丢数据（它只覆盖本地，且本来就中止），所以本批没动，但文案对空文件场景不准确。
