# 数据持久化

> 配置存储、历史记录、缩略图缓存的数据流图解。排查数据丢失或异常时查看此文档。

---

## 图 3：配置加载与保存流

展示 AES-GCM 加密配置的读写流程，重点关注**异常分支**（解密失败、备份密码）。

> **关键源文件**：`src/composables/useConfig.ts`、`src/store/instances.ts`、`src/crypto.ts`

### 配置加载

```mermaid
flowchart TD
    A[应用启动 / App.onMounted] --> B[useConfig.loadConfig]
    B --> C[configStore.get&lpar;'config', DEFAULT_CONFIG&rpar;]
    C --> D[Store.get → 读取 .settings.dat]

    D --> E{文件存在?}
    E -- 否 --> E1[返回 DEFAULT_CONFIG]
    E -- 是 --> F[读取文件内容]

    F --> G{已加密?}
    G -- 否 --> H[JSON.parse → UserConfig]
    G -- 是 --> I[secureStorage.decrypt&lpar;AES-GCM&rpar;]

    I --> J{解密成功?}
    J -- 成功 --> H
    J -- 失败 --> K{BackupPasswordRequiredError?}
    K -- 是 --> L[抛出异常 → 显示 BackupPasswordDialog]
    K -- 否 --> M[降级为 DEFAULT_CONFIG + 错误提示]

    L --> N[用户输入备份密码]
    N --> O[secureStorage.initWithPassword]
    O --> P{密码正确?}
    P -- 是 --> I
    P -- 否 --> Q[提示密码错误，重新输入]
    Q --> N

    H --> R[config.value = loadedConfig]
    E1 --> R
    M --> R
    R --> S[组件通过 useConfig&lpar;&rpar;.config 响应式访问]

    style L fill:#fff3e0,stroke:#ef6c00
    style M fill:#ffebee,stroke:#c62828
    style S fill:#e8f5e9,stroke:#2e7d32
```

### 配置保存

```mermaid
flowchart TD
    A[用户修改设置] --> B[useConfig.saveConfig&lpar;newConfig&rpar;]
    B --> C[toPlainConfig&lpar;&rpar; 序列化]
    C --> D[验证：至少一个可用图床]
    D --> E{验证通过?}
    E -- 否 --> E1[Toast 错误提示]
    E -- 是 --> F[configStore.set&lpar;'config', configToSave&rpar;]

    F --> G[Store 内部：mutex 互斥锁获取]
    G --> H[secureStorage.encrypt&lpar;AES-GCM&rpar;]
    H --> I[writeTextFile&lpar;.settings.dat&rpar;]
    I --> J[memCache 更新]
    J --> K[mutex 释放]

    K --> L[configStore.save&lpar;&rpar;]
    L --> M[config.value 内存更新]
    M --> N["emit('config-updated') 通知其他组件"]
    N --> O[各组件 listen 回调刷新状态]

    style E1 fill:#ffebee,stroke:#c62828
    style O fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 4：历史记录数据流

展示上传历史的写入、读取和删除路径。排查**历史不显示**或**数据不同步**时重点查看。

> **关键源文件**：`src/composables/useHistory.ts`、`src/composables/useHistorySaver.ts`、`src/services/database/HistoryDatabase.ts`

```mermaid
flowchart TD
    subgraph 写入路径
        W1[上传成功 → onServiceResult 回调]
        W1 --> W2{第一个成功的服务?}
        W2 -- 是 --> W3["saveHistoryItemImmediate<br/>构造 HistoryItem: id + services + metadata"]
        W2 -- 否 --> W4["addResultToHistoryItem<br/>追加 service URL 到已有记录"]
        W3 --> W5[historyDB.insert → SQLite INSERT]
        W4 --> W6[historyDB.updateServiceUrls → SQLite UPDATE]
        W5 & W6 --> W7["emitHistoryUpdated → cacheEvents 通知"]
    end

    subgraph 读取路径
        R1[视图挂载 / 激活]
        R1 --> R2{stats 缓存有效? TTL 5 分钟}
        R2 -- 有效 --> R3[复用 totalCount / favoriteSet / timePeriodStats]
        R2 -- 过期/无 --> R4[historyDB.open → 确保连接]
        R4 --> R5["loadStats：并行 getCount + getFavoriteIdList"]
        R5 --> R6[更新 stats + lastStatsLoadTime + dataVersion++]
        R6 --> R3
        R3 --> R7[视图各自走服务端分页/按日聚合拉取条目]
        R7 --> R8[Vue reactivity → 视图渲染]
    end

    subgraph 删除路径
        D1[用户点击删除]
        D1 --> D2[historyDB.delete → SQLite DELETE]
        D2 --> D3["emitHistoryDeleted(ids)"]
        D3 --> D4["模块只更新 stats：totalCount-- / favoriteSet 移除"]
        D4 --> D5[视图各自监听 history-deleted 重拉本页]
        D5 --> D6[dataVersion++ → 响应式更新]
    end

    subgraph 搜索路径
        S1[用户输入搜索关键词]
        S1 --> S2["historyDB.search(keyword, options)"]
        S2 --> S3[SQLite LIKE 模糊匹配]
        S3 --> S4[返回 SearchResult → 视图渲染]
    end

    W7 -.-> R2
    D3 -.-> D4

    style W3 fill:#e3f2fd,stroke:#1976d2
    style W4 fill:#e3f2fd,stroke:#1976d2
    style R8 fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 5：缩略图缓存流

展示缩略图 URL 的生成策略。排查**缩略图不显示**或**加载慢**时查看。

> **关键源文件**：`src/composables/useThumbCache.ts`

```mermaid
flowchart TD
    A[组件请求缩略图 URL] --> B[useThumbCache.getThumb&lpar;item&rpar;]
    B --> C{"内存缓存命中?<br/>(Map, max 500)"}
    C -- 命中 --> D[直接返回缓存 URL]
    C -- 未命中 --> E[根据 serviceId 生成缩略图 URL]

    E --> F{serviceId 类型}

    F -- weibo --> G1["thumb150/{fileKey}.jpg<br/>+ 链接前缀"]
    F -- r2 --> G2["wsrv.nl 代理<br/>75x75 WebP"]
    F -- jd --> G3["s76x76_jfs/ 前缀替换"]
    F -- zhihu --> G4["_xs 后缀"]
    F -- qiyu --> G5["NOS ?imageView 参数"]
    F -- nami --> G6["火山引擎 TOS 参数"]
    F -- nowcoder --> G7["阿里 OSS 参数"]
    F -- bilibili --> G8["@75w_75h_1c_80q.webp"]
    F -- chaoxing --> G9["替换域名 + 75_0cQ80.webp"]
    F -- 其他 --> G10[直接使用原图 URL]

    G1 & G2 & G3 & G4 & G5 & G6 & G7 & G8 & G9 & G10 --> H[写入内存缓存]
    H --> D

    style D fill:#e8f5e9,stroke:#2e7d32
    style G10 fill:#fff3e0,stroke:#ef6c00
```

---

## 排查指南

| 现象 | 可能原因 | 对照图表位置 |
|------|---------|-------------|
| 配置丢失/恢复默认 | .settings.dat 解密失败，降级为 DEFAULT_CONFIG | 图3 加载流节点 M |
| 弹出密码输入框 | 更换设备或密钥丢失，触发 BackupPasswordRequired | 图3 加载流节点 L |
| 配置保存后其他组件未更新 | `config-updated` 事件未触发或监听未注册 | 图3 保存流节点 N → O |
| 历史记录不显示 | TTL 缓存过期但 reloadSharedData 失败 | 图4 读取路径 R4 → R5 |
| 删除后列表未更新 | cacheEvents 监听未初始化 | 图4 删除路径 D3 → D4 |
| 缩略图显示原图（很大） | serviceId 未匹配到任何缩略图策略 | 图5 节点 G10 |
| 微博缩略图 404 | fileKey 缺失，回退到原图 URL | 图5 weibo 分支 G1 |

---

## 相关文档

- [Composables API](../reference/api/composables.md) — useConfig / useHistory / useThumbCache 接口索引
- [模块依赖图](../reference/architecture/dependencies.md) — 修改前查影响范围
- [历史查询流程](./history-flow.md) — 历史记录的缓存、搜索与分页
- [同步流程](./sync-flow.md) — 配置/历史的 WebDAV 云同步
- [上传流程](./upload-flow.md) — 上传完成后写入历史记录
- [批量迁移流程](./batch-migrate-flow.md) — 迁移过程中读写历史数据库
