# 第三方库 API 速查

项目核心依赖的使用规范和踩坑记录。基础用法查官方文档，本文只记项目特定的约定和陷阱。

---

## Vue 3

- [官方文档](https://vuejs.org/)

### 项目约定

- `ref()` 用于原始类型和需要重新赋值的对象；`reactive()` 用于稳定的状态/配置对象
- 大型数组用 `shallowRef()`（只追踪根级变化），避免深层响应式的性能开销
- Composable 以 `use` 前缀命名，遵循单一职责

---

## VueUse

- [官方文档](https://vueuse.org/)

### 项目约定

- 优先使用 VueUse 提供的工具函数，避免重复造轮子
- 项目中常用：`onClickOutside`、`useMediaQuery`、`useStorage`、`useAsyncState`

---

## Reka UI 2

- [官方文档](https://reka-ui.com/)

### 项目约定

- 只用它的行为（键盘、焦点、读屏、浮层定位），样子由 `src/components/pn/` 的 `Pn*` 组件给，不用它的示例样式
- 浮层内容传送到 body：样式用不带 scoped 的唯一类名，根元素加 `pn-layer`（见 `docs/design/ui-patterns.md`）
- 对话框没有说明文字时，`DialogContent` 传 `:aria-describedby="undefined"`，否则开发版会在控制台警告

---

## Tauri 2.x

- [官方文档](https://v2.tauri.app/)
- [JavaScript API](https://v2.tauri.app/reference/javascript/api/)

### 关键 API

- `invoke<T>(cmd, args)` — 调用 Rust 命令，命令列表见 `api/rust-commands.md`
- `convertFileSrc(path)` — 本地文件路径转 WebView URL

### 安全要点

- `capabilities` 限制 API 访问权限和文件/命令范围
- CSP 默认只允许外部 HTTPS；HTTP 仅保留 `localhost` / `127.0.0.1` 回环地址。样式内联保留（见下一条），脚本内联不允许。
- Tauri 正式版的 CSP nonce 会挡掉运行时插入的 `<style>` — 见 `troubleshooting/tauri-csp-nonce-inline-styles.md`

---

## AWS SDK v3 (S3)

- [官方文档](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)

### 项目约定

- 模块化导入（`@aws-sdk/client-s3`），不用 v2 兼容模式
- **复用客户端实例**，不要每次请求都 `new S3Client()`
- 大文件用 `@aws-sdk/lib-storage` 的 `Upload` 类（支持分段上传 + 进度回调）
- `GetObject` 返回 Stream，需手动 concat chunks

```typescript
// 客户端复用模式
const s3Client = new S3Client({ region, credentials });
// 所有操作共用这个实例
await s3Client.send(new PutObjectCommand({ Bucket, Key, Body }));
```

---

## LRU Cache

- [npm 文档](https://www.npmjs.com/package/lru-cache)

### 项目用途

缩略图 URL 缓存、API 响应缓存、搜索结果缓存。

### 关键约定

- **必须设 `max` 或 `ttl`**，否则无限增长
- 大型对象用 `sizeCalculation` + `maxSize` 限制内存

```typescript
const cache = new LRUCache<string, string>({ max: 500, ttl: 1000 * 60 * 30 });
```

---

## Vue Virtual Waterfall

- [GitHub](https://github.com/lhlyu/vue-virtual-waterfall) | 版本 1.0.8

### 核心 Props

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `items` | `any[]` | `[]` | 数据数组 |
| `calcItemHeight` | `(item, width) => number` | `() => 250` | 高度计算函数（影响性能） |
| `itemMinWidth` | `number` | `220` | 单项最小宽度 |
| `gap` | `number` | `15` | 间距 |
| `minColumnCount` / `maxColumnCount` | `number` | `2` / `10` | 列数范围 |
| `preloadScreenCount` | `[number, number]` | `[0, 0]` | 预加载屏数 [上, 下] |
| `virtual` | `boolean` | `true` | 虚拟滚动开关 |

### 必须注意

1. **容器必须有固定高度**（如 `height: 100vh`），否则虚拟滚动不工作
2. `calcItemHeight` 应返回准确值且避免复杂计算，直接用预计算高度最佳
3. 大数组用 `shallowRef`
4. 每个 item 必须有唯一 `id`（或通过 `rowKey` 指定）

### 项目中使用

- `src/components/history/HistoryGridView.vue` — 历史记录网格视图
- `src/components/history/GridTile.vue` — 网格项组件
