# 批量迁移流程

> 将图片从一个图床批量迁移到另一个图床。选择目标 → 筛选范围 → 下载 + 上传 → 更新历史记录。
> 排查「迁移速度慢」「格式转换失败」「重复迁移」时查看此文档。

---

## 图 1：四阶段总览

展示从 configuring 到 done 的整体流程，以及各阶段间的状态转移。

> **关键源文件**：`src/types/batchMigrate.ts`（`MigratePhase`）、`src/composables/useBatchMigrate.ts`（`useBatchMigrateManager`）

```mermaid
flowchart TD
    A["进入批量迁移面板"] --> B["initConfiguring()"]
    B --> C["读取配置<br/>filterConfiguredServices"]
    C --> D["构建 targetServices 列表<br/>保留上次勾选状态"]
    D --> E["applyFilter()<br/>查询各图床 pendingCount"]
    E --> F["configuring 阶段<br/>用户勾选目标图床"]

    F --> G{allBackedUp?<br/>所有图床 pending=0}
    G -- 是 --> G1["提示：已全部备份"]
    G -- 否 --> H["用户点击「开始迁移」"]

    H --> I["migrating 阶段<br/>startMigrate()"]
    I --> J["分页执行<br/>（见图 4）"]
    J --> K["done 阶段<br/>显示结果统计"]

    K --> L{用户操作}
    L -- "重试失败" --> M["retryFailed()"]
    M --> M1["applyFilter() 重算 pending"]
    M1 --> I
    L -- "返回配置" --> N["resetToConfiguring()"]
    N --> B

    %% 取消
    I -.-> O["cancelMigrate()<br/>isCancelled = true"]
    O --> K

    style F fill:#e3f2fd,stroke:#1976d2
    style I fill:#e3f2fd,stroke:#1976d2
    style K fill:#e8f5e9,stroke:#2e7d32
    style O fill:#fff3e0,stroke:#ef6c00
```

---

## 图 2：配置与筛选阶段

展示 `initConfiguring` 和 `applyFilter` 中双重分布查询的逻辑。解答「pendingCount 怎么算」。

> **关键源文件**：`src/composables/useBatchMigrate.ts`（`initConfiguring`、`applyFilter`）

```mermaid
flowchart TD
    A["initConfiguring() 入口"] --> B["cachedConfig = null<br/>清空缓存，确保读最新"]
    B --> C["getOrCacheConfig()<br/>从 configStore 读取"]
    C --> D["new MultiServiceUploader()"]
    D --> E["filterConfiguredServices<br/>筛出已配置的图床"]
    E --> F["构建 targetServices<br/>保留 prevChecked 勾选状态"]
    F --> G{仅 1 个已配置<br/>且无勾选?}
    G -- 是 --> G1["自动预勾选"]
    G -- 否 --> H["调用 applyFilter()"]
    G1 --> H

    H --> I["三路并行查询"]

    subgraph 并行查询
        I1["getItemsByBackupCount(params, limit:1)<br/>获取总数 total"]
        I2["getServiceDistribution(params)<br/>带来源筛选的分布"]
        I3["getServiceDistribution({maxSuccessCount})<br/>不带来源筛选的分布"]
    end
    I --> I1 & I2 & I3

    I1 & I2 --> J["计算每个目标图床<br/>pendingCount = total - existing"]
    I3 --> K["构建 availableSourceServices<br/>来源图床下拉列表"]

    J & K --> L["isFilterApplied = true<br/>配置阶段就绪"]

    style H fill:#e3f2fd,stroke:#1976d2
    style L fill:#e8f5e9,stroke:#2e7d32
```

### 双重分布查询说明

| 查询 | 参数 | 用途 |
|------|------|------|
| 带来源筛选 | `maxSuccessCount` + `hasServiceId` | 计算满足筛选条件的图片中，各目标图床的已有数量（total - existing = pending） |
| 不带来源筛选 | 仅 `maxSuccessCount` | 列出所有有记录的来源图床及其数量（构建筛选下拉列表） |

---

## 图 3：单图迁移管线

展示 `migrateOneItem` 中单张图片从下载到多目标上传的完整管线，包含格式转换逻辑。

> **关键源文件**：`src/composables/useBatchMigrate.ts`（`migrateOneItem`、`optimizeSourceUrl`、`convertIfNeeded`）

```mermaid
flowchart TD
    A["migrateOneItem(item, status, targets)"] --> B["计算 needUploadTargets<br/>过滤已存在于 item.results 的目标"]
    B --> C{needUploadTargets<br/>为空?}
    C -- 是 --> C1["status = skipped"]
    C -- 否 --> D{isCancelled?}
    D -- 是 --> D1["status = skipped"]
    D -- 否 --> E["查找下载源<br/>item.results.find(success)"]

    E --> F{有有效源?}
    F -- 否 --> F1["status = failed<br/>errorType = download"]
    F -- 是 --> G{任一目标不支持 webp<br/>且源为知乎 URL?}

    G -- 是 --> H["optimizeSourceUrl<br/>知乎 .webp → .jpg"]
    G -- 否 --> I["使用原始 URL"]
    H --> J["status = downloading"]
    I --> J

    J --> K["invoke('download_url_image')<br/>下载到临时目录"]
    K --> K1{下载成功?}
    K1 -- 否 --> K2["status = failed<br/>errorType = download"]
    K1 -- 是 --> L["累加 file_size 到统计"]

    L --> M{isCancelled?}
    M -- 是 --> M1["清理临时文件<br/>status = skipped"]
    M -- 否 --> N["status = uploading"]

    N --> O["逐目标上传循环"]
    O --> P{isCancelled?}
    P -- 是 --> Q["中断循环"]
    P -- 否 --> R["convertIfNeeded<br/>格式不兼容 → compress_image 转 jpeg"]
    R --> S["multiUploader.retryUpload<br/>上传到目标图床"]
    S --> S1{上传成功?}
    S1 -- 是 --> T["serviceResults[target] = success"]
    S1 -- 否 --> U["serviceResults[target] = failed"]
    T & U --> O

    Q & O --> V["清理临时文件<br/>下载的 + 格式转换的"]
    V --> W{hasSuccess?<br/>至少一个目标成功}
    W -- 是 --> X["historyDB.update<br/>追加 results"]
    X --> X1{DB 更新成功?}
    X1 -- 是 --> X2["status = success"]
    X1 -- 否 --> X3["status = failed<br/>errorType = upload"]
    W -- 否 --> Y["status = failed<br/>errorType = upload<br/>收集各目标错误信息"]

    style C1 fill:#e0e0e0,stroke:#616161
    style X2 fill:#e8f5e9,stroke:#2e7d32
    style F1 fill:#ffebee,stroke:#c62828
    style K2 fill:#ffebee,stroke:#c62828
    style Y fill:#ffebee,stroke:#c62828
```

### 格式兼容性表

| 场景 | 检测方法 | 处理 |
|------|---------|------|
| 知乎 webp → 不支持 webp 的目标 | `needsFormatConversion(targetId, 'webp')` | URL 改后缀 `.webp` → `.jpg`（知乎原生支持） |
| 下载文件格式不被目标支持 | `needsFormatConversion(targetId, ext)` | `compress_image` 转 jpeg（quality=92） |

---

## 图 4：分页执行与 offset 策略

展示 `startMigrate` 中分页查询、去重、offset 重置的循环逻辑。排查「重复迁移」或「漏处理」。

> **关键源文件**：`src/composables/useBatchMigrate.ts`（`startMigrate`）

```mermaid
flowchart TD
    A["startMigrate() 入口"] --> B["初始化<br/>totalToProcess = totalPending<br/>processedIds = new Set<br/>skipOffset = 0"]
    B --> C{isCancelled?}
    C -- 是 --> Z["构建 migrateResult<br/>phase = done"]
    C -- 否 --> D["historyDB.getItemsByBackupCount<br/>limit=100, offset=skipOffset"]

    D --> E{items 为空?}
    E -- 是 --> Z
    E -- 否 --> F["processedIds 过滤<br/>→ newItems"]

    F --> G{newItems 为空?}
    G -- 是 --> H["skipOffset += PAGE_SIZE<br/>当前页全是已处理项"]
    H --> I{skipOffset > 0<br/>且 >= queryTotal?}
    I -- 是 --> Z
    I -- 否 --> C

    G -- 否 --> J["创建 batchStatuses"]
    J --> K["processBatch<br/>Semaphore(MAX_CONCURRENT=2)"]
    K --> L["每个 item 完成 → onItemDone<br/>更新 counts + scheduleStatusUpdate"]
    L --> M["flushStatusUpdate()"]

    M --> N["记录所有 historyId<br/>到 processedIds"]
    N --> O{本批次有成功项?}
    O -- "是" --> P["skipOffset = 0<br/>成功项 success_count 变了<br/>从头重查"]
    O -- "否" --> Q["skipOffset += PAGE_SIZE<br/>翻页继续"]

    P --> R{skipOffset > 0<br/>且 >= queryTotal?}
    Q --> R
    R -- 是 --> Z
    R -- 否 --> C

    style A fill:#e3f2fd,stroke:#1976d2
    style Z fill:#e8f5e9,stroke:#2e7d32
    style K fill:#e3f2fd,stroke:#1976d2
```

### offset 重置策略说明

| 场景 | skipOffset 变化 | 原因 |
|------|----------------|------|
| 本批次有成功项 | 重置为 0 | 成功项 `success_count` 变化影响排序，需从头重查 |
| 本批次无成功项 | +PAGE_SIZE | 这些项暂时无法迁移，翻页查找后续项 |
| 当前页全是已处理项 | +PAGE_SIZE | 通过 `processedIds` 过滤后 newItems 为空 |
| `skipOffset > 0 且 >= queryTotal` | 终止循环 | 防无限翻页（`> 0` 守卫确保 offset=0 时不误终止） |

---

## 图 5：RAF 节流与 UI 更新

展示 `scheduleStatusUpdate` 中 requestAnimationFrame 节流和页面隐藏同步更新的机制。

> **关键源文件**：`src/composables/useBatchMigrate.ts`（`scheduleStatusUpdate`、`flushStatusUpdate`、统计卡 computed）

```mermaid
flowchart TD
    A["每个 item 完成<br/>onItemDone 回调"] --> B["更新 cumulativeCounts<br/>success / failed / skipped"]
    B --> C["更新 migrateStats<br/>processedCount / elapsedMs / totalBytes"]
    C --> D["调用 scheduleStatusUpdate"]

    D --> E{document.hidden?}
    E -- "是（页面不可见）" --> F["直接同步调用 updateStatusDisplay<br/>RAF 被跳过时的兜底"]
    E -- "否（页面可见）" --> G{rafPending?}
    G -- 是 --> H["只更新 pending 变量<br/>等 RAF 回调"]
    G -- 否 --> I["rafPending = true"]
    I --> J["requestAnimationFrame"]
    J --> K["updateStatusDisplay<br/>itemStatuses + globalProgress"]
    K --> L["rafPending = false"]

    M["批次结束"] --> N["flushStatusUpdate()<br/>强制刷新最终状态"]

    subgraph 统计卡计算
        O1["剩余时间<br/>(totalCount - processedCount) × avgMs<br/>processedCount=0 时显示「计算中」"]
        O2["平均速度<br/>totalBytes / (elapsedMs / 1000)<br/>单位 bytes/s"]
        O3["并发数<br/>itemStatuses.filter(downloading|uploading).length<br/>实时反映 Semaphore 占用"]
    end

    style F fill:#fff3e0,stroke:#ef6c00
    style K fill:#e8f5e9,stroke:#2e7d32
    style N fill:#e8f5e9,stroke:#2e7d32
```

### 实时统计卡计算

| 统计项 | 公式 | 边界情况 |
|--------|------|---------|
| 剩余时间 | `(totalCount - processedCount) × (elapsedMs / processedCount)` | `processedCount=0` 时显示「计算中」 |
| 平均速度 | `totalBytes / (elapsedMs / 1000)` bytes/s | `elapsedMs=0` 时返回 0 |
| 并发数 | `itemStatuses.filter(s => downloading \| uploading).length` | 实时反映 Semaphore(2) 占用数 |

---

## 排查指南

| 现象 | 可能原因 | 对照位置 |
|------|---------|---------|
| 目标图床 pendingCount 显示 0 | 所有图片已存在于该图床 | 图 2 `pendingCount = total - existing` |
| 迁移速度很慢 | `MAX_CONCURRENT=2` 限制 + 大文件下载耗时 | 图 3 信号量 / 图 4 循环 |
| webp 图片上传失败 | 目标图床不支持 webp 且格式转换失败 | 图 3 `convertIfNeeded` |
| 同一图片被重复迁移 | `processedIds` 未正确过滤或 offset 重置逻辑异常 | 图 4 去重 + offset 策略 |
| 进度条到 100% 但 phase 未变 done | 最后一批的 `flushStatusUpdate` 延迟 | 图 5 `flushStatusUpdate` |
| 统计卡一直显示「计算中」 | `processedCount` 始终为 0（可能全部 skipped 也算 processed） | 图 5 统计卡计算 |
| 知乎图片迁移后变模糊 | webp→jpg URL 优化生效但原图质量已低 | 图 3 知乎 URL 优化 |
| 迁移完成后历史记录未更新 | `historyDB.update` 失败 → `errorType='upload'` | 图 3 DB 更新失败分支 |
| 重试按钮点击后 pending=0 | `retryFailed` 先 `applyFilter` 重算，失败项可能已被其他操作处理 | 图 1 `retryFailed` |
| 高级筛选不生效 | `sourceServiceFilter` 为空数组表示「全部」，非「无」 | 图 2 `applyFilter` 参数 |

---

## 相关文档

- [上传流程](./upload-flow.md) — MultiServiceUploader 上传机制
- [数据持久化](./data-persistence.md) — historyDB 的查询和更新
- [链接监控流程](./link-check-flow.md) — 链接检测结果是迁移的数据来源
- [文档修复流程](./md-rescue-flow.md) — 另一个复用历史数据的功能
