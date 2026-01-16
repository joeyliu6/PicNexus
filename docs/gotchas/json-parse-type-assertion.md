# JSON.parse + as 类型断言的陷阱

## 现象

使用 `JSON.parse(content) as SomeType` 时，TypeScript 编译通过，但运行时数据可能不符合预期类型，导致后续操作出错。

## 陷阱原因

`as` 是类型断言，它只是告诉 TypeScript "相信我"，**不会在运行时做任何验证**。

```typescript
// ❌ 危险写法
const data = JSON.parse(content) as UserConfig;
// TypeScript 相信你，但 content 可能是任何东西
```

`JSON.parse` 返回 `any`，配合 `as` 使用时：
- 编译时：TypeScript 认为类型正确
- 运行时：实际数据可能完全不匹配

## 正确做法

**先验证，再使用**。使用类型守卫函数（Type Guard）确保数据格式正确。

```typescript
// ✅ 安全写法
const parsed = JSON.parse(content);

// 类型守卫函数
if (!isValidUserConfig(parsed)) {
  throw new Error('无效的配置格式');
}

// 此时 TypeScript 知道 parsed 是 UserConfig
const config = parsed;
```

## 类型守卫函数示例

```typescript
export function isValidHistoryItem(obj: unknown): obj is HistoryItem {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  const item = obj as Record<string, unknown>;

  // 检查必需字段
  if (typeof item.id !== 'string') return false;
  if (typeof item.timestamp !== 'number') return false;
  if (typeof item.localFileName !== 'string') return false;
  // ...

  return true;
}
```

## 错误示例 vs 正确示例

```typescript
// ❌ 错误：只验证是数组，不验证元素
const items = JSON.parse(content) as HistoryItem[];
if (!Array.isArray(items)) {
  throw new Error('期望数组');
}
// items[0].id 可能是 undefined，运行时崩溃

// ✅ 正确：验证数组 + 验证每个元素
const parsed = JSON.parse(content);
if (!Array.isArray(parsed)) {
  throw new Error('期望数组');
}
const invalidIndex = parsed.findIndex(item => !isValidHistoryItem(item));
if (invalidIndex !== -1) {
  throw new Error(`第 ${invalidIndex + 1} 条记录格式无效`);
}
const items = parsed as HistoryItem[];
```

## 适用场景

任何从外部获取数据后需要断言类型的场景：
- `JSON.parse()` 解析用户文件
- API 响应数据
- localStorage/IndexedDB 读取
- WebSocket 消息

## 相关文件

- `src/config/types.ts` - `isValidUserConfig`、`isValidHistoryItem`
- `src/composables/useBackupSync.ts` - 导入配置/历史时的验证
