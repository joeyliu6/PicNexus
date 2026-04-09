# 链接监控大数据量性能优化

## 问题背景

链接监控功能在 5 万条历史记录（约 7.5 万个链接行）下存在两个严重性能瓶颈：
1. Phase 2 加载期间 UI 卡顿
2. 检测完成后 DB 写入需要 50-100 秒

## 分析过程

通过 Triple-Check 模式模拟 5 万条数据走完整流程，逐环节分析计算量：

### 瓶颈 1：Phase 2 O(n²) 数组复制

`loadHistoryRows()` 的 Phase 2 每批 2000 条执行：
```typescript
checkRows.value = [...checkRows.value, ...rows];
```
12 批循环 = 60000 + 62000 + ... + 84000 ≈ 87 万次对象引用复制，且每次触发 `rebuildRowIndex()` 和所有 computed 重算。

### 瓶颈 2：逐条 DB update

`updateHistoryCheckStatus()` 对每个 historyId 执行：
```typescript
await historyDB.update(historyId, { linkCheckStatus, linkCheckSummary });
```
`update()` 内部先 `getById()` 再全列 UPDATE，5 万条 = 10 万次 IPC 往返。

## 优化方案

### 方案 1：先收集后合并

Phase 2 不再每批都复制全数组，而是先攒到临时数组，最后一次合并：
```typescript
const pendingRows: LinkCheckRow[] = [];
for await (const batch of stream) {
  pendingRows.push(...rows);
  await yieldToMain();
}
checkRows.value = [...checkRows.value, ...pendingRows];
rebuildRowIndex();
```

### 方案 2：CASE/WHEN 批量 SQL

新增 `batchUpdateLinkCheckStatus()` 方法，每 200 条一批用 CASE/WHEN：
```sql
UPDATE history_items
SET link_check_status = CASE
      WHEN id = $1 THEN $201
      WHEN id = $2 THEN $202 ...
    END,
    link_check_summary = CASE
      WHEN id = $1 THEN $202
      ...
    END
WHERE id IN ($1, $2, ...)
```
5 万条只需 250 次 SQL（vs 原来 5 万次 SELECT + 5 万次 UPDATE）。

## 效果对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| Phase 2 加载（5 万条） | ~87 万次数组复制 + 12 次 computed 重算 | 1 次数组合并 + 1 次 computed 重算 |
| DB 写入（5 万条） | 50-100 秒（逐条 SELECT + UPDATE） | 1-3 秒（250 次批量 UPDATE） |
| IPC 往返次数 | ~10 万次 | ~250 次 |

## 注意事项

- `batchUpdateLinkCheckStatus` 只更新 `link_check_status` 和 `link_check_summary` 两列，不触发全列更新
- Phase 2 改为一次合并后，用户在 Phase 2 加载期间不会看到"正常"标签的数据逐步增多（而是一次性出现）。这是可接受的权衡，因为 Phase 1 已经提前显示了失效/未检测数据
- CASE/WHEN 批量大小 200 是经验值，过大会导致 SQL 语句过长
