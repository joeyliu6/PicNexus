# 表格视图灯箱开关动画重做（2026-09-11）

> 这份文件原是交给**另一个 AI 做代码审查**用的上下文包，已于同日由发版前扫描独立复核（第 11 节），按 `docs/audits/` 惯例留档。
> 第 0~9 节是审查前的快照，描述当时的事实，不回头改。

---

## 0. 给审查者的任务说明

请审查 `f3e3af79..HEAD` 的 9 个 commit（见第 2 节）。这些改动**没有在真机上跑过一次**，全部结论来自单元测试和一个浏览器复现台。请重点找：

1. **状态机漏路径** —— 新引入的 `hoverPreview.phase` 有多个写入点，是否存在某条路径让它停在错误状态（例如卡片永久隐藏、或永久显示）。
2. **CSS 动画与 PhotoSwipe JS 计时的耦合** —— 有两处 CSS 时长/延迟是"对齐库内部常量"的，库升级或环境变慢时会怎样。
3. **跨视图回归** —— 收藏视图、时间轴视图与历史表格共用同一个 bridge 和同一份 CSS，改动是否会波及它们。
4. **直接操作第三方库 DOM / 内部状态的地方** —— 有三处，是否安全、是否有更正当的做法。
5. **资源泄漏** —— 卸载路径上有一处绕过了 PhotoSwipe 的 `destroy()`。

**不需要**再验证下面两条，它们已经被实测证伪并撤销了（第 6 节）：预解码中图、降分辨率渲染高斯模糊。

请用中文回复。发现问题时请指出具体文件与行，并说明触发路径。

---

## 1. 项目背景

- PicNexus，Tauri 2 桌面图床客户端。前端 Vue 3.5 + TypeScript + PrimeVue 4.5，灯箱用 **photoswipe 5.4.4**（直接 `new PhotoSwipe()`，没用 `PhotoSwipeLightbox`）。
- 项目规范见仓库根的 `AGENTS.md`，硬约束摘要：
  - CSS 中颜色/间距/圆角/字号/**动效时长**/**缓动**/z-index 一律用 CSS 变量，禁止硬编码。令牌定义在 `src/styles/motion.css`（duration/easing）、`src/styles/app.css`（radius/z-index/shadow 基线）、`src/theme/{dark,light}-theme.css`（分主题的颜色与阴影）。
  - 新增主题变量必须**在 dark 和 light 两个主题文件里成对定义**。
  - 单个 `.vue` 文件 ≤ 500 行（ESLint `max-lines`，`skipBlankLines + skipComments`，error 级）。
  - 禁止 `console.*`，用 `createLogger()`。
  - `prefers-reduced-motion` 由 `motion.css` 统一把 duration 归零。
- 门禁：`npm run lint`（含多个自定义脚本 + eslint + stylelint）、`npm run typecheck`、`npx vitest run`。

### 涉及的三个视图（关键约束）

`HistoryLightbox.vue`、`usePhotoSwipeBridge.ts`、`lightbox-pswp.css` 被**三个视图共用**：

| 视图 | 缩略图元素 | 是否传 `resolve-close-target-mode` |
|---|---|---|
| `src/components/views/history/HistoryTableView.vue` | `.thumb-box`（36px）+ `.global-thumb-hover-preview`（≤300px 悬浮预览卡片） | **是** |
| `src/components/views/FavoritesView.vue` | `.photo-item`（大方格，≥100px） | 否 |
| `src/components/views/TimelineView.vue` | `.photo-item`（大方格，≥100px） | 否 |

后两者 `closeTargetMode` 恒为 `'auto'`，FLIP 天然对称，**本来就没有这次要修的问题**。任何改动都不能弄坏它们。

---

## 2. 改动清单（9 个 commit，13 个文件）

```
8a8c114a refactor(history): extract lightbox and hover-preview styles into css files
235b1e68 feat(theme): add preview, lightbox image and vignette shadow tokens
f3e26a7b fix(history): stop the lightbox from jumping when it shrinks back
073c29fb feat(history): rebalance lightbox motion and rescue the backdrop colour
80a56e12 feat(history): give table thumbnails a hover state
24a96009 fix(lightbox): do not lose a close requested during the opening animation
619f6dd3 fix(history): keep the hover preview out of the way while the lightbox flies
41c405cb fix(history): land the shrinking image exactly on the preview card
ee76ec50 fix(history): make the lightbox open as one continuous motion
```

累计 `+1123 / -446`，13 个文件。每个 commit 的正文里写了完整的推理链和实测数据，**建议先读 commit message 再读 diff**。

核心文件：
- `src/composables/history/usePhotoSwipeBridge.ts`（PhotoSwipe 桥接，改动最多）
- `src/composables/history/useTableInteractions.ts`（表格交互 + 悬浮预览状态机）
- `src/components/views/history/lightbox-pswp.css`（新建，从 `.vue` 迁出）
- `src/components/views/history/thumb-hover-preview.css`（新建，从 `.vue` 迁出）
- `src/composables/history/thumbPreviewGeometry.ts`（新建，纯几何函数）

---

## 3. 起因与最终解决的问题

用户的原话是"表格视图打开图片、退出的动画不够好，鼠标停在缩略图上时打开再回来会跳一下，颜色阴影也不好"。逐帧测量后确认是**若干个独立缺陷叠加**：

1. **FLIP 起止矩形不一致** —— 悬浮预览卡片的入场过渡把 `transform: scale(0.92→1)` 加在**根元素**上，而这个根元素正是 PhotoSwipe 用来量 FLIP 矩形的对象（`getThumbBounds()` → 我们的 `thumbEl` filter → `getBoundingClientRect()`）。入场 200ms 内点击，量到的是缩放中的框；关闭时它已静止，量到满尺寸框。→ 缩放已下沉到内层 `<img>`。

2. **收回落地有空窗** —— 关闭时预览卡片被瞬间置为透明，而 PhotoSwipe 在收回动画结束那一帧直接 `element.remove()` 摘走大图，不留淡出尾巴；卡片却要等 timer 才恢复。→ 见下面的 `phase` 状态机。

3. **收回过程中卡片和大图两个框同时可见且错开** —— 第一次修 (2) 时改成"卡片全程保持可见"，结果穿帮：大图收回是**一边缩小一边往屏幕中心平移**，途中根本盖不住卡片。→ 改成全程让位、只在末段接上。

4. **关场缓动用反** —— `ease-accelerate` 末段最快，大图在最后 ~20ms 从 418px 猛缩到 300px，且从未收到位就被移除。→ 关场改 `decelerate`。

5. **关闭时自绘的模糊背景层不淡出** —— zoom 模式下 PhotoSwipe 只淡出自己的 `.pswp__bg`，根元素 opacity 全程是 1，我们 Teleport 进去的 `.pswp-blur-bg` 无人管，直到根元素被整个 remove。观感是"幕布被一把扯走"。三个视图都中招。

6. **开场是"黑闪 + 干等 120ms + 才放大"** —— 背景起点 0.78 等于瞬间铺满；那 120ms 是 PhotoSwipe 固有启动延迟。→ 背景改成从 0 渐入并跨过空窗。

7. 背景四层叠加后中心亮度只剩原图 7%、边缘 2.5%；灯箱图片阴影是黑影打在近黑背景上（等于没画）；`.thumb-box` 完全没有 hover 反馈。→ 配色与阴影调整。

8. **顺带发现的真 bug**：开场 300ms 内触发关闭（灯箱内的删除按钮直接改 `lightboxVisible`），PhotoSwipe 静默拒绝 → `close` 事件永不派发 → 桥接层实例引用清不掉 → `if (pswp) return` 永久挡住后续所有打开。`destroy()` 也救不了（内部转调 `close()`）。

---

## 4. 审查者需要知道的 PhotoSwipe 内部事实

这些是读 `node_modules/photoswipe/dist/photoswipe.esm.js` 得到的，代码里多处依赖它们。**请核实我没读错**。

1. **FLIP 矩形量两次**：`init()` 里同步 `getThumbBounds()` 存为 `_initialThumbBounds`（开场用，`_applyStartProps` 在 `isOpening` 时复用不重量）；`opener.close()` 里再量一次（关场用）。两次都会走 `applyFilters('thumbEl', ...)`，也就是我们的 filter。

2. **`close` 事件是同步派发的**，`opener.close()` 紧随其后同步执行。因此在 `pswp.on('close')` 回调里改 `options.easing` / `hideAnimationDuration` / `showHideAnimationType`、给根元素加 class，**都来得及生效**。

3. **关闭动画结束后立刻销毁**：`_onAnimationComplete()` → `pswp.destroy()` → `element.remove()`。大图在那一帧被摘走，**没有淡出尾巴**。

4. **`close()` 有开场闸门**：`close() { if (!this.opener.isOpen || this.isDestroying) return; }`，而 `opener.isOpen` 要到开场动画结束才置 true。静默 return，不派发任何事件。`destroy()` 内部也是转调 `close()`，同样被吃。

5. **CSSAnimation 的启动延迟**：`setTimeout(0)` 里设 transition 样式，再 `setTimeout(30)` 里才写目标值（源码注释 `Do not reduce this number`）。所以元素实际起跑比我们的 CSS 动画晚约 30ms。

6. **开场还有一段强制等待**：`opener._start()` 中，若占位图是 `<img>`（我们传了 `msrc` 做 LQIP，所以是），会等它 decode，且**最少 50ms、最多 250ms**。不传 `msrc` 则走 else 分支直接 `_initiate()`。

7. **`thumbEl` filter 返回 `undefined` 时**，`_thumbBounds` 留空 → `_animateZoom = false` → `_animateRootOpacity = true` → 整个根元素淡出（即 fade 降级）。TS 签名写的是 `=> HTMLElement`，但运行时有 `if (thumbnail)` 判断，所以返回 undefined 是安全的（代码里用 `NO_THUMB` 常量表达这一点）。

---

## 5. 请重点审查的六个风险点

### R1. `hoverPreview.phase` 状态机（`useTableInteractions.ts`）

新类型 `PreviewLightboxPhase = 'idle' | 'open' | 'landing' | 'dismissing'`，**取代了原来的 `closing: boolean` + `closeMode` 两个字段**（两个字段描述重叠状态，容易走散）。

语义：
- `idle` —— 普通 hover 预览，正常显示
- `open` —— 灯箱开着（含开场动画），卡片让位（透明）
- `landing` —— 正在收回到这张卡片，全程让位、只在收回末段淡入接上
- `dismissing` —— 正在关闭但鼠标已移开，保持让位直到被移除

**写入点（请逐个核对是否完备、是否有遗漏路径）**：
`clearHoverPreview` / `requestHoverPreviewDismissAfterClose` / `resolveLightboxCloseTargetMode` / `openLightbox` / `syncHoverPreviewToItem`（两个分支）/ `handlePreviewEnter` / `watch(lightboxVisible)` / `closingTimer` 回调。

**特别注意的时序陷阱**：两条关闭路径的先后顺序是**相反**的——
- 按 Esc / 点背景：PhotoSwipe 先派发 `close` → `resolveLightboxCloseTargetMode()` 抢先定好 phase → 之后才轮到 `watch(lightboxVisible)`；
- 点灯箱内的删除按钮：`handleLightboxDelete` 直接改 `lightboxVisible` → `watch` 先跑，`resolveLightboxCloseTargetMode()` 可能根本不被调用。

所以 `watch` 里用同一套判据（`isMouseOnSourceThumb`）补写了一次 phase。**请确认这两处判据不会得出不同结果，以及有没有第三条关闭路径被漏掉**（例如跨页导航、`onDeactivated`、窗口失焦）。

### R2. 两处"对齐库内部常量"的 CSS 时序

- `thumb-hover-preview.css` 里 `--pswp-anim-start-delay: 30ms`，用作 `landing` 淡入动画的 `animation-delay`，对齐的是上面第 4.5 条那个写死的 `setTimeout(..., 30)`。
- `landing` 的 keyframes 是 `0%, 85% { opacity: 0 } 100% { opacity: 1 }`，时长 `--duration-normal`(200ms)，与 `HIDE_ANIMATION_DURATION` 同源。

**风险**：这是**用 CSS 时钟去追 JS 时钟**。请评估：
- photoswipe 升级改了那个 30ms 会怎样；
- 低端设备/主线程繁忙导致 JS 定时器被推迟时，CSS 动画不会跟着推迟，会不会又露出双影或空窗；
- `prefers-reduced-motion` 下 `--duration-normal` 归零，`animation-delay` 却是固定 30ms —— 我加了 `@media (prefers-reduced-motion: reduce)` 分支把 animation 关掉并直接 `opacity: 1`，**请确认这个兜底是对的**。

### R3. 删掉了 `closeTargetMode !== 'thumb' &&` 这半个条件

`usePhotoSwipeBridge.ts` 的 `resolveFlipElement()`。原来 `'thumb'` 模式**绕过**了 `FLIP_MIN_WIDTH = 100` 的阈值，导致鼠标移开后关闭时，大图要在一次动画里缩进 36px 的格子（30 多倍缩放），且 `thumbCropped` 会从 `contain` 翻成 `cover` 重算 innerRect，长宽比悬殊的图末端必然偏移。

现在阈值对所有模式一视同仁，越线就降级 fade（配合 `--scale-subtle` 的轻微收缩补偿）。

**请确认**：收藏 / 时间轴视图的 `.photo-item` 确实恒大于 100px，行为逐字节不变。有单测 `keeps the FLIP animation for grid tiles that clear the size threshold` 守这条，但**没有真机验证过**。

### R4. 三处直接操作 PhotoSwipe 的 DOM / 内部状态

1. `thisInstance.element?.classList.add('is-pswp-closing')` —— 在 close 回调里给根元素加 class，驱动 `.pswp-blur-bg` 淡出。
2. `thisInstance.element?.classList.add('is-pswp-closing--fade')` —— 按 `resolveFlipElement()` 的结果判断本次会不会降级 fade，加补偿样式。**filter 和 close 回调必须共用 `resolveFlipElement()`**，否则动画类型和补偿样式会走散。
3. `isOpeningAnimationRunning(instance)` —— 通过 `(instance as unknown as { opener?: { isOpen?: boolean } }).opener?.isOpen === false` 读**私有状态**。读不到时按"可以关"处理（退回原行为）。

**请评估**：3 是明确的私有 API 依赖，有没有公开替代（例如监听 `openingAnimationEnd` 维护自己的标志位，代价是要处理"事件没来"的情况）。

### R5. 卸载路径绕过了 `destroy()`

`onUnmounted` 里：若开场动画仍在跑，直接 `pswp.element?.remove()` 而不是 `pswp.destroy()`。理由是 `destroy()` 会被 R4.3 那道闸门吃掉，根元素会赖在 body 上。

**请评估**：`destroy()` 内部还做了 `events.removeAll()`、`contentLoader.destroy()`、`slide.destroy()` 等清理，直接 `remove()` 会不会漏掉监听器 / 定时器 / 图片解码任务。这是我最不确定的一处。

### R6. 视觉回归覆盖不到

`tests/visual/` 里的 "lightbox" 场景是 harness 自绘的静态 `div.visual-lightbox`（见 `tests/visual/harness/src/VisualHarness.vue`），**不加载 `lightbox-pswp.css`、也不跑真实 PhotoSwipe**。所以本次所有配色/动画改动，视觉快照零变化是"没测到"而不是"没变化"。

**请判断**：值不值得给 harness 加一个真实灯箱场景，还是维持现状靠人工验收。

---

## 6. 两条已被实测证伪、已撤销的优化（不要重提）

1. **预解码中图**（改 `warmImage` 加 `img.decode()`）——假设开场那段延迟卡在解码上。实测**冷解码只要 6~9ms**，瓶颈根本不在那儿，真正来源是 `_start()` 的 50ms 下限 + `setTimeout` 链调度。已 `git checkout` 撤销。

2. **按 1/4 分辨率渲染高斯模糊**——一度测出全屏 `blur(32px)` 把开场帧率压到 20fps。后来发现 **headless Chromium 用的是 SwiftShader 软件渲染**（`ANGLE (... SwiftShader driver)`），而真实环境是硬件加速（实测 headed 下是 `NVIDIA GeForce RTX 2060 ... D3D11`）。**真 GPU 下所有配置一律 59fps**，包括原样的全分辨率 blur。优化零收益且会让背景多糊一层，已撤销。

> 教训写在这里免得重走：**任何在 headless 里做的渲染性能测量都不代表真机**，必须用 `chromium.launch({ headless: false })` 复测。

---

## 7. 已做的验证 / 完全没做的验证

### 已做
- `npm run lint`、`npm run typecheck` 全绿。
- `npx vitest run` **3010 个单测全绿**（219 个文件）。
- 新增单测 6 条，其中 3 条**用注入回归的方式反向验证过**（故意改坏代码确认测试会失败，不是摆设）：
  - `resolves the same element, rect and crop semantics on open and on close`（FLIP 起止矩形对称性）
  - `degrades to fade rather than shrinking the image into a 36px thumbnail`
  - `keeps the FLIP animation for grid tiles that clear the size threshold`（跨视图守卫）
  - `defers a close requested mid-opening instead of losing it, and can reopen afterwards`
  - `tears the root out of the DOM when unmounted mid-opening`
  - `thumbPreviewGeometry.spec.ts` 8 条（纯几何）
- 用真实浏览器解析 CSS 验证了新增的三个 token 都能正确解析（本项目有过 `--shadow-md` 未定义导致规则静默失效的先例）。
- 缩略图 hover 实测：边框/描边环/提亮都生效，且 **hover 前后 `getBoundingClientRect()` 逐字段相同**（证明没污染 FLIP 几何）。
- 搭过一个浏览器复现台，用**真实 bridge + 真实 CSS + 真实 photoswipe** 逐帧采样 DOM，修复前后对比过关键指标（两框错开的帧数 3→0；大图消失时尺寸 418x279→300x200 与卡片逐像素贴合；开场空窗被填满）。**复现台是临时的，已删除**（见第 8 节如何重建）。

### 完全没做
- **真机（Tauri）从未跑过一次**。所有结论来自 Chromium + 复现台。
- 视觉回归对灯箱无覆盖（R6）。
- 没测过慢网络下的表现（LQIP 占位图的价值主要体现在慢图场景）。
- 没测过 `prefers-reduced-motion` 开启时的实际观感（只保证了 CSS 有兜底分支）。
- 没测过低端设备 / 集显。

---

## 8. 如何重建复现台（可选，审查时若想自己验证）

复现台是临时文件，已删。重建要点：

1. 在项目根放一个 `repro.html` + `repro.mjs`，用 `npx vite --port 1427` 起（**别用 1420**，那是 `tauri dev` 的固定端口）。
2. `repro.mjs` 里 `import` **真实的** `@/composables/history/usePhotoSwipeBridge` 和 `@/composables/history/thumbPreviewGeometry`；表格那侧的交互逻辑照抄 `useTableInteractions`（它依赖 tauri / config / toast，直接引进来太重）。
3. 模拟 DOM 结构：`.thumb-preview-wrapper > .thumb-box[data-lightbox-id]`，外加 Teleport 到 body 的 `.global-thumb-hover-preview[data-lightbox-id]`，以及 Teleport 进 `bridge.pswpEl` 的 `.pswp-blur-bg`。
4. 图片**必须用 canvas 生成真实 PNG**，不要用 SVG data URI —— SVG 每次都要重新栅格化，会严重夸大 decode 耗时，测出来的数不可用。
5. 用 Playwright + 页面内 `requestAnimationFrame` 循环采样，每帧记录卡片 `img` 的 computed opacity、`.pswp__img` 的 rect/opacity、`.pswp__bg` 的 opacity、根元素上的 `--pswp-transition-duration`（`_initiate()` 时才被设置，是"动画真正开始"的信号）。
6. **测性能必须 `headless: false`**（见第 6 节）。

---

## 9. 已知的、本次没动的遗留问题

- `src/styles/app.css` 的 `.p-popover` 引用了 `--shadow-md`，而这个变量**全项目无定义** → 该声明恒为 invalid，Popover 实际无阴影，静默失效。与本次改动无关，未修。
- `src/theme/transitions.css` 的 `--theme-transition-duration` 从未定义，三处只靠 fallback，且两个 fallback 值不一致（200ms vs 300ms），也不受 `prefers-reduced-motion` 归零覆盖。与本次改动无关，未修。
- `useTableInteractions.ts` 的 `ensureLightboxTargetVisible()` 直接改 `scrollTop`（瞬时，无平滑）。仅在灯箱内跨页/跨行导航时触发，会让关闭落点与打开起点不同。属于次要来源，本次未动。
- 开场缓动 `decelerate` 后 20% 的时间只走 3% 的距离（1048px→1240px 花掉近 180ms），数据上偏"拖"。没改是因为要改就得重新引入"开关两条曲线"的机制，且快慢主观。**如果审查者认为该调，请说明理由**。

---

## 10. 追加记录（2026-09-11，随同一批改动一起提交）

发出审查请求后在真机 WebView2 上逐帧采样，顺带把 R5 也一起修了。两点补记，避免这份文档被留档后误导后来者：

1. **新发现（不在本文档 R1-R6 之内）：`.pswp-blur-bg` 关场淡出是静默瞬切**。原写法 `animation: none` + `transition: opacity ...` 想接管一个带 `both` 填充值的 animation，实测第一帧就直接跳到 `opacity: 0`，全程无插值——transition 的起始值取自 before-change style，而 animation 的 `both` 填充值不参与这个比较。已改用新 keyframes（`pswp-blur-bg-close`）顶替，并新增 `scripts/check-css-animation-handoff.mjs` 静态护栏防止同类写法再犯（已接入 `npm run lint`，详见该脚本头部注释）。
2. **R5 已修复**：`onUnmounted` 不再用 `pswp.element?.remove()` 裸摘 DOM，改为新增的 `forceDestroy()`——先置 `isDestroying = true`，跳过 `destroy()` 内部"转调 close() 被开场闸门吃掉"的分支，走完整清理路径（`events.removeAll()` 等）。对应地，R4.3 提到的 `isOpeningAnimationRunning` 已更名为 `isCloseGateShut`，`onUnmounted` 那个调用点已改用 `forceDestroy`，该函数目前只剩 `closePswp` 一处调用。
3. **R4.3 的"私有状态"定性有误，已订正（不影响修法本身）**：`isCloseGateShut` 读的 `opener.isOpen`、`forceDestroy` 写的 `isDestroying`，查 `node_modules/photoswipe/dist/types/photoswipe.d.ts` 和 `opener.d.ts` 确认都是类型完整的公开字段（无 `private` 标记，同文件里真正私有的 `_duration`/`_prevViewportSize` 等有明确标记做对比）。两处 `as unknown as {...}` 强制类型擦除已去掉，改成直接按 `PhotoSwipe`/`Opener` 的真实类型读写——`npm run typecheck` 全绿；好处是以后 photoswipe 大版本真改了这两个字段的形状，类型检查会当场报错，而不是像 `unknown` 那样悄悄编译通过、运行时才发现读到 `undefined`。
4. **审查时顺手验证过、被否掉的一个"简化"**：`pswp-blur-bg-close` keyframes 一度想改成复用 motion.css 共享的 `k-fade-in` 反着播（`animation-direction: reverse`），本地起 http server 用真实 Chromium 逐帧采样后发现两者曲线完全不同——`reverse` 只是把关键帧顺序倒过来，缓动函数仍按时间正向套用，"反着播 0→1"并不等于"正着播 1→0"，会把 decelerate 曲线的观感悄悄换成 accelerate。已放弃这个改动，专门写的 `pswp-blur-bg-close` keyframes 保持不变，教训记在该规则上方的注释里。

新增的"已知取舍"条目：`docs/TODO.md` 记了一条与 R4 相关但本文档 R1-R6 未覆盖的边界情况——快速关闭后 200ms 内重开新灯箱，会把 Teleport 目标从旧实例抢到新实例身上，旧实例剩下的淡出帧因此丢背景装饰。影响很小（大概率被新实例整体遮住）且根治代价明显更大，故意不修，理由与重新考虑的触发条件都写在那条目里。

R1、R2、R3、R6 以及第 9 节列出的遗留问题**不在本次改动范围内**，状态不变。

---

## 11. 独立复核结论（2026-09-11，发版前扫描）

由 v1.1.2 发版前扫描（[scan-prerelease-1.1.2-2026-09-11.md](./scan-prerelease-1.1.2-2026-09-11.md)）派一个只读代理按 R1~R6 逐条复核，第 4 节对 PhotoSwipe 内部行为的 7 条断言全部与 `photoswipe.esm.js` 源码吻合（`close()` 6767-6776 同步派发；`destroy()` 6786-6811 无提前 return；`thumbEl` filter 返 undefined 时 4377 → 5932 `_animateZoom=false` → 5935 `_animateRootOpacity=true`）。

| 风险点 | 结论 |
|---|---|
| **R1** phase 状态机 | 10 个写入点 / 8 个函数无悬空路径：`open` 只经 watch 或 resolve 离开，`landing` / `dismissing` 只经 timer、clear、或 enter 整体替换离开；两条关闭路径判据一致（同一份 `lastMouseX/Y`、同一个 wrapper rect，Esc 路径中间插不进 mousemove）；`onDeactivated` / `blur` / `visibilitychange` / 跨页导航 / `props.visible=false` 都回 idle。**唯一发现**：`pendingClose` 延迟关闭路径下 timer 锚点与真实 close 脱钩（开灯箱后 ~160-380ms 内完成删除 + 确认才触发，人手基本做不到，下次 mouseenter/leave 自愈），已登记 TODO，不改 |
| **R2** CSS 追 JS 时钟 | reduced-motion 兜底正确：选择器特异性相同靠源码顺序胜出，`animation: none; opacity: 1` 后 30ms delay 不再参与；即便没这条覆盖，`forwards` 无 backwards 填充，delay 期间 img 取非动画值 1 也不会空窗 |
| **R3** 阈值对所有模式生效 | 不是回归：旧代码 `closeTargetMode !== 'thumb' && rect.width < FLIP_MIN_WIDTH` 对 `'auto'` 本来就生效，收藏 / 时间轴恒 `'auto'`，行为逐字节相同。**订正第 1 节一处描述**："收藏 / 时间轴 `.photo-item` ≥100px"对收藏成立（`minmax(160px,1fr)`，最窄分支 148px），对时间轴**不成立**——`justifiedLayout.ts` 的 `itemWidth = rowHeight × aspectRatio` 未钳制比例，200px 行高下比例 <0.5 的竖图宽度 <100px，开关两端都判 fade。改动前即如此 |
| **R4** 直接操作库 DOM / 状态 | `is-pswp-closing` 加得及时：`dispatch('close')` 同步，`opener.close()` 之后还有 `setTimeout` 链才到首帧，filter 与回调之间无 DOM 变化 |
| **R5** 卸载绕过 destroy | 第 10 节已修的 `forceDestroy` 复核通过：`isDestroying=true` 后 `destroy()` 依次走 `dispatch('destroy')` → `element.remove()` → 每个 `slide.destroy()` → `contentLoader.destroy()` → `events.removeAll()`；残留的 decode Promise 与 CSSAnimation 定时器 ≤800ms 内触发，只改已脱离文档的节点，不抛错不泄漏 |
| **R6** 视觉回归覆盖不到 | **决定维持人工验收**，不给 harness 加真实灯箱场景：真实 PhotoSwipe 依赖 `setTimeout` 链与图片 decode，截图时机不稳定，硬塞进像素比对只会产出 flaky 基准。真机验收清单见发版前扫描文档 |

顺带发现（改动前即如此，登记 TODO）：keep 分支下 `closingTimer` 回调只写 `idle` 不调 `stopHoverHandoffTracking()`，document 5 个 capture 监听 + window 2 个要等鼠标离开源缩略图才拆。
