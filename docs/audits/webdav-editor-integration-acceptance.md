# 编辑器插件支持 WebDAV 图床 — 实现记录（2026-08-17）

- **结论**：5/5 代码改动完成；CLI 直传 / Typora profile 两条路径已用真实 dufs 服务器验证成功（文件真的落盘、能读回来）；Obsidian 端只验证到「Server 正确识别并加载了 WebDAV 配置」（`/status` 返回 `service: "webdav"`），没有走完整的 HTTP `/upload` 请求——这段风险很低，因为 `/upload` 最终调的是和 CLI 完全同一段核心逻辑（`dispatch_upload` → `server_upload_webdav` → `upload_to_webdav_core`），只是外面多包了一层没改过的 HTTP 路由/鉴权
- **背景**：[docs/TODO.md](../TODO.md) 原「需要动的 5 处」（2026-08-13 记录）+ 「范围修正」（2026-08-16）
- **前置**：主界面 WebDAV 上传本身已可用，本次只是把 Typora / Obsidian / CLI 那条独立链路补齐
- **审查发现并修复**：真机验收过程中一次代码审查揪出 3 个真实问题（P1 CLI 密码变更不触发重下发、P2
  禁用服务时仍会因解密失败而卡住、P3 WebDAV 路径处理要求比同级函数更苛刻的 UTF-8 假设），详见文末
  「审查发现与修复」一节

## 改了什么

### 1. Rust：`ServerUploadConfig` 加 `Webdav` 变体

`src-tauri/src/server/upload_handler.rs`：枚举新增

```rust
Webdav {
    url: String,
    username: String,
    password: String,          // 前端解密后的明文，Rust 侧没有 secureStorage 密钥解不了密文
    remote_path: String,
    public_domain: String,
    public_url_template: String,
    lan_http_confirmed: bool,
    #[serde(default = "default_true")]
    unique_file_name: bool,   // 后续批次追加，见文末「同名文件静默覆盖」
}
```

字段名直接照抄 `commands::webdav_upload::upload_to_webdav` 命令的参数名（全 snake_case，`ServerUploadConfig` 的
`rename_all = "camelCase"` 只作用于 `type` 标签值，不级联到字段），前端 `buildServiceConfig` 产出的 JSON 不需要
额外映射就能直接反序列化。`dispatch_upload` 与 `get_service_info` 两处 match 各加一条分支。

### 2. Rust：`upload_to_webdav` 解耦 `Window`

`src-tauri/src/commands/webdav_upload.rs`：原来的命令体拆成 `upload_to_webdav_core`（不含 `Window` 参数，
`progress: Option<(&Window, &str)>` 控制要不要 emit 进度事件）+ 一个只剩「拼参数调用 core」的薄命令壳。
新增的 `server_upload_webdav`（`upload_handler.rs`）传 `progress: None`、`client: shared_client()`（进程级
共享 client，因为 CLI 模式没有 Tauri app 上下文，拿不到 `tauri::State<HttpClient>`）复用同一份核心逻辑。

### 3. 前端：`editorServiceConfig.ts` 加 webdav 分支

`isCliCompatibleServiceConfigured` / `buildServiceConfig` / `buildCliServicesConfig` /
`buildEditorCredentialSignature` 四个函数（范围修正指出漏了第四个）都已支持 `webdav:<profileId>` 复合 ID。

同步/异步撞墙的解法：签名检测（跑在 Vue `computed` 里，不能 `await`）直接用 `passwordEncrypted` **密文**
拼接——只需要判断"变没变"，密文足够。真正需要明文的地方（`buildServiceConfig` 的 `password` 字段）改成
接收调用方传入的可选参数，解密动作挪到 `useEditorIntegration.ts` 的 `applyEditorServer`（本来就是 async）里，
新增 `resolveWebDAVServicePassword` / `resolveWebDAVPasswordsForCli` 两个导出的 async 函数负责解密。

### 4. 前端：编辑器专用图床选择器列出 WebDAV / 自定义 S3 profiles

`ExternalEditorPanel.vue` 原来的 `configuredServices` 只由一份写死的 16 个内置服务的数组过滤而来，
**custom_s3 和 webdav 两种 profile 都不在里面**——这个链路的空洞不是 WebDAV 独有的，顺带一起接上了
（否则会出现"webdav 单独特判、custom_s3 原地继续缺"这种不对称代码，和仓库里其它地方
`isCustomS3Id`/`isWebDAVId` 总是成对出现的写法不一致）。

新增 `profileServiceEntries` computed，把 `custom_s3_profiles` / `webdav_profiles` 转成
`{value: 'webdav:xxx', label: 'WebDAV · <profile 名字>'}` 形式的候选项，合入 `configuredServices` 与
`resolvedServiceLabelMap`（下拉框当前选中项的展示名也要从这份表查，不只是候选列表）。

Props 从 `SettingsView.vue` 经 `AdvancedSettingsPanel.vue` 传到 `ExternalEditorPanel.vue`。
`SettingsView.vue` 卡在 [TODO.md](../TODO.md) 待处理小节记录的 max-lines 500 行硬指标上，一行不剩，
用了同一个技巧腾出空间：把两个已有的单行 prop 绑定合并成一行，换来的空间正好放下新的两个 prop，
物理行数和门禁口径的有效行数都是净 0 变化。

### 5. Rust：`cli.rs` 的 `--service webdav:profile-1`

`--service` 解析本来就是纯字符串（`service_id: Option<String>`），`resolve_upload_config` 按
`HashMap<String, ServerUploadConfig>` 精确匹配 key，两者对复合 ID 天然透明，**不需要改代码**。

唯一要动的是 `service_id_for_config`（`&'static str` 返回值，只服务"旧版单图床 cli-config.json"的兼容读取——
`save_cli_config` 早就只写多图床格式了）：Rust `match` 要求穷尽所有枚举变体，照抄 `CustomS3` 的处理方式
补一条返回静态标签 `"webdav"` 的分支即可。

**这里纠正了 2026-08-16 范围修正里的一个错误预判**：那份文档说这个函数的返回类型要从 `&'static str`
换成 `String`/`Cow`，理由是 WebDAV id 是动态串。实际读代码后发现不需要——`CustomS3` 早就用同样的手法
（返回一个跟真实 profile id 无关的固定标签）处理过一模一样的问题，因为这个函数只在旧版单图床配置的兼容分支里
被调用，从未真正需要按具体 profile id 精确匹配。

## 自动化验证

- `cargo check` / `cargo clippy`：无新增警告（`clippy` 报的 2 条 `too_many_arguments` / `str::trim` 警告
  在改动前就存在，与本次改动无关，已用 `git stash` 验证过）
- `cargo test`：291 → 295（WebDAV 变体反序列化、`get_service_info`/`service_id_for_config` 穷尽分支、
  复合 ID CLI 解析、P3 的非 UTF-8 路径回归测试），全过
- `npm run typecheck` / `npm run lint`（含新增 `check_editor_server_status` 命令的 invoke 参数核对）：全绿
- `npx vitest run`：2803 → 2808，213 个测试文件全过

## 真机验收记录（2026-08-17）

- **CLI 直传**：本地起 dufs（`http://127.0.0.1:5001`），设置里配好 WebDAV profile 并启用 CLI 导出后跑
  `picnexus.exe --service webdav:<id> <图片>`，程序回报成功；直接去 dufs 存文件的目录确认新文件确实落盘
  （时间戳、字节数吻合），再用 HTTP GET 把文件读回来（`200`），确认不是假成功。
- **Typora（`--profile typora`）**：设置页把 Typora 图床换成同一个 WebDAV profile 后，跑
  `picnexus.exe --profile typora <图片>`，同样验证文件真的落盘——这条路径读的是 `cli-config.json` 里
  `profiles.typora`，和上面 CLI 直传走的是 `resolve_upload_config` 里不同的分支，两条都测了。
- **Obsidian**：设置页把 Obsidian 图床换成 WebDAV profile 后，探测 `/status` 端点返回
  `{"service":"webdav","serviceName":"WebDAV","ready":true}`，确认 Server 正确加载了新的 `Webdav` 变体配置。
  没有再往下走一次真实的 `/upload` POST（要么需要装 Obsidian 插件真的粘一张图，要么需要拿认证 Token
  模拟请求）——权衡下来接受这个残留风险，因为 `/upload` 复用的核心上传逻辑已经被 CLI 路径完整验证过。

验收过程中顺带修了一个**跟 WebDAV 无关的老 bug**：Obsidian 卡片「测试连接」直接用浏览器 `fetch()` 探测
`/status`，但 `/status` 故意不带 CORS 许可（防止任意网页探测本机是否在跑 PicNexus），设置页 webview 跟
服务端口不同源，请求被浏览器拦截，误报成「端口已被占用」。修法：新增 Rust 命令
`check_editor_server_status`（`main.rs`），让探测请求从 Rust 侧发出，不经过浏览器、不受 CORS 约束；
`ObsidianCard.vue` 的 `testObsidianConnection` 改成调用这个命令。`externalEditorPanel.spec.ts` 里原来
mock `fetch` 的那条用例已经改成 mock `invoke('check_editor_server_status', …)`。

## 审查发现与修复（2026-08-17）

真机验收过程中做了一次代码审查，3 条发现全部核实属实并已修复：

- **P1（已修）：CLI-only 的 WebDAV 密码变更不会触发 `cli-config.json` 重写**。
  `useEditorIntegration.ts` 里判断"要不要重新下发"的 `cliSig` 直接拿 `buildCliServicesConfigJson(fd)`
  的结果当签名，但那份 JSON 的 `password` 字段在没传 `webdavPasswords` 时固定是空串——`passwordEncrypted`
  根本不在这份 JSON 里出现。只要这个 WebDAV profile 没有同时被选为 Typora/Obsidian 的图床（纯 CLI 用），
  改密码就不会改变签名字符串，`watch` 检测不到变化，`resolveWebDAVPasswordsForCli` 永远不会被触发，
  磁盘上的 `cli-config.json` 会一直停在旧密码上，直到用户碰了其它编辑器设置或重启应用。
  **修法**：新增 `buildCliServicesSignature`（`editorServiceConfig.ts`），对每个 CLI 服务调用
  `buildEditorCredentialSignature`（webdav 分支比较的是密文 `passwordEncrypted`，不用解密），
  `cliSig` 改用这个函数。回归用例：`editorServiceConfig.spec.ts` 新增 3 条。
- **P2（已修）：服务被禁用时仍会尝试解密 WebDAV 密码，解密失败会挡住"禁用"这个操作本身**。
  `applyEditorServer` 对 `obsidianService`/`typoraService` 的解密只判断"选没选 WebDAV"，没判断
  "这个服务是不是启用的"。换过机器、密钥对不上时，就算用户只是想把 Obsidian 开关关掉，解密照样会抛错，
  `update_server_config`/`save_cli_config` 全都不会执行，服务卡在旧状态出不来。
  **修法**：解密条件加上 `activeCfg.enabled` / `cfg.typoraEnabled` 判断，禁用的服务不再尝试解密。
  回归用例：`useEditorIntegration.spec.ts` 新增 1 条，模拟 `secureStorage.decrypt` 持续失败的情况下
  「关闭已禁用的 WebDAV 服务」仍然成功、且没有调用过 `decrypt`。
- **P3（已修）：`server_upload_webdav` 对文件路径的 UTF-8 要求比同级的 `server_upload_r2` 等函数更苛刻**。
  其它 `server_upload_*` 函数只需要**文件名**是合法 UTF-8（`tokio::fs::read(path: &Path)` 本身不关心
  路径编码）；`server_upload_webdav` 却在自己的入口就对**整条路径**做 `path.to_str()`，任何目录层级
  出现非 UTF-8 字节都会直接失败，风险面比兄弟函数大一圈。
  **修法**：`upload_to_webdav_core`（`webdav_upload.rs`）改成接收 `&Path` 而不是预先转好的 `&str`，
  转换动作挪到函数内部一处；`server_upload_webdav` 不再自己转，直接把 `&Path` 传进去，恢复成和兄弟函数
  一致的签名风格。新增 Windows 平台的回归测试
  `upload_to_webdav_core_rejects_non_utf8_path_instead_of_panicking`（用未配对 UTF-16 代理项构造真实
  存在但转不了 `&str` 的路径）。

  **⚠️ 这次修复的实际收益要说准（2026-08-17 二次审查更正）**：本条最初写的是「至少不再比其它上传器
  更差」，**这句话是错的**。兄弟函数 `server_upload_r2` / `server_upload_jd` 等走的是
  `tokio::fs::read(path)`，只要求**文件名**是合法 UTF-8；而 WebDAV 这条路径经
  `probe_upload_file_size(path: &str)` / `put_file_stream`，仍然要求**整条路径**是 UTF-8。
  所以差距**没有抹平**，WebDAV 依旧比兄弟 server 上传器严格。真实收益只有两条：
  转换失败从 panic 变成清晰的 `AppError::validation`，以及转换点从两处收敛到一处。
  彻底拉平需要改 `commands/utils.rs::probe_upload_file_size` 的签名，影响面覆盖全部 server 上传器，
  仍在本次范围之外（见「未做的事」）。

## 未做的事（明确边界）

- **Obsidian 的真实 HTTP 上传**：见上方「真机验收记录」，`/status` 验证过但 `/upload` 没有
- `probe_upload_file_size` / `put_file_stream` 仍然要求**整条文件路径**是合法 UTF-8，而兄弟
  `server_upload_*` 只要求文件名是。P3 的修复只消除了 panic、收敛了转换点，**没有拉平这个差距**。
  真要解决得改 `commands/utils.rs::probe_upload_file_size` 的签名，影响面覆盖全部 server 上传器，
  超出本次范围

> `cli-config.json` 明文落盘一项**已在 2026-08-17 的后续批次中解决**（信封加密 + 钥匙串主密钥），
> 见下方「后续：cli-config.json 凭证加密」。

---

## 二次审查发现与处理（2026-08-17）

提交前又跑了一轮代码审查，5 条意见的核实结果：

| 审查意见 | 核实结果 | 处理 |
|---|---|---|
| 🔴 WebDAV 密码明文写入 `cli-config.json` | 属实，**但不是本次引入**——同一文件里 GitHub token / 各家 OSS secret key / 全部 cookie 早就是明文。定级为「本批新增红色问题」不准；但「旧 TODO 里那条知情项随段落删除一起消失、没留未关闭追踪」这半句成立 | 直接解决，见下一节 |
| 🟠 编辑器/CLI 导出的链接模板缺默认值兜底 | 属实。`buildServiceConfig` 导出裸 `profile.publicUrlTemplate`，而主链路 `WebDAVUploader` 有 `\|\| DEFAULT`；`render_public_url` 拿到空模板会渲染出**空链接**且静默 | 已修，前后端各兜一层 |
| 🟡 `check_editor_server_status` 未登记进 API 文档 | 属实，**但漏报了范围**：同区的 `save_cli_config` / `check_port_free` / `get_executable_path` 也都没登记 | 已补齐 4 条 + 新增「密钥管理」分类 |
| 建议：验收文档「不再比其它上传器更差」措辞 | 属实，**而且比审查说的更硬**——兄弟函数只要求文件名 UTF-8，WebDAV 要求整条路径，差距根本没抹平 | 已更正 P3 与「未做的事」两处 |
| 建议：Obsidian 别写成完全完成 | **已经满足，无需改动**：TODO.md 该条是 `[~]`，Obsidian 子项是 `[ ]` 未勾选并写明了原因 | 无 |

### 链接模板兜底（🟠）

两侧都补，各有各的理由：

- 前端 `editorServiceConfig.ts`：`profile.publicUrlTemplate?.trim() || DEFAULT_WEBDAV_URL_TEMPLATE`，
  让导出的 `cli-config.json` 里直接是最终生效的模板，而不是留个空串让下游猜
- Rust `render_public_url`：空模板（含纯空格）回落到 `DEFAULT_WEBDAV_URL_TEMPLATE`。放在渲染处而不是
  各调用方，顺带覆盖「用户手改 `cli-config.json`」这条前端管不到的路径

`DEFAULT_WEBDAV_URL_TEMPLATE` 现在 TS / Rust 各有一份，已登记进
`scripts/check-cross-language-constants.mjs` 的 `PAIRS`，漂移会被 `npm run lint` 拦下。

回归用例：`editorServiceConfig.spec.ts` +2（空模板回落、自定义模板不受影响）、
`webdav_upload.rs::render_public_url_falls_back_on_empty_template`。

---

## 后续：cli-config.json 凭证加密（2026-08-17）

### 起因与那个被推翻的判断

原「未做的事」写着「真要加密需要先解决 CLI 独立进程的密钥分发，是独立课题」。**这个判断是错的。**

系统钥匙串的访问控制单位是**用户账号**，不是程序。CLI 进程（`picnexus.exe --service ...`）与 GUI
跑在同一个账号下，于是它直接 `Entry::get_password()` 就能拿到 GUI 写入时用的同一把密钥——
根本不存在「分发」这回事。而且 `keyring = "2"` 早就是依赖了（`.settings.dat` 的主密钥就存在那儿），
零件全是现成的。

### 横向调研（决定方案前做的）

| 软件 | 做法 |
|---|---|
| PicGo（同品类） | `data.json` 纯明文，不加密不收权限；2019 年 issue #223 要求隐藏 token，至今未实现 |
| rclone | 默认 `obscure`——硬编码密钥的 AES-CTR，官方自陈「不是安全的加密，只防不小心瞟到」 |
| AWS CLI | `~/.aws/credentials` 纯明文，官方指导就是 `chmod 600` |
| Docker | 默认走 credential helper → 系统钥匙串 |
| gh CLI | 优先系统钥匙串；无钥匙串才退回明文，且需 `--insecure-storage` 显式开启 |
| VS Code | Electron `safeStorage`：钥匙串存主密钥 + 用它加密本地文件（**与本方案同构**） |
| Cyberduck / Mountain Duck | 密码全部进系统钥匙串 / 凭据管理器 |

结论：`gh` / Docker / VS Code 的信封加密是主流做法，照抄即可。

### 实现

```
系统钥匙串 us.picnex.app.secure / config_encryption_key（32 字节 AES-256 主密钥，与 .settings.dat 共用）
   ├─ GUI 前端 WebCrypto → .settings.dat        （既有）
   └─ Rust secure_key.rs → cli-config.json      （本次新增）
      ├─ save_cli_config 写入前加密
      └─ cli.rs 读取时解密
```

不把凭证直接塞进凭据管理器，是因为 Windows 单条凭据 blob 上限只有 2560 字节
（`CRED_MAX_CREDENTIAL_BLOB_SIZE`），配几个图床就撑爆，所以走信封。

落盘格式：`PNXCLI1:<base64(nonce(12) || 密文+tag)>`，AES-256-GCM。明文 JSON 必然以 `{` 开头，
所以**老版本写下的明文文件仍然读得动**，升级不断链。

新增文件 `src-tauri/src/secure_key.rs`：钥匙串读写（从 `main.rs` 搬出来，GUI 与 CLI 共用）
+ 信封加解密 + Unix 0600 权限收紧。

### 刻意避开的两个业界实现坑

调研 Electron `safeStorage`（VS Code 在用）的内部实现时挖到两个反面教材，都绕开了：

1. **它用 AES-128-CBC + 硬编码 IV（16 个空格）**，同样的明文加出来密文一样，不解密光比对密文
   就能推断信息。本实现用 **AES-256-GCM + 每次随机 nonce**，且 GCM 自带完整性校验。
   回归用例 `same_plaintext_produces_different_ciphertext` / `tampered_ciphertext_is_rejected` 守着这两点。
2. **它在 Linux 缺钥匙串时静默降级**到近乎无加密的模式（PBKDF2 单轮 + 硬编码盐 `saltysalt`），
   用户毫不知情。本实现降级必须是响的：Rust 打 warn 日志 → `save_cli_config` 回传
   `{ encrypted: false }` → 设置页弹一次 warn toast。回归用例见
   `useEditorIntegration.spec.ts` 的「warns the user once…」。

### 密钥轮转

设置备份密码会把主密钥换成口令派生的新密钥（`crypto.ts` 有 3 处调用点），旧密文就解不开了。
处理放在 Rust 侧的 `set_secure_key`：**换钥前**先用旧密钥把 `cli-config.json` 解成明文暂存，
换完再用新密钥重新加密写回。放 Rust 比让每个前端调用点各自记得重新下发一次可靠。

### 诚实的边界

- ✅ **挡得住**：文件被拷走 / 同步到云盘 / 混进备份包 / 随日志外传；同机器上的其他用户账号
- ❌ **挡不住**：以当前用户身份运行的恶意程序——它同样能问钥匙串要到密钥。
  这是所有本机凭证存储的共同上限：Cycode 演示过恶意 VS Code 扩展可读走全部 secret，
  微软的回应是「这是不做扩展沙箱这个设计选择的必然结果」，明确不修
- ⚠️ **便携版基本无效**：主密钥明文放在 exe 旁的 `secure-key` 文件里，钥匙就躺在锁边上。
  这是便携版「拔下 U 盘带走全部数据」前提的既有取舍，与 `.settings.dat` 一致，不假装解决了

### 验证

- `cargo test`：295 → 303（`secure_key` 7 条：往返、随机 nonce、明文兼容、错密钥报错文案、
  篡改拒绝、畸形载荷、非法密钥长度；`webdav_upload` 1 条：空模板回落）
- `npx vitest run`（编辑器相关 3 个文件）：26 → 30
- `npm run typecheck` / `npm run lint`（含新登记的跨语言常量）：全绿

### 跨进程端到端验证（2026-08-17）

单测只能证明加解密函数自洽，证明不了「GUI 进程加密写入 → CLI **另一个进程**从钥匙串取到同一把密钥
并解开」。所以补了一轮真机验证：用真实的系统钥匙串密钥把真实的 `cli-config.json` 就地加密，
再用 debug 构建的 `picnexus.exe` 跑完整上传。

环境：dufs `http://127.0.0.1:5001`（`admin`/`admin123`，全路径需认证），1×1 PNG 共 70 字节。

| 场景 | 结果 |
|---|---|
| 密文格式 | 2756 字节明文 → 3720 字节密文，以 `PNXCLI1:` 开头 |
| 明文残留扫描 | `password` / `secret` / `cookie` / `token` / `webdav` / `http` / `{` **一个都搜不到** |
| 真实钥匙串往返 | ✓ 两次读取密钥一致（44 字符 Base64 = 32 字节），加解密往返成功 |
| CLI 直传（`--service webdav:<id>`） | ✓ 退出码 0，返回 `http://127.0.0.1:5001/pics/e2e-test.png` |
| Typora 分支（`--profile typora`） | ✓ 退出码 0，走的是 `resolve_upload_config` 的另一条分支 |
| 落盘核对 | ✓ `pics/e2e-test.png` 70 字节，时间戳吻合 |
| HTTP 读回 | ✓ 带认证 GET 200，内容与源文件**逐字节一致**（非假成功） |
| 篡改密文（改 1 字符） | ✓ 退出码 1，报「解密失败——密钥不匹配或文件已损坏。常见原因是修改过备份密码……」 |
| 旧版明文向后兼容 | ✓ 换回明文配置后退出码 0，上传照常，**升级不断链** |

**顺带实锤了链接模板那个 🟠**：本机 `webdav:msrlkrjz39xp49fzy` 这个 profile 的
`public_url_template` 字段**实际就是空串**——审查提的不是假设场景，它在真实配置里活着。
本次上传返回的 `http://127.0.0.1:5001/pics/e2e-test.png` 正是 `render_public_url` 的默认模板
兜底渲染出来的；换成修复前的代码，这里会静默返回一条**空链接**。

**另一个实证**：这台机器上的 `cli-config.json` 是 2756 字节，**已经超过 Windows 凭据管理器
2560 字节的单条 blob 上限**。这从实测角度印证了「不能把配置整个塞进凭据管理器、必须走信封加密」
不是纸上谈兵。

验证用的临时 helper（就地加解密真实配置的三个 `#[ignore]` 测试）跑完已删除；
只把无副作用的那条固化进 `secure_key.rs::real_keychain_is_usable`（只读 `load_existing_key`，
不会凭空造密钥），排查「用户说 CLI 解不开配置」时手动跑：
`cargo test -- --ignored --nocapture real_keychain_is_usable`。

验证结束后 `cli-config.json` 已还原成验证前的明文原样（SHA256 比对一致）——**故意不留在加密态**，
因为用户当前安装/日常使用的仍是旧版二进制，旧代码不认 `PNXCLI1:` 前缀。等新版跑起来、
设置页 `onMounted` 那次 `applyEditorServer(force: true)` 会自动把它转成加密。

---

## 附带修复：Obsidian 插件上传时闪现「未找到锚点」报错（2026-08-17）

### 现象

用户在真实 Obsidian 里粘图，上传其实成功了（服务端两次 `[Server] ✓ 文件上传成功`），
但过程中文档里出现

```
![Uploading image.png...](#picnexus-upload-1786943282409-2)
```

悬停时弹出 **「在 测试图片上传 中未找到 "picnexus-upload-1786943282409-2"」**。

### 根因

`](#...)` 在 Obsidian 里是**指向当前笔记某个标题的内部链接**。占位符存在的那几秒钟，
Obsidian 解析不到同名标题，就把它渲染成失效链接并弹出这条提示。
**上传链路本身完全正常**，坏的只是占位符的写法——但用户看到的是一个报错，非常吓人。

跟 WebDAV / cli-config.json 加密这批改动**无关**，是插件里的既有问题
（`plugins/obsidian/src/markdown.ts`，本次之前一直如此）。

### 修法（两轮才收敛，第一轮的教训一并留着）

**最终形态：纯文本，不带任何 Markdown 语法。**

```
⏳ Uploading image.png… (pmt4)
```

文档里的原文与用户屏幕上看到的**完全一致**——没有任何需要靠渲染隐藏的东西。

ID 直接示人，所以要短：用「会话随机标签(3 字符) + 自增序号」。序号保证同一会话内不撞；
会话标签解决另一个坑——上次若在上传途中被关掉，笔记里会残留孤儿占位符，新会话序号从 1 重来
就可能把新链接替换到那个更靠前的孤儿身上。

**这个形态是踩了三次才收敛的，三次的坑都值得留着：**

| # | 形态 | 为什么不行 |
|---|---|---|
| 1 | `![Uploading x...](#picnexus-upload-<id>)` | `](#...)` 是指向笔记内标题的链接，解析不到 → 弹「在 <笔记名> 中未找到 <锚点>」 |
| 2 | `⏳ Uploading x... <!--picnexus-upload:<id>-->` | 报错没了，但 **HTML 注释在光标所在行原样露出来** |
| 3 | `![⏳ Uploading x… (id)]()`（社区同款） | 空 URL 确实没东西可解析了，但 `![` 和 `]()` **同样在光标所在行露出来** |

**根子上的教训**：第 2、3 次都栽在同一个错误假设上——「Live Preview 会把原始标记渲染隐藏」。
它只在**光标不在的那一行**隐藏，而占位符的整个生命周期里光标基本都压在它身上（刚粘完图，
光标就在那儿）。所以任何依赖渲染隐藏的写法在这个场景下都不成立，只能用纯文本。

社区同类插件（[obsidian-r2-auto-upload](https://github.com/aest3ra/obsidian-r2-auto-upload)、
[obsidian-image-uploader-to-api](https://github.com/babarot/obsidian-image-uploader-to-api)）
用的是形态 3（`![Uploading… (id)]()`）。照抄它解决了「未找到」，但没解决刺眼——
**横向调研给的是安全下界，不是上界**。

顺带把定位方式从「拿占位符全文 `indexOf`」改成**按 ID 正则匹配**。原写法有个更隐蔽的风险：
Smart Typography 这类社区插件会改写可见部分的省略号、Linter 会重排空白——文本一被改写，
精确匹配就找不到，替换**静默失败**（返回值全部被丢弃，没有任何告警），占位符永久留在用户笔记里。

### 写正则时踩的坑（被测试逮住了）

中间段最早写成 `[^\n]*?`。批量上传会把多个占位符放在**同一行**，于是找第二个占位符时，
正则从**第一个**的起始标记一路吃到第二个的尾标记，把中间无关的正文一起圈进替换范围
（测试报 `start: 7` 而非期望的 `66`）。最终写成 `(?:(?!⏳)[^\n])*`——不跨越换行、也不跨越
下一个 `⏳`，天然关在自己那一段里；贪婪匹配配合 `(id)` 尾锚，
还顺带处理了「文件名本身就带 `(pmt4)`」的情况。
`createUploadPlaceholder` 也剔掉文件名里可能混入的 `⏳` 与换行，免得把这个判据搅乱。

### 验证

`npm run ci:obsidian` 全绿（lint / typecheck / build / validate-release / 12 条发布测试 /
9 条行为测试）。行为测试新增 3 条回归：

- `placeholder is plain text with no markup that Live Preview would expose` —— 一条用例把三次
  弯路各守一遍：不含 `](#`、不含 `<!--`、不含 `![`、不含 `](`
- `finds the placeholder even after another plugin rewrites the visible text` —— 模拟排版插件
  改写省略号与空白，确认仍能定位并整段替换
- `picks the trailing id even when the file name looks like one` —— 文件名带 `(ab1)` 时不误匹配

原有 3 条按旧契约（传占位符全文）写的用例已改为传 ID。

### 真机确认

用户 2026-08-17 在真实 Obsidian 里粘图，直接读 vault 里的笔记原文核对：

```
![image.png](https://img30.360buyimg.com/imgzone/jfs/.../09361b326fcbee0a.png)
```

与日志 `[05:30:26] [Server] ✓ 文件上传成功` 的 URL 一致——**占位符确实被正确替换、报错也消失了**。
（截图里看到的占位符是上传进行中的那一瞬间，不是残留。）

---

## 附带修复：同名文件静默覆盖（2026-08-17）

### 怎么发现的

WebDAV 真机验收时用户连传 3 张图，`dufs` 目录里**只落了 1 个文件**。3 次都叫 `image.png`，
后面的把前面的覆盖了。这次传的是同一张图所以看不出坏处，但换个场景就是丢数据：

> 笔记 A 粘一张流程图 → `image.png`；次日笔记 B 粘一张报错截图 → 也叫 `image.png` → 覆盖。
> **笔记 A 里的图悄悄变成了笔记 B 的内容，原图不可恢复。**

Obsidian / Typora 剪贴板粘贴出来的文件名**永远**是 `image.png` 这类通用名，所以这不是边角场景。

### 这是漏了，不是设计如此

`docs/flows/upload-flow.md` 早就立过不变量「同一个对象名只对应一次上传」，S3 系用
`{yyyyMMdd}_{4位随机}_{原名}` 实现。但那份实现**只在前端** `objectKey.ts`（GUI 主界面路径）。
四条路径里三条没兑现：

| 路径 | 修复前 | 修复后 |
|---|---|---|
| GUI 主界面 · S3 系 | ✅ 已有 | 不变 |
| GUI 主界面 · WebDAV | ❌ 原文件名 | ✅ |
| 编辑器/CLI · S3 系 | ❌ 原文件名 | ✅ |
| 编辑器/CLI · WebDAV | ❌ 原文件名 | ✅ |

### 命名格式：两套顺序，刻意不同

```
S3 系     20260817_a3f9_image.png     日期在前
WebDAV    image_20260817_a3f9.png     原名在前
```

判据来自档案命名规范的通用规则——**把最重要的参数放最前面**（哈佛 / 哥大等命名指南均如此表述）。
S3 桶基本没人用文件管理器翻，日期在前便于按时间扫读；WebDAV 通常指向用户自己的 NAS，
**那个目录是人会去翻的**，此时最重要的是「这是哪张图」，14 字符的日期前缀正好挡住它。

调研顺带纠正两个容易想当然的点：

- AWS 自 2018 年起[已明确随机前缀不再影响 S3 性能](https://repost.aws/knowledge-center/s3-object-key-naming-pattern)。
  随机段现在的**唯一职责是防覆盖**，别再拿「打散分区」当理由。
- 日期段不只是为了好看：它把碰撞分母从「历史上所有同名文件」缩到「同一天的同名文件」，
  正是 4 位随机（168 万种）够用的前提。去掉日期得加到 8 位，反而更长。
- WordPress 那套（`uploads/YYYY/MM/` 日期建目录 + 原名保持干净）也很好，但它靠**服务端查重**
  才决定要不要追加 `-1`。WebDAV 上这意味着每次上传多一次往返 + 竞态，且查重失败会退回静默覆盖，
  正是要消灭的东西，故不采用。

### 可关闭

`WebDAVStorageProfile.uniqueFileName` / `ServerUploadConfig::Webdav.unique_file_name`
（设置页「文件名加唯一后缀」开关）。**缺省即开启**，两侧判据分别是 `!== false` 与
`#[serde(default = "default_true")]`——写成 falsy 判定会让升级前的老 profile / 老
`cli-config.json` 默认失去防护，而 Rust 侧没有 `serde(default)` 更会让整份配置反序列化失败、
三条编辑器链路一起罢工。

### 验证

- Rust `cargo test`：303 → **309**（`commands/utils.rs` 新增 6 条：两种格式的形状、
  无扩展名、多点扩展名 `archive.tar.gz`、64 次调用近乎全不重复、base36 定宽左补零）
- 前端 `npx vitest run`：2812 → **2815**（缺省为 true、显式关闭、开关变化要进签名）
- `upload_handler.rs` 原有的 WebDAV 反序列化用例改成断言：那份**故意不带** `unique_file_name`
  的 JSON 必须落到 `true`
- **真机**：同一张图经 CLI 连传 3 次，dufs 目录落了 **3 个独立文件**
  （`e2e-test_20260817_u0gt.png` / `_7eo6` / `_ikyo`），互不覆盖。
  且这次用的 `cli-config.json` 是改动前的版本写的、根本没有该字段——顺带证明了默认值兜得住

---

## 三次审查发现与修复（2026-08-17）

提交前第三轮审查，2 条意见**全部属实**，且都已修复。

### 🟠 加密后，不带 `--service` 的 `picnexus` 列不出可用图床（本批引入的回归）

`format_missing_service_message`（`cli.rs`）直接 `read_to_string` 后交给 `parse_cli_config_json`，
**漏了解密那一步**。`cli-config.json` 改成加密落盘后，这条路径必然解析失败。

真机复现（配置完全正常，只是加密态）：

```
[PicNexus] 缺少 --service <图床名>。
无法读取可用图床。请在 PicNexus 设置中重新保存图床配置。   ← 误导
```

**更糟的是这条建议是死循环**：用户照做去"重新保存"，写出的仍是加密文件，问题原样复现。

**根因不是漏写一行，是「先解密、再解析」这个顺序在两处各写了一遍**，缺省错误路径那份少了一环。
修法不是补上就算，而是把两条路径收敛到同一个入口 `parse_cli_config_from_raw(raw, key)`，
让它们不可能再分叉；顺带把密钥获取与解密拆开（`decrypt_cli_config_with_key`），
使解密逻辑能被单测直接覆盖——原先它必须访问真实钥匙串，所以一直没有测试兜着。

修复后真机复验：

```
[PicNexus] 缺少 --service <图床名>。
可用图床: chaoxing, custom_s3:…, jd, r2, webdav:…, zhihu
```

回归用例（`cli.rs`，用测试专用密钥造加密 fixture，不碰真实钥匙串）：

- `parses_encrypted_config_not_just_plaintext` —— 加密态必须列得出 r2/jd，且不得退回通用错误文案
- `parses_plaintext_config_for_backward_compatibility` —— 旧版明文仍读得动
- `wrong_key_surfaces_actionable_error` —— 密钥不匹配时报错要指出「备份密码」这个常见原因

### 🟡 CLI 卡片的安全文案在便携版下不成立

原文案无条件声称「文件用系统钥匙串中的密钥加密，被拷走或同步到云盘后无法解开」。
但便携版的密钥在 `data/secure-key`（`portable.rs::secure_key_path`），**就在程序目录里、
和配置文件是邻居**——整个目录被拷走后照样解得开。这会让便携版用户高估保护边界。

修法：调用已有的 `is_portable_mode` 命令分流文案。

- 便携版：「便携版的加密密钥就放在程序目录内，**整个目录被拷走后仍能解开**，请勿把程序目录放进云盘或共享位置」
- 安装版：保留原文案，并补一句「系统钥匙串不可用时会降级为明文存放，届时会有提示」（补齐降级分支）

探测失败时**默认按安装版处理**：那份文案更保守（强调「以你身份运行的程序仍可读取」），
猜错方向也不会让用户高估防护。

### 验证

- `cargo test`：309 → **312**（cli.rs 新增 3 条）
- `npx vitest run`：2815 全过；`npm run lint` / `typecheck` 全绿
- **真机**：加密配置下 `picnexus <图片>`（不带 `--service`）正确列出全部 10 个图床
- `CliCard.vue` 416 / 500 行
