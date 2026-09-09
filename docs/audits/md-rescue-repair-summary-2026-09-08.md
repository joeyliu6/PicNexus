# md-rescue：修复确认对话框补上「替换摘要」（2026-09-08）

> 来源：`docs/TODO.md` 待处理条目「文档修复：修复确认对话框缺「替换摘要」，图 6 流程与实际不符」，
> 原始发现见 2026-08-25 `/scan-bugs md-rescue` 扫描。本文记录设计决策、实现与真机验证。

## 结论

文档图 6 承诺确认对话框会展示「逐文件替换摘要」，但当时实现这个摘要的 `autoSelectAndGetSummary`
函数写好后从未接入 UI（生产代码零调用，仅测试引用）。用户要求接上 UI。

排查后发现直接复用 `autoSelectAndGetSummary` 会引入一个新缺陷：它内部按「每张图第一个有效备份」
自选，不认对话框里用户实际选中的策略（指定图床优先的顺序 / 响应最快 / 逐张手动选择）——预览会跟
点「开始修复」后 `applyRepairStrategy` 真正选出的结果对不上。改为抽出 `pickBackupForLink` 纯函数
供两边共用，新增 `summarizeRepairStrategy`（纯预览、不写状态）替代 `autoSelectAndGetSummary`。

## 实现

- `src/composables/md-rescue/useRepairStrategy.ts`：
  - 新增 `pickBackupForLink(link, strategy)`：按策略为单张图挑一个备份 URL 的纯函数
  - `applyRepairStrategy` 改为调用 `pickBackupForLink`（行为不变，`applyRepairStrategy.spec.ts` 原有
    6 条断言原样通过）
  - `autoSelectAndGetSummary` 删除，替换为 `summarizeRepairStrategy(links, strategy)`：纯函数，
    不写 `imageLinks`/`selectedBackup`，供确认对话框实时预览
- `src/components/views/link-check/MdRepairDialog.vue`：新增 `currentStrategy` 计算属性（随策略单选/
  优先级顺序/手动选择实时更新，与 `confirm()` 发出的策略是同一个来源，保证一致），新增「替换摘要」
  折叠面板（复用 `.repair-manual-list` 的展开/「显示全部」交互模式），显示 `N 个文件 · M 处替换`，
  展开可看每个文件改几处
- `src/composables/md-rescue/useMdRescue.ts`：`useMdRescueManager()` 不再导出 `autoSelectAndGetSummary`
  （已删除；`summarizeRepairStrategy` 是纯函数，由 `MdRepairDialog.vue` 直接从 `useRepairStrategy.ts`
  导入，不经过 manager，做法与该文件已有的 `smartTruncateUrl` 直接导入一致）
- `docs/flows/md-rescue-flow.md`：图 6 重画为实际流程（`currentStrategy` → `summarizeRepairStrategy`
  预览 / `pickBackupForLink` 选择 → 确认 → `applyRepairStrategy` → `executeReplace`）；图 5 的入口节点
  从过时的 `startFix(preference)` 改为实际的 `handleRepairConfirm(strategy)` → `applyRepairStrategy`；
  顺手修正图 3、图 4「关键源文件」指针（`useMdRescue.ts` → `LinkChecker.ts`，那部分逻辑早就搬过去了，
  文档没跟上）

**残留未动**：`startFix` / `applyHostPreference` 仍是没有任何 UI 组件调用的旧路径（`startFix` 内部调
`applyHostPreference`，两者互相成对但整体不可达）。本次范围是「补摘要」，不是「清理所有 md-rescue 死
代码」，两个函数留作后续独立评估——要么找到新的接入点，要么确认彻底废弃后删除。

## 测试

`tests/unit/composables/md-rescue/useRepairStrategy.spec.ts`：把原来锁定 `autoSelectAndGetSummary`
行为的 `describe` 块换成 `summarizeRepairStrategy`，新增关键断言——摘要预览选中的备份必须与
`applyRepairStrategy` 对同一份策略实际选出的备份完全一致（用 `fastest` 策略验证），以及纯函数不
写 `imageLinks`/`selectedBackup`。`tests/unit/composables/md-rescue/LinkChecker.spec.ts` 无需改动。
全量跑 `tests/unit/composables/md-rescue/` 148 → 151 条全绿。

## 真机验证（2026-09-08）

复用 [md-rescue-cancel-backup-verify-2026-09-08.md](md-rescue-cancel-backup-verify-2026-09-08.md) 搭
过的 portable 隔离环境 + `npm run tauri dev`（前端走 devUrl 实时加载，改完代码不用重新编译 Rust，
用户看到的就是当次改动）。

**过程中踩了两次同一类坑，记录下来避免下次重复**：

1. 第一轮：备用链接候选的测试图片是 `echo` 出来的纯文本，虽然文件名叫 `backup.jpg`，但内容不是图片
   → Rust 侧 `is_suspicious_image_response` 判定非 `image/*` 类型的 2xx 响应为「疑似」而非「有效」→
   备用链接 `checkResult.is_valid` 为 false → 这条失效链接不计入 `rescuableCount`，修复链接按钮全程
   禁用，摘要面板根本看不到。
2. 第二轮：换成用 PIL 生成的真 JPEG，但只有 24→692 字节，仍被判「疑似」——`is_suspicious_image_response`
   对 2xx 且非 SVG 的响应还有一条 `content_length < 1024` 字节的门槛（防止把占位图误判为正常图）。
   换成 108KB 的真图片后才通过。

**最终确认**：确认对话框底部出现「替换摘要」折叠面板，显示 `1 个文件 · 1 处替换`，与预期完全一致
（真机截图由用户提供，两轮失败 + 第三轮成功）。

## 清理

复用并延长使用的 portable 数据目录、`npm run tauri dev` 进程、两个本地测试 HTTP 服务器均已在验证
完成后确认退出/删除，未影响真实用户数据。
