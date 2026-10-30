# 死代码清理（2026-10-30）

分支 `feat/redesign`。清理本身 17 个提交，142 个文件改动，净删 2382 行，其中 30 个文件整个删除。扫描方法与已知误报见 [dead-code-scan.md](../reference/guides/dead-code-scan.md)。

## 为什么做

`TODO.md` 记着阶段 11 之前就没人用的 16 个函数和 30 条通知文案，要求逐条确认后删除。借这次把全仓扫了一遍：前端用 knip，Rust 用编译器，前后端之间的命令逐个对照。

## 删了什么

| 批 | 内容 | 依据 |
|----|------|------|
| 1 | TODO 点名的 16 个函数与 30 条通知文案；`UI_COPY` 里 20 个没人读的键 | 除定义处外零引用 |
| 2 | 只剩测试在调的 7 个函数、2 个文件（`useClickOutside`、`utils/validators`），连同它们的测试 | 10 月 17 日删旧页面时漏删 |
| 3 | 3 个任何窗口都没放行的命令（`upload_to_r2`、`fetch_qiyu_token`、`download_image_from_url`）、`IntoAppError` 的 8 个方法、4 个只收不读的字段 | Rust 里的 `allow(dead_code)` 随之清零 |
| 4 | 19 个 `index.ts`（18 个图床文件夹加 `base/`），以及 `src/uploaders/index.ts` 末尾 19 条转出 | 生产代码都直接从类文件导入 |
| 5 | 测试里没人用的 fixtures、`helpers/index.ts`、`linkCheckFactory` 和 13 个工具函数 | 零引用 |
| 6 | 12 个零引用的类型、1 个脚本常量；73 处只在本文件用的 `export`（含 Obsidian 子包 2 处） | 只影响谁能导入 |
| 连锁 | 京东、纳米两个只在自己测试里创建的错误类 | 去掉转出口后才在生产模式里露出来 |
| 7 | Tauri HTTP 插件与主窗口的 `http:default`（8 条网址范围） | 前端自 7 月 16 日起零调用；GitHub、Imgur、SM.MS 走 webview 自带的 `fetch`，由 CSP `connect-src` 管 |

2026-09-09 的[结构整理](./structure-refactor-2026-09-09.md)把「每个图床一个 `index.ts` 入口」当作样板，但从没有代码经它导入。新增图床的写法以 [add-new-uploader.md](../reference/guides/add-new-uploader.md) 为准：直接从类文件导入。

## 顺带改正的文档

删东西时对照了每处提到它们的文档，另外改正了几处早已和代码对不上的说法：测试指南里不存在的 `shallowMountWithDefaults` / `findByTestId` / `clipboardMock`，`download_url_image` 的调用方（从 URL 下载、粘贴图片链接、补充备份三处），R2 连接测试实际发的是 HEAD 请求。

## 没删的

逐条理由见扫描指南的「已知误报」。本次另外留下的：Rust 的 `R2Error`、微博错误类（生产代码在创建和判断），`services/database/index.ts`（生产代码在用）。

## 验证

每批删完跑类型检查、lint、单测与构建，Rust 批跑 `cargo test`；收尾时 `npm run ci:full` 与 `test:e2e:chromium` 全部通过，Obsidian 子包的 lint、类型检查和行为测试通过，重新打包的 `main.js` 与原来逐字节相同。视觉回归没跑：本次没有界面改动。
