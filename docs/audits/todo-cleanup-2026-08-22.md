# TODO 清账记录（2026-08-22）

一次性处理 `docs/TODO.md` 待处理区里三条可以纯代码解决的条目。每条记根因、修法与验证方式。

---

## 1. 上传队列缩略图右下各被削 1px

**根因不是尺寸算错，是两层 wrapper 同名。** `QueueCard.vue` 的外层裁切盒和
`ThumbnailImage.vue` 的根元素都叫 `.thumbnail-wrapper`。Vue 会把父组件的 scoped
属性附加到子组件根元素上，于是 QueueCard 里 `width: 40px; height: 40px; border: 1px`
那条规则**同时命中了内层**：内层被强行定成 40px（还叠了一道边框），塞进外层 38px
的内容区，右下各溢出 1px 被 `overflow: hidden` 裁掉。

**修法**：外层类名改为 `.thumbnail-box`，并在样式处注释禁止改回同名。内层恢复
`width/height: 100%`（= 38px 内容区），不再溢出。

**验证**：删掉 `tests/visual/cross-engine/exemptions.ts` 里 `upload / thumbnail-wrapper`
的 x、y 两条豁免后，`layout-chromium` + `layout-webkit` 共 200 条全绿。

**经验**：给「组件根元素」和「包着它的父容器」起同名 class 是个静音陷阱——scoped
样式并不像直觉那样隔离子组件根元素。排查跨组件样式串扰时先查类名撞车。

---

## 2. `config-updated` 消费方全量重算（TODO「广播过频」条目的消费端半场）

**做了什么**：`useServiceSelector.loadServiceButtonStates` 加值比较短路，照搬
`useGlobalShortcut` 的「配置未变化，跳过重新注册」。读盘后先把本模块实际消费的
配置切片（`availableServices` / `enabledServices` / `services` / `custom_s3_profiles` /
`webdav_profiles` / `linkPrefixConfig`）序列化成签名，与上次**成功应用**的签名一致
就直接返回；签名只在整套重算全部成功后落盘，中途抛错下次仍会重算。

**为什么读盘省不掉**：跨窗口场景（托盘写配置）必须先 `readFreshConfig` 拿到最新
内容才能知道「变没变」，省下的是后面的全量重算、状态写入与派生保存。

**边界（知情）**：TODO 里量出 26 次的场景是「设置页填一个新 S3 profile」——
`custom_s3_profiles` 恰好在消费切片内，这个场景仍会 26 次重算（配置确实变了，
重算是对的）。短路真正消灭的是主题、压缩、快捷键、链接输出等**无关字段**保存
触发的重算，这类占日常保存的大多数。

**源头降频排查结论**：TODO 猜测「是不是每个字段变更都独立触发保存」——不成立。
`useSettingsForm.scheduleSave` 是所有字段共享的一个 500ms 防抖定时器，26 次保存
= 13 秒内 26 个超过 500ms 的输入停顿，属正常输入节奏。源头不用改；再往上调防抖
窗口会拿「托盘/跨窗口同步的及时性」换安静，不划算。

**验证**：`useServiceSelector.spec.ts` 新增两条——切片内容相同（不同对象引用）
的第二次加载被跳过；切片真变了仍重算。

**真机验收（2026-08-22，dev 日志，两判据全过）**：

1. 压缩面板连改 5 处（08:55:54 ~ 08:56:16，5 次真实保存）→ 5 次广播全部命中
   「配置未变化，跳过服务按钮状态刷新」，零全量重算；
2. 托盘连续改 3 个图床勾选（08:58:00 / 08:58:02 / 08:58:13）→ 每次都正常走
   「已加载状态」全量重算，主窗口按钮同步跟变，跨窗口同步未被误伤；
3. 附带收益：托盘勾选的防抖保存 echo 回来的重复广播（08:58:08）也被短路吸收——
   原条目「托盘 4 次保存 4 次全量刷新」里的重复部分现在同样省掉。

---

## 3. SettingsView.vue 500 行贴顶

**做了什么**：新建 `src/composables/settings/useSettingsActions.ts`，把五组
「改 formData 之外还要碰系统状态或后端」的副作用 handler 从视图搬走：主题切换、
自启动（含 OS/磁盘双向回滚）、关闭到托盘、统计开关、清缓存、备份 WebDAV 连接
测试（含密文解密与状态回写）。`isClearingCache` / `webdavTesting` 两个状态随
动作一起归属新 composable。视图侧只剩 tab 导航、事件编排、面板 props 传递——
与文件头注释宣称的职责终于一致。

**为什么不按 TODO 说的「按 tab 拆面板」**：五个 tab 的面板组件早已拆出去了
（`GeneralSettingsPanel` 等），再拆只能拆出转发 props 的空壳。真正占行数的是
副作用 handler，抽成 composable 与同目录 `useSettingsForm` / `useConnectionTest` /
`useSettingsReset` / `useEditorIntegration` 的既有格局同构。

**测试为什么不用改**：`settingsView.spec.ts` 通过组件交互覆盖这些 handler，
而 handler 的叶子依赖（`useToast` / `useAnalytics` / `useConfigManager` /
`WebDAVClient` / tauri `invoke`）全是模块级 mock，对新 composable 同样生效。
18 条用例原样通过，行为覆盖无损。

**结果**：物理行 579 → 472，门禁口径 500 → 约 400，设置页改动不再一改就撞墙。
`BackupPasswordDialog.vue`（568 物理行，逼近上限）本次未动，留给下次真需要改它时
按 mode 拆子组件。

---

## 门禁

`npm run typecheck`、`npm run lint`、`npm run test:coverage` 全部 exit 0
（输出摘要见各条目）；跨引擎哨兵 `layout-chromium` + `layout-webkit` 200/200。
