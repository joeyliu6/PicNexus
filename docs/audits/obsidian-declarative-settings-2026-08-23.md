# Obsidian 插件采用 1.13 声明式设置 API（2026-08-23）

> 触发来源：社区插件页 <https://community.obsidian.md/plugins/picnexus> 的自动扫描 Warning。
> 涉及版本：插件 `1.0.2` → `1.0.3`，`minAppVersion` 保持 `1.4.0` 不变。

## 一、问题

社区扫描器报：

> This PluginSettingTab does not implement `getSettingDefinitions()`; its settings will not appear in Obsidian's settings search for users on 1.13.0 or later. Consider adopting the declarative settings API.
> `src/settings.ts:4`

**大白话**：以前设置界面是「手工搭」的——在 `display()` 里一行行 `new Setting(...)` 亲手画 DOM，Obsidian 只看到画好的界面，**不知道插件到底有哪些设置项**。1.13 加了设置搜索框，用户搜「端口」时 Obsidian 得能读懂设置清单。新 API 改成「报菜单」：`getSettingDefinitions()` 返回一个数组说明有哪几项、叫什么、是开关还是数字框、存到哪个字段，渲染和搜索索引都交给 Obsidian。

同页另一条 Disclosure「Malware scan not available」是社区扫描平台自身基建未跑成，与本仓库代码无关，未处理。

## 二、根因：本地 lint 曾把这条规则显式关闭

`plugins/obsidian/eslint.config.mjs` 里有一行：

```js
'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
```

随 2026-07-15 `45f40597 refactor(repo): reorganize project structure` 进入仓库，不是针对本规则的专门决策。因为它，本地 `npm run lint:obsidian` 一直是绿的，只有社区扫描器（用自己的配置）才报得出来。

**本次已删除该行**。规则恢复后 `eslint src --max-warnings 0` 会把它当作硬失败，同类退化不再只能靠社区扫描发现。

## 三、API 契约核实出处

按 AGENTS.md「绝对禁止凭空假设 API」，全部签名取自本地已安装的 `plugins/obsidian/node_modules/obsidian/obsidian.d.ts`（v1.13.1），非网络推测：

| 成员 | d.ts 行 | 关键事实 |
|---|---|---|
| `PluginSettingTab.getSettingDefinitions()` | 5159 | 返回非空数组时 **`display()` 完全不被调用**（6633） |
| `PluginSettingTab.getControlValue(key)` | 5166 | 默认从 `this.plugin.settings` 读 |
| `PluginSettingTab.setControlValue(key, value)` | 5173 | 默认只改写 `plugin.settings`，**不会调用我们的 `uploader.updatePort()`，必须覆写** |
| `display()` | 6638 | 标 `@deprecated Since 1.13.0`，但注释明确其正当用法是「支持 1.13.0 之前版本的回退」 |
| `SettingControlBase.validate` | 5916 | 返回非空字符串 = 拒绝写入并在设置项下方显示内联错误 |
| `SettingNumberControl` | 6422 | `type/placeholder/min/max/step` |
| `SettingToggleControl` | 6696 | `type: 'toggle'` |
| `SettingDefinitionAction` | 5938 | `action: (el, index) => void`，无 `SettingGroup` 参数 |
| `SettingDefinitionRender` | 6265 | `render(setting, group)` 需要 `SettingGroup` 实例——**老版本适配器造不出来，故未采用** |
| `SettingDefinitionGroup` | 6079 | `type / heading / items` |
| `debounce()` | 2232 | 无 `@since` 标记 → 1.4.0 可用 |
| `Debouncer.run()` | 2248 | 标 `@since 1.4.4` → **minAppVersion 1.4.0 下不可依赖，改用自建 pending 标志** |

`eslint-plugin-obsidianmd` 的 `no-deprecated-display` 规则只在 `minAppVersion >= 1.13.0` 时才报 `display()`（已读 `dist/lib/rules/settingsTab/noDeprecatedDisplay.js` 源码）。本项目保持 1.4.0，保留 `display()` 是 lint-clean 的。

## 四、方案：一份定义，两处渲染

不抬 `minAppVersion`（否则 1.13 之前的用户装不上），但也不写两套设置代码（否则加设置项时会漏改一处，且 lint 抓不到）。

```
private definitions(): PicNexusItem[]        <-- 唯一真相源
        |                          |
getSettingDefinitions()         display()
（1.13+ 交给 Obsidian 渲染）    （1.4.0–1.12 遍历同一份定义翻译成 new Setting）
        |                          |
        +-----------+--------------+
                    |
      getControlValue / setControlValue
      （两条路径共用同一套读写、副作用与防抖）
```

新增设置项只需往 `definitions()` 数组里加一条，两条渲染路径同时生效。

**防漂移锁**：适配器的 `renderControl()` 对 `PicNexusControl`（刻意收窄成 `toggle | number` 两种）做 `never` 穷尽检查。将来往定义里加 `dropdown`/`slider` 却忘了更新适配器，`typecheck:obsidian` 会直接编译失败，不会静默漏渲染。

## 五、顺带修掉的三个既有缺陷

| # | 缺陷 | 原行为 | 现行为 |
|---|---|---|---|
| ① | 端口非法输入静默丢弃 | 输入 `80` 或 `abc`：不保存、不提示，输入框还留着非法值，重开面板才恢复 | `validate` 回调在设置项下方显示内联中文错误；越界与非整数给**不同**提示 |
| ② | 端口逐字符写盘 | `onChange` 每敲一个字符触发一次 `saveSettings()`，`36799`→`40000` 中间态要写好几次盘 | 端口即时生效（`updatePort` 每次都跟上），落盘防抖 400ms；`hide()` 冲刷未落盘的值，关面板快过防抖也不丢 |
| ③ | 上传通知开关文案对不上 | 描述写「上传成功或失败时显示通知」，但 `main.ts` 的失败 `Notice` 不受该开关约束 | 描述改为「上传成功时显示通知」。**只改文案不改行为**——用户关掉通知后仍应知道上传失败了 |

端口判据（`PORT_MIN` / `PORT_MAX` / `validatePort`）抽到 `src/types.ts`，成为加载路径（`normalizeSettings`）与输入路径（`validate` 回调）的共用真相源。放在 `types.ts` 是因为该文件不 import `obsidian`，是唯一能被现有 `node --test` 覆盖到的位置。

## 六、改动清单

| 文件 | 改动 |
|---|---|
| `plugins/obsidian/src/settings.ts` | 97 → 302 行；新增 `getSettingDefinitions` / `getControlValue` / `setControlValue` / `hide`，`display()` 改为遍历同一份定义 |
| `plugins/obsidian/src/main.ts` | 状态栏新增焦点刷新 + 点击刷新（详见第八节，真机验收时追加发现） |
| `plugins/obsidian/src/types.ts` | 新增 `PORT_MIN` / `PORT_MAX` / `validatePort`，`normalizeSettings` 复用 |
| `plugins/obsidian/eslint.config.mjs` | 删除 `prefer-setting-definitions: 'off'` |
| `plugins/obsidian/styles.css` | 新增 `.picnexus-setting-error`（用 `--text-error` / `--font-ui-smaller`，未硬编码） |
| `scripts/test/obsidian-plugin-behavior.test.mjs` | 新增 `validatePort` 边界用例 |
| `plugins/obsidian/{manifest,package,package-lock,versions}.json` | `1.0.2` → `1.0.3`（`package-lock` 仅改顶层与根包两处，其余 15 处同名版本号属依赖包） |
| `plugins/obsidian/main.js` | 重新构建 |

## 七、已完成的验证

### 自动化

`npm run ci:obsidian` 全链 `exit=0`（lint → typecheck → build → validate-release → test-release → test-plugin），仓库内测试 10/10 通过。

**两条反向验证**（确认新门禁真会拦人，而不是碰巧没报错）：

1. 把 `getSettingDefinitions` 改名后 `eslint src` 确实报出 `obsidianmd/settings-tab/prefer-setting-definitions`（`--max-warnings 0` 下即硬失败）。验完还原。
2. 往 `PicNexusControl` 加一个 `SettingDropdownControl` 后，`tsc --noEmit` 确实报
   `error TS2322: Type 'SettingDropdownControl<keyof PicNexusSettings>' is not assignable to type 'never'`。验完还原。

**构建产物断言** 14 项全过，含反向断言「旧文案『上传成功或失败时显示通知』必须已消失」。
注意 esbuild 用 `charset: ascii`，产物里字符串字面量的中文是 `\uXXXX` 转义形态，注释里的中文才是原样 UTF-8——按原样中文 grep 产物会全部落空，不要误判为构建失败。

### 设置面板行为验证（scratchpad 临时桩，未入库）

`settings.ts` import 了 `obsidian`，子包无 DOM/API mock 层，仓库内测不到。本次在 scratchpad 里搭了一个最小 `obsidian` 桩（`PluginSettingTab` / `Setting` / `Notice` / `debounce`），用 esbuild alias 替换后驱动**真实的 `PicNexusSettingTab`**，12 项断言全过：

- 声明式定义覆盖全部 4 个设置字段（= 设置搜索能索引到）；`showNotifications` 描述已是「上传成功时显示通知」
- 非法端口不写内存、不推 uploader、不落盘
- 逐字符输入 3 个合法中间态：`updatePort` 跟满 3 次，`saveSettings` 只写 1 次（修复②）
- `hide()` 冲刷未落盘端口且不重复补写（防抖窗口内关面板不丢值）
- 开关立即落盘；非布尔值与未知 key 一律拒绝
- 回退 `display()` 渲染出的 6 行名称/顺序/分节标题/按钮文案与改动前**完全一致**，端口输入框 `type=number`、`min=1024`、`max=65535`
- 回退路径下非法端口显示内联错误并阻止写入，改回合法值后错误消失

> 踩坑记录：esbuild 会把桩模块**内联进 bundle**，导致 harness 侧与 bundle 侧各持一份模块副本，`Notice` 收集数组对不上。挂到 `globalThis` 才共享。这是验证工具的问题，不是产品缺陷。

### 真机验收（2026-08-23，Obsidian 1.13.7，vault `C:\Users\Jiawei\Desktop\test`）

| # | 步骤 | 结果 |
|---|---|---|
| A1 | 设置页搜索框输入「端口」 | ✅ 搜到 `PicNexus > 端口`（**本警告的直接验收点，达成**） |
| A2 | 搜索「粘贴」「通知」 | ✅ 分别搜到「粘贴时自动上传」「上传通知」 |
| A3 | 端口填 `80` | ✅ 提示「值必须至少为 1024」——见下方说明，这条来自 Obsidian 内建的 `min` 校验，不是 `validatePort` |
| A4 | 端口填 `36799.5` | ✅ 提示「端口必须是整数」（`validatePort` 的文案） |
| A5 | 端口改成 `40000` 后立刻关面板再打开 | ✅ 仍是 `40000`，防抖窗口内关面板没丢值 |
| A6 | 点「测试连接」行 | ✅ 整行可点，弹出「PicNexus 已连接 (v1.1.0)，当前图床: Cloudflare R2」；端口改 40000 后正确弹出「无法连接 PicNexus」。**不需要回退到 `SettingDefinitionRender`** |
| A7 | 「上传通知」文案 | ✅ 已是「上传成功时显示通知」 |
| E2E | 粘贴上传 / 拖拽上传 | ✅ 正常 |

**A3 的实际表现与预期不同（不是缺陷，但要记下来）**：定义里同时给了 `min: PORT_MIN` 和 `validate: validatePort`。Obsidian 对 `number` 控件的内建 `min/max` 校验**先于** `validate` 触发，所以越界时用户看到的是 Obsidian 的「值必须至少为 1024」，而不是我们写的「端口需在 1024–65535 之间」。两者语义一致、都拦住了写入，故保持现状；若日后想统一文案，去掉 `min`/`max` 让 `validate` 独占即可。

## 八、验收中追加发现：状态栏图床名滞后

**现象**（用户报告）：在 PicNexus 里切换图床后，Obsidian 右下角状态栏显示的图床名不会马上变，要等十几秒到几十秒。

**根因**：`main.ts` 里状态栏只有**一条**更新路径——每 30 秒轮询一次 `/status`。切换图床后最坏要等满一整轮。

同时查出第二个小毛病：`styles.css` 给 `.picnexus-status` 设了 `cursor: pointer`，鼠标移上去变手型**看着能点**，但代码里没有注册任何点击处理器，是个假的可点击提示。

**修法**：用户在 PicNexus 里切完图床后**必然要切回 Obsidian**，所以「窗口重新获得焦点」正是想看到新图床名的那一刻。把这个时刻接上，就等于即时刷新，不必把轮询调密去空耗。

```
改前：  每 30s 轮询             -> 最坏等满 30 秒
改后：  切回 Obsidian 窗口 focus -> 立即刷新（2 秒节流，防止频繁切窗口刷屏）
        点击状态栏               -> 立即刷新（绕过节流，顺带把假可点击变成真可点击）
        每 30s 轮询              -> 保留兜底，应对 PicNexus 在后台崩掉/重启（此时没有 focus 事件可依赖）
```

API 出处：`Component.registerDomEvent(el: Window, type, callback)`，`obsidian.d.ts:1892`，插件卸载时自动解绑。提示文案用 `el.setAttribute('aria-label', ...)` 而非 `setTooltip()`——后者标了 `@since 1.4.4`，而 `minAppVersion` 是 1.4.0。

因 `1.0.3` 尚未发布，本修复并入同一版本，未再抬版本号。

**验证**（scratchpad 桩驱动真实 `PicNexusPlugin`，8 项断言全过）：

- 切换图床后触发 focus → 状态栏立刻变成新图床名（**直接复现并验证了用户报的场景**）
- 刚拉取过就连切窗口 → 0 次重复请求；越过节流窗口后连切 5 次 → 只发 1 次
- 点击状态栏即使落在节流窗口内也必刷新
- 状态栏有 `aria-label` 且真的注册了 click 处理器
- 服务挂掉 → 「未连接」+ `picnexus-disconnected`；恢复 → 变回已连接
- `ready: false` 时显示「未配置图床」而非「已连接」
- 30s 兜底轮询仍在注册（不能因为有了 focus 就删掉）

> 踩坑记录：第一版测试断言「2 秒内连切 5 次应发 1 次」，实测 0 次而失败。查下来是**测试预期写错了**——启动时那次强制拉取已把节流时间戳设上，紧随其后的 focus 全被挡掉，0 才是正确行为。改成分两段断言（刚启动后 0 次 / 越过窗口后连切只放行 1 次）。

**真机验收（2026-08-23，Obsidian 1.13.7）**：

| 步骤 | 结果 |
|---|---|
| 在 PicNexus 里切换图床 → 切回 Obsidian | ✅ 右下角状态栏立刻变成新图床名 |
| 点击右下角状态栏 | ✅ 立即刷新 |

## 九、结论

本次两件事全部闭环，无遗留：

1. **社区扫描 Warning 已消除**——`getSettingDefinitions()` 已实现，四个设置项在 Obsidian 1.13.7 的设置搜索里均可搜到（真机确认）。
2. **四个缺陷已修并真机验收**——端口非法输入静默丢弃、端口逐字符写盘、上传通知文案与行为不符、状态栏图床名滞后（含假可点击提示）。

防退化门禁两道，均已反向验证确实会拦人：

- `obsidianmd/settings-tab/prefer-setting-definitions` 恢复启用，`--max-warnings 0` 下漏实现即 lint 失败
- 回退适配器对控件类型做 `never` 穷尽检查，新增控件类型而不更新适配器即编译失败

`minAppVersion` 保持 `1.4.0`，1.13 之前的用户不受影响。
