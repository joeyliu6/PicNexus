# Rust 侧 main.rs 减重：21 个内联命令归位到 commands/

> 2026-09-09 · 承接 [structure-refactor-2026-09-09.md](structure-refactor-2026-09-09.md) 的第七批（Rust 批）

## 为什么做

`src-tauri/src/main.rs` 3050 行，是全项目最大的单文件。里面塞着 22 个 `#[tauri::command]`（占全部 77 个的 28.6%）、26 个私有辅助函数、9 个类型定义、3 个测试模块，而 `fn main()` 本身只占 472 行——启动逻辑被命令实现淹没了。`commands/` 目录已有 24 个按域拆好的模块，位置是现成的。

前六批（前端）是「移动文件 + 改路径」，编译器和测试能完全兜底；这一批要处理 Rust 模块可见性和条件编译，且 Cookie 登录链路的正确性只能真机验证，所以单独成批。

## 结果

| 项 | 前 | 后 |
|---|---|---|
| `main.rs` 行数 | 3050 | **644** |
| `main.rs` 里的 `#[tauri::command]` | 22 | **1**（`set_close_to_tray`） |
| `commands/` 模块数 | 24 | 31 |
| `cargo test` | 348 passed | **348 passed**（全程每批不变） |
| `cargo clippy` 警告 | 3 | 3 |

判据用的是**通过数不变**而不是「绿不绿」——测试模块搬家最容易整块漏掉，而漏掉的表现恰恰是「变绿了、少跑了」。三个测试模块（342 行、28 个测试）全部跟着对应代码走。

## 落点

| 模块 | 内容 |
|---|---|
| `commands/app_paths.rs`（新） | `is_portable_mode`、`get_user_data_dir`、`get_history_db_path` |
| `commands/system.rs`（新） | `open_log_dir`、`get_executable_path`、`check_port_free`、`check_editor_server_status`、`update_server_config` |
| `commands/open_target.rs`（新） | `open_path` + `OpenTarget` + 三个 validate 函数 + 两对 `#[cfg(windows)]` 判定 + `open_target_tests` |
| `commands/app_key.rs`（新） | `get_or_create_secure_key`、`set_secure_key` + `rescue_*` + `cli_config_rescue_tests` |
| `commands/cli_config.rs`（新） | `save_cli_config` + `SaveCliConfigOutcome` |
| `commands/r2.rs`（追加） | `test_r2_connection` + `hmac_sha256` + `R2Config` |
| `commands/webdav_backup.rs`（新） | `test_webdav_connection`、`probe_webdav_connection`、`webdav_request` + 四个结构体 + `webdav_connection_tests` |
| `commands/cookie_login.rs`（新） | 6 个 cookie/登录窗口命令 + 12 个私有函数 + `CookieUpdatedPayload` |

留在 `main.rs`：`fn main()`、`set_close_to_tray` + `CloseToTrayState`、`HttpClient`、`ServerState`、5 个托盘/窗口私有函数——它们被 `fn main()` 的托盘构建代码直接调用，搬走只会增加往返引用。

## 计划调整（到现场后改的主意）

原计划（提示词）按「动作」分组，核实现有代码后改成按域分组：

1. **`test_r2_connection` 并入现有 `r2.rs`**，没有另建 `connection_test.rs`。现有约定是每个服务一个文件、上传与连接测试同住（`s3_compatible.rs` 就是），按动作分组会横切这条约定。代价是 `r2.rs` 里同时有两套 HTTP 栈（上传走 aws-sdk-s3、连接测试走 `HttpClient` + 手搓 SigV4），已在文件里写清为什么。
2. **备份 WebDAV 三件合成一个 `webdav_backup.rs`**，没拆成 `connection_test.rs` + `webdav_request.rs`。仍然**不并入 `webdav_upload.rs`**——后者的头部注释写明了两者为何是两个东西。
3. **两个密钥命令同模块、同批次搬**。原计划把 `get_or_create_secure_key` 放批次 1、`set_secure_key` 放批次 3，但它们同属「密钥管理」家族（日志前缀都是 `[密钥管理]`），拆开会让调用方和它唯一的辅助函数分居两个文件。
4. **`show_login_window` 跟 cookie 家族走**，没有单独丢进 `system.rs`——它操作的正是 `open_login_window` 建出来的那个窗口。

## 核实提示词时发现的偏差

计划文档的行号地图基本准确，但有三处需要修正：

- 标题写「22 个命令」，实际搬 **21 个**（`set_close_to_tray` 提示词自己也说留下）。
- 只提醒了 `open_target` 那两对条件编译，**漏了 Cookie 家族**：`attempt_cookie_capture_and_save_generic`、`spawn_cookie_poll_fallback`、`extract_and_merge_cookies`、`try_extract_cookie_header_generic` 四个私有函数全带 `#[cfg(target_os = "windows")]`，且**没有非 Windows 实现**，靠调用点的 `#[cfg(not(target_os = "windows"))]` 早退分支兜底。
- 文档同步清单漏了 `commands/webdav_upload.rs` 里 3 处写死 `main.rs::probe_webdav_connection` 的注释。

## 可复用的做法

- **`unused_imports` 警告只对当前 cfg 生效。** 本机 `cargo check` 只编 Windows 那一半，非 Windows 分支搬错了本机看不出来。反过来「Windows 下没用到的 import」删掉一定安全（非 Windows 编的是子集），但「只有非 Windows 才用到的 import」本机永远发现不了——那一半只有 CI 的 ubuntu / macos 两格能验。
- **搬完立刻清 `main.rs` 的孤儿 import。** 每一批都会留下几个（本次累计 7 个：`Path`、`PathBuf`、`HashMap`、`Duration`、`AppError`、`base64::STANDARD`、`url_policy::*`、`hmac`/`sha2`）。不清理会让 clippy 警告数悄悄上涨，而那正是本次唯一的回归判据之一。
- **用 `sed -n 'a,bp'` 按行范围搬运，不要手抄代码。** 中文注释经过 shell argv 会被按 GBK 解，按行范围抽取是字节级复制，天然无损；模块头部那几行中文注释另外用写文件工具落盘再 `cat` 拼接。
- **`sed -e 'a,bp;a,bd'` 里的 `p` 会让 `d` 失效。** `p` 先打印一次、`d` 再抑制自动打印，净效果是「这段没删」。本次踩到一次，靠 `wc -l` 对不上数才发现——删代码后核对行数，别只看编译过没过。

## 留给人工真机验收

批次 1–4 由 `cargo test` + `npm run ci:full` 完全覆盖。批次 5（Cookie 登录）改的是开窗口、监听 Cookie 事件、跨窗口通信这条链，单测和编译都保证不了，需要在界面上验：

1. 设置 → 图床，选一个需要 Cookie 登录的图床（B 站 / 知乎 / 超星），点「登录」
2. 登录窗口正常弹出、能加载目标站点页面
3. 在窗口里完成一次真实登录
4. 登录成功后窗口自动关闭，设置页显示已登录
5. 关掉再打开设置页，登录状态仍在（Cookie 已持久化）
6. 用该图床上传一张图，确认成功
