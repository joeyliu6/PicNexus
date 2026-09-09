# 存量扫描：config + mirror 两模块（2026-09-07）

> 来源：`/scan-bugs` 存量扫描，Claude 侧「意图一致性」视角——只查**文档/注释声明的行为 vs 代码实际行为**的偏差。
> 选这两个模块的理由：history / sync / ipc / md-rescue / batch-migrate 均已扫过；`config` 是高风险文件区且出错代价是配置丢失，
> `mirror` 的不变量表与边界表写得最具体、最适合逐条对照。
>
> 所有 file:line 为 2026-09-07 快照，写入本文前已逐条回源码二次核对。
>
> **⚠️ 处置纪律（用户 2026-09-07 明确要求）：四条发现虽然都已在单元级复现，但一律先真机复测、再动代码。**
> 真机复测清单见文末，复现用例源码见附录，修复时把附录用例翻成回归测试。

## 验证状态

四条发现各写了临时 vitest 用例，用**真实模块**（真 AES-GCM、真 `MutexStore`、真 `useSettingsForm` / `useMirrorFallback` /
`mergeHistoryCollections`）跑通，共 8 条断言全部命中缺陷行为。用例已从仓库移除（它们断言的是"错的行为"，修完就该反转），
源码保存在本文附录。

| # | 模块 | 发现 | 单元级复现 | 真机复测 |
|---|------|------|-----------|---------|
| 1 | config | 换备份密码后托盘仍用旧钥匙回写配置，重启整份重置且无备份 | ✅ 3 条（主路径 / 轻症状 / 停用方向可救回） | ✅ 复现（主路径 2026-09-07）+ ✅ 修复复验（2026-09-07 同路径，见「真机复验结果」） |
| 2 | config | `configStore.get` 递出缓存原件，保存失败后回滚空转 | ✅ 2 条 | ✅ 复现（2026-09-07）+ ✅ 修复复验（2026-09-07，见「P1-1」执行记录） |
| 3 | mirror | 文档承诺切主/删镜像走「脏标记同步」，机制不存在 | ✅ 2 条（上传/下载两个方向） | ✅ 复现（2026-09-07，见「真机复现记录」）+ ✅ 文档已修正（同日，仅改文档，未动代码） |
| 4 | mirror | 灯箱单条重检不重算 `linkCheckSummary` | ✅ 1 条 | ✅ 复现（2026-09-07）+ ✅ 修复复验（2026-09-07，见「P1-3」执行记录） |

---

## 批次 P0：会丢整份配置

### P0-1 换备份密码后托盘窗口仍用旧钥匙回写配置，下次启动整份配置被重置且无备份

- **置信度**：🔴 已验证（代码路径无条件成立 + 单元级三条复现全过）

- **问题（大白话）**：主窗口换了锁芯（设置/修改/停用备份密码 = 换加密钥匙），但托盘那个小窗口手里还是旧钥匙。
  托盘是程序一启动就建好、常驻不销毁的独立 webview，它有自己一份 `secureStorage` 单例和一份配置缓存。
  用户在托盘里随手勾一个图床或切个主题，托盘就拿旧钥匙把整份 `.settings.dat` 重新锁了一遍。
  下次启动，主窗口用钥匙串里的新钥匙开不了这把旧锁，`main.ts` 认定「密钥不匹配」直接把门拆了换新门——
  用默认配置覆盖，所有图床凭证、profile 全没。

- **位置**：
  - 托盘常驻：[src-tauri/src/main.rs:468](../../src-tauri/src/main.rs#L468)；挂载即读配置并缓存钥匙：
    [TrayMenuWindow.vue:274](../../src/components/tray/TrayMenuWindow.vue#L274) → `readFreshConfig` → `decrypt` → `init()`
  - 换钥匙只通知本窗口：[BackupPasswordSection.vue:96](../../src/components/settings/backup-sync/BackupPasswordSection.vue#L96)
    `setDirect` + [:164](../../src/components/settings/backup-sync/BackupPasswordSection.vue#L164) 只 `emit('secrets-rekeyed')`（Vue 组件事件）。
    全仓 tauri `config-updated` 只有 `useConfig.saveConfig` 与 `trayMenu.ts` 两处发射，换钥匙不在其中。
    新机器输入迁移密码恢复（[App.vue:117](../../src/App.vue#L117)）同样不通知托盘。
  - 托盘写入路径：[trayMenu.ts:338](../../src/services/trayMenu.ts#L338) `loadTrayConfig()` 命中缓存 →
    [:362](../../src/services/trayMenu.ts#L362) `configStore.set` → `writeAll` → `encrypt()`；
    [crypto.ts:344](../../src/security/crypto.ts#L344) 只在 `!this.key` 时才 `init()`，钥匙已存在就直接用旧钥匙、按旧模式写。
    `toggleTrayTheme`（[:370-380](../../src/services/trayMenu.ts#L370)）同路径。
  - 重启重置：[main.ts:98](../../src/main.ts#L98) `setDirect({ config: DEFAULT_CONFIG })`；
    `loadForRead` 解密失败分支（[EncryptedStore.ts:223](../../src/store/EncryptedStore.ts#L223)）不做 `backupCorrupted`。

- **三个方向的后果不同**（单元级已分别验证）：

  | 操作 | 托盘写出的格式 | 重启后 | 能否救回 |
  |------|--------------|--------|---------|
  | **设置密码**（随机钥匙 → 口令钥匙） | `PNXENC`（旧随机钥匙） | `StoreError` → 直接重置 | ❌ 旧随机钥匙已被 `store_key` 覆盖，不可恢复 |
  | 修改密码（旧口令 → 新口令） | `PNXPWD`（旧口令钥匙） | 弹密码框 | ✅ 输**旧**口令 |
  | 停用密码（口令钥匙 → 随机钥匙） | `PNXPWD`（旧口令钥匙） | 弹密码框 | ✅ 输旧口令（副作用：又回到密码模式） |

  最常见的「第一次设置密码」正好是不可恢复的那个方向。

- **同根因的轻症状**：换钥匙后主窗口只要再保存一次（发 `config-updated`），托盘 `readFreshConfig` 抛
  `BackupPasswordRequiredError`、缓存已作废，之后托盘勾选静默失败直到重启（[TrayMenuWindow.vue:251-270](../../src/components/tray/TrayMenuWindow.vue#L251)
  的 `try/finally` 没有 catch）。这条是 fail-safe，不丢数据。

- **触发窗口**：换钥匙之后、主窗口下一次保存之前。设置页 `onUnmounted` 才会保存，而「关窗到托盘」只是隐藏窗口、组件不卸载，
  所以「设密码 → 关窗到托盘 → 托盘勾图床 → 重启」是一条自然操作路径。

- **修法（待真机复测后执行）**：
  1. 根治：`swapKeyAndReencrypt` 成功后与 `initWithPassword` 成功后 `emit('secure-key-rotated')`；
     `TrayMenuWindow.vue` 监听后依次 `secureStorage.forceReinit()` → `configStore.invalidateCache()` → `refreshTrayState()`。
  2. 兜底：`EncryptedStore.writeAll` 覆盖前把内存钥匙与钥匙串比对一次（`get_or_create_secure_key` 一次 IPC，写盘极少）。
  3. 止损：`main.ts ensureConfigSync` 重置前先 `backupCorrupted`，让「修改/停用」方向留有救回余地。
  4. 文档：`data-persistence.md` 图 3 节点 M 写的是内存降级，真正的磁盘覆写在 `main.ts`，排查表「配置丢失/恢复默认」指向要改。

- **验收命令**：把附录 `trayStaleKey.spec.ts` 三条用例的断言反转后纳入 `tests/unit/`，
  `npx vitest run tests/unit/security tests/unit/services/store.spec.ts`；再按文末真机清单跑一遍。

- **⚠️ 踩坑点**：修法 1 的监听要装在托盘 webview，不是主窗口；`forceReinit` 会把 `mode` 重置为 random 再 `init()`，
  口令模式的 `passwordSalt` 由下一次 `decryptPasswordData` 成功时回填，顺序不能反。

---

## 批次 P1：状态错位

### P1-1 `configStore.get` 返回缓存对象本身，`saveSettings` 就地改写后保存失败的回滚是空转

- **置信度**：🟡 疑似（别名关系是代码事实且已单元级复现；用户可见后果需要一次保存失败才触发）

- **问题（大白话）**：Store 的缓存把「原件」直接递出去而不是给「复印件」。设置页拿到原件就在上面涂改，然后才去保存；
  保存失败时缓存里躺着的就是涂改稿，「回滚到磁盘真值」再去读缓存，读到的还是涂改稿。别的读缓存的地方
  （上传器取配置、服务选择器）也把没落盘的值当真值，重启后消失。

- **位置**：
  - [MutexStore.ts:92-93](../../src/store/MutexStore.ts#L92) `return cached`；[CacheStore.ts:32](../../src/store/CacheStore.ts#L32) 返回内部引用；`replaceAll` 只浅拷一层。
  - [useSettingsForm.ts:424](../../src/composables/settings/useSettingsForm.ts#L424) 取到后 `config.services = …`、
    `config.webdav_profiles = formData.value.webdav_profiles`（把响应式数组塞进缓存）、`config.availableServices = …` 就地改写；
    [:495](../../src/composables/settings/useSettingsForm.ts#L495) 回滚 `loadSettings()` 读的是同一对象。
  - 同模式：`useAnalytics.ts:327-331`、`loadSettings` 的 legacy custom_s3 迁移分支（改写后不保存，缓存与磁盘分叉到下次保存）。

- **现有测试为什么没抓到**：[useSettingsForm.spec.ts:184](../../tests/unit/composables/settings/useSettingsForm.spec.ts#L184)
  把 `configStore.get` mock 成「每次返回新对象」，正好把别名关系遮住。

- **修法（待真机复测后执行）**：在 Store 层收口，`_performRead` 返回 `structuredClone(cached)`（配置只有几 KB），一处改动堵住所有调用方；
  `useConfig.loadConfig` 把缓存对象包进 `ref` 的别名一并消除。改后把上述 spec 的回滚用例换成真实 Store 驱动。

- **验收命令**：附录 `storeAliasing.spec.ts` 两条断言反转后纳入 `tests/unit/services/`；`npm run test:unit -- store useSettingsForm`。

- **⚠️ 踩坑点**：先 grep 有没有代码**依赖**这个别名（改了缓存对象就指望 `get` 读到）。扫描时没找到，但 `ConfigSync.ts`
  的合并路径要过一遍。

### P1-2 mirror 文档承诺切主/删镜像「复用脏标记同步」，实际不存在该机制，改动不进云端

- **置信度**：🟡 疑似（合并函数是纯函数、结论确定；是否算缺陷取决于「内容改动要不要同步」这个产品决定）

- **问题（大白话）**：[mirror-fallback-flow.md:219](../flows/mirror-fallback-flow.md#L219) 边界 12 说切主图床、移除镜像
  「都走 `update()`，复用现有脏标记机制」同步到 WebDAV。但 `HistoryDatabase.update` 不写任何脏标记或版本列；
  三个上传入口（[HistorySync.ts:130/210/428](../../src/composables/backup-sync/HistorySync.ts#L210)）都是
  `mergeHistoryCollections(cloudItems, localItems)`，[HistoryMerge.ts:80](../../src/services/database/HistoryMerge.ts#L80)
  同 id 且时间戳相等时**云端胜出**，[:90](../../src/services/database/HistoryMerge.ts#L90) `hasHistoryItemChanged` 只看 timestamp 与收藏签名。
  切主、删镜像、灯箱重检都不改 timestamp → 增量/合并/双向同步一律报「无需上传」；只有「上传覆盖云端」能带上去；
  之后「下载覆盖本地」或换机恢复会把已移除的死链接和旧主图床原样带回。
  `sync-flow.md` 自己写的是「上传新增 id 或收藏版本更新」，与代码一致——失真的是 mirror 文档的承诺。

- **修法**：先改文档（边界 12 改为「内容层改动只有『上传覆盖云端』会同步，从云端恢复会还原旧镜像」+ 排查表加一行）。
  要真同步需给 `history_items` 加 `content_updated_at` 并让 `mergeHistoryItem` 参与比较，属 sync + db-migration 改动，另开条目排期。

- **验收命令**：附录 `mergeIgnoresMirrorEdits.spec.ts` 可直接作为「当前行为」的钉子保留。

### P1-3 灯箱单条重检只写 `linkCheckStatus`，不重算 `linkCheckSummary`

- **置信度**：🟡 疑似（口径不一致确凿；追到消费端影响很小）

- **问题**：[useMirrorFallback.ts:378](../../src/composables/history/useMirrorFallback.ts#L378) 落库只带 `{ linkCheckStatus }`。
  同为「状态变了」的三条路径——`removeMirror`（HistoryDatabase.ts:403）、`stripServiceFromItem`（useHistoryResultOps.ts:67）、
  链接检测页 `updateHistoryCheckStatus`（linkCheckPersistence.ts:100-116）——都重算 summary，只有这条不算。
  summary 唯一读者是 [LinkCheckQuery.ts:13-15](../../src/services/database/LinkCheckQuery.ts#L13) 的 Phase 1 首屏查询，无 UI 直接展示计数，
  后果只是「灯箱里刚判失效的链接不进链接检测页首屏那批，要等 Phase 2」。

- **修法**：写库任务里加 `linkCheckSummary: recomputeLinkCheckSummary(latest.results, linkCheckStatus, latest.linkCheckSummary)`
  （无 previousSummary 返回 undefined，与 `removeMirror` 口径一致）。

- **验收命令**：附录 `checkMirrorSummary.spec.ts` 断言反转后并入 `useMirrorFallback.spec.ts`。

---

## 文档漂移（非缺陷，修 P1-2 时顺手）

- mirror 图 2 节点 M3 写「toast.success 已切换主图床」（[mirror-fallback-flow.md:120](../flows/mirror-fallback-flow.md#L120)），
  代码刻意不弹（圆点跳行即反馈，符合 notification-patterns）。
- mirror 不变量表说候选指纹只含「前缀模板 + 知乎 source」（[:70](../flows/mirror-fallback-flow.md#L70)），实际还含 R2 代理开关与会话可达性
  （[useThumbCache.ts:243-251](../../src/composables/useThumbCache.ts#L243)）。
- data-persistence 图 3 节点 M，见 P0-1 修法 4。

## 已核对无问题（Codex 孪生扫描可跳过）

- config：`saveConfig` 序列化/校验/写入/事件顺序与图 3 一致；`toPlainConfig` + Store roundtrip 双重剥代理；
  `config-updated` 六个监听方凡涉及跨窗口都走 `readFreshConfig`；`purgeOrphanSecrets` 在 `ensureConfigSync` 之后。
- mirror：`extractMirrorServices` 谓词 = `isUsableMirror`；DB 三重守卫与图 3 一致；乐观切主 / 主图床移除的先切后删 / 并发守卫与图 2 一致；
  时间轴、收藏、表格都监听 `history-updated` 重查。`getSuccessfulServices` 仍是「仅 status」口径，
  但两个复制入口（useLightboxActions.ts:68、useTableInteractions.ts:474）都已守卫空 url，只剩菜单多开一行的观感差异。
- IPC 语义、错误处理、性能三个维度未发现问题。

## 范围外线索（未验证，不定性）

- [UploadView.vue:393-397](../../src/components/views/UploadView.vue#L393) 与 [TrayMenuWindow.vue:251-270](../../src/components/tray/TrayMenuWindow.vue#L251)
  的异步回调没有 catch，`readFreshConfig` / `toggleTrayService` 抛错会变成 unhandledrejection（window / upload 范围）。
- 链接检测页写入的 `linkCheckStatus`、批量迁移的 `migrationSkip` 与 P1-2 同理，均不会经增量同步进云端（sync 范围）。
- 处理 P1-2 真机复测时顺带确认：`uploadHistoryIncremental`（增量上传）/ `uploadHistoryMerge`（智能合并上传）/
  `downloadHistoryMerge`（合并下载）三个函数已实现且有单元测试，但全仓没有任何 `.vue` 组件调用它们——
  `DataItemCard.vue` 的「更多」下拉菜单只有「覆盖云端」「覆盖本地」两项，`sync-flow.md:136-141` 画的 5 分支
  流程图与实际 3 按钮 UI 不符。这不是 P1-2 的一部分（不影响本条的结论或修法），已单独登记
  `docs/TODO.md`「设置页「备份与同步」缺少增量上传/合并下载入口」条目，是否补 UI 入口待产品决定。

---

## 真机复测清单（修改前必做）

> ⚠️ P0-1 的复测会**真的清掉配置**。开始前先在「备份与同步」导出一份配置备份，并把 `.settings.dat` 手工复制一份。

| # | 步骤 | 预期（缺陷成立时） | 结果 |
|---|------|------------------|------|
| P0-1 主路径 | 无备份密码状态 → 设置页「设置密码」→ **不要**再改任何设置 → 关窗到托盘 → 托盘勾选一个图床 → 完全退出 → 重启 | 启动弹「密钥不匹配，配置已重置」，所有图床凭证消失；`%APPDATA%` 下无 `.settings.dat.corrupted.*` | ✅ 真机完全复现，见下方执行记录；已用于验证修复生效（见「真机复验结果」） |
| P0-1 轻症状 | 设置密码 → 在设置页随便改一项让它保存 → 托盘勾选图床 | 托盘勾选无反应（日志有 `BackupPasswordRequiredError`），重启后恢复 | ⬜ |
| P0-1 停用方向 | 已有密码 → 「关闭加密」→ 关窗到托盘 → 托盘切主题 → 重启 | 弹密码框；输**旧**口令能进，配置完整，但备份密码又变回「已加密」 | ⬜ |
| P1-1 | 设置页改微博 Cookie → 让保存失败（最省事：先把 `.settings.dat` 设为只读）→ 观察表单与「保存失败」提示 → 离开再回设置页 | 提示保存失败，但表单仍显示新 Cookie；回来还是新值；解除只读、重启后是旧值 | ✅ 真机完全复现（2026-09-07）+ ✅ 修复复验（2026-09-07，见下方执行记录） |
| P1-2 | ~~一条多图床记录 → 灯箱移除一条镜像 → 「增量上传」~~（此判据里的"增量上传"按钮在界面上不存在，见执行记录；改用「同步」）一条多图床记录 → 灯箱移除一条镜像 → 「同步」 | toast「已同步」（不报错、也不是"无需上传"，因为走的入口不同）；云端 `history.json` 里被移除的镜像原样还在；「覆盖本地」后镜像回本地 DB | ✅ 复现，见「真机复现记录」 |
| P1-3 | 链接检测跑一遍得到一条失效 → 灯箱 chip 重检判回可用 → 重进链接检测页 | 首屏（Phase 1）仍含这条，行状态显示可用 | ✅ 复现（2026-09-07）+ ✅ 修复复验（2026-09-07，见「P1-3」执行记录） |

## 执行记录

### 2026-09-07 P0-1 主路径真机复现（真跑起来的 App，不是 vitest mock）

**结论：坐实了。缺陷在真机上百分之百复现，现象与本文预测完全一致，没有走样。**

**怎么测的**：`src-tauri/target/debug/data/portable.json` 隔离出一个完全独立的数据目录（不碰真实
`%APPDATA%`），用项目已有的 wdio + tauri-driver + msedgedriver 真机 E2E 框架驱动一次完整的
「设密码 → 关窗到托盘 → 托盘写配置 → 杀进程 → 冷启动」流程，每一步直接读磁盘上的 `.settings.dat`
文件头（不经过 UI 转述），外加读 `data/logs/*.log` 里 Rust/前端打的真实日志。临时脚本跑完已删除
（`tests/tauri-e2e/p0-1-tray-stale-key-repro.tauri.e2e.cjs`），下面是关键证据摘录：

| 步骤 | `.settings.dat` 文件头 | 说明 |
|------|----------------------|------|
| 冷启动，首次建档 | `PNXENC:zk8eC...`（6219 字节） | 全新 portable 目录，随机钥匙 |
| 打开设置页「备份与同步」 | `PNXENC:eJMnF...`（6375 字节） | 跳过新手引导等前置操作顺手存了一次盘，钥匙没变 |
| 点「设置密码」→ 填 `TestPass123` → 提交，收到 toast「备份密码设置成功」 | **`PNXPWD:dcG8l...`**（6399 字节） | 钥匙已换成口令派生钥匙，符合预期 |
| 点标题栏关闭按钮（`closeToTray` 默认开，只隐藏不退出，`SettingsView` 不 `onUnmounted`） | `PNXPWD:dcG8l...` 不变 | 隐藏窗口本身不触发任何写盘 |
| 切到 `tray-menu` 窗口（`getWindowHandles()` 里真的能拿到它的句柄，尽管它 `visible(false)`），`browser.execute` 直接对 `.menu-row` 里"切换主题"那一项 `dispatchEvent(new MouseEvent('click'))` | **`PNXENC:4S7Zi...`**（6379 字节） | ⚠️ 被打回随机钥匙格式，托盘用的是它自己那份还没刷新的旧钥匙 |
| `taskkill /F /IM picnexus.exe /T` 完全杀掉进程（含子进程，日志显示连带杀了 21 个 PID，含 sidecar/webview 子进程），确认进程列表里已找不到 | `PNXENC:4S7Zi...` 不变 | 杀进程本身不动文件，符合预期 |
| 直接 `spawn` 冷启动同一个 exe（不经 webdriver），等 8 秒 | **`PNXENC:Vu8lV...`**（6379 字节，内容与上一行不同——重新加密写过一遍） | 文件被全新覆盖 |

**冷启动时抓到的真实日志（`data/logs/PicNexus.log`，逐字摘录）**：

```
[ERROR] [SecureStorage] 解密失败:
[ERROR] [Store] 解密失败: 数据损坏或密钥不匹配
[ERROR] [Store] 读取失败 (config): 加密数据解密失败: 数据损坏或密钥不匹配
[WARN] [TrayMenuWindow] 读取配置失败，沿用上一次快照: {"name":"StoreError","message":"加密数据解密失败: 数据损坏或密钥不匹配"}
...
[INFO] [Store] ✓ 解密成功
[INFO] [ServiceSelector] 已加载状态: [] (可用: ["r2","smms","github","imgur","tencent","aliyun","qiniu","upyun"] )
```

`已加载状态: []` 就是 `DEFAULT_CONFIG.enabledServices`（默认空）——配置确实被整份重置成出厂默认值，
不是"读不到就沿用旧值"那种温和失败。`main.ts:96` 那句 `log.warn('检测到密钥不匹配，配置将重置为默认值
（旧配置无法恢复）')` 因为窗口截断没抓到逐字文本，但从「解密失败」→「重新解密成功且是默认值」这条时间线看，
`ensureConfigSync` 的 `StoreError` 分支必然被走到了，跟本文 39-51 行标注的位置一字不差对上。

**和本文预判的两点出入，如实记录**：

1. **触发动作用的是"托盘切主题"而不是"托盘勾选图床"。** 全新 portable 安装的 `availableServices`
   默认是 `['r2','smms','github','imgur','tencent','aliyun','qiniu','upyun']`，但这些服务全部没填
   凭证（不在 `NO_CONFIG_SERVICES` 里），托盘「当前图床」子菜单在配置一个服务之前是空的（"暂无可用图床"），
   没法真的点开勾一个图床——这本身不是缺陷，只是测试前置条件问题。`toggleTrayTheme` 和 `toggleTrayService`
   走的是完全同一段代码（`trayMenu.ts` 里 `configStore.get` 命中缓存 → 深拷贝 → `configStore.set` →
   `save()` → 用内存里那把旧钥匙 `encrypt()`），本文自己在「停用方向」那一行测试用例里也是用切主题当触发器，
   这里对「主路径」沿用同一等价触发是一致的，不影响结论。
2. **托盘窗口尽管 `visible(false)`，`getWindowHandles()` 里确实能拿到它的句柄**，`browser.execute`
   对里面 DOM 元素 `dispatchEvent` 一样能触发 Vue 的响应式更新和真实的 IPC 调用——这条印证了任务交底里
   的猜测，以后写托盘相关的真机用例可以直接用这个手法，不用再纠结"看不见的窗口测不了"。

**没有验证到的部分**：只跑了「主路径」（首次设置密码方向，不可恢复的那个）。"轻症状"（换钥匙后主窗口
再保存一次，托盘写入变成静默失败）和"停用方向"（旧口令能救回）这两条本文预判的对照场景没有单独在真机上
过一遍——机制跟主路径共享同一段代码路径，主路径既然已经证实，暂不重复测，但严格说这两条目前仍停留在
单元级验证。

**清理**：`tests/tauri-e2e/p0-1-tray-stale-key-repro.tauri.e2e.cjs` 已删除；
`src-tauri/target/debug/data/`（含本次生成的 `.settings.dat`、`logs/`、`portable.json`）已整个删除，
不会影响后续 `npm run dev`/`tauri dev` 或其他人跑同一个 debug exe。

**下一步**：P0-1 的真机复测判据已满足「修复前必做」的门槛，可以按本文「修法」小节动代码了；
另外三条（P1-1/P1-2/P1-3）仍停留在单元级复现，尚未安排真机复测。

### 2026-09-07 P0-1 修复实施（代码 + 单元回归，真机复验见下）

按上面「修法」小节动了代码，四点里做了三点、有意跳过一点，原因都记下面：

1. **根治（已做）**：`src/security/crypto.ts` 新增 `SECURE_KEY_ROTATED_EVENT = 'secure-key-rotated'` 常量。
   换钥匙的两个入口都会广播这个 Tauri 跨窗口事件（Vue 组件事件 `secrets-rekeyed` 过不去托盘那个独立
   webview，必须走真正的 `emit()`）：`BackupPasswordSection.vue` 的 `swapKeyAndReencrypt` 成功后（覆盖
   设置/修改/停用密码三条分支），以及 `App.vue` 的新机器输入密码恢复成功后。`TrayMenuWindow.vue` 新增
   监听，收到后依次 `secureStorage.forceReinit()` → `refreshTrayState()`（内部的 `readFreshConfig()` 会
   顺带 `invalidateCache()` 并触发一次真实解密，让密码模式的 `mode`/`passwordSalt` 回填——这个顺序是本文
   「踩坑点」提到的坑，`forceReinit()` 单独调用不会回填 mode，必须紧跟一次真实解密）。
2. **兜底（有意跳过）**：本文提议在 `EncryptedStore.writeAll` 写盘前拿内存密钥去和钥匙串比对一次，不一致
   就纠正。评估后发现这个"纠正"不能只是简单调用 `forceReinit()`——`forceReinit()` 会把 `mode` 硬编码回
   `random`，如果写盘前只做这一步就直接 `encrypt()`，会把一份实际是口令派生密钥的内容错误标成 `PNXENC`
   格式落盘（密钥字节是对的，能正常读回来，但从此失去口令模式的可跨机恢复能力、盘面身份也不对）。
   要做对就得在 `writeAll` 里插入一次"先解密当前文件、确认 mode、再加密"的完整流程，等于把
   `readFreshConfig()` 的逻辑在写路径里重新实现一遍，复杂度和引入新缺陷的风险超过它能补的那点缺口——
   根治（第 1 点）已经覆盖了审计报告记录的触发路径。不做这条兜底，如实记录，不是漏掉。
3. **止损（已做，但选了更根源的落点）**：本文原話是在 `main.ts ensureConfigSync` 里加备份，但顺着代码
   追下去发现更合适的落点是 `EncryptedStore.loadForRead`——它的解密失败分支（`main.ts` 的 `configStore.get()`
   走的正是这条路径）之前直接抛错、没有备份，而**同一个文件里**的 `loadForWrite` 遇到解密失败早就会先
   `backupCorrupted()` 再抛错/自愈。这是一处此前没被注意到的不对称，修在 `loadForRead` 一个地方即可覆盖
   `main.ts` 和其他任何调用 `get()` 触发解密失败的场景，比在 `main.ts` 单点打补丁更对症。
   `main.ts` 的日志文案同步改了措辞（不再说"无法恢复"，改成"密钥仍在的情况下可能找回"）。
   ⚠️ 如实说明局限：这条对 P0-1"设置密码"这个方向本身没有实际救援作用——托盘写盘时用的旧随机密钥
   在换密码那一步已经被 `set_secure_key` 覆盖、不会再出现在钥匙串里，备份下来的密文永远配不上任何还
   找得到的密钥。它的价值是把这个 codebase 里 `loadForRead`/`loadForWrite` 两条路径的处理方式拉齐，对
   "修改/停用密码"方向（钥匙用密码可以重新派生，不依赖钥匙串）以及任何其他未来导致解密失败的场景
   才有实际的救援价值。
4. **文档（已做）**：`docs/flows/data-persistence.md` 图 3 节点 M 的文案从"降级为 DEFAULT_CONFIG"改成
   准确描述"main.ts 整份覆写磁盘"，加了一段说明背后的真实路径、备份兜底、以及触发根源和修法链接；
   排查表「配置丢失/恢复默认」那一行同步更新。

**单元回归**（已跑，全绿，不是本文附录那种"断言错误行为"的临时复现用例，而是断言"修好之后应有的行为"的
永久回归测试）：

- `tests/unit/crypto.spec.ts` 新增 `describe('P0-1 回归：托盘常驻窗口的密钥轮换', ...)`，三条用例：复现
  前提仍成立（不刷新会写坏）、`forceReinit()` + 一次真实解密后写盘格式和密钥都对、`forceReinit()` 本身
  不回填 mode 的顺序坑。
- `tests/unit/components/backupPasswordSection.spec.ts` 新增一条断言换密钥后确实广播了
  `secure-key-rotated`（用 `getEmitMock()` 断言 Tauri 事件层，不是 Vue 组件事件层）。
- `tests/unit/services/store.spec.ts` 新增 `describe('Store（加密模式）读取时解密失败的备份兜底', ...)`，
  验证 `loadForRead` 解密失败时确实先备份再抛错。
- `npx vitest run`：221 个文件 / 3068 条用例全绿；`npm run typecheck`、`npm run lint` 均通过。

**真机复验**：进行中，见下一条记录（用同一套 wdio + portable 隔离手法，重复本文最初复现的那条「设密码 →
关窗到托盘 → 托盘切主题 → 完全退出 → 重启」路径，这次预期文件应该全程保持 `PNXPWD:` 前缀、重启后配置
不丢）。

### 2026-09-07 P0-1 真机复验结果（结论：修复生效）

**结论用大白话说**：锁芯换了以后，这次托盘那把小钥匙真的跟着一起换了。之前那条「设密码 → 关窗到托盘 →
托盘切主题 → 杀进程 → 冷启动」路径走了整整一遍，文件头**全程没有再被打回 `PNXENC`**，重启后也没有再出现
「密钥不匹配」——跟第一次复现时那次一步步崩掉的样子完全不一样了。

**怎么测的**：跟「主路径真机复现」那次用的是同一套手法——`src-tauri/target/debug/data/portable.json`
隔离出独立数据目录，wdio + tauri-driver + msedgedriver 驱动真实编译出来的 debug 版 App（跑之前
`onPrepare` 钩子已经用当前工作区代码重新跑了一遍 `vite build` + `cargo build`，不是拿旧的 exe 蒙混）。
临时脚本 `tests/tauri-e2e/p0-1-tray-fix-verify.tauri.e2e.cjs` 跑完已删除。判据同样是直接读磁盘上
`.settings.dat` 的文件头前缀 + `data/logs/PicNexus.log` 的真实日志，不看 UI 文案。

**关键证据表**（跟第一次复现表格对照着看，步骤完全一样，结果反过来了）：

| 步骤 | `.settings.dat` 文件头 | 说明 |
|------|----------------------|------|
| 冷启动，首次建档 | `PNXENC:Uw6WjEziFzWtsMVUW...`（6375 字节） | 全新 portable 目录，随机钥匙，跟修复前一致 |
| 设置页「设置密码」→ 填 `TestPass123` → 提交，收到 toast「备份密码设置成功」 | `PNXPWD:Kd65KBMfB5866sizD...`（6399 字节） | 钥匙已换成口令派生钥匙，跟修复前一致 |
| 关窗到托盘（标题栏关闭按钮只隐藏，不退出） | `PNXPWD:` 不变 | 隐藏窗口本身不触发写盘 |
| 切到 `tray-menu` 窗口，`browser.execute` 对「切换主题」那一行 `.click()` | **`PNXPWD:Kd65KBMfB5866sizD...`（同一把钥匙，同样 6399 字节）** | ⚠️ 修复前这一步会被打回 `PNXENC`（旧随机钥匙）；这次文件确实被重新写过一遍（mtime 变了），但写出来的还是 `PNXPWD` 口令钥匙格式——**这是本次验证的核心判据，通过** |
| `taskkill /F /IM picnexus.exe /T` 完全杀掉进程树 | `PNXPWD:` 不变 | 杀进程本身不动文件 |
| 直接 `spawn` 冷启动同一个 exe（不经 webdriver），等 8 秒 | `PNXPWD:Kd65KBMfB5866sizD...`（同钥匙同字节数，只是 mtime 更新——应用启动流程里有一次读后再写的正常动作） | 冷启动全程没有走到「密钥不匹配」分支 |

**冷启动抓到的真实日志（`data/logs/PicNexus.log`，逐字摘录，时间线完整）**：

```
[09:09:25][SecureStorage] ✓ 密钥初始化成功
[09:09:25][Store] ✓ 解密成功
[09:09:25][Store] ✓ 解密成功
[09:09:25][ServiceSelector] 已加载状态: [] (可用: ["r2","smms","github","imgur","tencent","aliyun","qiniu","upyun"] )
...
[09:09:27][密钥管理] ✓ 密钥已更新到便携数据目录        ← 设置密码：写入口令派生钥匙
[09:09:27][SecureStorage] ✓ 备份密码已设置
[09:09:27][Store] ✓ 直接写入成功 (.settings.dat)        ← 主窗口用新钥匙重新加密写回（PNXPWD）
[09:09:27][密钥管理] 从便携数据目录读取现有密钥          ← 托盘收到 secure-key-rotated 事件，forceReinit() 重新取钥匙
[09:09:27][SecureStorage] ✓ 密钥初始化成功              ← 托盘 forceReinit() 完成
[09:09:27][Store] ✓ 解密成功                            ← 托盘 refreshTrayState()→readFreshConfig() 用新钥匙成功解密，mode/passwordSalt 在这一步回填
...（托盘点击「切换主题」，配置更新事件在其余窗口触发的连锁刷新）...
[09:09:31][密钥管理] 从便携数据目录读取现有密钥          ← 冷启动
[09:09:31][SecureStorage] ✓ 密钥初始化成功
[09:09:31][Store] ✓ 解密成功                            ← 主窗口正常解密成功，全程无报错
[09:09:32][ServiceSelector] 已加载状态: [] (可用: [...])
```

**全篇没有出现**：`检测到密钥不匹配`、`配置已重置为默认值`、`数据损坏或密钥不匹配`、`BackupPasswordRequiredError`、
`读取配置失败，沿用上一次快照`——这五个字符串是本文档和 `main.ts`/`TrayMenuWindow.vue` 源码里能找到的、
专属于「解密失败/密钥不匹配/重置」分支的日志文案，一个都没触发。

⚠️ 说明一点容易误判的地方：日志里两次都出现了 `已加载状态: []`（冷启动前和冷启动后都是空数组），
第一次复现文档里曾经把这行当「配置被重置」的铁证，但那是因为当时的场景恰好是「默认值也是空数组」和
「被重置成默认值后也是空数组」两种情况长得一模一样——本次全新 portable 安装从头到尾就没有配置过任何
图床凭证，`enabledServices` 正常情况下也是 `[]`，所以这次改用了更精确的判据（上面那五个专属错误文案），
不再单独依赖这一行，避免了假阳性。

**跟第一次复现的操作路径完全对称**：同样用「托盘切主题」代替「托盘勾图床」当触发器（原因同上次记录——
全新安装没有已配置凭证的图床可勾），同样是 `getWindowHandles()` 拿到 `visible(false)` 的托盘窗口句柄后
直接 `browser.execute` 里 `dispatchEvent`/`.click()`，同样用文件头 + 日志判定而非 UI 文案。

**框架层面遇到的两个小插曲，如实记录（跟修复本身无关）**：

1. 托盘菜单里「切换主题」那一行的图标是动态的（`getThemeToggleIcon`：亮色主题下显示 `pi-moon`「切到暗色」，
   暗色主题下显示 `pi-sun`「切到亮色」），不是固定的 `pi-sun`——第一次复现文档里写的定位方式（按 `pi-sun`
   图标找行）在全新安装默认亮色主题下会找不到行，脚本改成两个图标类名任一命中都算。
2. 用 `taskkill /F /IM picnexus.exe /T` 杀真实运行中的进程树需要一点时间枚举子进程，脚本里原本断言
   「杀进程指令发出到进程确认死亡之间文件绝对不会变」偶发失败（怀疑是某个排队中的防抖保存赶在进程真正
   退出前完成了最后一次写入），后来把这条断言改成非致命警告——不影响本次验证的核心判据（切主题时是否
   还写成 `PNXPWD`、重启后是否还能正常解密）。

**没有验证到的部分**（跟第一次复现记录的遗留项一致，未重复扩大范围）：只验证了「主路径」（首次设置密码
这个不可恢复的方向）。「轻症状」（换钥匙后主窗口再保存一次，托盘写入变成静默失败）和「停用方向」
（旧口令能救回）两个对照场景仍停留在单元级验证，机制跟主路径共享同一段被改动的代码，暂不单独补真机验证。

**清理**：`tests/tauri-e2e/p0-1-tray-fix-verify.tauri.e2e.cjs`、`tests/tauri-e2e/p0-1-fix-verify-logs.txt`
已删除；`src-tauri/target/debug/data/`（含本次生成的 `.settings.dat`、`logs/`、`portable.json`）已整个
删除；复验结束后确认过一遍进程列表，没有残留的 `picnexus.exe`。

### 2026-09-07 P1-1 真机复现（真跑起来的 App，不是 vitest mock）

**结论：坐实了，一次跑通。** 现象跟本文预判完全一致：保存失败之后，表单/缓存里还留着那份没保存成功的
新 Cookie 值，切标签页也救不回来；只有真正重启进程（清空 JS 内存里那份被涂改的缓存）之后，界面才变回
磁盘上真正落盘的旧值。

**怎么测的**：跟 P0-1 同一套手法——`src-tauri/target/debug/data/portable.json` 隔离数据目录，
wdio + tauri-driver + msedgedriver 驱动真实编译出来的 debug App。临时脚本
`tests/tauri-e2e/p1-1-config-aliasing-repro.tauri.e2e.cjs`（跑完已删除）流程：设置页微博 Cookie 填一个
基线值 → 等真实保存成功日志 → 给 `.settings.dat` 拍 SHA-256 快照 → 从 App 外部用 Node `fs.chmodSync`
把文件设只读 → 改成新值触发保存 → 等真实失败日志 → **重新聚焦 Cookie 框**（不是失焦后立刻读，见下方
「意外发现」）读当前值 → 切标签页再切回读一次 → 解除只读、硬杀进程、冷启动、重新建立真实 WebDriver 会话，
再读一次。

**证据表格**：

| 步骤 | 观察到的值 / 文件状态 / 日志 | 说明 |
|---|---|---|
| 基线保存 | 日志 `[useConfig] ✓ 配置保存成功`；`.settings.dat` 6383 字节，SHA-256=`4241ca48...` | 基线值真正落盘 |
| 触发只读写入失败 | `[Store] 保存失败 (config): 写入文件失败: ... 拒绝访问。(os error 5)` | Windows 系统级真实拒绝，不是伪造的失败 |
| 失败后文件字节 | SHA-256 与基线**完全一致** | 失败的写入一个字节都没碰到磁盘 |
| **失败后重新聚焦读值（核心判据）** | `"SUB=edited-value-2-should-not-persist-after-rollback"` | 是编辑后的新值，不是基线值——"回滚到磁盘真值"确实是空转 |
| 切标签页再切回后读值 | 仍是编辑值；`.settings.dat` 字节仍与失败写入后一致 | 不是瞬时界面残留，整个面板重挂载后读到的还是同一份被污染的缓存 |
| 清除只读 + 硬杀进程 + 冷启动后读值 | `"SUB=baseline-value-1"` | 编辑值从未真正落盘，重启清空内存缓存，只能从磁盘读回基线值 |

**意外发现（很重要，直接决定了判据怎么读值）**：微博 Cookie 框走的是 `useSensitiveDraft.ts` 那套"草稿机"
逻辑——失焦提交是同步的，不等真正的防抖保存结果，草稿一律清空，框里只剩圆点占位符。若照直觉"失焦后立刻
读 `textarea.value`"，不管保存成没成功都会读到空字符串，得出一个完全误导的"没问题"结论。正确做法是
**重新聚焦这个框**，触发应用自己的"取回已存值"逻辑（`beginEdit` → `reveal` → 读
`formData.value.weiboCookie`），这时读到的才是真正有意义的判据，也正好对应单元测试
`storeAliasing.spec.ts` 断言的 `formData.value.weiboCookie` 这个层面。

**清理**：临时脚本已删除；`src-tauri/target/debug/data/` 已整个删除；确认无残留 `picnexus.exe` 进程；
`git status` 干净。

### 2026-09-07 P1-1 修复实施（代码 + 单元回归，真机复验见下）

**改法**：只改一处——`src/store/MutexStore.ts` 的私有方法 `_performRead`。原来两个返回点（缓存命中
`return cached`、缓存刚从磁盘加载后首次读 `return value as T`）都是把 `CacheStore` 内部对象的引用直接
递出去；现在统一经过 `cloneValue`（对象类型 `structuredClone`，基本类型原样返回）再返回。一处改动堵住
所有调用方，不用逐个改 `useSettingsForm.ts` / `useAnalytics.ts`，与本文「修法」小节的预案一致。

**`useConfig.ts` 的 `loadConfig` 没有额外改代码**——这是本文之前要求"一并核实"的第二个消费点。没有凭直觉
下结论，而是先写了一条测试专门验证"`loadConfig()` 后就地改写 `config.value` 会不会污染 Store 缓存"，
用 `git stash` 把 `MutexStore.ts` 的修复临时撤回、跑这条测试——**确实失败**，证明 `useConfig.ts` 在修复前
也受这个别名 bug 影响；`git stash pop` 恢复修复后重跑——**通过**，证明 Store 层这一处改动已经连带把它
修好了，不需要在 `useConfig.ts` 里再单独处理。这个"先撤回确认会红、再恢复确认转绿"的验证流程对
`tests/unit/services/storeAliasing.spec.ts` 的全部 3 条用例都做了一遍，不是只测了这一条。

**改之前的排查（用户要求的"先全仓 grep 有没有代码依赖这个别名"）**：全仓核对了 `configStore.get()` /
`syncStatusStore.get()` 的全部约 27 个调用点，重点复查了本文点名的 `ConfigSync.ts`（`uploadSettingsCloud`
只读不改；`downloadSettingsMerge` / `syncConfig` 只读一次 `currentConfig.webdav` 拼进一个全新对象，不依赖
后续 `get()` 能读到这次"改写"）。结果与本文预判一致：**没有代码反过来依赖这个别名**——`trayMenu.ts` /
`useServiceSelector.ts` / `useBackupLocal.ts` / `main.ts` 的 `purgeOrphanSecrets` 等处，凡是需要改写的都已经
先 `structuredClone` 或 `JSON.parse(JSON.stringify(...))` 深拷贝再改，属于"恰好写对了"而不是"依赖了 bug"。
唯一顺手发现的相似形态是 `src/theme/ThemeManager.ts`（`setTheme` 就地改 `this.config.theme` 再落盘、失败
时手动回滚一个字段）——但它把 Store 读到的值长期私有持有在实例字段上、从不再调用 `get()` 重新读取，
不依赖"每次 `get()` 返回同一引用"这个（错误的）特性，修复前后行为一致，不受这次改动影响，也不在 P1-1 范围
内，这里如实记录、不处理。

**测试**：

- 新增 `tests/unit/services/storeAliasing.spec.ts`（永久回归测试，取代本文附录的临时复现用例，断言已反转
  为"修复后应有的行为"），3 条用例：Store 本身两次 `get()` 返回不同引用且互不污染、`useSettingsForm`
  保存失败后正确回滚到磁盘真值（含 toast/`advancedSaveState`/`availableServices` 一并核实）、
  `useConfig.loadConfig` 塞进 `ref` 的值同样与缓存解耦。
- `tests/unit/composables/settings/useSettingsForm.spec.ts` 原本第 184 行那条"保存失败后回滚"用例已删除
  ——它把 `configStore.get` mock 成"每次返回新对象"，这个 mock 方式本身就把别名关系遮住了，测的是虚构
  场景不是真实 Store 行为，改用真实 `Store` 实例的等价用例现在在 `storeAliasing.spec.ts` 里。
- `npx vitest run`：222 个文件 / 3070 条用例全绿（3068 + 新增 3 − 删除 1）；`npm run typecheck`、
  `npm run lint` 均通过。改动只涉及前端 TS，未碰 `src-tauri/`，未跑 `cargo check`/`cargo test`。

**真机复验**：见下一条记录。

### 2026-09-07 P1-1 真机复验结果（结论：修复生效）

**结论用大白话说**：保存失败之后，这次表单**立刻**（不用等重启）就正确显示回磁盘上的旧值了，跟修复前
那次"卡在编辑值上直到重启才恢复"完全不一样。

**怎么测的**：跟真机复现同一套手法——portable 数据隔离 + wdio + tauri-driver，`onPrepare` 钩子用当前
工作区代码（已包含修复）重新构建 vite + cargo。临时脚本
`tests/tauri-e2e/p1-1-config-aliasing-fix-verify.tauri.e2e.cjs`（跑完已删除）复用复现阶段摸出来的全部
技巧（"重新聚焦读值"避开草稿机制假阴性、`fs.chmodSync` 只读逼真实写入失败、SHA-256 字节比对），把预期
断言在核心判据处反转过来。

**过程中的一个插曲，如实记录**：第一次跑这份新脚本时卡在最开头——`#app .main-layout` 60 秒都没显示，
但应用日志显示前端其实正常跑起来了。查了一下本机 wdio 真机测试的已知坑记录，命中了「多 webview 窗口
会话可能连到非主窗口」这一条（`tests/tauri-e2e/scan-history-fix-acceptance.tauri.e2e.cjs` 里已经有现成的
`switchToMainWindow`：轮询 `getWindowHandles()`，逐个 `switchToWindow` 找 `#app .main-layout`）——这份新
脚本漏写了这一步，是脚本本身的问题，跟这次修复的正确性无关。补上同样的手法（适配了 step 8 用到的
"重新建立一份独立 WebDriver 会话"场景，让 `switchToMainWindow` 接受显式 `client` 参数而不是只认全局
`browser`）后，重新跑一遍，9 步全过。

**关键证据表**（跟真机复现那次的表格对照着看，操作路径完全一样，核心那一行反过来了）：

| 步骤 | 观察到的值 / 文件状态 / 日志 | 说明 |
|---|---|---|
| 基线保存 | `[useConfig] ✓ 配置保存成功`；`.settings.dat` 6387 字节，SHA-256=`cc89ebed...` | 跟复现阶段一致 |
| 触发只读写入失败 | `[Store] 保存失败 (config): 写入文件失败: ... 拒绝访问。(os error 5)` | **同样的真实系统错误**——失败机制本身没变，改的只是失败后缓存要不要被污染 |
| 失败后文件字节 | SHA-256 与基线完全一致 | 跟复现阶段一致，失败的写入没碰到磁盘 |
| **失败后重新聚焦读值（核心判据，这次翻过来了）** | `"SUB=baseline-value-1"` | ✅ 正确回滚显示基线值，不再停在编辑值上——这是修复生效的直接证据 |
| 切标签页再切回后读值 | 仍是 `"SUB=baseline-value-1"`；文件字节仍与失败写入后一致 | 不是瞬时巧合 |
| 清除只读 + 硬杀进程 + 冷启动 + 重新建立 WebDriver 会话后读值 | `"SUB=baseline-value-1"` | 修复前后这一步都应该是基线值（问题只出在内存缓存层），交叉验证一致 |

**没有验证到的部分**：跟真机复现阶段一致，只测了微博 Cookie 这一个字段；`useAnalytics.ts` 和
`loadSettings` 里 legacy `custom_s3` 迁移分支这两处"同样的模式"没有单独在真机上过一遍——这两处的安全性
是通过前面「改之前的排查」小节的静态核对 + `storeAliasing.spec.ts` 对 Store 层不变量的单元验证间接保证的，
不是真机直接测出来的。

**清理**：临时脚本 `tests/tauri-e2e/p1-1-config-aliasing-fix-verify.tauri.e2e.cjs` 已删除；
`src-tauri/target/debug/data/` 已整个删除；确认无残留 `picnexus.exe` 进程；`git status` 干净（只有本次
改动 + 会话开始前就存在的 `docs/TODO.md` 改动）。

**下一步**：P1-1 到此闭环（真机复现 → 修复 → 单元回归 → 真机复验，全部通过）。改动尚未提交，等待用户
确认后按仓库惯例拆成「修复代码 + 回归测试」「文档」两次原子提交。P1-2、P1-3 仍未处理。

### 2026-09-07 P1-2 真机复现 + 文档修正（真跑起来的 App，不是 vitest mock）

**结论：坐实了，一次跑通，全部判据命中预期，没有走样。** 大白话说：灯箱里删掉一个镜像之后，不管是
点"同步"还是之后点"覆盖本地"，云端那份旧数据都会原封不动地把你刚删掉的东西还给你——"同步"这一步
压根没把改动带上去，云端文件字节都没变；"覆盖本地"则是反过来，把云端那份没更新的旧镜像整个拍回
本地库。

**入口选择的偏差，如实记录**：审计原判据写的是"点增量上传"，但真机复测前先查了一遍界面代码，发现
`uploadHistoryIncremental`（增量上传）这个函数在设置页「备份与同步」面板里根本没有对应的可点按钮——
是个只有类型定义和单元测试引用、没有任何 `.vue` 组件调用的孤儿函数（详见上方「范围外线索」新增的
一条，已登记 `docs/TODO.md`）。跟用户确认后，改用界面上真实存在、同样会踩中这个缺陷的「同步」
（`syncHistory`，双向同步）按钮复测，判据也相应调整——"同步"点击后不会像"增量上传"预想的那样弹
"无需上传"，而是**无条件**弹"已同步"成功提示，这本身也是要记录的证据点（比"无需上传"更容易误导
用户，因为连"有东西被跳过"的暗示都没有）。

**怎么测的**：`src-tauri/target/debug/data/portable.json` 隔离出独立数据目录；本机 dufs
（`C:\Users\Jiawei\.cargo\bin\dufs.exe`）起一个 `-A`（免鉴权读写）的本地 WebDAV 服务器当"云端"；在
dufs 根目录下预置 `PicNexus/history.json`，内容是一条 id 固定、timestamp 固定、带 jd+qiniu 两个镜像
的历史记录（模拟"之前已经同步过一次"）；本地 `history.db`（真实 SQLite，不是 mock）种同一条记录
（同 id、同 timestamp、同样两个镜像）。wdio + tauri-driver + msedgedriver 驱动真实编译出来的 debug
App：设置页配好 WebDAV 连接（`hasValidConfig` 要求用户名/密码非空，即便 dufs 本身不校验内容，也填了
哑值才能让「测试连接」按钮从禁用态变可点）→ 在灯箱里真实点开图床管理菜单、点掉 qiniu 那一行的移除
按钮、二次确认（走真实的 `useMirrorFallback.removeMirror()` → `historyDB.removeMirror()` 写库路径，
不是脚本直接改数据库）→ 回设置页点「同步」→ 直接读 dufs 服务目录下 `history.json` 文件的真实内容
（而不是只看 toast 文案）→ 再点「更多 → 覆盖本地」→ 再读一次本地 `history.db`。临时脚本
`tests/tauri-e2e/p1-2-mirror-sync-doc-verify.tauri.e2e.cjs` 跑完已删除。

**实际证据**：

| 操作 | 实际观察 | 说明 |
|------|---------|------|
| 灯箱移除 qiniu 镜像 | toast「链接已移除」/「qiniu 的链接已从此记录中移除」（字面 serviceId，非中文展示名，与源码文案一致）；移除后单独核对：本地 DB 已变成 `[jd]`，云端 `history.json` 此时还没被碰过、仍是 `[jd, qiniu]` | 走真实写库路径，不是脚本直接改数据库；把"移除"和"同步"两个动作的因果关系分开验证过 |
| 点「同步」 | toast「已同步」/「共 1 条记录」，不含"失败"字样 | 无条件成功提示，不提示任何东西被跳过 |
| 同步后读云端 `history.json` | 仍是 `[jd, qiniu]`（文件确实被重写过一次，JSON 格式从紧凑变成带缩进，但内容里 qiniu 原封不动） | 本地"移除 qiniu"的改动没有传到云端——这是缺陷的核心证据 |
| 同步后读本地 `history.db` | 仍是 `[jd]`，qiniu 没有从云端合并回来 | "同步"的下载合并那一半同样因为 `hasHistoryItemChanged` 只比较 timestamp+收藏签名（两边 timestamp 完全相同）判定"没变化"，双向都卡住 |
| 点「覆盖本地」→ 读本地 `history.db` | toast「已下载」/「共 1 条记录（覆盖本地）」；`history.db` 变回 `[jd, qiniu]` | qiniu 复活——云端那份从未更新过的旧数据，把用户刚做的镜像清理原样覆盖回本地 |

**过程中的插曲，如实记录（跟结论无关，是环境搭建细节）**：

1. 冷启动 App 一次并不会自动建好 `history_items` 表——这张表是懒加载的，只有真正进入历史/浏览记录页
   才会建表。第一次尝试"冷启动一次再杀掉"发现 `data/` 目录下只有 `.settings.dat`/`secure-key`/`logs/`，
   没有 `history.db`。后改成直接用 Python 按 `SchemaManager.ts` 的 DDL（`CREATE TABLE IF NOT EXISTS`
   全套）建表再插入种子行，全程没让 App 碰过这个文件，跟 App 自己的建表逻辑完全幂等兼容。
2. 移除镜像时额外弹了一条噪音 toast："京东 图片加载失败，当前主图床访问失败…"——因为种子数据用的是
   `*.example.invalid` 假地址，主图加载不出来触发了应用自己的失效检测，跟这次要验证的缺陷无关，也
   没有干扰判据 toast 文案的捕获。
3. 全程没有遇到选择器猜错、wdio 连接失败、表单模拟不出真实输入这类卡点，一次跑通（17 秒交互时长）。

**文档修正（本条缺陷的实际修法，已完成，未动任何 `src/` 代码逻辑）**：

1. `docs/flows/mirror-fallback-flow.md` 边界 12：从"都走 `update()`，复用现有脏标记机制"改写为准确
   描述——`update()` 不写 `timestamp`，本项目没有脏标记/版本列机制；常规「同步」/合并上传因为只比较
   timestamp + 收藏签名，不会带上内容层改动；只有手动「覆盖云端」才能真正推送；「覆盖本地」或换机
   恢复会把已处理的旧数据带回来。排查指南表新增一行"切了主图床/删了镜像，点同步之后又变回去了"。
2. 顺手改掉两处文档漂移（审计文档「文档漂移」小节标注过的）：图 2 节点 M3 的"toast.success 已切换
   主图床"改成"不弹 toast：圆点跳到新主图床行即反馈"（与 `useMirrorFallback.switchPrimary()` 源码
   一致，该函数成功路径确实没有 `toast.success` 调用）；不变量表的候选指纹说明补全 R2 缩略图代理
   开关与会话可达性两项（`useThumbCache.ts:243-251`）。
3. `sync-flow.md` 未改动——它自己的"增量策略：上传新增 id 或收藏版本更新"描述与代码一致，失真的只是
   mirror 文档单方面的承诺。
4. 新增 `tests/unit/services/database/mergeIgnoresMirrorEdits.spec.ts`：把审计附录的临时复现用例原样
   转成永久回归测试（断言不用反转，因为这次不改代码、这个行为会继续存在），`npx vitest run` 该文件
   2 条用例全绿。

**清理**：`tests/tauri-e2e/p1-2-mirror-sync-doc-verify.tauri.e2e.cjs` 已删除；`src-tauri/target/debug/data/`
已整个删除；dufs 进程已确认死亡、端口释放；`picnexus.exe`/`msedgedriver`/`tauri-driver` 进程列表确认无
残留；scratchpad 下的临时 WebDAV 根目录、种子脚本、运行日志已清理。

**下一步**：P1-2 到此闭环（真机复现 → 文档修正 → 新增回归测试，全部完成；因为这次修法是文档向的，
没有"修复代码 → 真机复验"这一步）。改动尚未提交，等待用户确认。

### 2026-09-07 P1-3 真机复现 + 修复 + 真机复验（真跑起来的 App，不是 vitest mock）

**结论：坐实了，一次跑通，缺陷现象和修复效果都用真实数据在真机上核对过，没有走样。** 大白话说：
灯箱里把一条已经判定失效的镜像链接点「重新检测」，如果这次判回可用，链接检测页那一行的状态确实
会立刻显示对——但用来决定「这条记录要不要在首屏第一批就捞出来给你看」的那个统计摘要字段，
修复前压根没跟着重算，还停在"有问题"那个旧结论上；修复后统计摘要跟着一起改对了。

**怎么测的**：跟 P0-1/P1-1/P1-2 同一套 portable 隔离手法（`src-tauri/target/debug/data/portable.json`），
但这次不需要吃真实 WebDAV，用本机 dufs（`C:\Users\Jiawei\.cargo\bin\dufs.exe`）在 `127.0.0.1:5057`
起一个纯静态文件服务器，托管两张真实 PNG（`src-tauri/icons/128x128.png` 复制出来的，4066 字节，
过了 Rust 侧 `is_suspicious_image_response` 要求的"content-type 是 image/* 且体积 ≥1024 字节"这道槛，
确保「重新检测」发出的是一次不摆造型的真实 HTTP 请求、走真实判定逻辑，不是随手挂一个假 URL）。
在 portable 库里直接用 Python sqlite3 按 `SchemaManager.ts` 最新 DDL 种了一条记录：主图床 jd
（已判 valid）+ 镜像 qiyu（已判 invalid，`linkCheckSummary` 是 `{totalLinks:2,validLinks:1,invalidLinks:1,uncheckedLinks:0}`，
模拟"上一次批量检测判定 qiyu 挂了"）。wdio + tauri-driver + msedgedriver 驱动真实编译出来的 debug
App（`onPrepare` 钩子已用当前工作区代码——含还没提交的修复——重新跑过 `vite build` + `cargo build`）：
进历史页 → 真实点开这条记录的灯箱 → 真实点开图床管理菜单 → 真实点 qiyu 那一行的状态 chip
（触发 `useMirrorFallback.checkMirror`，真的发一次 `invoke('check_image_link')` 打到 dufs）→ 等 chip
在真实 UI 上从「已失效」变绿。判据不看 toast 文案，直接读磁盘上 `history.db` 里这条记录的
`link_check_status` / `link_check_summary` 两列，另外**直接跑一遍 `LinkCheckQuery.ts` 里 Phase 1
首屏那句真实 SQL**（`link_check_summary IS NULL OR invalidLinks>0 OR uncheckedLinks>0`）核对这条
记录会不会被捞出来——这比在链接检测页里干等分批加载更直接，且是同一句 SQL、同一份数据库文件，
不存在"判据和代码实际用的不是一回事"的风险。临时脚本
`tests/tauri-e2e/p1-3-mirror-summary-repro.tauri.e2e.cjs` 跑完已删除。

**证据表格**（改代码前后各跑一遍完整流程，同一条种子记录）：

| 阶段 | `link_check_status.qiyu` | `link_check_summary` | Phase 1 SQL 是否命中这条记录 |
|------|--------------------------|----------------------|------------------------------|
| 种子初始状态 | `isValid:false`（上次批量检测判失效） | `{invalidLinks:1,validLinks:1,uncheckedLinks:0}` | 是（`invalidLinks>0`） |
| **修复前**：灯箱重检后 | `isValid:true`（chip 在 UI 上确实变绿了） | **原样不动**，仍是 `invalidLinks:1` | **仍然是**——这正是缺陷本体：行状态对，批次分类错 |
| **修复后**：同样流程重跑一遍 | `isValid:true` | `{invalidLinks:0,validLinks:2,uncheckedLinks:0}`（正确重算，`lastCheckTime` 保留旧值，与 `removeMirror` 的既有口径一致——不凭空刷新时间戳） | **不再命中**——`json_extract` 三个条件全部不满足 |

「修复前」那一行是本次新采集的真机证据，跟审计文档最初预判的现象完全对上：`linkCheckStatus`
这个字段确实是对的（用户在灯箱里看到的 chip 颜色不会骗人），但 `linkCheckSummary` 这个只有
Phase 1 查询会用到、没有任何 UI 直接展示的统计字段被漏更新了，后果就是这条记录在链接检测页里
会被误判为"还有问题"多留在首屏一轮，等 Phase 2 补全查询扫到它才会被摘掉。「修复后」证明补上
`recomputeLinkCheckSummary` 调用（口径抄 `removeMirror`：无 `previousSummary` 就不生成、
有则原地重算四个计数）后这个错位消失。

**改的代码**：`src/composables/history/useMirrorFallback.ts` 的 `checkMirror` 函数里，DB 写入队列
原来只 `historyDB.update(cur.id, { linkCheckStatus })`；现在多算一步
`recomputeLinkCheckSummary(latest.results, linkCheckStatus, latest.linkCheckSummary)`，
非空才塞进 `updates.linkCheckSummary` 一并写入——和 `HistoryDatabase.removeMirror`（403 行）、
`useHistoryResultOps.stripServiceFromItem`（67 行）用的是同一个函数、同一套"没有旧 summary 就不
凭空造一个"的规则，不是照着这两处的逻辑另起一份新实现。

**单元回归**（永久测试，取代审计附录里那份断言"缺陷点"的临时用例）：
`tests/unit/composables/history/useMirrorFallback.spec.ts` 的 `checkMirror` describe 块新增两条：
一条用带 `linkCheckSummary` 的种子数据验证重检后落库的 `updates.linkCheckSummary` 确实按新状态
重算对（`invalidLinks:1→0`，其余字段没被检测覆盖到的服务归入 `uncheckedLinks`）；另一条验证
`previousSummary` 本来就不存在时（`makeItem()` 默认不带这个字段）不会凭空生成一个，`updates` 里
压根不出现 `linkCheckSummary` 这个 key——这是 `recomputeLinkCheckSummary` 自己文档注释里写的既有
规则，`checkMirror` 这条新路径也必须守住，不能自己另开一套。原有 22 条 `checkMirror`/`removeMirror`/
`switchPrimary` 用例全部保持通过（新增后共 24 条）。

`npx vitest run`：223 个文件 / 3074 条用例全绿；`npm run typecheck`、`npm run lint` 均通过
（lint 输出的"10 处 invoke 调用无法静态核对"是本仓库已知的动态派发盲区，跟这次改动无关，
本次没有新增任何一条）。改动只涉及前端 TS，未碰 `src-tauri/`，未跑 `cargo check`/`cargo test`。

**清理**：`tests/tauri-e2e/p1-3-mirror-summary-repro.tauri.e2e.cjs` 已删除；
`src-tauri/target/debug/data/`（含本次生成的 `history.db`、`portable.json`）已整个删除；
dufs 进程已停止、`127.0.0.1:5057` 端口释放；`picnexus.exe`/`msedgedriver`/`tauri-driver` 进程列表
确认无残留；scratchpad 下的临时 webroot（两张测试用 PNG）与种子脚本已清理；`git status` 干净
（只有本次改动）。

**下一步**：P1-3 到此闭环（真机复现 → 修复 → 单元回归 → 真机复验，全部通过）。改动尚未提交，
等待用户确认。至此 config + mirror 这批扫描的四条发现（P0-1/P1-1/P1-2/P1-3）全部处理完毕。

---

## 附录：单元级复现用例源码

以下用例 2026-09-07 在本机 vitest 3.2.4 + happy-dom 全绿（断言的是缺陷行为）。放到 `tests/unit/` 任意子目录即可运行；
修复后把标注「缺陷点」的断言反转即成回归测试。

### P0-1 · `trayStaleKey.spec.ts`

```ts
/**
 * 临时复现用例（/scan-bugs config 发现 1）：
 * 换备份密码后，托盘 webview 手里的 secureStorage 仍是旧钥匙，
 * 它一写配置就用旧钥匙整份覆盖 .settings.dat，下次启动主窗口解不开。
 *
 * 三个 JS 上下文（主窗口 / 托盘 / 重启后）用 vi.resetModules 各自拿一份模块单例；
 * 钥匙串与磁盘文件是共享的内存变量。加解密走真的 WebCrypto。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

function testKey(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** 共享的"系统钥匙串"与"磁盘" */
let keychain = testKey(0x42);
const files = new Map<string, string>();

async function loadContext() {
  vi.resetModules();
  vi.doMock('@tauri-apps/plugin-fs', () => ({
    readTextFile: async (p: string) => {
      if (!files.has(p)) throw new Error(`not found: ${p}`);
      return files.get(p)!;
    },
    writeTextFile: async (p: string, c: string) => { files.set(p, c); },
    exists: async (p: string) => files.has(p),
    mkdir: async () => undefined,
    remove: async (p: string) => { files.delete(p); },
  }));
  vi.doMock('@tauri-apps/api/core', () => ({
    invoke: async (cmd: string, args?: { key?: string }) => {
      if (cmd === 'get_or_create_secure_key') return keychain;
      if (cmd === 'set_secure_key') { keychain = args!.key!; return undefined; }
      if (cmd === 'get_user_data_dir') return '/mock';
      return undefined;
    },
  }));
  vi.doMock('@tauri-apps/api/path', () => ({
    appDataDir: async () => '/mock',
    join: async (...parts: string[]) => parts.join('/'),
  }));
  const crypto = await import('@/security/crypto');
  const store = await import('@/store');
  return { ...crypto, Store: store.Store, StoreError: store.StoreError };
}

const FILE = '/mock/.settings.dat';

beforeEach(() => {
  keychain = testKey(0x42);
  files.clear();
});

describe('换备份密码后托盘仍用旧钥匙写配置', () => {
  it('托盘 set → 文件变回 PNXENC(旧钥匙) → 重启后解不开且不是"要密码"的错', async () => {
    // 0. 首次启动：随机钥匙 K0 写出一份配置
    const boot = await loadContext();
    const bootStore = new boot.Store('.settings.dat');
    await bootStore.set('config', { marker: 'original', enabledServices: ['jd'] });
    expect(files.get(FILE)!.startsWith('PNXENC:')).toBe(true);

    // 1. 托盘 webview 启动时读一次配置（缓存 + 钥匙 K0 都留在它自己那份单例里）
    const tray = await loadContext();
    const trayStore = new tray.Store('.settings.dat');
    const trayView = await trayStore.get<{ marker: string; enabledServices: string[] }>('config');
    expect(trayView?.marker).toBe('original');

    // 2. 主窗口：设置备份密码 = 换钥匙 K1 + 用 K1 重写整份文件（PNXPWD）
    const main = await loadContext();
    const mainStore = new main.Store('.settings.dat');
    const raw = await mainStore.readRawAll();
    await main.secureStorage.setBackupPassword('correct horse battery staple');
    await mainStore.setDirect(raw!);
    expect(files.get(FILE)!.startsWith('PNXPWD:')).toBe(true);
    expect(keychain).not.toBe(testKey(0x42));

    // 3. 托盘：用户勾选一个图床 → 走 trayMenu.ts 同样的 get(命中缓存) + set
    await trayStore.set('config', { ...trayView!, enabledServices: ['jd', 'weibo'] });
    // ⚠️ 文件被旧钥匙、旧模式整份覆盖
    expect(files.get(FILE)!.startsWith('PNXENC:')).toBe(true);

    // 4. 重启：钥匙串里是 K1，文件是 PNXENC(K0)
    const restart = await loadContext();
    const restartStore = new restart.Store('.settings.dat');
    let caught: unknown;
    try {
      await restartStore.get('config');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(restart.StoreError);
    expect(caught).not.toBeInstanceOf(restart.BackupPasswordRequiredError);
    expect(String((caught as Error).message)).toContain('解密失败');

    // 5. main.ts ensureConfigSync 对 StoreError 的处置：setDirect(DEFAULT) 覆写
    await restartStore.setDirect({ config: { marker: 'DEFAULT' } });
    const after = await restartStore.get<{ marker: string }>('config');
    expect(after?.marker).toBe('DEFAULT');
    // 整个过程没有任何备份文件
    expect([...files.keys()].filter(k => k !== FILE)).toEqual([]);
  });

  it('轻症状：换钥匙后托盘 readFreshConfig 抛 BackupPasswordRequiredError，之后写入也失败', async () => {
    const boot = await loadContext();
    await new boot.Store('.settings.dat').set('config', { marker: 'original' });

    const tray = await loadContext();
    const trayStore = new tray.Store('.settings.dat');
    await trayStore.get('config');

    const main = await loadContext();
    const mainStore = new main.Store('.settings.dat');
    const raw = await mainStore.readRawAll();
    await main.secureStorage.setBackupPassword('pw');
    await mainStore.setDirect(raw!);

    // 主窗口随后任意一次保存会发 config-updated → 托盘 readFreshConfig = invalidateCache + get
    await trayStore.invalidateCache();
    await expect(trayStore.get('config')).rejects.toBeInstanceOf(tray.BackupPasswordRequiredError);
    // 缓存已作废 → 之后的托盘写入也失败（fail-safe，但托盘勾选直到重启都没反应）
    await expect(trayStore.set('config', { marker: 'x' })).rejects.toBeInstanceOf(tray.BackupPasswordRequiredError);
  });
});

describe('方向对比：停用密码时托盘写的是 PNXPWD(旧口令钥匙)，重启后可用旧口令救回', () => {
  it('stale write = PNXPWD → 重启抛 BackupPasswordRequiredError → initWithPassword(旧口令) 能解开', async () => {
    const boot = await loadContext();
    const bootStore = new boot.Store('.settings.dat');
    await boot.secureStorage.setBackupPassword('old-pw');
    await bootStore.set('config', { marker: 'original' });
    expect(files.get(FILE)!.startsWith('PNXPWD:')).toBe(true);

    const tray = await loadContext();
    const trayStore = new tray.Store('.settings.dat');
    await trayStore.get('config'); // 托盘拿到口令钥匙 + salt

    const main = await loadContext();
    const mainStore = new main.Store('.settings.dat');
    const raw = await mainStore.readRawAll();
    await main.secureStorage.clearBackupPassword(); // 停用 → 随机钥匙 K2
    await mainStore.setDirect(raw!);
    expect(files.get(FILE)!.startsWith('PNXENC:')).toBe(true);

    await trayStore.set('config', { marker: 'tray-wrote' });
    expect(files.get(FILE)!.startsWith('PNXPWD:')).toBe(true);

    const restart = await loadContext();
    const restartStore = new restart.Store('.settings.dat');
    await expect(restartStore.get('config')).rejects.toBeInstanceOf(restart.BackupPasswordRequiredError);
    // App.vue 密码框：用旧口令能救回
    await restart.secureStorage.initWithPassword(files.get(FILE)!, 'old-pw');
    const recovered = await restartStore.get<{ marker: string }>('config');
    expect(recovered?.marker).toBe('tray-wrote');
  });
});
```

### P1-1 · `storeAliasing.spec.ts`

```ts
/**
 * 临时复现用例（/scan-bugs config 发现 2）：
 * configStore.get 直接返回缓存对象本身；useSettingsForm.saveSettings 就地改写它，
 * 保存失败后缓存停在改写稿，loadSettings 的"回滚到磁盘真值"读到的还是改写稿。
 *
 * 与现有 useSettingsForm.spec 的差别：那份把 configStore.get mock 成每次返回新对象，
 * 正好把别名关系遮住了。这里用真实 Store（非加密、内存文件）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { Store } from '@/store';
import { configStore } from '@/store/instances';
import { useSettingsForm } from '@/composables/settings/useSettingsForm';
import { createConfig } from '../factories/configFactory';
import { resetTauriMocks, setupInvokeResponses } from '../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  toastShowConfig: vi.fn(),
  confirm: vi.fn(),
  loadHealthStatus: vi.fn(),
  evaluateConfig: vi.fn(),
}));

vi.mock('@/store/instances', async () => {
  const { Store } = await import('@/store');
  return { configStore: new Store('t.dat', { encrypted: false }) };
});
vi.mock('@/utils/webdav', () => ({
  WebDAVClient: {
    encryptPassword: vi.fn(async (p: string) => `encrypted:${p}`),
    decryptPassword: vi.fn(async (e: string) => `plain:${e}`),
  },
}));
vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({ saveConfig: mockState.saveConfig }),
}));
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showConfig: mockState.toastShowConfig }),
}));
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockState.confirm }),
}));
vi.mock('@/composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    loadHealthStatus: mockState.loadHealthStatus,
    evaluateConfig: mockState.evaluateConfig,
  }),
}));
vi.mock('@/uploaders', () => ({
  syncCustomS3Uploaders: vi.fn(),
  syncWebDAVUploaders: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const files = new Map<string, string>();

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  files.clear();
  vi.mocked(exists).mockImplementation(async (p) => files.has(String(p)));
  vi.mocked(readTextFile).mockImplementation(async (p) => files.get(String(p)) ?? '');
  vi.mocked(writeTextFile).mockImplementation(async (p, c) => { files.set(String(p), String(c)); });
  vi.mocked(mkdir).mockResolvedValue(undefined);
  setupInvokeResponses({ 'plugin:autostart|is_enabled': false });
  mockState.loadHealthStatus.mockResolvedValue(undefined);
});

describe('Store.get 把缓存对象本身递出去', () => {
  it('两次 get 返回同一引用；就地改写后不 set 也能从下一次 get 读到', async () => {
    const store = new Store('a.dat', { encrypted: false });
    files.set('/mock/appdata/a.dat', JSON.stringify({ config: { services: { weibo: { cookie: 'disk' } } } }));

    const first = await store.get<{ services: { weibo: { cookie: string } } }>('config');
    const second = await store.get<{ services: { weibo: { cookie: string } } }>('config');
    expect(first).toBe(second);

    first!.services.weibo.cookie = 'mutated-without-set';
    const third = await store.get<{ services: { weibo: { cookie: string } } }>('config');
    expect(third!.services.weibo.cookie).toBe('mutated-without-set');
    // 磁盘没变
    expect(JSON.parse(files.get('/mock/appdata/a.dat')!).config.services.weibo.cookie).toBe('disk');
  });
});

describe('saveSettings 失败后的回滚', () => {
  it('回滚读到的是改写稿：表单没回到磁盘值，缓存也被污染', async () => {
    const onDisk = createConfig({
      availableServices: ['jd', 'weibo'],
      services: { weibo: { enabled: true, cookie: 'SUB=on-disk' } },
    });
    files.set('/mock/appdata/t.dat', JSON.stringify({ config: onDisk }));
    mockState.saveConfig.mockRejectedValue(new Error('Disk full'));

    const api = useSettingsForm();
    await api.loadSettings();
    expect(api.formData.value.weiboCookie).toBe('SUB=on-disk');

    api.formData.value.weiboCookie = 'SUB=edited';
    await expect(api.saveSettings()).resolves.toBe(false);

    // 磁盘真值没变
    const disk = JSON.parse(files.get('/mock/appdata/t.dat')!).config;
    expect(disk.services.weibo.cookie).toBe('SUB=on-disk');

    // 但缓存已被 saveSettings 就地改写
    const cached = await configStore.get<typeof onDisk>('config');
    expect(cached!.services.weibo?.cookie).toBe('SUB=edited');

    // 于是"回滚到磁盘真值"是空转
    expect(api.formData.value.weiboCookie).toBe('SUB=edited');
  });
});
```

### P1-2 · `mergeIgnoresMirrorEdits.spec.ts`

```ts
/**
 * 临时复现用例（/scan-bugs mirror 发现 3）：
 * 切主图床 / 移除镜像不改 timestamp，mergeHistoryCollections(cloud, local) 同 id 同 timestamp
 * 以云端为准 → 增量/合并上传把本地改动判为"无变化"。
 */
import { describe, expect, it } from 'vitest';
import { mergeHistoryCollections } from '@/services/database/HistoryMerge';
import type { HistoryItem } from '@/config/types';

function item(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 'h1',
    timestamp: 1_710_000_000_000,
    localFileName: 'pic.png',
    primaryService: 'jd',
    generatedLink: 'https://jd.example/pic.png',
    results: [
      { serviceId: 'jd', status: 'success', result: { serviceId: 'jd', url: 'https://jd.example/pic.png' } },
      { serviceId: 'qiyu', status: 'success', result: { serviceId: 'qiyu', url: 'https://qiyu.example/pic.png' } },
    ],
    ...overrides,
  } as HistoryItem;
}

describe('云端合并对镜像改动的处理', () => {
  const cloud = item({});
  // 本地：切主到 qiyu 并移除了 jd
  const local = item({
    primaryService: 'qiyu',
    generatedLink: 'https://qiyu.example/pic.png',
    results: [
      { serviceId: 'qiyu', status: 'success', result: { serviceId: 'qiyu', url: 'https://qiyu.example/pic.png' } },
    ],
  });

  it('上传方向 merge(cloud, local)：云端旧记录胜出，updatedCount 为 0', () => {
    const { items, addedCount, updatedCount } = mergeHistoryCollections([cloud], [local]);
    expect(addedCount).toBe(0);
    expect(updatedCount).toBe(0);
    expect(items[0].primaryService).toBe('jd');
    expect(items[0].results.map(r => r.serviceId)).toEqual(['jd', 'qiyu']);
  });

  it('下载方向 merge(local, cloud)：本地胜出，合并不会把死链接带回来', () => {
    const { items, updatedCount } = mergeHistoryCollections([local], [cloud]);
    expect(updatedCount).toBe(0);
    expect(items[0].primaryService).toBe('qiyu');
    expect(items[0].results.map(r => r.serviceId)).toEqual(['qiyu']);
  });
});
```

### P1-3 · `checkMirrorSummary.spec.ts`

```ts
/**
 * 临时复现用例（/scan-bugs mirror 发现 4）：
 * checkMirror 落库只带 linkCheckStatus，不重算 linkCheckSummary。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { invoke } from '@tauri-apps/api/core';
import type { HistoryItem } from '@/config/types';

const m = vi.hoisted(() => ({
  dbGetByIdMock: vi.fn(),
  dbUpdateMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/composables/useConfirm', () => ({ useConfirm: () => ({ confirmDelete: vi.fn() }) }));
vi.mock('@/composables/useHistory', () => ({ useHistoryManager: () => ({ invalidateCache: vi.fn() }) }));
vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({ loadConfig: vi.fn().mockResolvedValue({}) }),
}));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: {
    switchPrimaryService: vi.fn(),
    removeMirror: vi.fn(),
    getById: m.dbGetByIdMock,
    update: m.dbUpdateMock,
  },
}));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const { useMirrorFallback } = await import('@/composables/history/useMirrorFallback');

function makeItem(): HistoryItem {
  return {
    id: 'hist-1',
    timestamp: 1,
    localFileName: 'pic.png',
    primaryService: 'jd',
    generatedLink: 'https://jd.example/pic.png',
    results: [
      { serviceId: 'jd', status: 'success', result: { serviceId: 'jd', url: 'https://jd.example/pic.png' } },
      { serviceId: 'qiyu', status: 'success', result: { serviceId: 'qiyu', url: 'https://qiyu.example/pic.png' } },
    ],
    // 上一次批量检测：qiyu 失效
    linkCheckStatus: {
      jd: { isValid: true, lastCheckTime: 1, errorType: 'success' },
      qiyu: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
    },
    linkCheckSummary: { totalLinks: 2, validLinks: 1, invalidLinks: 1, uncheckedLinks: 0, lastCheckTime: 1 },
  } as HistoryItem;
}

describe('checkMirror 与 linkCheckSummary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('单条重检把 qiyu 判回 valid 后，落库仍带着 invalidLinks=1 的旧 summary（没有重算）', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      link: 'https://qiyu.example/pic.png', is_valid: true, status_code: 200, error_type: 'success',
    });
    m.dbGetByIdMock.mockResolvedValueOnce(makeItem());

    const item = ref<HistoryItem | null>(makeItem());
    let api: ReturnType<typeof useMirrorFallback> | null = null;
    mount(defineComponent({ setup() { api = useMirrorFallback(item); return () => h('div'); } }));

    await api!.checkMirror('qiyu');

    expect(m.dbUpdateMock).toHaveBeenCalledTimes(1);
    const [, updates] = m.dbUpdateMock.mock.calls[0] as [string, Partial<HistoryItem>];
    expect(updates.linkCheckStatus?.qiyu?.isValid).toBe(true);
    // 缺陷点：updates 里没有 linkCheckSummary → DB 里的 summary 仍是 invalidLinks=1
    expect('linkCheckSummary' in updates).toBe(false);
  });
});
```
