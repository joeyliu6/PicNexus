# 上传队列状态竞态条件

## 现象

单个图床已经失败或成功，队列卡片却：

- 失败的图床又回到「准备上传... / 上传中」，一直转圈，没有重试按钮，「批量重传」也不包含它，「清空已完成」还会把它当干净项清掉；
- 成功的图床链接消失，复制按钮不见（历史记录不受影响）；
- 整项失败后仍显示「正在同步...」。

## 根因

**进度走节流层，最终状态走同步写入，二者在同一帧里交错。**

`updateServiceProgress` 把进度压进 `useQueueState` 的 `pendingUpdates`，下一帧 `requestAnimationFrame` 才落地；而图床结果（`handleServiceResult` / `RetryService`）用 `updateItem` 同步写 ✓ / ✗、`link`、`fileKey`。下一帧回放攒下的进度时，如果直接替换，就会把刚写入的最终状态盖回旧值。

```
1. github 报进度「准备上传...」 → 进 pendingUpdates
2. github 失败 → updateItem 同步写「✗ 失败」（整项仍是 uploading，smms 还在传）
3. 下一帧 flushPendingUpdates 回放第 1 步 → 若整条替换，「✗ 失败」被抹掉
```

## 防线（三层，缺一不可）

| 层 | 位置 | 管什么 |
|---|---|---|
| 整项收口时丢弃 | `UploadQueue.ts` 的 `markItemComplete` / `markItemFailed` 调 `clearPendingUpdatesForItem` | 整项已结束，攒下的全部作废 |
| 整项终态跳过 | `useQueueState.ts` `flushPendingUpdates`：`status` 为 `success` / `error` 时整项跳过 | 收口后才到的迟到进度 |
| **单图床终态跳过** | `flushPendingUpdates` 经 `mergeServiceProgress(..., { skipSettled: true })` 按图床深合并；该图床已是 ✓ / ✗ / 已跳过 就丢弃它的节流进度 | 整项还在传、某个图床已落定——上面两层都挡不住这种情况 |

配套约定：`updateServiceProgress` 只提交本次变化的字段（`progress` / `status` / `metadata.step*`），**不带入入队那一刻的整条快照**；否则即使按图床合并，快照里旧的 `link` / `error` 也会被写回去。

重试不受影响：`resetServiceForRetry` / `resetItemForRetry` 用 `updateItem` 同步把状态改回「等待中...」（非终态），之后的重试进度照常落地。

## 测试

`tests/unit/core/uploadQueueManager.spec.ts` 里「同一帧里先报进度、随后失败」「100%「完成」进度不能抹掉链接与 fileKey」「重试重置后的新进度照常落地」三条钉住单图床那一层。

## 经验

1. 节流层与同步写入共存时，节流回放必须是「合并 + 跳过已落定」，不能是「替换」。
2. RAF 回调时序不可控，不能假设它在某段代码之前或之后执行。
3. 判断「已落定」要按图床看，整项状态只是其中一种特例。
