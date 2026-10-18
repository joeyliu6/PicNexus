# 设置面板 + 主题架构流程

> 从「用户修改设置项」到「加密落盘 + 跨组件同步 + 主题切换生效」的完整闭环。**新增设置项、改主题切换逻辑、排查配置丢失/未持久化**时优先查看此文档。

## 概览

PicNexus 的配置系统绕开了 `tauri-plugin-store`,采用**自写 SimpleStore + AES-GCM 加密 + 互斥锁**的方案:

- **配置存储**:`configStore = new Store('.settings.dat')`,单例,**禁止再次 new**(CLAUDE.md 规定)
- **加密**:AES-GCM,支持"随机密钥"和"备份密码"两种格式(v2.8+)
- **并发控制**:全局互斥锁,防止多处同时写入导致数据损坏(v2.9+)
- **配置入口**:`useConfigManager()` composable,返回响应式 `config` + `loadConfig` + `saveConfig`；设置页只经 `useSettingsConfig().patch` 写配置(见图 1)
- **主题切换**:`ThemeManager` 通过 `document.documentElement.classList` 切换 `.dark-theme` / `.light-theme`
- **跨组件同步**:保存后 `emit('config-updated')`,其他 composable 通过 `listen('config-updated')` 重新读取
- **强制规则**:序列化 config 时必须先调 `toPlainConfig()` 剥离 Vue Proxy

---

## 图 1:设置页改一项(读最新 → 只改这一项 → 写 → 广播)

设置页不握表单副本:每改一项都从磁盘读最新配置、只改这一项、整份保存。副本整份回写会用旧值盖掉图床页、托盘、云同步刚写进去的东西;图床字段设置页从来不碰。

> **关键源文件**:`src/views/settings/useSettingsConfig.ts`(唯一写入口)、`src/views/settings/settingsEffects.ts`(要先改系统的几项)、`src/composables/useConfig.ts`、`src/store/instances.ts`

```mermaid
flowchart TD
    A[用户改一项<br/>开关 / 分段 / 失焦的输入框] --> B{要先改系统?}
    B -- 开机自启 / 关闭到托盘 --> B1[settingsEffects:<br/>先调插件或 Rust 命令]
    B1 --> B2{系统接受?}
    B2 -- 否 --> B3[开关弹回 + 红色通知<br/>不写配置]
    B2 -- 是 --> C
    B -- 其余 --> C[patch rowId, mutate]

    C --> Q[排进写入队列<br/>串行:后一项读到前一项写完的配置]
    Q --> D[readFreshConfig<br/>读磁盘上的最新配置]
    D --> E[mutate 只改这一项]
    E --> F[useConfigManager.saveConfig draft]
    F --> F1[toPlainConfig + 验证]
    F1 --> M[configStore.set<br/>mutex.withLock → 加密 → 原子写]
    M --> G{成功?}
    G -- 否 --> G1[红色通知「未能保存 / 原因，请重试」<br/>重新读磁盘,界面回到磁盘值]
    G1 --> G2[settingsEffects:<br/>把系统也改回去]
    G -- 是 --> H[那一行闪「✓ 已保存」1.5 秒]
    M --> O[emit 'config-updated']
    O --> P1[ThemeManager / 全局快捷键 / 自动更新 /<br/>自动上传剪贴板 / 编辑器服务 重读]
    O --> P2[设置页回到前台时 reload]

    style C fill:#e3f2fd,stroke:#1976d2
    style D fill:#fff3e0,stroke:#ef6c00
    style G1 fill:#ffebee,stroke:#c62828
    style H fill:#e8f5e9,stroke:#2e7d32
```

**要点**

- 文本类(模板、端口、压缩参数)离开输入框或停手半秒才 `patch`;开关、分段改了立刻 `patch`。
- 主题由 `ThemeManager.setTheme` 自己落盘(同样读最新配置、只改 `theme`),设置页随后 `reload`。
- 云同步合并 / 覆盖本机、从文件导入配置后,设置页顶部出现刷新横幅(「云端配置已下载，刷新后生效。」/「配置已导入，刷新后生效。」),点「刷新」整窗重新载入。

---

## 图 2:主题切换的运行时机制

展示 `ThemeManager` 如何在三种模式(`light` / `dark` / `auto`)下正确切换 CSS 类,以及与系统深色模式的联动。

> **关键源文件**:`src/theme/ThemeManager.ts`、`src/composables/useTheme.ts`、`src/theme/dark-theme.css`、`src/theme/light-theme.css`

```mermaid
flowchart TD
    A[useThemeManager<br/>首次调用] --> B[new ThemeManager 单例]
    B --> C[读 config.theme.mode]

    C --> D{mode?}
    D -- light --> E1[强制亮色]
    D -- dark --> E2[强制深色]
    D -- auto --> E3[注册 mediaQuery 监听器<br/>prefers-color-scheme]

    E3 --> E3A{系统当前是暗?}
    E3A -- 是 --> E2
    E3A -- 否 --> E1

    E1 --> F1[applyThemeClass 'light']
    E2 --> F2[applyThemeClass 'dark']

    F1 --> G1[documentElement<br/>.classList.toggle<br/>'light-theme' true<br/>'dark-theme' false]
    F2 --> G2[documentElement<br/>.classList.toggle<br/>'dark-theme' true<br/>'light-theme' false]

    G1 & G2 --> H[CSS 变量立即生效]
    H --> H1[读取 :root.xxx-theme<br/>下的 --bg-app 等变量]
    H1 --> H2[所有组件重绘<br/>无需 JS 介入]

    %% 持久化
    F1 & F2 --> I[localStorage.setItem<br/>picnexus-theme<br/>快速恢复用]
    I --> J[configStore.set 'config'<br/>持久化到 .settings.dat]

    %% auto 模式切换
    E3 -.系统暗黑变化.-> E3B[mediaQuery change handler]
    E3B --> F1
    E3B --> F2

    style A fill:#e3f2fd,stroke:#1976d2
    style H2 fill:#e8f5e9,stroke:#2e7d32
    style E3 fill:#fff3e0,stroke:#ef6c00
```

**关键细节**:

- **切换方式是 `classList` 而非 `data-theme` 属性**(与 `docs/design/themes.md` 约定一致)
- **localStorage 是性能优化**:下次启动时 `index.html` 的内联脚本可以第一时间读 localStorage 应用主题,避免白屏闪烁(FOUC)
- **PrimeVue 集成**:PrimeVue 组件读取 `:root.xxx-theme` 下的 CSS 变量,不需要 JS 调用 PrimeVue API
- **auto 模式切换时的 listener 生命周期**:`setTheme(mode)` 先 `removeEventListener` 旧的,再按需 `addEventListener` 新的,避免重复触发

---

## 图 3:CSS 变量体系与组件消费

展示 CSS 变量从 `:root` 定义到各组件 `var(--xxx)` 引用的层级关系,帮助新增设置项时正确使用变量而非硬编码(CLAUDE.md 禁止硬编码)。

> **关键源文件**:`src/theme/dark-theme.css`、`src/theme/light-theme.css`、`src/styles/motion.css`、`docs/design/tokens.md`

```mermaid
flowchart LR
    subgraph R[:root.dark-theme]
        R1[颜色系:<br/>--bg-app<br/>--bg-sidebar<br/>--bg-card<br/>--text-primary<br/>--text-secondary<br/>--primary<br/>--success / --error / --warning]
        R2[间距/圆角:<br/>--space-*<br/>--radius-*<br/>--shadow-*]
        R3[动效:<br/>--duration-*<br/>--ease-*]
        R4[透明度派生:<br/>--primary-alpha-8<br/>--primary-alpha-16]
    end

    subgraph L[:root.light-theme]
        L1[覆盖颜色系<br/>其他变量继承 dark]
    end

    R --> C[组件 SCSS / Vue style]
    L --> C

    C --> C1[setting-panel.vue<br/>background: var --bg-card]
    C --> C2[toggle-row.vue<br/>color: var --text-secondary]
    C --> C3[primary-button.vue<br/>background: var --primary<br/>transition: var --duration-normal var --ease-standard]

    C1 & C2 & C3 --> U[最终 UI]

    %% 禁止的写法
    X[❌ background: #1a1a1e<br/>❌ padding: 12px<br/>❌ transition: 200ms ease]:::bad
    X -.被禁止.-> C
    classDef bad fill:#ffebee,stroke:#c62828

    style R fill:#e3f2fd,stroke:#1976d2
    style L fill:#fff3e0,stroke:#ef6c00
    style U fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 4:设置页分组与职责

`src/views/settings/` 每组一个组件,`settingsGroups.ts` 是分组与每一行的表(命令面板的设置项也从这张表生成)。新增设置项时先判断归属哪一组。图床的连接、凭证与启用不在设置页，在图床页（路由 `/hosts`，`src/views/hosts/`，见 [HANDOFF §4](../design/redesign/handoff/HANDOFF.md)）；设置页从不写图床配置。各组设计没画、开发时补的做法见 [decisions/settings.md](../design/redesign/decisions/settings.md)。

```mermaid
flowchart TD
    S[SettingsView<br/>二级栏 + 标题行 + 滚动区 + 刷新横幅] --> N[SettingsNav 7 组]

    N --> G1[GeneralGroup 通用] --> G1A[theme.mode / theme.homeDecor<br/>appBehavior 开机自启 静默启动 关闭到托盘]
    N --> G2[UploadGroup 上传与链接] --> G2A[linkOutput 默认格式 / 自定义模板 / 自动复制<br/>appBehavior.autoUploadClipboard<br/>imageCompression 方案]
    N --> G3[ShortcutGroup 快捷键] --> G3A[globalShortcut<br/>录制见 useShortcutRecorder]
    N --> G4[EditorGroup 编辑器与命令行] --> G4A[editorServer<br/>Typora / Obsidian / CLI]
    N --> G5[BackupGroup 备份与同步] --> G5A[webdav 同步连接与 syncItems<br/>备份密码 / 导出导入 / 最近操作]
    N --> G6[PrivacyGroup 数据与隐私] --> G6A[analytics / 数据位置 / 缓存<br/>清空记录 / 恢复默认]
    N --> G7[AboutGroup 关于] --> G7A[autoUpdate / UpdateCard<br/>帮助与反馈链接]

    G5 -.详见.-> SYNC[sync-flow]
    G7 -.详见.-> UPD[auto-update-flow]
    G7 -.详见.-> LOG[logger-diagnostics-flow]

    style S fill:#e3f2fd,stroke:#1976d2
```

### 图床「启用」的三个字段（别混淆）

| 字段 | 语义 | 谁写入 |
|------|------|--------|
| `config.availableServices` | 「已添加」的一半：图床在这里**并且**免配置或凭证已填，才算已添加（出现在图床页左栏、首页「上传到」、托盘） | 图床页 `hostConfig.connectHost` / `disconnectHost` / `restoreHost`（撤销）；首页一键加免配置图床 `useUploadController.enableNoConfigHost` |
| `config.enabledServices` | 「启用」= 上传时传到它；图床页的「启用 / 停用」和首页「上传到」的勾选是同一个字段 | `useUploadController.toggleHost`（图床页 `useHosts.toggleEnabled` 也调它）、托盘菜单；连接成功时 `connectHost` 一并启用 |
| `config.services.*.enabled` | **已退化为死字段**：写入方一律写 `true`，唯一读取点 `MultiServiceUploader.filterConfiguredServices` 对任何已知服务都不可达。不要依赖它 | — |

配套规则：

- **判定「已添加 / 启用 / 出问题」只看 `useUploadController().hosts`**，图床页、首页与托盘菜单（`src/tray/installTray.ts`）共用这一份，不要各自再拼一遍。
- **断开 = 清掉凭证并移出两个列表**（通知带撤销，撤销按快照原样恢复，含原来的位置）；WebDAV / 自定义 S3 叫「删除这份」，同时删掉 profile 并 `syncProfileUploaders`。
- **公共风险图床**（`PUBLIC_RISK_SERVICES`）的启用一律先过 `usePublicRiskConfirm().ensureAccepted()`（P11 弹窗），那是 `publicServiceRiskAccepted` 唯一的置位入口；绕过它启用，会让上传时被静默过滤。
- `availableServices` **可以为空**（一个图床都没添加是正常状态：首页显示「没有图床」，图床页右侧直接是目录）。

---

## 新增设置项的标准流程

```mermaid
flowchart TD
    A[需求:加一个新设置项] --> B[1. 确定归属分组<br/>在 settingsGroups.ts 的 SETTING_ROWS 加一行<br/>命令面板自动能搜到]
    B --> C[2. src/config/types.ts<br/>UserConfig 加字段]
    C --> D[3. src/config/defaults.ts<br/>DEFAULT_CONFIG 加默认值]
    D --> E[4. 分组组件:<br/>SettingRow + Pn 控件<br/>读 settings.config, 改时 settings.patch rowId]
    E --> F{要先改系统?}
    F -- 是 --> F1[写进 settingsEffects:<br/>先改系统、成功才 patch、失败回滚]
    F -- 否 --> G
    F1 --> G{业务方要跟着变?}
    G -- 是 --> G1[消费方 listen 'config-updated'<br/>读 readFreshConfig]
    G -- 否 --> H
    G1 --> H[5. 偏好类字段:<br/>resetPreferences.ts 决定恢复默认时回不回去]
    H --> K[6. 测试 + 文档:<br/>decisions/settings.md 记设计没画的做法]

    style A fill:#e3f2fd,stroke:#1976d2
    style K fill:#e8f5e9,stroke:#2e7d32
    style C fill:#fff3e0,stroke:#ef6c00
```

---

## 链接前缀（微博代理）数据结构

`config.linkPrefixConfig.prefixList` 是 `LinkPrefixItem[]`（不是字符串数组）：

```ts
interface LinkPrefixItem { name: string; template: string }
```

`template` 支持 4 种占位符，由 `src/utils/linkPrefixTemplate.ts` 解析：

| 占位符 | 含义 | 典型用法 |
|--------|------|---------|
| `{url}` | 完整原 URL | 显式声明位置 |
| `{url_no_scheme}` | 去掉 `https://` / `http://` | Jetpack 风格 |
| `{path}` | 去掉协议和域名，仅保留路径 | IPFS Scan 风格 |
| `{url_encoded}` | `encodeURIComponent` | 搜狗 / query 参数型 |

**兼容规则**：template 若不含任何占位符，拼接时自动在末尾追加 `{url}`，等价于旧版纯前缀行为。

默认列表定义在 [src/config/configInterface.ts](../../src/config/configInterface.ts) 的 `DEFAULT_LINK_PREFIXES`，当前包含搜狗图片 / CDN JSON / Jetpack / IPFS Scan 四项。

在图床页微博详情里选择与增删（[HostSettings.vue](../../src/views/hosts/HostSettings.vue) + [HostTemplateList.vue](../../src/views/hosts/HostTemplateList.vue)）：「不加前缀」= `enabled: false`，其余各项对应 `prefixList`；「添加模板…」弹窗填 `name` + `template`，改动即保存。

反向解析（MD 解析器把带前缀的 URL 剥回原始 URL）由 `stripPrefixTemplate()` 完成，[mdParser.ts](../../src/utils/mdParser.ts) 的 `stripKnownPrefixes` 遍历 `prefixList` 尝试匹配。

---

## 排查指南

| 现象 | 可能原因 | 对照图表位置 |
|------|---------|-------------|
| 改完设置刷新后丢失 | 没走 `useSettingsConfig().patch`,或 patch 失败(看「未能保存」通知与日志) | 图1 C、G1 |
| 保存报 `Converting circular structure to JSON` | 没调 `toPlainConfig`,直接序列化 Vue Proxy | 图1 L1 |
| 多处写配置偶尔丢数据 | 没过 `mutex.withLock`(自己 new Store 绕过了单例),或拿旧副本整份回写(设置页一律先 `readFreshConfig`) | 图1 D、M |
| 修改主题后部分组件没变色 | 该组件用了硬编码颜色,不消费 CSS 变量 | 图3 X |
| auto 模式系统切换不生效 | `setTheme('auto')` 没正确注册 mediaQuery listener | 图2 E3 |
| 启动时短暂白屏闪烁(FOUC) | `index.html` 的内联脚本没读 localStorage | 图2 I |
| 保存后其他组件没重新响应 | 没 `listen('config-updated')`,或监听后没 unlisten 导致重复 | 图1 P |
| 配置文件打不开/解密失败 | 备份密码机制触发,启动时弹「还原备份配置」(D01) | [app-lifecycle](./app-lifecycle.md) |
| 新增字段迁移老配置报错 | 新字段没在 DEFAULT_CONFIG 加默认值,老 config 读到 undefined | 新增流程 C、D |
| 改了开机自启,系统和开关对不上 | 系统改成功后写配置失败,回滚也失败(看日志「回滚失败」) | 图1 G2 |
| 云同步后设置页还是旧值 | 下载的配置要刷新后生效,看页顶刷新横幅 | 图1 要点 |
| 样式被硬编码污染 | 违反 CLAUDE.md,用 `docs/design/tokens.md` 里的变量替换 | 图3 |
| 新加的链接前缀没生效 / 搜狗风格 URL 不对 | template 占位符拼错,或调用方没过 `applyPrefixTemplate` 直接字符串拼接 | 链接前缀数据结构 |
| 新建的自定义 S3 / WebDAV 在上传界面看不到 | 还没「测试并连接」成功（草稿不保存），或凭证没填全（被 `unconfigured` 过滤挡住） | 图床「启用」的三个字段 |
| 改了 `services.*.enabled` 却毫无效果 | 该字段已退化为死字段，启用看 `enabledServices` | 图床「启用」的三个字段 |
| 图床页左栏有它，上传时却没传 | 它是「停用」（不在 `enabledServices`）；或是公共图床、还没同意风险提示 | 图床「启用」的三个字段 |

---

## 相关文档

- [设计规范总集](../design/) — tokens / themes / ui-patterns / settings-layout
- [数据持久化](./data-persistence.md) — `.settings.dat` 的加密存储细节
- [应用生命周期](./app-lifecycle.md) — `loadConfig` 的启动时机
- [IPC 命令层](./ipc-command-flow.md) — `emit/listen` 的事件系统基础
- [自动更新](./auto-update-flow.md) — `autoUpdateEnabled` 开关消费样例
- [日志与诊断](./logger-diagnostics-flow.md) — 「关于」里的「打开日志目录」
