# 类型检查盲区收口：`tests/` 与 `scripts/` 纳入门禁（2026-09-08）

## 背景

`npm run typecheck` 此前只覆盖两块：`vue-tsc --noEmit`（`tsconfig.json`，`include: ["src"]`）
与 `tsc -p tsconfig.node.json`（4 个根配置文件 + `eslint.config.mjs`）。

`tests/`（283 个 `.ts`）和 `scripts/`（21 个 `.mjs`）不在任何 tsconfig 覆盖内——
eslint 管得到它们，但类型层完全没人看。

## 做法与结果

| 目标 | 配置 | 首次接入报错 | 现状 |
|------|------|-------------|------|
| `tests/` | 新增 `tsconfig.test.json`，用 **vue-tsc** 跑 | 33 | 0 |
| `scripts/` | 新增 `tsconfig.scripts.json`，关 `noImplicitAny` | 5 | 0 |

`package.json` 的 `typecheck` 现在是四段：

```
vue-tsc --noEmit
  && vue-tsc --noEmit -p tsconfig.test.json
  && tsc --noEmit -p tsconfig.node.json
  && tsc --noEmit -p tsconfig.scripts.json
```

## 探测阶段踩的两个坑（复用时直接抄结论）

### 1. `tests/` 必须用 `vue-tsc`，不能用 `tsc`

先用 `tsc` 探，得到 111 条错，其中 **76 条是假的 `TS2307: Cannot find module`**——
测试会 import `.vue` 组件和 `.css`，只有 `vue-tsc` 解析得了。换成 `vue-tsc` 后直接掉到 34 条。

### 2. `include` 里必须显式带上两个"没人 import 的 `.d.ts`"

`src/types/primevue-confirm.d.ts`（PrimeVue `ConfirmationOptions` 的模块增强）和
`src/vite-env.d.ts`（`import.meta.env` / `import.meta.glob`）**没有任何文件 import 它们**，
全靠主配置的 `include: ["src"]` 收进来。

只写 `"include": ["tests"]` 的话它们会缺席，于是刷出 3 条**指向 `src/` 的假错**：

```
src/composables/useConfirm.ts(180,9): 'clearOptOut' does not exist in type 'ConfirmationOptions'
src/events/cacheEvents.ts(42,20):     Property 'env' does not exist on type 'ImportMeta'
src/utils/icons.ts(18,36):            Property 'glob' does not exist on type 'ImportMeta'
```

差点被当成 `src/` 里的真缺陷去查。正确写法：

```jsonc
"include": ["tests", "src/types/*.d.ts", "src/vite-env.d.ts"]
```

### 3. `scripts/` 为什么**故意**关掉 `noImplicitAny`

开着 strict 全套：**273 条**，全是无标注纯 JS 的固有噪音，不是缺陷。
关掉 `noImplicitAny` 后：**5 条，全是真错**。

门禁一旦被噪音淹没，结局只有被关掉一个。想再收紧的路子是「按脚本逐个补 JSDoc」，
补完一个挪进一个开着 `noImplicitAny` 的更严格 include，而不是在这里一把梭。

## `tests/` 的 33 条错分布

一个 helper 的返回类型写宽了，就占了 19 条：

**`tests/unit/helpers/tauriMock.ts::utf8Bytes`**（19 条）——返回类型裸写 `Uint8Array`。
TS 5.7 起 `Uint8Array` 带缓冲区类型参数，裸写会推成 `Uint8Array<ArrayBufferLike>`，
赋给 `readFile` 的 `Promise<Uint8Array<ArrayBuffer>>` 会被拒。
改成显式 `Uint8Array<ArrayBuffer>` 并统一在 `new ArrayBuffer(...)` 上构造，19 条一次清零。

其余 14 条：

| 位置 | 问题 | 修法 |
|------|------|------|
| `useSensitiveDraft.spec.ts` ×3 | 漏传 `confirmClear` | 补上——见下方「门禁真抓到东西了」 |
| `editorServiceConfig` / `useConnectionTest` / `useEditorIntegration` ×3 | upyun 夹具缺 `s3AccessKey` / `s3SecretKey` | 补空串 |
| `analyticsBootstrap.spec.ts` ×2 | happy-dom 的 `querySelector` 泛型约束是 `keyof ISVGElementTagNameMap`，不收元素类型 | 改用 happy-dom 自己的 `Element` 类型，别和全局 DOM 类型混用 |
| `VisualHarness.vue` ×2 | 三元分支推成联合类型；漏传必填 prop | 见下方 |
| `linkFeatureFixtures.ts` | 三元分支推成 `{r2: string}` 而非字面量联合 | 显式标注成 `MigrateItemStatus['serviceResults']` |
| `crypto.spec.ts` | `mockImplementation` 第二形参写窄成 `{key?: string}`，被 `strictFunctionTypes` 判不兼容 | 形参不标注，函数体里断言 |
| `useLinkCheck.spec.ts` | `mock.calls` 是 `any[][]`，回调形参声明成元组不合法 | 改成 `(call) => (call[0] as ...)` |
| `mergeIgnoresMirrorEdits.spec.ts` | `UploadResult.fileKey` 必填但夹具没给 | 补 `fileKey` |
| `useAnalytics.spec.ts` | `InvokeArgs` 与 `HeartbeatStart` 无重叠 | 经 `unknown` 中转 |

## 门禁真抓到东西了（两条）

### `useSensitiveDraft` 的 `confirmClear` 漏接了三处

`SensitiveDraftOptions.confirmClear` 是**刻意设成必填**的，源码注释写得很清楚：

> Why 必填而不是可选：漏接的后果是静默的——清除会变成什么也不做，跟修好之前的表现一模一样，
> 没有任何报错提醒你漏了。做成必填，让类型检查在四个调用点上各拦一次。

而 `tests/` 从来没被类型检查过，于是三个用例正好从这道设计好的拦网底下溜了过去。
这是「必填」这个设计第一次真的生效。

### 视觉基准的 harness 漏传必填 prop

`tests/visual/harness/src/VisualHarness.vue` 渲染 `ServiceEnableSection` 时漏了
`publicServiceRiskAccepted`。已确认该 prop **只在 toggle 处理函数里用，不进 template**
（`ServiceEnableSection.vue:158`），所以补上 `false` 不改变任何一张基准图——
但它说明 harness 与真实调用点之间已经开始漂移，正是像素基准最怕的那种失真。

## 顺带修掉的 login-titlebar 主题 class 不一致

`login-titlebar.html` 用 `html.light`，而全项目约定是 `html.light-theme`
（`useLoginTheme.ts` / `preload-theme.js` / `login-webview.html` 均为后者）。
它自成一体能工作，所以一直没人发现；但下个人照约定改样式会扑空。

改法：HTML 四处 `html.light` → `html.light-theme`，`src/login-titlebar.ts` 改成和
`useLoginTheme.ts` 同形状的 `` classList.add(`${theme}-theme`) ``。

**没动配色**：`#111827` / `#f8fafc` 是另起的一套，不是主题令牌的副本，
所以 `check-theme-token-copies.mjs` 刻意没收编它。要收编得先把整套色值对到令牌上，
那是一次独立的视觉改动，需要真机看过标题栏与下方 WebView 的接缝再定，已留在 `docs/TODO.md`。

## 验证

- `npm run typecheck`：四段全绿
- `npm run lint`：全绿
- `npm run test:coverage`：223 个测试文件全过，关键文件覆盖率门禁通过
- `npm run test:workspace-tools`：9/9
- `npm run test:updater-manifest`：11/11
