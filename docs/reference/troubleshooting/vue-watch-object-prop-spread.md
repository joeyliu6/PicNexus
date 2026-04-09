# Vue watch 监听对象 prop 时，展开运算符触发意外副作用

## 现象

灯箱（Lightbox）组件中，点击收藏按钮后图片突然变成"加载中"状态，然后重新加载。

收藏操作本身成功了，但视觉上图片会闪烁一次。

## 陷阱原因

灯箱组件有一个 watch 监听 `props.item` 变化，切换图片时重置缩放/拖拽状态：

```ts
// HistoryLightbox.vue
watch(() => props.item, () => {
  if (props.visible) resetImageState(); // imageLoading = true
});
```

父组件在收藏切换后用展开运算符创建了新对象来更新 `isFavorited`：

```ts
// 父组件
lightboxItem.value = { ...lightboxItem.value, isFavorited: newState };
```

**问题**：`{ ...obj }` 创建了全新的对象引用 → Vue 的 watch 默认是浅比较 → 检测到 `props.item` 引用变了 → 触发 `resetImageState()` → 图片重新加载。

实际上只是 `isFavorited` 属性改了，图片并没有变。

## 正确做法

**方案 A**：watch 只监听真正需要触发重置的字段（推荐）

```ts
// 只在切换到不同图片时才重置
watch(() => props.item?.id, () => {
  if (props.visible) resetImageState();
});
```

**方案 B**：直接修改属性，不创建新对象

```ts
// 不触发 watch
if (lightboxItem.value?.id === item.id) {
  lightboxItem.value.isFavorited = newState;
}
```

## 错误示例

```ts
// ❌ 创建新对象引用，触发所有监听 item 的 watch
lightboxItem.value = { ...lightboxItem.value, isFavorited: newState };
```

## 正确示例

```ts
// ✅ 方案 A：watch 精确监听 id
watch(() => props.item?.id, () => {
  if (props.visible) resetImageState();
});

// ✅ 方案 B：直接修改属性（适用于只改一个字段的场景）
if (lightboxItem.value?.id === item.id) {
  lightboxItem.value.isFavorited = newState;
}
```

## 适用场景

任何通过 props 传递对象的组件，且组件内部有 watch 监听该 prop 并执行副作用（如重置状态、发起请求等）。常见于：

- Lightbox / Modal / Dialog 组件（切换内容时需重置状态）
- 表单组件（切换编辑对象时需重置校验状态）
- 详情面板（切换选中项时需重新加载数据）
