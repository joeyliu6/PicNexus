# 删除四个从未接进 UI 的同步入口，并让「同步」说实话（2026-09-08）

## 背景

2026-09-07 处理 P1-2 真机复测时发现：审计文档写的判据「点增量上传验证」压根点不了——
设置页「备份与同步」里没有这个按钮。追下去发现 `HistorySync.ts` 里有三个实现完整、
有类型定义、有单元测试，但**全仓没有任何 `.vue` 组件调用**的函数。

本次收口时又查出第四个：配置侧的 `downloadSettingsMerge` 同样是孤儿。

## 事实核对

设置页 [DataItemCard.vue](../../src/components/settings/backup-sync/DataItemCard.vue) 实际只有 3 个入口，
由 [BackupSyncPanel.vue](../../src/components/settings/BackupSyncPanel.vue) 接线：

| 界面上的按钮 | 实际调用 |
|---|---|
| 同步 | `syncConfig` / `syncHistory` |
| 更多 → 覆盖云端 | `uploadSettingsCloud` / `uploadHistoryForce` |
| 更多 → 覆盖本地 | `downloadSettingsOverwrite` / `downloadHistoryOverwrite` |

四个孤儿（`grep` 全仓 `.vue` 零命中）：

| 函数 | 语义 |
|---|---|
| `uploadHistoryMerge` | 合并上传（同步的上半场） |
| `uploadHistoryIncremental` | 增量上传（同步的上半场，与上一条高度重合） |
| `downloadHistoryMerge` | 合并下载（同步的下半场） |
| `downloadSettingsMerge` | 配置合并下载（同步的下半场） |

而 `sync-flow.md` 图 3 画了 5 个分支，含「增量上传」「下载合并到本地」两个界面上不存在的入口。

## 决定：删，不补 UI

理由三条：

1. **补上去会让界面更难用，不是更好用。** 这四个都是「把同步劈成一半」。个人图床客户端里，
   「我要把这台机器的推上去、但坚决不要云端那些」的场景极少见；真需要单向的极端情况，
   「覆盖云端」「覆盖本地」已经兜住了。而「合并上传」和「增量上传」的区别，连开发者都得
   读代码才说得清——菜单每多一项，用户就要多做一次判断。
2. **死代码已经害过人。** P1-2 真机复测就是照着文档里的「点增量上传」去找按钮，白费一轮排查。
3. **真有人提需求再加不迟**，而且到时候能问清他到底要哪种单向。

## 顺带修掉的真缺陷：「同步」在糊弄人

删的过程中发现一件更值得修的事——**更好的反馈埋在死代码里，接线的那条反而在糊弄用户**：

| | 无变化时的表现 |
|---|---|
| `uploadHistoryIncremental`（**没人调用**） | 不写云端，提示「无需上传：本地没有新增或更新的记录」 |
| `syncHistory`（**界面上的「同步」**） | 照样 `putFile`，照样弹「已同步，共 N 条记录」 |

那个 N 是**全表总数**，不是本次变更量。所以一条都没动的时候，用户看到的和真同步了一大批时
看到的，是同一句话——而「到底同步了没有」恰恰是同步类操作最需要回答的问题。

修法（[HistorySync.ts](../../src/composables/backup-sync/HistorySync.ts) `syncHistory`）：

- 步骤 1 接住 `importFromJSON` 的返回值，记下**从云端拉了多少**（`added` / `updated`）
- 步骤 2 接住 `mergeHistoryCollections` 的 `addedCount` / `updatedCount`，记下**推了多少**
- 两个方向都为 0 → **不写云端**，`toast.info('已是最新', '本地与云端没有差异，共 N 条记录')`
- 否则按方向分别报数：`拉取新增 X 条、更新 Y 条；推送新增 Z 条、更新 W 条，共 N 条记录`

跳过无谓的 `putFile` 顺带省掉一次网络写，也不再无故改动云端文件的修改时间。

## 测试怎么处理的：能retarget的不删

删函数会连带删掉它们的测试，但其中几条守的是**与函数无关的契约**。这些改指到保留的入口上，
而不是跟着一起删：

| 原测试 | 守的契约 | 处置 |
|---|---|---|
| `merges local and cloud history by id and timestamp before uploading` | 合并顺序与裁决规则 | 改指 `syncHistory`（现在唯一的合并上传路径） |
| `skips incremental upload when the cloud already has every local history id` | 无变化时不写云端 | 改写成「同步」如实反馈的主判据 |
| `incremental upload includes records whose only change is newer favorite metadata` | 收藏元数据较新也要参与合并 | 改指 `syncHistory` |
| `merges downloaded settings while preserving the current WebDAV config` | **合并绝不能让云端 webdav 段盖掉本地的**（否则同步一次就把自己的图床凭据换成别人的） | 改指 `syncConfig`——它第一步是同一套 `{...云端, webdav: 本地}` 逻辑 |
| `uploadHistoryMerge / uploadHistoryIncremental 中止且不写云端`（防静默覆盖 `describe.each`） | 云端数据不可用时中止 | 删——同 `describe.each` 里的 `syncHistory` 分支同构，覆盖不丢 |
| `stops merge/incremental upload when ... non-404` | 非 404 错误必须中止 | 删——与 `stops syncHistory before upload when cloud download fails with a non-404` 同构 |
| `reports real imported/new/updated counts for downloadHistoryMerge` | 报真实入库数 | 删——入口没了，且 `downloadHistoryOverwrite` 那条同类判据仍在 |

新增两条覆盖新分支：

- `reports 已是最新 and skips the cloud write when neither side changed`
- `reports only the pull direction when the cloud had nothing new to receive`

## 一并修正的文档

- `sync-flow.md` 图 3：5 分支 → 3 分支，与实际菜单一致；补画「无变化 → 不写云端」那条岔路
- `sync-flow.md` 关键点：合并语义现在只由「同步」提供；记下四个入口已删除
- `backupSyncUtils.ts` 里 `parseCloudHistoryForUpload` 的注释：调用点从「三个」改为「`syncHistory` 第一步」

## 验证

- `npm run typecheck`：四段全绿
- `npm run lint`：全绿
- `npm run test:coverage`：223 个测试文件全过；`backup-sync` 8 文件 / 79 用例全过

## 真机验收：3/3 通过（2026-09-08）

**环境**：portable 隔离模式（`src-tauri/target/debug/data/portable.json`），完全不碰
`%APPDATA%` 下 `us.picnex.app` 里的真实数据；本地库用 python sqlite3 按 SchemaManager DDL
预置 3 条记录；云端是本机 dufs（`127.0.0.1:5001`，空目录起步）。

判据不看弹窗截图，**看 `sync_log` 表的 details 与云端文件的 mtime**——弹窗文案与写入日志
同源，而 mtime 能证伪「嘴上说没写、其实写了」。

| # | 场景 | `sync_log` 实际记录 | 云端文件 mtime | 结论 |
|---|------|--------------------|---------------|------|
| ① | 首次同步（云端空） | `推送新增 3 条、更新 0 条，共 3 条记录` | 14:19:50（本次写入） | ✅ |
| ② | 紧接着再点一次 | `无变化，共 3 条记录` | **仍是 14:19:50** | ✅ |
| ③ | 外部往云端注入 1 条后再点 | `拉取新增 1 条、更新 0 条，共 4 条记录` | **仍是 14:21:15**（注入时刻） | ✅ |

判据 ② 是这次改动的核心：同步发生在 14:20:04，云端 mtime 停在 14:19:50——**一个字节都没写**。
改之前这里会白写一次并弹「已同步，共 3 条记录」。

判据 ③ 额外坐实了「只有拉取方向有变化时也不写云端」这条分支（对应单测
`reports only the pull direction when the cloud had nothing new to receive`）：
同步在 14:25:47，mtime 停在注入时刻，本地库正确多出 `from-other-device.png`。

> 造判据 ③ 的办法可复用：先正常同步一次让云端有文件，再由**外部进程**直接改
> 云端 `history.json` 追加一条本地没有的记录，就等价于「另一台机器传了张图」，
> 不需要第二台设备。
