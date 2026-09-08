# md-rescue：取消扫描后仍联网验证备用链接（2026-09-08 真机复现 + 修复）

> 来源：`docs/TODO.md` 待处理条目「文档修复：取消扫描后仍自动发起备用链接网络验证批次」，
> 原始发现见 2026-08-25 `/scan-bugs md-rescue` 扫描。本文记录真机复现过程、结论与修复。

## 结论

真机复现坐实：用户点「取消」后，应用仍会为已经检测完的坏链单独发起一轮新的网络请求去验证
备用链接候选，而不是立刻停下所有联网行为。代码里没有注释、文档里也没有说明这是故意设计，
虽然 `tests/unit/composables/md-rescue/LinkChecker.spec.ts` 里原本有一条测试专门锁定了这个行为
（说明当初是有意为之，只是从未解释理由、也从未写进文档）。跟用户核对后，按「取消即停」修正：
备用链接候选仍然查（纯本地 DB 查询，不联网），但取消后不再联网验证它们，保留为「待验证」状态。

## 真机复现（2026-09-08）

**环境**：`src-tauri/target/debug/data/portable.json` 隔离出的全新 portable 数据目录（不碰真实数据），
三个本地服务：
- `127.0.0.1:18081`：目录为空的 `python -m http.server`，模拟主链接失效（任何请求 404）
- `127.0.0.1:18082`：放了一个文件的 `python -m http.server`，模拟备用链接（响应 200）
- `127.0.0.1:18083`：自写的 TCP 服务器，接受连接后永不响应，用来把 Phase 1 的整体检测时间
  撑到 `timeout_secs`（10s），给人工点「取消」留出反应窗口

`history.db` 手工插入一条记录：`results` 里一个 service 指向 18081（会失效的主链接），另一个
service 指向 18082（备用链接候选）。两个 markdown 文件放进同一个待扫描目录：`file_a_fast.md`
只引用 18081 的链接（检测很快完成，让 `onFileComplete` 在 Phase 1 期间就查到备用链接候选）；
`file_b_slow.md` 引用 18083 上的三个不同路径（挂起，撑住整批检测的耗时）。

**操作**：真机打开 PicNexus，链接检测 → 文档修复 tab → 选择文件夹（选中含两个 md 文件的目录），
扫描自动开始后立刻点「取消」。

**PicNexus 自己的日志（`data/logs/PicNexus.log`）给出的时间线**：

```
15:55:06 [批量检测] 开始: 4 条链接, 并发=10, 单图床限制=3, 超时=10s
15:55:07 [批量检测] 收到取消请求                          ← 用户点了「取消」
15:55:16 [批量检测] 完成: 总=4 ... 耗时=10004ms, 取消=true  ← 已挂起的 3 条链接超时才算完
15:55:16 [批量检测] 开始: 1 条链接, 并发=10, ...            ← 修复前：这里又单独起了一批
15:55:16 [批量检测] 完成: 总=1 ... 耗时=3ms, 取消=false
15:55:16 [LinkChecker] 扫描已取消，已检测 4 条链接
```

15:55:07 用户已经点了取消，但 15:55:16 应用还是又发起了一轮全新的批量检测去查那 1 条备用链接
（打到了 18082，拿到 200 响应）。用真实运行的应用、真实的网络请求、真实的时间戳确认了 TODO 里
的怀疑：取消不是立刻停下所有联网行为。

## 修复

[LinkChecker.ts:403](../../src/composables/md-rescue/LinkChecker.ts#L403)：`verifyBackupLinks({ allowCancelled: true })`
改为 `verifyBackupLinks()`（不传 `allowCancelled`），命中函数内 `if (isCancelled.value && !options.allowCancelled) return;`
的早退分支，取消后不再联网验证。备用链接候选的**查找**（`enqueueFileComplete(file, { allowCancelled: true })`，
纯本地 DB 查询）保持不变——这部分不联网，取消后继续做没有代价，还能让用户看到候选。

`MdBackupLink.checkResult` 本来就是可选字段，UI 已有「待验证」的展示状态（未联网验证的候选走这条），
不需要额外改 UI。

`tests/unit/composables/md-rescue/LinkChecker.spec.ts` 原本那条测试断言取消后 `checkUrls` 应被调用
两次（主检测 + 备用链接验证），改为断言只调用一次、`backupLinks` 存在但 `checkResult` 未定义。
`docs/flows/md-rescue-flow.md` 排查表「备用链接显示待验证不更新 | Phase 2 的 checkUrls 被取消或
尚未开始」这一行修复前只对「Phase 2 中取消」成立，修复后对「Phase 1 中取消」也成立了，文档不用改。

## 清理

复现用的 portable 数据目录、三个本地测试服务器、临时 markdown/DB 种子文件均已在验证完成后清理，
不影响真实用户数据。
