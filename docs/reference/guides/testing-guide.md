# PicNexus 测试实操指南

> 这份指南用于决定“写哪类测试、放在哪里、用哪些 helper、跑什么命令”。偏项目实操，不重复展开 Vitest、Playwright 或 Tauri 的通用理论。

## 当前测试体系

| 类型 | 目录 / 配置 | 主要用途 |
|------|-------------|----------|
| 单元 / composable / 组件测试 | `src/test/**/*.spec.ts`，`vitest.config.ts` | 纯逻辑、状态流、Vue 组件交互 |
| 视觉截图测试 | `tests/visual/*.visual.spec.ts`，`playwright.config.ts` | 页面级 UI 状态截图回归 |
| mocked E2E | `tests/e2e/*.e2e.spec.ts`，`playwright.e2e.config.ts` | 浏览器环境下验证主流程与 mocked Tauri 边界 |
| 真实 Tauri E2E | `tests/tauri-e2e/*.tauri.e2e.cjs`，`wdio.tauri.e2e.conf.cjs` | 少量真实桌面壳层冒烟 |

Vitest 使用 `happy-dom`，全局 setup 为 `src/test/setup.ts`，当前会加载统一的 Tauri mock。覆盖率只统计 `src/utils/**`、`src/services/**`、`src/core/**`、`src/composables/**`、`src/uploaders/**`。

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
| utils / formatter / status 计算 | 单元测试 | `src/test/unit/utils/formatters.spec.ts` 验证 `formatFileSize`、`formatRelativeTime`；`src/test/unit/utils/uploadStatus.spec.ts` 验证成功、失败、上传中、等待中状态判断 |
| URL、Markdown、路径、布局算法 | 单元测试 | `linkFormatter.spec.ts`、`mdParser.spec.ts`、`pathUtils.spec.ts`、`justifiedLayout.spec.ts` |
| uploader 或 service 分发逻辑 | 单元测试，必要时 mock Tauri invoke | `uploaderFactory.spec.ts`、`multiServiceUploader.spec.ts`、`historyDatabase.spec.ts` |
| composable 状态流 | composable 测试 | `useQueueState.spec.ts` 验证队列 CRUD、节流更新与完成态判断；`useBatchMigrate.spec.ts`、`useLinkCheck.spec.ts` 验证业务状态推进 |
| 组件交互 | 组件测试 | `uploadQueuePanel.spec.ts` 验证按钮点击 emit、loading 禁用态和空队列渲染 |
| 页面多状态 UI | 视觉截图测试 | `upload.visual.spec.ts` 覆盖 empty、no-services、uploading、failed、success、compression-menu；`timeline.visual.spec.ts` 覆盖滚动、骨架屏、lightbox 等状态 |
| mocked 原生边界 | mocked E2E | `tests/e2e/app-smoke.e2e.spec.ts` 验证启动不白屏、主导航、设置保存、文件选择、剪贴板、上传队列、历史页壳层、链接检测页 |
| 真实桌面壳层 | 真实 Tauri E2E | `tests/tauri-e2e/app-smoke.tauri.e2e.cjs` 只验证真实应用启动、标题、主布局和四个主导航 |

视觉测试通过 `tests/visual/harness` 构造稳定页面状态，不依赖真实网络、真实图床或真实 Tauri 后端。新增页面截图时，优先把状态放进 harness，再用 `captureVisualState(page, pageName, state)` 截图。

mocked E2E 通过 `tests/e2e/vite.config.ts` 把 Tauri API alias 到 `tests/e2e/mocks/*`，适合验证“前端走到了 native 边界且不会崩”。真实 Tauri E2E 成本高，只保留少量冒烟，不承担业务回归主力。

## Helper 使用规范

新测试优先从这些入口复用，不要每个 spec 自己堆一套 mock 和 mount 配置。

| helper | 用法 |
|--------|------|
| `src/test/helpers/vueMount.ts` | 组件测试优先用 `mountWithDefaults` / `shallowMountWithDefaults`。它内置 `v-tooltip` 测试替身、`Teleport` stub、`Transition` 配置；查 `data-testid` 用 `findByTestId` |
| `src/test/helpers/wait.ts` | 异步刷新优先用 `flushPromisesAndTicks`、`flushTicks`；定时器用 `useFakeTimers`、`advanceTimersByTime`、`runPendingTimers` |
| `src/test/helpers/tauriMock.ts` | 普通 Tauri API mock 统一用这里的 `setupInvokeResponses`、`setupInvokeHandler`、`mockInvokeResponse`、`mockInvokeError`、`resetTauriMocks`、`get*Mock` |
| `src/test/helpers/clipboardMock.ts` | 剪贴板场景用 `mockClipboardText`、`mockClipboardReadError`、`mockClipboardWriteError`、`getClipboardTextWriteMock`、`resetClipboardMock` |
| `src/test/factories` | 需要结构化业务对象时优先用工厂：`createConfig`、`createHistoryItem`、`createQueueItem`、`createMockUploader`、`createLinkCheckRow` 等 |
| `src/test/fixtures` | 多个测试共享的固定数据用 fixtures：`historyRows`、`favoriteHistoryRows`、`linkCheckRows`、`selectedLinkCheckRows`、`imageUrls` |

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

不要在测试里散落大段重复 native mock。出现以下情况时，先考虑扩展 `src/test/helpers/tauriMock.ts` 或 `tests/e2e/mocks/*`：

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
| `npm run test:visual` | 跑 Playwright 视觉截图测试，自动启动 `tests/visual` Vite harness |
| `npm run test:visual:update` | 更新视觉快照，必须人工确认 diff |
| `npm run test:e2e` | 跑 mocked Playwright E2E，自动启动 `tests/e2e` Vite harness |
| `npm run test:tauri:e2e` | 跑真实 Tauri 桌面冒烟，会检查 driver、构建 Vite、构建 Tauri debug binary |

真实 Tauri E2E 前置依赖：

- `tauri-driver`：`cargo install tauri-driver --locked`
- Windows：安装与 Edge 版本匹配的 `msedgedriver`，或设置 `TAURI_NATIVE_DRIVER`
- Linux：安装 `WebKitWebDriver` / `webkit2gtk-driver`，无桌面时用 `xvfb`
- macOS：当前不支持 `tauri-driver` 桌面 WebView，发版前走手动清单

## CI 策略

PR / push 到 `main` 当前必跑 `.github/workflows/ci.yml` 的 `test` job：

- 三平台安装依赖并构建 sidecar。
- Rust：`cargo check`、`cargo test`。
- 前端：`npm run typecheck`、`npm run lint`、`npm run build`、`npm run test:unit`。
- Obsidian 插件：独立 `obsidian-plugin` job 执行依赖安装、`npm run ci:obsidian`，并确认构建后的 `plugins/picnexus/main.js` 已提交。
- 覆盖率：只在 `ubuntu-latest` 跑 `npm run test:coverage`，并上传 `coverage-report` artifact。

视觉测试当前手动触发：

- GitHub Actions 运行 `CI` workflow。
- 勾选 `run_visual=true`。
- Windows runner 执行 `npm run test:visual`，上传 `playwright-visual-report`。

mocked E2E 当前手动触发：

- GitHub Actions 运行 `CI` workflow。
- 勾选 `run_e2e=true`。
- Windows runner 执行 `npm run test:e2e`，上传 `playwright-e2e-report`。

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
- release matrix 中跑 `npm run lint`、`npm run test:unit`。
- Windows release runner 安装 Tauri E2E drivers 后跑 `npm run test:tauri:e2e`。
- 打包后 Windows / Linux 还有安装包或 AppImage 启动冒烟。

发版前建议：

- 打 tag 前手动触发 `CI` workflow 跑 `run_visual=true`，人工确认视觉 diff 不包含真实 UI 回归。
- 打 tag 前手动触发 `CI` workflow 跑 `run_e2e=true`，确认 mocked E2E 主流程稳定。
- 如果 Windows driver 环境可用，打 tag 前手动触发 `run_tauri_e2e=true`，或本地运行 `npm run test:tauri:e2e` 做真实桌面冒烟。
- tag 后的 `Release` workflow 会再次跑 mocked web smoke 和 Windows 真实 Tauri E2E，但 visual 仍保留为发版前手动门禁。

未来稳定后适合进入 PR 必跑：

- `npm run test:e2e`：mocked E2E 已经隔离外网和原生能力，稳定后可以作为 PR 必跑的 smoke job。
- `npm run test:visual`：截图基线稳定、字体和平台差异收敛后，可以先只在 Windows PR 必跑。
- `npm run test:tauri:e2e`：成本高，更适合 release 或 nightly；除非 driver 环境足够稳定，不建议直接放入每个 PR。

## 视觉截图更新流程

允许更新快照的情况：

- 本次 PR 明确改变了页面 UI、布局、文案、主题 token 或组件视觉状态。
- 已确认失败截图对应的是预期变化，而不是真实 UI 回归。
- 新增 visual harness 状态或新增页面截图。

更新步骤：

```bash
npm run test:visual
npm run test:visual:update
npm run test:visual
```

更新后必须人工确认：

- 查看 Playwright HTML report 或 `test-results/` 中的 diff。
- 检查 desktop light / desktop dark 两个 project 的变化是否都合理。
- 确认没有因为真实 bug、元素重叠、空白页、图片加载失败、文字溢出而直接更新基线。
- PR 描述里说明哪些截图是预期变化。

禁止把真实 UI 回归直接更新掉。遇到视觉测试失败时，先修 UI；只有确认新 UI 就是目标结果，才运行 `npm run test:visual:update`。

## 写测试时的最小检查清单

- 纯逻辑先写 Vitest 单元测试。
- composable 只断言公共状态和方法效果，不绑定内部实现细节。
- 组件测试用 `mountWithDefaults`，尽量断言用户可见行为和 emit。
- 页面视觉状态放到 `tests/visual/harness`，截图前固定时间、图片、动画。
- Tauri native 行为优先 mock 到 helper 或 `tests/e2e/mocks`。
- 真实 Tauri E2E 只做启动和导航级冒烟，不接真实账号、真实图床、真实外网。
