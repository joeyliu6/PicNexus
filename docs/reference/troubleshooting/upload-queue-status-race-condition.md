# 上传队列状态竞态条件

## 问题描述

上传失败后，弹窗正确显示"全线上传失败"，但队列 UI 仍显示：
- 整体状态："正在同步..."
- 服务状态："上传中..."

重试失败后也有相同问题。

## 问题根源

**节流更新的 RAF 回调覆盖了最终状态。**

### 时序分析

```
1. 进度回调 → updateServiceProgress → updateItemThrottled
   → 加入 pendingUpdates 队列（status: 'uploading', serviceProgress: {...}）

2. 上传失败 → onServiceResult 回调 → handleServiceResult
   → updateItem 更新 serviceProgress（但 status 仍是 'uploading'）

3. ⚠️ RAF 回调可能在此时执行！
   → flushPendingUpdates 检查 status === 'uploading'
   → 应用过时的节流更新，覆盖 serviceProgress！

4. catch 块执行 → markItemFailed 设置 status = 'error'
   → 太晚了，serviceProgress 已被覆盖
```

### 核心问题

1. `handleServiceResult` 只更新了 `serviceProgress`，没有设置整体 `status`
2. 节流队列中的更新在 RAF 帧执行，时机不可控
3. `markItemFailed` 设置 `status: 'error'` 时，`serviceProgress` 已被过时更新覆盖

## 解决方案

### 方案：在设置最终状态时清除节流队列

在 `markItemFailed` 和 `markItemComplete` 被调用时，**立即清除**该 item 的所有待处理节流更新。

#### 1. 添加清除函数 (`useQueueState.ts`)

```typescript
/**
 * 清除指定 item 的所有待处理节流更新
 */
function clearPendingUpdatesForItem(itemId: string): void {
  pendingUpdates.delete(itemId);
}
```

#### 2. 在关键状态更新时调用 (`uploadQueue.ts`)

```typescript
markItemFailed(itemId: string, errorMessage: string): void {
  // ...
  // 关键：清除过时的节流更新
  this.queueState.clearPendingUpdatesForItem(itemId);

  this.updateItem(itemId, { status: 'error', ... });
}

markItemComplete(itemId: string, primaryUrl: string): void {
  // ...
  // 关键：清除过时的节流更新
  this.queueState.clearPendingUpdatesForItem(itemId);

  // ...
}
```

#### 3. 双重保险：RAF 回调中跳过已完成的 item (`useQueueState.ts`)

```typescript
function flushPendingUpdates() {
  pendingUpdates.forEach((updates, itemId) => {
    // ...
    // 如果状态已经是最终态，跳过所有待处理更新
    if (currentItem.status === 'error' || currentItem.status === 'success') {
      return;
    }
    // ...
  });
}
```

## 修改文件

- `src/composables/useQueueState.ts` - 添加 `clearPendingUpdatesForItem` 函数
- `src/uploadQueue.ts` - 在 `markItemFailed` 和 `markItemComplete` 中调用清除函数
- `src/services/RetryService.ts` - 重试失败后检查并恢复 error 状态

## 效果

- ✅ 首次上传失败后，队列正确显示失败状态
- ✅ 重试失败后，队列正确恢复失败状态
- ✅ 上传成功后，状态不会被过时更新覆盖

## 经验教训

1. **节流更新需要考虑清除时机** - 当有明确的"最终状态"时，应清除待处理更新
2. **RAF 回调时序不可控** - 不能假设它在特定代码之前或之后执行
3. **状态机需要完整的状态转换** - `handleServiceResult` 应该同时更新服务状态和整体状态
