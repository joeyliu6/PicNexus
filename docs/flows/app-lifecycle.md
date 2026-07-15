# 应用生命周期

> 应用启动流程和 Cookie 登录流程。排查启动异常、登录失败时查看此文档。

---

## 图 8：应用启动流程

展示从 `main.ts` 初始化到应用就绪的完整步骤。重点关注**密码恢复分支**和**非阻塞初始化**。

> **关键源文件**：`src/main.ts`、`src/App.vue`

```mermaid
flowchart TD
    A[main.ts 入口] --> B[initializeUploaders 注册所有上传器]
    B --> C[ensureConfigSync 初始化配置]
    C --> D{密钥匹配?}
    D -- 不匹配 --> D1["startupFlags.configResetDueToKeyMismatch = true<br/>重置为默认配置"]
    D1 --> E
    D -- 匹配 --> E["useAnalytics.initialize 非阻塞<br/>生命周期事件交给本机隔离 Google tag"]
    E --> F[cleanupStoreBackups 清理过期备份]
    F --> G["createApp(App).mount('#app')"]

    G --> H[App.vue onMounted]
    H --> I[initializeTheme 主题初始化]
    I --> J[注册事件监听]

    J --> J1["window.offline / online"]
    J --> J2["visibilitychange 后台恢复"]
    J --> J3["onFocusChanged 窗口聚焦"]

    J --> K{密钥曾重置?}
    K -- 是 --> K1[Toast 警告：密钥不匹配]
    K -- 否 --> L

    K1 --> L[continueStartup]
    L --> L1[configStore.get 读取配置]
    L1 --> L2{启动时最小化?}
    L2 -- 是 --> L3[窗口保持隐藏]
    L2 -- 否 --> L4[getCurrentWindow.show]
    L3 & L4 --> M

    M[checkOnboarding 首次引导]
    M --> N[initGlobalShortcuts 全局快捷键]
    N --> O{自动更新启用?}
    O -- 是 --> O1["setTimeout 3秒后 checkForUpdate"]
    O -- 否 --> P
    O1 --> P

    P["checkAllAvailabilityWithCooldown<br/>图床可用性检测（非阻塞）"]
    P --> Q["startPeriodicCheck<br/>12小时周期性检测"]
    Q --> R[应用就绪 ✓]

    %% 密码恢复异常分支
    L -.-> ERR{抛出异常?}
    ERR -- BackupPasswordRequired --> PWD1[显示窗口]
    PWD1 --> PWD2[读取加密配置 .settings.dat]
    PWD2 --> PWD3[显示 BackupPasswordDialog]
    PWD3 --> PWD4{用户操作}
    PWD4 -- 输入密码 --> PWD5["secureStorage.initWithPassword"]
    PWD4 -- 跳过 --> PWD6[使用默认配置]
    PWD5 --> PWD7{密码正确?}
    PWD7 -- 是 --> PWD8["Toast: 恢复成功"]
    PWD7 -- 否 --> PWD9["onPasswordFailed 重新输入"]
    PWD9 --> PWD4
    PWD8 --> L
    PWD6 --> L
    ERR -- 其他错误 --> ERR1[log.error + 强制显示窗口]

    style R fill:#e8f5e9,stroke:#2e7d32
    style PWD3 fill:#fff3e0,stroke:#ef6c00
    style ERR1 fill:#ffebee,stroke:#c62828
    style D1 fill:#fff3e0,stroke:#ef6c00
```

---

## 图 9：Cookie 登录流程

展示自动获取 Cookie 的完整流程。排查**登录窗口无反应**或**Cookie 验证失败**时查看。

> **关键源文件**：`src/config/cookieProviders.ts`、`src/composables/useConfig.ts`

```mermaid
flowchart TD
    A[用户点击「自动获取 Cookie」] --> B["getCookieProvider(serviceId)"]
    B --> C{服务支持自动获取?}
    C -- 否 --> C1[提示：该服务不支持]
    C -- 是 --> D[获取 CookieProvider 配置]

    D --> E["打开登录窗口<br/>默认 1300x800"]
    E --> F[加载 loginUrl]
    F --> G[监听指定 domains 的 Cookie 变化]

    G --> H{平台}
    H -- Windows --> I[事件驱动监听<br/>实时捕获 Cookie 变化]
    H -- 非 Windows --> J["降级轮询<br/>初始延迟 2-3秒<br/>间隔 500ms-1秒"]

    I & J --> K[用户在窗口中完成登录]
    K --> L[捕获到 Cookie 字符串]
    L --> M["validateCookie(cookie, provider)"]

    M --> N{requiredFields 检查}
    N -- 缺失必填字段 --> N1["提示：缺少 XXX 字段<br/>继续等待..."]
    N1 --> K
    N -- 通过 --> O{fieldValueChecks}

    O -- 值不匹配 --> O1["提示：如微博 MLOGIN≠1<br/>继续等待..."]
    O1 --> K
    O -- 通过 --> P[Cookie 验证成功]

    P --> Q["testCookieConnectionGeneric<br/>调用 Rust 命令验证连接"]
    Q --> R{连接成功?}
    R -- 失败 --> R1[Toast: 连接测试失败]
    R -- 成功 --> S[保存 Cookie 到配置]
    S --> T[关闭登录窗口]
    T --> U["Toast: 获取成功 ✓"]

    %% 超时分支
    G -.-> TIMEOUT{超时?<br/>默认 60秒}
    TIMEOUT -- 是 --> TIMEOUT1[关闭窗口 + Toast: 获取超时]

    style U fill:#e8f5e9,stroke:#2e7d32
    style TIMEOUT1 fill:#ffebee,stroke:#c62828
    style N1 fill:#fff3e0,stroke:#ef6c00
    style O1 fill:#fff3e0,stroke:#ef6c00
```

### 支持自动获取 Cookie 的服务

| 服务 | loginUrl | 必填 Cookie 字段 | 值检查 |
|------|----------|-----------------|--------|
| 微博 | m.weibo.cn | SUB, SUBP | MLOGIN=1 |
| 牛客 | nowcoder.com | — | — |
| 知乎 | zhihu.com | — | — |
| 纳米 | nami.cc | — | — |
| B站 | bilibili.com | — | — |
| 超星 | chaoxing.com | — | — |

---

## 排查指南

| 现象 | 可能原因 | 对照图表位置 |
|------|---------|-------------|
| 启动后白屏 | continueStartup 异常但窗口未显示 | 图8 ERR 分支 |
| 弹出密码输入框 | 更换设备或迁移，密钥不匹配 | 图8 PWD 分支 |
| 启动时 Toast 警告"密钥不匹配" | 之前密钥失效，已重置为默认 | 图8 节点 K → K1 |
| 主题未生效 | initializeTheme 在事件监听之前，检查 effectiveTheme | 图8 节点 I |
| 自动更新未触发 | config.autoUpdate.enabled = false | 图8 节点 O |
| GA4 日志显示发送失败 | 不影响应用挂载；仅 `first_run` 会在下次启动重试，`app_start` 不补发 | 图8 节点 E |
| 登录窗口打开但 Cookie 获取不到 | 域名不在 domains 列表 / 平台降级轮询延迟 | 图9 节点 G → H |
| Cookie 获取后提示失败 | requiredFields 缺失或 fieldValueChecks 不通过 | 图9 节点 N → O |
| 登录超时 | 用户未完成登录 / Cookie 事件未触发 | 图9 TIMEOUT 分支 |

---

## 相关文档

- [休眠白屏修复](../reference/troubleshooting/sleep-resume-white-screen.md) — SQLite 连接丢失 + WebView reload 失败
- [Tauri CSP nonce 问题](../reference/troubleshooting/tauri-csp-nonce-blocks-primevue-styles.md) — 启动后样式异常的排查
- [系统总览](./system-overview.md) — 宏观架构分层与模块关系
- [数据持久化](./data-persistence.md) — 启动时加载的配置/历史存储机制
