# 上传流程

> 核心业务逻辑的可视化图解。排查上传失败、进度异常时优先查看此文档。

---

## 图 1：上传主流程

展示从用户操作到最终结果的完整路径。重点关注**分批处理**和**多图床并行**两个关键设计。

> **关键源文件**：`src/composables/useUpload.ts`、`src/core/MultiServiceUploader.ts`

```mermaid
flowchart TD
    %% 用户输入
    A1[拖拽图片] --> B
    A2[点击选择文件] --> B
    A3["粘贴剪贴板<br/>Ctrl+V 仅上传视图激活时响应"] --> B

    B[UploadView 接收文件路径列表]
    B --> C{isUploading?}
    C -- 是 --> C1[提示：上传进行中]
    C -- 否 --> D

    %% 前置校验
    D[锁定 isUploading = true]
    D --> E[filterValidFiles 文件类型校验]
    E --> F{有有效文件?}
    F -- 否 --> F1[提示：没有有效图片]
    F --> G{超过 200 张?}
    G -- 是 --> G1[截断并提示]
    G1 --> H
    G -- 否 --> H

    %% 配置与网络
    H[configStore.get 读取配置]
    H --> I{读取成功?}
    I -- 失败 --> I1[回退 DEFAULT_CONFIG]
    I1 --> J
    I -- 成功 --> J
    J{enabledServices 为空?}
    J -- 是 --> J1[提示：请选择图床]
    J -- 否 --> K

    K[checkNetworkConnectivity 网络检测]
    K --> L{网络可用?}
    L -- 否 --> L1[提示：网络不可用]
    L -- 是 --> M

    %% 分批处理
    M[chunkArray 按 50 张分批]
    M --> N[并发批次控制 max=2]
    N --> O[processBatch 批次处理]

    %% 单批次流水线
    O --> P[fetchMetadataBatch 获取元数据]
    P --> Q{压缩已启用?}
    Q -- 是 --> Q1[compressImageBatch 图片压缩]
    Q1 --> R
    Q -- 否 --> R

    R[queueManager.addFile 加入上传队列]
    R --> S[MultiServiceUploader.uploadToMultipleServices]

    %% 多图床并行
    S --> T[filterConfiguredServices 过滤已配置服务]
    T --> U[并行上传到所有图床]
    U --> V1[图床 A 上传]
    U --> V2[图床 B 上传]
    U --> V3[图床 C 上传...]

    %% 单个图床上传
    V1 & V2 & V3 --> W[UploaderFactory.create 创建上传器]
    W --> X[validateConfig 配置校验]
    X --> Y[uploader.upload → Tauri invoke → Rust 后端]
    Y --> Z[远程图床服务]

    %% 实时回调
    Z --> AA{上传成功?}
    AA -- 成功 --> AB[onServiceResult 实时回调]
    AA -- 失败 --> AC[记录 StructuredError]
    AC --> AB

    AB --> AD{第一个成功的服务?}
    AD -- 是 --> AE[saveHistoryItemImmediate 立即创建历史]
    AD -- 否 --> AF[addResultToHistoryItem 追加结果]
    AE & AF --> AG[queueManager.updateItem 更新 UI]

    %% 收尾
    AG --> AH{当前文件所有图床完成?}
    AH -- 否 --> U
    AH -- 是 --> AH1[reconcileHistoryPrimary<br/>按配置顺序收口主图床]
    AH1 --> AH2[markItemComplete<br/>统一缩略图主链接]
    AH2 --> AH3{所有批次完成?}
    AH3 -- 否 --> O
    AH3 -- 是 --> AI[copyLinks 复制最终主链接到剪贴板]
    AI --> AJ[showUploadSessionSummary Toast 通知]
    AJ --> AK[解锁 isUploading = false]

    %% 样式
    style A1 fill:#e3f2fd,stroke:#1976d2
    style A2 fill:#e3f2fd,stroke:#1976d2
    style A3 fill:#e3f2fd,stroke:#1976d2
    style F1 fill:#ffebee,stroke:#c62828
    style J1 fill:#ffebee,stroke:#c62828
    style L1 fill:#ffebee,stroke:#c62828
    style C1 fill:#fff3e0,stroke:#ef6c00
    style AK fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 2：上传事件时序

展示前后端通过 Tauri Event System 的实时通信过程。排查**进度更新卡住**或**事件丢失**时重点查看。

> **关键源文件**：`src/core/MultiServiceUploader.ts`、各 Uploader 实现

```mermaid
sequenceDiagram
    participant UV as UploadView
    participant UU as useUpload
    participant MSU as MultiServiceUploader
    participant UF as UploaderFactory
    participant UP as [Service]Uploader
    participant IPC as Tauri IPC
    participant RS as Rust 后端
    participant RM as 远程图床

    UV->>UU: handleFilesUpload(filePaths)
    activate UU

    Note over UU: 文件校验 + 配置读取 + 网络检测
    UU->>UU: chunkArray 分批

    loop 每个批次（max 2 并发）
        UU->>UU: fetchMetadataBatch（元数据）
        UU->>UU: compressImageBatch（可选压缩）
        UU->>UU: queueManager.addFile

        UU->>MSU: uploadToMultipleServices(filePath, services, config)
        activate MSU

        MSU->>MSU: filterConfiguredServices

        par 并行上传到各图床
            MSU->>UF: create(serviceId)
            UF-->>MSU: uploader 实例
            MSU->>UP: upload(filePath, options, onProgress)
            activate UP

            UP->>IPC: invoke("upload_to_xxx", params)
            IPC->>RS: Tauri Command 调用
            activate RS

            RS->>RM: HTTP 请求（上传文件）
            activate RM

            loop 上传进度
                RS-->>IPC: window.emit("upload-progress-{id}")
                IPC-->>UP: listen 回调
                UP-->>MSU: onProgress(serviceId, percent)
                MSU-->>UU: 进度回调
                UU-->>UV: Vue reactivity → UI 进度条更新
            end

            RM-->>RS: HTTP 响应（URL、key）
            deactivate RM
            RS-->>IPC: 返回 UploadResult
            deactivate RS
            IPC-->>UP: invoke 结果
            UP-->>MSU: UploadResult
            deactivate UP

            MSU-->>UU: onServiceResult（实时回调，不等其他图床）
        end

        deactivate MSU

        alt 第一个成功
            UU->>UU: saveHistoryItemImmediate（SQLite INSERT）
        else 后续成功
            UU->>UU: addResultToHistoryItem（SQLite UPDATE）
        end

        UU->>UU: reconcileHistoryPrimary（最终 primaryService/primaryUrl）
        UU->>UV: markItemComplete（最终缩略图链接）

        UU->>UV: queueManager.updateItem → UI 更新
    end

    UU->>UU: copyLinks 复制到剪贴板
    UU->>UV: showUploadSessionSummary
    deactivate UU
```

---

## S3 系图床：对象名与 Content-Type

适用于全部 6 个走 `upload_to_s3_compatible` 的图床：**阿里云 OSS / 腾讯云 COS / 七牛云 / 又拍云 / Cloudflare R2 / 自定义 S3**（它们都继承 `BaseS3Uploader`，`R2Uploader` 也不例外——`src-tauri/src/commands/r2.rs` 的 `upload_to_r2` 目前无前端调用方）。

### 对象名（key）唯一化

```
key = {配置里的 path}/{yyyyMMdd}_{4位base36随机}_{原文件名}
例：images/20260813_a3f9_screenshot.png
```

> **关键源文件**：`src/uploaders/s3/objectKey.ts`（`buildObjectKey`）→ `src/uploaders/s3/BaseS3Uploader.ts`

**不变量：同一个对象名只对应一次上传。**

大白话：以前 key 就是「路径 + 原文件名」，你把两张不同内容但都叫 `screenshot.png` 的图先后传上去，第二张会**直接把第一张顶掉**——桶里只剩第二张，而第一条历史记录的链接还指向那个 key，于是点开旧记录看到的是新图，旧图永久没了。加上「日期 + 随机段」前缀后，每次上传都落在自己的 key 上，谁也顶不掉谁。

设计取舍：

- **原文件名留在末尾**，不是开头——既保住可读性，也保住扩展名（Rust 侧靠扩展名推断 Content-Type，见下）。
- **随机段 4 位 base36**（约 168 万种）。碰撞需要「同一天 + 同一个原文件名 + 同一个随机段」三者同时命中，日常量级下可忽略。
- **只影响新上传**：旧记录的 URL 结构不变，历史里的 `fileKey` 始终取 Rust 回传值，不是前端自算的那个字符串。
- **代价**：上传失败后重试会生成新 key。若前一次其实已经落桶只是响应丢了，桶里会留一个孤儿对象（旧行为是覆盖同名对象、不留孤儿）。用「多一个几十 KB 的孤儿文件」换「不再静默覆盖用户的图」，是划算的。
- 文件名本身**不做净化**（空格、`#`、中文原样保留），与改动前一致。

#### 四条上传路径的唯一化现状（2026-08-17 补齐）

上面那套前缀最初**只做在前端**（`objectKey.ts` 走 GUI 主界面上传），Typora / Obsidian / CLI
走的是 Rust 侧 `server/upload_handler.rs` 的独立链路，一直漏着——而编辑器粘贴出来的图
**永远叫 `image.png`**，恰恰是最容易撞名的入口。已补齐：

| 路径 | S3 系（R2 / 腾讯 / 阿里 / 七牛 / 自定义 S3） | WebDAV |
|------|---------------------------------------------|--------|
| GUI 主界面 | `objectKey.ts::buildObjectKey` | `webdav_upload.rs`（core 内统一处理） |
| 编辑器 / CLI | `upload_handler.rs::build_upload_key` | 同上（共用 `upload_to_webdav_core`） |

两条 Rust 侧实现都在 `commands/utils.rs`：`prefix_unique_file_name` / `suffix_unique_file_name`。

**⚠️ 两套顺序不同，是刻意的，不要"顺手统一掉"**：

```
S3 系     20260817_a3f9_image.png     日期在前
WebDAV    image_20260817_a3f9.png     原名在前
```

判据是命名规范里那条通用规则——**把最重要的参数放最前面**（[哈佛](https://guides.library.harvard.edu/c.php?g=1033502&p=7496710)、
[哥大](https://photos.columbia.edu/content/file-naming-conventions-0) 等档案命名指南）。
S3 桶基本没人用文件管理器去翻，日期在前便于按时间扫读；WebDAV 通常指向用户自己的 NAS，
**那个目录是人会去翻的**，此时最重要的信息是「这是哪张图」，14 个字符的日期前缀正好挡住它。
场景不同，答案就不同。

另：AWS 自 2018 年起[已明确随机前缀不再影响 S3 性能](https://repost.aws/knowledge-center/s3-object-key-naming-pattern)，
所以随机段现在的**唯一职责是防覆盖**，不要再用「打散分区提性能」当理由。
日期段也不只是为了好看——它把碰撞的分母从「历史上所有同名文件」缩小到「同一天的同名文件」，
正是 4 位随机（168 万种）够用的前提；去掉日期就得加到 8 位，反而更长。

#### WebDAV 可以关掉唯一化

`WebDAVStorageProfile.uniqueFileName`（设置页「防止图片互相覆盖」开关），**缺省即开启**——
判据一律写 `!== false`，写成 `=== true` 会让升级前的老 profile 默认失去防护。
Rust 侧 `ServerUploadConfig::Webdav.unique_file_name` 同理用 `#[serde(default = "default_true")]`，
否则升级前写下的 `cli-config.json` 会因缺字段而整份反序列化失败，三条编辑器链路一起罢工。

关掉的正当场景：用户就想按固定文件名更新同一张图（如 `logo.png`），自己接受覆盖风险。

### Content-Type

> **关键源文件**：`src-tauri/src/commands/utils.rs`（`guess_object_content_type`）

`put_object` 按**文件扩展名**用 `mime_guess` 推断 Content-Type，未知扩展名回退 `application/octet-stream`。

大白话：不带这个头的话，对象会以「二进制文件」的身份存进桶里，浏览器直接打开图片链接时不会显图，而是弹出下载框。

已覆盖：`png / jpg / jpeg / webp / gif / svg / avif / bmp / ico / tif / tiff`（大小写不敏感），与上传白名单 `VALID_IMAGE_EXTENSIONS`（前端）和 `DetectedImageKind`（server）的 9 种格式一一对应。

**四条链路共用同一个推断函数**，别再各写一份扩展名表：

| 链路 | 调用点 | 传什么 |
|---|---|---|
| 桌面 GUI（S3 系） | `s3_compatible.rs::upload_to_s3_compatible` | `file_path`（前端传下来的绝对路径） |
| 编辑器 / CLI / 本地 server（S3 系） | `server/upload_handler.rs::s3_put_object` | 由 `object_content_type(path)` 从 `&Path` 推断 |
| WebDAV 图床（两条链路共用同一函数体） | `webdav_upload.rs::upload_to_webdav_core` | 唯一化后的文件名（`suffix_unique_file_name` 不改扩展名） |
| 又拍云（编辑器 / CLI，走独立 REST PUT） | `server/upload_handler.rs::server_upload_upyun` | 由 `object_content_type(path)` 从 `&Path` 推断 |

> ⚠️ **后两条都是 2026-08-18 才并进来的，各自踩过一次同样的坑。**
> WebDAV 曾自带第三张手写扩展名表，与共用表已漂了 5 个（`heic/heif/jfif/apng/svgz` 在
> WebDAV 落 octet-stream、在 S3 落正确类型），靠上传白名单挡着才没爆。
> 又拍云曾硬编码 `Content-Type: image/` 加星号——星号形式只在**请求**的 `Accept` 里合法，
> 当成响应类型是无效值；它走独立 REST PUT 不经过 `s3_put_object`，所以逃过了 issue #4 那轮统一修复。
> 两处都有回归测试钉住：`webdav_put_sends_content_type_from_shared_table`（拿 `.jfif` 当判据，
> 因为它正是「手写表答不出、共用表答得出」的那一类）与 `upload_paths_never_send_hardcoded_image_content_type`。

`s3_put_object` 的 `content_type` 是**显式形参**，不是函数内部推断出来的。这样新增调用方时编译器会强制它给出类型——issue #4 的成因正是这个参数当初不存在，2026-08-13 只修了 GUI 一侧，编辑器链路又漏了 5 天。

> ⚠️ **改动只对新传的对象生效。** 类型是上传那一刻写进桶里的元数据，升级客户端不会回头改旧对象。旧对象的补救见 [s3-legacy-content-type.md](../reference/troubleshooting/s3-legacy-content-type.md)。

---

## 排查指南

| 现象 | 可能原因 | 对照图表位置 |
|------|---------|-------------|
| 点击上传无反应 | `isUploading` 未释放（上次上传异常退出） | 图1 节点 C |
| 提示"没有有效图片" | 文件格式不在白名单 | 图1 节点 F |
| 提示"请选择图床" | `enabledServices` 为空 | 图1 节点 J |
| 进度条卡在 0% | Rust 后端未发送 progress 事件 | 图2 进度循环 |
| 部分图床失败 | 单个服务 StructuredError | 图1 节点 AA → AC |
| 历史记录缺少某图床 URL | `addResultToHistoryItem` 未触发 | 图1 节点 AD → AF |
| 历史主图床与复制链接不一致 | `reconcileHistoryPrimary` 未完成 | 图1 节点 AH1 |
| S3 图床链接在浏览器里变成下载而不是显图 | 对象缺 Content-Type；确认 `curl -I` 返回的是否为 `application/octet-stream`。**先看是什么时候传的**：改动前的旧对象不会因升级自愈，补救见 [s3-legacy-content-type.md](../reference/troubleshooting/s3-legacy-content-type.md) | S3 系图床 → Content-Type |
| GUI 传的图正常，Typora / Obsidian / CLI 传的图仍变下载框 | 2026-08-18 前编辑器链路的 `s3_put_object` 漏传 Content-Type（GUI 侧 08-13 就修了，这条晚 5 天）；升级后已修，旧对象仍需按上一行处理 | S3 系图床 → Content-Type |
| S3 桶里出现 `20260813_a3f9_` 之类的前缀 | 预期行为，key 唯一化前缀 | S3 系图床 → 对象名唯一化 |
| 想按固定文件名覆盖桶里的旧对象 | S3 系刻意不支持——覆盖会让旧历史记录的链接指向新图；WebDAV 可在 profile 里关掉「防止图片互相覆盖」 | S3 系图床 → 对象名唯一化 |
| Typora/Obsidian 传的图把之前的顶掉了 | 2026-08-17 前编辑器/CLI 链路漏了唯一化（粘贴的图永远叫 `image.png`）；升级后已修 | 四条上传路径的唯一化现状 |
| NAS 目录里文件名都带 `_20260817_a3f9` | 防覆盖的唯一段，故意放在原名之后好让你先看到文件名；不想要就关掉那个开关 | WebDAV 可以关掉唯一化 |
| S3 桶里有对象但历史里查不到 | 上传失败重试留下的孤儿对象（重试用新 key，不覆盖） | S3 系图床 → 对象名唯一化「代价」 |
| 未知扩展名的文件上传后类型是 `application/octet-stream` | `mime_guess` 无法识别该扩展名，按设计回退 | S3 系图床 → Content-Type |
| 在历史/链接检测/设置页按 Ctrl+V 也触发了上传 | `UploadView` 的 keydown 监听挂在 `window` 上，且 `MainLayout` 的 `KeepAlive` 上限等于视图数、本组件永不卸载，必须靠 `isViewActive` 早退收敛 | 图1 节点 A3 |
| 在上传页按 Ctrl+V 没反应 | 切走再切回后 `onActivated` 未触发（`isViewActive` 卡在 false）；或焦点在 `INPUT`/`TEXTAREA` 内被有意跳过 | 图1 节点 A3 |
| 设置里的全局快捷键在其他视图仍能上传剪贴板 | 预期行为，那是 `useGlobalShortcut` 注册的 OS 级热键，与视图无关 | `src/composables/useGlobalShortcut.ts` |

---

## 相关文档

- [添加新图床指南](../reference/guides/add-new-uploader.md) — 新增图床的完整操作步骤
- [上传器接口规范](../reference/api/uploaders.md) — IUploader 接口定义
- [架构总览](../reference/architecture/overview.md) — 系统分层与核心模块
- [系统总览](./system-overview.md) — 宏观架构分层与上传器类关系
- [批量迁移流程](./batch-migrate-flow.md) — 复用 MultiServiceUploader 的批量迁移
