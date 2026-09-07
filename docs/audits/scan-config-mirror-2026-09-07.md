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
| 2 | config | `configStore.get` 递出缓存原件，保存失败后回滚空转 | ✅ 2 条 | ⬜ 待安排 |
| 3 | mirror | 文档承诺切主/删镜像走「脏标记同步」，机制不存在 | ✅ 2 条（上传/下载两个方向） | ⬜ 待安排 |
| 4 | mirror | 灯箱单条重检不重算 `linkCheckSummary` | ✅ 1 条 | ⬜ 待安排（影响极小，可与 #3 一起看） |

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
  - 换钥匙只通知本窗口：[BackupPasswordSection.vue:96](../../src/components/settings/backup/BackupPasswordSection.vue#L96)
    `setDirect` + [:164](../../src/components/settings/backup/BackupPasswordSection.vue#L164) 只 `emit('secrets-rekeyed')`（Vue 组件事件）。
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

---

## 真机复测清单（修改前必做）

> ⚠️ P0-1 的复测会**真的清掉配置**。开始前先在「备份与同步」导出一份配置备份，并把 `.settings.dat` 手工复制一份。

| # | 步骤 | 预期（缺陷成立时） | 结果 |
|---|------|------------------|------|
| P0-1 主路径 | 无备份密码状态 → 设置页「设置密码」→ **不要**再改任何设置 → 关窗到托盘 → 托盘勾选一个图床 → 完全退出 → 重启 | 启动弹「密钥不匹配，配置已重置」，所有图床凭证消失；`%APPDATA%` 下无 `.settings.dat.corrupted.*` | ✅ 真机完全复现，见下方执行记录；已用于验证修复生效（见「真机复验结果」） |
| P0-1 轻症状 | 设置密码 → 在设置页随便改一项让它保存 → 托盘勾选图床 | 托盘勾选无反应（日志有 `BackupPasswordRequiredError`），重启后恢复 | ⬜ |
| P0-1 停用方向 | 已有密码 → 「关闭加密」→ 关窗到托盘 → 托盘切主题 → 重启 | 弹密码框；输**旧**口令能进，配置完整，但备份密码又变回「已加密」 | ⬜ |
| P1-1 | 设置页改微博 Cookie → 让保存失败（最省事：先把 `.settings.dat` 设为只读）→ 观察表单与「保存失败」提示 → 离开再回设置页 | 提示保存失败，但表单仍显示新 Cookie；回来还是新值；解除只读、重启后是旧值 | ⬜ |
| P1-2 | 一条多图床记录 → 灯箱移除一条镜像 → 「增量上传」 | toast「无需上传：本地没有新增或更新的记录」；「下载覆盖本地」后镜像回来 | ⬜ |
| P1-3 | 链接检测跑一遍得到一条失效 → 灯箱 chip 重检判回可用 → 重进链接检测页 | 首屏（Phase 1）仍含这条，行状态显示可用 | ⬜ |

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
