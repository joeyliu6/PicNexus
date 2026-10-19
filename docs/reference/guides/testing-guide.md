# PicNexus 测试实操指南

> 这份指南用于决定“写哪类测试、放在哪里、用哪些 helper、跑什么命令”。偏项目实操，不重复展开 Vitest、Playwright 或 Tauri 的通用理论。

## 当前测试体系

| 类型 | 目录 / 配置 | 主要用途 |
|------|-------------|----------|
| 单元 / composable / 组件测试 | `tests/unit/**/*.spec.ts`，`vitest.config.ts` | 纯逻辑、状态流、Vue 组件交互 |
| 视觉截图测试 | `tests/redesign/*.visual.spec.ts`，`playwright.config.ts` | 新界面每页按设计画板编号截图回归 |
| mocked E2E | `tests/e2e/*.e2e.spec.ts`，`playwright.e2e.config.ts` | 浏览器环境下验证主流程与 mocked Tauri 边界 |
| 真实 Tauri E2E | `tests/tauri-e2e/*.tauri.e2e.cjs`，`wdio.tauri.e2e.conf.cjs` | 少量真实桌面壳层冒烟 |

Vitest 使用 `happy-dom`，全局 setup 为 `tests/unit/setup.ts`，当前会加载统一的 Tauri mock。覆盖率只统计 `src/utils/**`、`src/services/**`、`src/core/**`、`src/composables/**`、`src/uploaders/**`。

## 测试类型边界

| 场景 | 写什么测试 | 判断标准 |
|------|------------|----------|
| 纯逻辑、格式化、状态计算 | 单元测试 | 输入输出明确，不需要 Vue 渲染或真实原生能力 |
| composable 状态流 | composable 测试 | 关注 `ref` / `computed` / 方法调用后的状态变化 |
| Vue 组件交互 | 组件测试 | 关注 props、emit、按钮点击、条件渲染、轻量 DOM 行为 |
| 页面 UI 表现 | Playwright screenshot 视觉测试 | 关注布局、断点、深浅色、弹窗、空态、加载态、失败态 |
| Tauri 原生能力 | 少量 E2E 冒烟 | 只验证壳层启动、主导航、mocked native 边界或真实桌面是否白屏 |

不要用组件测试覆盖整页视觉布局，也不要用 E2E 去测纯函数。测试越靠近业务边界，数量越少、场景越关键。

## 什么时候写什么

| 改动类型 | 首选测试 | 项目例子 |
|----------|----------|----------|
| utils / formatter / status 计算 | 单元测试 | `tests/unit/utils/formatters.spec.ts` 验证 `formatFileSize`、`formatRelativeTime`；`tests/unit/utils/uploadStatus.spec.ts` 验证成功、失败、上传中、等待中状态判断 |
| URL、Markdown、路径、布局算法 | 单元测试 | `linkFormatter.spec.ts`、`mdParser.spec.ts`、`pathUtils.spec.ts`、`justifiedLayout.spec.ts` |
| uploader 或 service 分发逻辑 | 单元测试，必要时 mock Tauri invoke | `uploaderFactory.spec.ts`、`multiServiceUploader.spec.ts`、`historyDatabase.spec.ts` |
| composable 状态流 | composable 测试 | `useQueueState.spec.ts` 验证队列 CRUD 与节流更新；`useUploadController.spec.ts` 验证上传会话与图床列表；`tests/unit/tray/*.spec.ts` 验证托盘菜单由配置推出、点击分派到控制器；`useLinkCheck.spec.ts`、`tests/unit/views/health/*.spec.ts` 验证业务状态推进 |
| 组件交互 | 组件测试 | `tests/unit/shell/appShell.spec.ts` 验证侧栏导航、跳转事件、`Ctrl+\` 收起侧栏 |
| 页面多状态 UI | 视觉截图测试 | 新界面：`tests/redesign/home.visual.spec.ts` 跑真应用 + `tests/e2e/mocks`，按设计画板编号覆盖首页、图库、链接健康、图床、设置各状态 |
| mocked 原生边界 | mocked E2E | `tests/e2e/app-smoke.e2e.spec.ts` 验证启动不白屏、主导航、设置保存与失败回滚、文件选择、剪贴板、上传后复制链接、图库空状态、链接健康状态栏 |
| 真实桌面壳层 | 真实 Tauri E2E | `tests/tauri-e2e/app-smoke.tauri.e2e.cjs` 只切页面、只看不点：真实应用启动、五个导航（侧栏展开或收起都认）、设置 7 个分组、图库、图床、链接健康状态栏；不改设置、不起检测，跑在本机真实数据上也不留痕迹 |

视觉测试跑真应用 + `tests/e2e/mocks` 的原生接口模拟：配置、历史、上传结果都在页面加载前用种子写进去（`tests/redesign/helpers.ts`），不依赖真实网络、真实图床或真实 Tauri 后端。

mocked E2E 通过 `tests/e2e/vite.config.ts` 把 Tauri API alias 到 `tests/e2e/mocks/*`，适合验证“前端走到了 native 边界且不会崩”。真实 Tauri E2E 成本高，只保留少量冒烟，不承担业务回归主力。

## Helper 使用规范

新测试优先从这些入口复用，不要每个 spec 自己堆一套 mock 和 mount 配置。

| helper | 用法 |
|--------|------|
| `tests/unit/helpers/vueMount.ts` | 组件测试优先用 `mountWithDefaults` / `shallowMountWithDefaults`。它内置 `v-tooltip` 测试替身、`Teleport` stub、`Transition` 配置；查 `data-testid` 用 `findByTestId` |
| `tests/unit/helpers/wait.ts` | 异步刷新优先用 `flushPromisesAndTicks`、`flushTicks`；定时器用 `useFakeTimers`、`advanceTimersByTime`、`runPendingTimers` |
| `tests/unit/helpers/tauriMock.ts` | 普通 Tauri API mock 统一用这里的 `setupInvokeResponses`、`setupInvokeHandler`、`mockInvokeResponse`、`mockInvokeError`、`resetTauriMocks`、`get*Mock`；剪贴板场景用 `getClipboardMocks()` 拿 `writeText` / `readText` / `writeImage` / `readImage` 的 mock（独立的 `clipboardMock.ts` 已于 2026-09-09 删除） |
| `tests/unit/factories` | 需要结构化业务对象时优先用工厂：`createConfig`、`createHistoryItem`、`createQueueItem`、`createMockUploader`、`createLinkCheckRow` 等 |
| `tests/unit/fixtures` | 多个测试共享的固定数据用 fixtures：`historyRows`、`favoriteHistoryRows`、`linkCheckRows`、`selectedLinkCheckRows`、`imageUrls` |

推荐模式：

```ts
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import { mockInvokeResponse } from '../../helpers/tauriMock';
import { createQueueItem } from '../../factories';
```

如果测试只需要一个很小的对象，可以在 spec 里内联；一旦同类对象出现第二次，优先抽到 factory 或复用已有 factory。

## Mock 规范

普通 Tauri API 使用统一 `tauriMock`。包括 `invoke`、`event`、`path`、`fs`、`dialog`、`shell`、`http`、`updater`、`process` 等，测试里只配置行为，不重复写整段 `vi.mock('@tauri-apps/...')`。

clipboard 使用 `clipboardMock`。剪贴板读写错误、文本返回、写入断言都走剪贴板 helper，避免和普通 `invoke` mock 混在一起。

`plugin-sql` 这类需要状态化数据库替身的测试可以本地 mock，但必须写注释说明原因。当前例子：

```ts
// Keep plugin-sql local: this suite needs a stateful in-memory SQL adapter.
vi.mock('@tauri-apps/plugin-sql', () => ({ ... }));
```

不要在测试里散落大段重复 native mock。出现以下情况时，先考虑扩展 `tests/unit/helpers/tauriMock.ts` 或 `tests/e2e/mocks/*`：

- 多个 spec 需要同一个 Tauri API 默认行为。
- mock 逻辑超过少量 `mockResolvedValue`。
- mock 需要跨测试维护状态或记录调用。

允许本地 mock 的情况：

- 目标是被测模块的直接依赖，而不是 Tauri native API，例如某个 service 或 composable。
- 这个 mock 只服务当前 suite 的特殊状态机。
- 像 `HistoryDatabase`、连接池、SQL 查询时序这类测试需要精确控制内部状态。

## 命令

| 命令 | 用途 |
|------|------|
| `npm run test:unit` | 跑全部 Vitest 测试 |
| `npm run test:run` | `test:unit` 的别名，PR 模板里使用这个名字 |
| `npm run test:coverage` | 跑 Vitest 并生成 `coverage/`，受 `vitest.config.ts` 阈值约束 |
| `npm run test:visual` | 跑新界面视觉截图（`redesign-light` / `redesign-dark`），自动启动应用的 Vite 服务（端口 1423） |
| `npm run test:visual:update` | 重录视觉快照，必须人工确认 diff |
| `npm run snapshots:noise` | 重录后把工作区里改过的基准图和 `HEAD` 逐像素比，分出「渲染噪声」与「真改动」；加 `-- --restore` 把噪声图 `git checkout` 回去。默认看 `tests/redesign`，可传别的路径 |
| `npm run test:e2e` | 跑 mocked Playwright E2E（chromium + webkit 两个引擎），自动启动 `tests/e2e` Vite harness |
| `npm run test:e2e:chromium` / `npm run test:e2e:webkit` | 只跑其中一个引擎 |
| `npm run test:tauri:e2e` | 跑真实 Tauri 桌面冒烟，会检查 driver、构建 Vite、构建 Tauri debug binary |

Rust 侧起本机 HTTP 服务的测试要绕开系统代理：本机开着系统代理时，reqwest 0.11 不读代理例外名单，发往 `127.0.0.1` 的请求也交给代理，关掉的端口会被代理回一个 502（「连不上」测成了「服务器出错」）。测试里用 `reqwest::Client::builder().no_proxy()`，或跑前设 `NO_PROXY=127.0.0.1,localhost`。

首次跑 WebKit 前需要装一次浏览器：`npx playwright install webkit`（约 50MB，独立于系统，不需要装 Safari）。

真实 Tauri E2E 前置依赖：

- `tauri-driver`：`cargo install tauri-driver --locked`
- Windows：安装与 Edge 版本匹配的 `msedgedriver`，或设置 `TAURI_NATIVE_DRIVER`
- Linux：安装 `WebKitWebDriver` / `webkit2gtk-driver`，无桌面时用 `xvfb`
- macOS：当前不支持 `tauri-driver` 桌面 WebView，发版前走手动清单

> CI 上这套跑不起来的原因不是配置问题：WebView2 Runtime 150+ 在**提权**宿主下故意丢弃
> msedgedriver 注入的调试参数，而 GitHub 跑手默认以管理员运行。已接入 `gsudo --integrity Medium`
> 降权绕过，根因见 [wry#1782](https://github.com/tauri-apps/wry/issues/1782) 与
> `docs/TODO.md`「Tauri E2E 在 CI 跑手上建会话失败」。

### 带数据的验收（portable 隔离库）

需要预置历史记录的验收 spec（`PICNEXUS_ACCEPTANCE=1` 门控）走 portable 隔离：

```bash
node scripts/seed-tauri-e2e-portable.mjs          # 建 portable.json + 6 条 e2e-* 记录
PICNEXUS_ACCEPTANCE=1 npm run test:tauri:e2e
node scripts/seed-tauri-e2e-portable.mjs --clean  # ⚠️ 必做
```

portable 模式下应用的**全部**数据（DB / 配置 / 日志 / 主密钥）落到
`src-tauri/target/debug/data/`，完全不碰真实用户数据；密钥走文件而非系统钥匙串。
⚠️ 不 `--clean` 的话，以后 `tauri dev` 会静默进入 portable 模式读错数据。
建表语句由脚本从 `SchemaManager.ts` 运行时抽取，不存在第二份会漂移的 DDL 副本。

### 真机走查（AI 自己看界面）

视觉测试用的是夹具数据；改完维护页这类「数据 → 判断 → 界面」整条链路，还要在真应用里走一遍。做法：

1. `node scripts/seed-tauri-e2e-portable.mjs` 建好隔离库，再用 Python 把 `history_items` 换成自己造的记录。`results` 每项写成 `{ serviceId, status: 'success', result: { serviceId, fileKey, url } }`（应用认这个形状，种子脚本里的 6 条 `e2e-*` 不是）。
2. 本机起一个假图床（Python `ThreadingHTTPServer`），按路径回 200 真图片（大于 1 KB、`image/png`）/ 404 / 502 / 403 / 超过 10 秒 / 302，链接写 `http://127.0.0.1:端口/...`：探测放行回环地址。
3. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev`，用 Playwright `chromium.connectOverCDP('http://127.0.0.1:9222')` 连上主窗口点按钮、截图。
4. 收尾：关掉 `target\debug\picnexus.exe` 和 Vite 进程，`--clean` 删隔离库。

坑：

- 隔离的只有数据库和配置；WebView 的 localStorage 和正式版共用：连上后先把 `Object.entries(localStorage)` 存下来，走查完在关应用前原样写回。`picnexus-theme` 会被开发版写成它自己的主题，正式版下次启动时自己改回。
- 全新的隔离库会先弹新手引导（点「跳过」），而且没有京东：补充备份要两个可用图床，自己加一个。
- 原生对话框（「添加文件夹…」的选文件夹）拦不住：`window.__TAURI_INTERNALS__.invoke` 是只读属性。点完按钮后用 PowerShell 的 UI Automation 找到「Select Folder」窗口，往 AutomationId 1152 下的输入框发 `WM_SETTEXT` 写路径、给 AutomationId 1 的按钮发 `BM_CLICK`。
- 补充备份能跑通：取原图放行 `http://127.0.0.1`。假图床同时接 WebDAV 的 `PUT` / `MKCOL` / `PROPFIND`（`PUT` 故意慢 2–3 秒，才来得及点暂停），在图床页加一个指向它的 WebDAV 当目标。
- 想读页面里的状态，要导入和应用**同一个地址**的模块：先用 `performance.getEntriesByType('resource')` 看页面实际加载的地址，一般是 `/src/xxx.ts`，热更新过的模块带 `?t=时间戳`；`/@fs/C:/…` 和不带 `?t=` 的都是另一份，状态是空的、改了也不影响应用。
- 托盘原生菜单：Windows 10 通知区域的图标不在 UI Automation 树里，先截任务栏找到图标位置；弹出的菜单（`#32768` 窗口）UIA 也读不出菜单项，靠截图看、按坐标点。鼠标用 `mouse_event`（绝对坐标）模拟：`SetCursorPos` 不产生托盘的鼠标消息。PowerShell 里别把函数叫 `Mv`（会被当成移动文件的 `mv` 别名）；脚本里有中文要存成带 BOM 的 UTF-8，否则 PowerShell 5 读成乱码。
- 测剪贴板相关（「剪贴板无图片」）前先把剪贴板里的内容存下来，测完放回；托盘、截图都会和你同时使用的鼠标打架，被打断就重来一次。
- 走查中想摆出「上传中」等状态，不必真的上传：拿到应用那份 `useUploadController()` / `useQueueState()`，往队列里加一条、往 `sessions` 里塞一个未结束的会话。
- 走查中改代码会热更新：外壳里常驻的组件（传输中心）重挂后，挂在它身上的东西会停掉，看到「数据库对、页面不对」先刷新页面重试一次再下结论。
- 微博链接检测走百度中转，中转连不到本机，假图床模拟不了微博，造数据换别的图床。

## 跨引擎（WebKit）层

### 它解决什么

Tauri 借用系统 WebView，三个平台不是同一个引擎：

| 平台 | 引擎 |
|------|------|
| Windows | WebView2（Chromium） |
| macOS | WKWebView（WebKit） |
| Linux | WebKitGTK（WebKit） |

所以 macOS / Linux 上的 UI 问题主要是 **WebKit 与 Chromium 的差异**，而 `test` job 的三平台矩阵只覆盖「编译得过、单测跑得过」，碰不到渲染层。Playwright 自带的 WebKit 构建能在 Windows 上跑，这一层就是拿它在本机提前把这类问题挖出来。

### 为什么不给 WebKit 建像素基准

**这是一个刻意的决定，不要"顺手"补上。**

跨引擎的字体栅格化与抗锯齿差异必然超过像素容差，做成门禁只会持续误报直到被关掉；而把阈值放宽到能容忍差异之后，它又抓不到任何真实回归。更根本的是，像素比对回答的是「两张照片一样吗」，我们要问的是「排版会不会塌」。该做的是断言**由 CSS 直接决定的绝对不变式**——裁切、溢出、越界、地标尺寸，换引擎不会变、零基准图。

### 现状

- WebKit 这一层现在只有 mocked E2E 的 `webkit` project（`npm run test:e2e:webkit`）：跑得通主要流程，但不量排版。
- 量排版的跨引擎布局哨兵（在 Chromium 与 WebKit 上各跑一遍、断言上面那些不变式）目前没有，接到 `tests/redesign/` 的新页面上记在 `docs/TODO.md`「不给 WebKit 建像素基准图」。

### 局限：它抓不到什么

不要因为这一层是绿的就认为 macOS 已被覆盖。

- **字体完全不对（最大盲区）**。`src/styles/app.css` 的字体栈在真 macOS 上落到 SF Pro / 苹方，在 Windows 的 Playwright WebKit 上落到微软雅黑。所有由字体度量驱动的差异（换行位置、按钮实际高度、省略号截断点、CJK 与拉丁混排基线）一条都抓不到。这也正是不做像素基准、不做几何量 diff 的原因——那两样在这个盲区下产出的都是假信号。
- **Playwright WebKit ≠ WKWebView，也 ≠ WebKitGTK**。Playwright 打包的是 WebKit trunk 构建，比任何已发布 Safari 都新。用户如果在老 macOS 上，那是更早的引擎，**Playwright WebKit 支持的特性它可能不支持**。典型例子：`src/` 里多处 `backdrop-filter` 没写 `-webkit-` 前缀，Playwright WebKit 渲染正常，老 mac 上会直接没有毛玻璃效果——这类问题不改变布局，哨兵抓不到，只能靠 code review。
- **原生控件与窗口层**：titlebar、托盘、原生菜单、macOS 红绿灯按钮，Playwright 里根本没有窗口 chrome。托盘菜单只能核对应用交给菜单接口的结构（`tests/e2e/mocks/menu.ts` 记下来，`tray.e2e.spec.ts` 用它查「托盘、首页、设置同一份配置」），菜单长什么样靠真机走查。
- **DPI / 缩放**：截图固定 @1x，Retina 2x 与 Linux 分数缩放下的 1px 边框消失、圆角走样抓不到。
- **滚动条占位**：macOS 默认 overlay 滚动条不占宽度，Windows / Linux 传统滚动条占约 15px，本机量不到这个差。
- **Tauri IPC / 权限 / 文件系统**：E2E 那套全是 `tests/e2e/mocks/*` 的假实现，只验前端时序。

一句话：**WebKit 跑得通不等于 mac 上长得对。**

## CI 策略

PR / push 到 `main` 当前必跑 `.github/workflows/ci.yml` 的 `test` job：

- 三平台安装依赖并构建 sidecar。
- Rust：`cargo check`、`cargo test`。
- 前端：`npm run typecheck`、`npm run lint`、`npm run build`。
- 单元测试：`npm run test:unit` 只在 `windows-latest` / `macos-latest` 跑；`ubuntu-latest` 由下面的 `npm run test:coverage` 跑同一套 suite，不重复执行。
- Obsidian 插件：独立 `obsidian-plugin` job 执行依赖安装、`npm run ci:obsidian`，并确认构建后的 `plugins/obsidian/main.js` 已提交。
- 覆盖率：只在 `ubuntu-latest` 跑 `npm run test:coverage`，并上传 `coverage-report` artifact。

视觉测试由 `visual-impact` 的 paths-filter 决定是否触发：

- PR 改到 `playwright.config.ts` / `tests/redesign/**` / `tests/e2e/mocks/**` / `src/**` 的 UI 相关文件时自动跑；每日 schedule 与 `run_visual=true` 的手动触发也会跑。
- Windows runner 先 `npx playwright install chromium`，再执行 `npm run test:visual`（`redesign-light` / `redesign-dark`），上传 `playwright-visual-report`。

mocked E2E：

- `e2e` job（ubuntu）跑 `npm run test:e2e:chromium`，上传 `playwright-e2e-report`，**失败阻断**。
- `e2e-webkit` job（ubuntu）跑 `npm run test:e2e:webkit`，上传 `playwright-e2e-webkit-report`。跑在 ubuntu 是刻意的：Playwright 的 Linux WebKit 构建离 Tauri 的 WebKitGTK 最近。**刚接入，暂设 `continue-on-error: true` 观察两周**——它跑的是完整应用加异步时序，flake 面比布局哨兵大得多。

真实 Tauri E2E 当前手动触发：

- GitHub Actions 运行 `CI` workflow。
- 勾选 `run_tauri_e2e=true`。
- Windows runner 构建 sidecar、安装 `tauri-driver` / `msedgedriver`，执行 `npm run test:tauri:e2e`。

CI artifact：

- `coverage-report`：`coverage/`，来自 Ubuntu 覆盖率 job。
- `playwright-visual-report`：`playwright-report/` 和 `test-results/`，来自手动 visual job。
- `playwright-e2e-report`：`playwright-report/` 和 `test-results/`，来自手动 mocked E2E job。

release 当前还会跑：

- tag 触发时先在 Ubuntu 跑 `npm run test:e2e` 的 web smoke。
- release matrix 中跑 `npm run typecheck`、`npm run lint`、`npm run test:unit`。`typecheck` 是发版路径唯一的类型闸门（`npm run build` 不再内联 `tsc`）。
- Windows release runner 安装 Tauri E2E drivers 后跑 `npm run test:tauri:e2e`。
- 打包后 Windows / Linux 还有安装包或 AppImage 启动冒烟。

发版前建议：

- 打 tag 前手动触发 `CI` workflow 跑 `run_visual=true`，人工确认视觉 diff 不包含真实 UI 回归。
- 打 tag 前手动触发 `CI` workflow 跑 `run_e2e=true`，确认 mocked E2E 主流程稳定。
- 如果 Windows driver 环境可用，打 tag 前手动触发 `run_tauri_e2e=true`，或本地运行 `npm run test:tauri:e2e` 做真实桌面冒烟。
- tag 后的 `Release` workflow 会再次跑 mocked web smoke 和 Windows 真实 Tauri E2E，但 visual 仍保留为发版前手动门禁。

未来稳定后适合收紧的：

- `e2e-webkit`：观察两周无 flake 后去掉 `continue-on-error`，与 chromium 那格同级阻断。
- `npm run test:tauri:e2e`：成本高，更适合 release 或 nightly；除非 driver 环境足够稳定，不建议直接放入每个 PR。

## 视觉截图更新流程

允许更新快照的情况：

- 本次 PR 明确改变了页面 UI、布局、文案、主题 token 或组件视觉状态。
- 已确认失败截图对应的是预期变化，而不是真实 UI 回归。
- 新增页面截图或新的状态。

更新步骤：

```bash
npm run test:visual
npm run test:visual:update
npm run test:visual
```

更新后必须人工确认：

- 查看 Playwright HTML report 或 `test-results/` 中的 diff。
- 检查 `redesign-light` / `redesign-dark` 两个 project 的变化是否都合理。
- 确认没有因为真实 bug、元素重叠、空白页、图片加载失败、文字溢出而直接更新基线。
- PR 描述里说明哪些截图是预期变化。

新界面基准（`tests/redesign/`，每页一份 `*.visual.spec.ts`，图名前缀是设计画板编号）：

- 跑单页：`npx playwright test tests/redesign/<页>.visual.spec.ts --project=redesign-light --project=redesign-dark --timeout=90000`。让 Playwright 自己起服务，不要先手动起 Vite（会留下占着 1421 / 1423 端口的进程）。
- 本机截图容差是 `maxDiffPixels: 100`（`tests/redesign/helpers.ts`，CI 照旧用全局 1%）：一个提示点、几处 1px 位移都放得过去。改了外壳、全局令牌、共用组件之后，所有页面都 `--update-snapshots=all` 重录一遍，再跑 `npm run snapshots:noise -- --restore`：只剩下真改动的图，逐张看，确认只有该变的地方在变。
- 噪声的判据：每个通道最多差 8 个色阶（抗锯齿，肉眼看不出），差异像素可以上千个；真改动（换文案、挪 1px、换颜色）的最大色差都在 90 以上。

禁止把真实 UI 回归直接更新掉。遇到视觉测试失败时，先修 UI；只有确认新 UI 就是目标结果，才运行 `npm run test:visual:update`。

## 写测试时的最小检查清单

- 纯逻辑先写 Vitest 单元测试。
- composable 只断言公共状态和方法效果，不绑定内部实现细节。
- 组件测试用 `mountWithDefaults`，尽量断言用户可见行为和 emit。
- 页面视觉状态用 `tests/redesign/helpers.ts` 的种子在加载前写进去，截图前固定时间、图片、动画。
- Tauri native 行为优先 mock 到 helper 或 `tests/e2e/mocks`。
- 真实 Tauri E2E 只做启动和导航级冒烟，不接真实账号、真实图床、真实外网。
