# 踩坑记录

> 记录开发过程中遇到的常见陷阱和易错点，避免重复踩坑。

---

## 记录列表

| 文档 | 问题 | 分类 |
|------|------|------|
| [vue-watch-object-prop-spread.md](./vue-watch-object-prop-spread.md) | `{ ...obj }` 更新 prop 触发 watch 副作用（如 resetImageState），应监听 `item?.id` | Vue/响应式 |
| [tauri-async-runtime-spawn-no-abort-handle.md](./tauri-async-runtime-spawn-no-abort-handle.md) | `tauri::async_runtime::spawn` 不支持 `abort_handle()`，需改用 `tokio::task::spawn` | Tauri/tokio |
| [primevue-scoped-css-width-not-applied.md](./primevue-scoped-css-width-not-applied.md) | PrimeVue 组件上的 scoped CSS 宽度不生效，需用原生 div 包裹 + `:deep()` 穿透 | PrimeVue/CSS |
| [tauri-csp-nonce-blocks-primevue-styles.md](./tauri-csp-nonce-blocks-primevue-styles.md) | Tauri 2.x CSP nonce 替换导致 PrimeVue 运行时样式被静默拦截，需禁用 style-src 的 nonce 修改 | Tauri/CSP |
| [primevue-virtualscroller-fixed-itemsize.md](./primevue-virtualscroller-fixed-itemsize.md) | VirtualScroller `itemSize` 只能固定数字，内容高度变化会导致错位；间距必须用 padding 不能用 margin | PrimeVue/虚拟滚动 |

---

## 记录格式

```markdown
# [问题标题]

## 现象
[遇到的问题表现]

## 陷阱原因
[为什么会踩坑]

## 正确做法
[应该怎么做]

## 错误示例
[错误的代码]

## 正确示例
[正确的代码]
```

---

## 适合记录的内容

- **API 误用**：容易用错的 API 参数或返回值
- **框架陷阱**：Vue/Tauri/PrimeVue 的隐藏行为
- **CSS 怪癖**：浏览器兼容性、层叠优先级问题
- **异步问题**：竞态条件、Promise 处理不当
- **类型陷阱**：TypeScript 类型推断失败的场景

---

## 相关链接

- [问题修复记录](../fixes/) - 复杂 bug 的完整解决方案
- [最佳实践](../patterns/) - 推荐的代码模式
- [返回文档首页](../README.md)
