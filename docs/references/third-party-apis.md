# 第三方库 API 使用规范

本文档记录项目中使用的关键第三方库的 API 使用规范和最佳实践。

## 目录

- [Vue 3 Composition API](#vue-3-composition-api)
- [VueUse](#vueuse)
- [PrimeVue](#primevue)
- [Tauri](#tauri)
- [AWS SDK v3 (S3 客户端)](#aws-sdk-v3-s3-客户端)
- [LRU Cache](#lru-cache)
- [Vue Virtual Waterfall](#vue-virtual-waterfall)

---

## Vue 3 Composition API

### 官方文档
- [Vue.js 官方文档](https://vuejs.org/)
- [Composition API 指南](https://vuejs.org/guide/reusability/composables.html)

### 核心优势
- 通过 composable 函数实现更好的逻辑复用
- 改进的 TypeScript 支持和自然的类型推断
- 按功能而非选项组织代码，更灵活
- 更好的 tree-shaking 支持，减小打包体积

### `ref` vs `reactive` 使用原则

**使用 `ref()`：**
- 原始数据类型（string, number, boolean）
- 需要重新赋值的对象
- 频繁需要重新赋值的数组

```typescript
const count = ref(0)
const user = ref<User | null>(null)
```

**使用 `reactive()`：**
- 稳定的对象结构
- 状态对象
- 配置对象

```typescript
const state = reactive({
  loading: false,
  error: null,
  data: []
})
```

### 性能优化

**使用浅层响应式 API 优化大型数据集：**

```typescript
// 对于大型数组或深层嵌套对象
import { shallowRef, shallowReactive } from 'vue'

const largeList = shallowRef([...]) // 只追踪根级别的变化
const config = shallowReactive({...}) // 只追踪第一层属性
```

### Composable 最佳实践

#### 命名规范
- 使用 `use` 前缀，遵循单一职责原则
- 示例：`useUser()`、`useAsyncData()`、`useLocalStorage()`

#### 结构模板

```typescript
import { ref, onMounted, onUnmounted } from 'vue'

export function useFeature() {
  // 1. 响应式状态
  const state = ref(null)

  // 2. 计算属性
  const computed = computed(() => ...)

  // 3. 方法
  const method = () => { ... }

  // 4. 生命周期钩子
  onMounted(() => { ... })
  onUnmounted(() => { ... })

  // 5. 返回公开的 API
  return {
    state,
    computed,
    method
  }
}
```

### 参考资源
- [Vue 3 Composition API最佳实践（2025）](https://www.xinniyun.com/Web开发/article-vue3-composition-api-best-practi)
- [Vue 3 组合式 API 最佳实践](https://mmwk.cn/zh/blog/vue3-composition-api)
- [围绕Vue 3 Composition API构建应用程序](https://cloud.tencent.com/developer/article/2100342)

---

## VueUse

### 官方文档
- [VueUse 官方网站](https://vueuse.org/)
- [VueUse Guidelines](https://vueuse.org/guidelines)

### 项目中的使用

VueUse 提供了 200+ 即用型 Composition API 工具函数，支持 Vue 2 和 Vue 3。

### 常用 Composables

#### 元素交互
```typescript
import { onClickOutside, useMediaQuery } from '@vueuse/core'

// 检测点击外部区域
const target = ref(null)
onClickOutside(target, () => {
  console.log('Clicked outside')
})

// 媒体查询
const isMobile = useMediaQuery('(max-width: 768px)')
```

#### 浏览器 API
```typescript
import { useStorage, useTitle } from '@vueuse/core'

// 自动同步到 localStorage
const token = useStorage('auth-token', '')

// 响应式文档标题
const title = useTitle()
title.value = '新标题'
```

#### 状态管理
```typescript
import { useAsyncState } from '@vueuse/core'

const { state, isReady, isLoading, error } = useAsyncState(
  fetch('https://api.example.com/data').then(r => r.json()),
  null
)
```

### 最佳实践
- 优先使用 VueUse 提供的工具函数，避免重复造轮
- 参考 VueUse 的实现编写自定义 composable
- 使用 TypeScript 以获得更好的类型推断

### 参考资源
- [Best VueUse Composables](https://www.vuemastery.com/blog/best-vueuse-composables/)
- [5 Awesome VueUse Browser Related Composables](https://vuejsdevelopers.com/2023/06/05/5-awesome-browser-related-vueuse-composables-to-try-out/)
- [VueUse Composable Library](https://markus.oberlehner.net/blog/vue-composition-api-vueuse-composable-library)

---

## PrimeVue

### 官方文档
- [PrimeVue 官方网站](https://primevue.org/)
- [PrimeVue 中文文档](http://www.primevue.top)

### 项目配置

PrimeVue 4 提供 80+ UI 组件，支持主题定制和无样式模式。

### 组件使用规范

#### 导入方式
```typescript
// 按需导入组件
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
```

#### 主题配置
```typescript
// main.ts
import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'

const app = createApp(App)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark-mode'
    }
  }
})
```

#### 表单组件
```vue
<script setup>
import InputText from 'primevue/inputtext'
import { ref } from 'vue'

const value = ref('')
</script>

<template>
  <InputText v-model="value" placeholder="请输入..." />
</template>
```

#### 数据展示
```vue
<script setup>
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'

const items = ref([...])
</script>

<template>
  <DataTable :value="items" paginator :rows="10">
    <Column field="name" header="名称" sortable />
    <Column field="status" header="状态" />
  </DataTable>
</template>
```

### 样式定制

#### PassThrough API
使用 PassThrough API 访问组件内部 DOM 元素：

```vue
<Button
  :pt="{
    root: { class: 'custom-button' },
    label: { class: 'custom-label' }
  }"
>
  按钮
</Button>
```

#### 无样式模式
完全控制组件样式：

```typescript
app.use(PrimeVue, {
  unstyled: true
})
```

### 最佳实践
- 使用 Composition API 方式使用组件
- 利用 PassThrough API 进行样式定制
- 参考 PrimeVue 的设计规范保持界面一致性
- 检查父级和子级元素样式的影响

### 参考资源
- [PrimeVue：下一代 Vue.js UI 组件套件](https://zhuanlan.zhihu.com/p/17466468846)
- [PrimeVue - 基于Vue 3 的免费开源UI组件库](https://zhuanlan.zhihu.com/p/447720918)

---

## Tauri

### 官方文档
- [Tauri v1 官方指南](https://v1.tauri.app/v1/guides/)
- [Tauri 中文文档](https://tauri.org.cn/v1/api/js/tauri/)
- [Tauri 1.5 发布公告](https://tauri.app/blog/tauri-1-5/)

### API 使用

#### 文件系统访问
```typescript
import { convertFileSrc } from '@tauri-apps/api/tauri'

// 将设备文件路径转换为 webview 兼容的 URL
const assetUrl = convertFileSrc('/path/to/file.jpg')
```

**配置要求：**
需在 `tauri.conf.json` 中配置安全策略：

```json
{
  "tauri": {
    "security": {
      "csp": "default-src 'self' asset: http://asset.localhost"
    },
    "allowlist": {
      "protocol": {
        "asset": true,
        "assetScope": ["$APPDATA/**", "$RESOURCE/**"]
      }
    }
  }
}
```

#### 调用 Rust 后端
```typescript
import { invoke } from '@tauri-apps/api/tauri'

// 调用 Rust 命令
const result = await invoke<string>('my_command', {
  arg1: 'value1',
  arg2: 123
})
```

#### 文件对话框
```typescript
import { open, save } from '@tauri-apps/api/dialog'

// 打开文件选择器
const selected = await open({
  multiple: true,
  filters: [{
    name: 'Image',
    extensions: ['png', 'jpg', 'jpeg']
  }]
})

// 保存文件对话框
const path = await save({
  filters: [{
    name: 'JSON',
    extensions: ['json']
  }]
})
```

#### Shell 执行
```typescript
import { Command } from '@tauri-apps/api/shell'

const command = new Command('my-script', ['arg1', 'arg2'])
const output = await command.execute()
```

**配置 Shell 权限：**
```json
{
  "tauri": {
    "allowlist": {
      "shell": {
        "scope": [
          { "name": "my-script", "cmd": "script.sh" }
        ]
      }
    }
  }
}
```

### 安全最佳实践
- 始终使用 allowlist 限制 API 访问权限
- 使用 scope 定义文件和命令访问范围
- 配置适当的 CSP (Content Security Policy)
- 验证来自前端的所有输入

### 参考资源
- [使用Tauri快速开发速览](https://www.jeeinn.com/2024/01/2290)
- [Tauri JavaScript API 参考](https://v2.tauri.app/reference/javascript/api/)

---

## AWS SDK v3 (S3 客户端)

### 官方文档
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [@aws-sdk/client-s3 文档](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/)
- [Amazon S3 示例代码](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html)

### 模块化导入

AWS SDK v3 采用模块化设计，只导入需要的客户端和命令：

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

// 创建客户端（可复用）
const client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'YOUR_ACCESS_KEY',
    secretAccessKey: 'YOUR_SECRET_KEY'
  }
})

// 发送命令
const result = await client.send(new PutObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt',
  Body: 'file content'
}))
```

### 处理流式响应

在 v3 中，`GetObject` 返回 Stream 而不是 Buffer：

```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3'

const response = await client.send(new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt'
}))

// 处理流
const stream = response.Body
const chunks = []
for await (const chunk of stream) {
  chunks.push(chunk)
}
const buffer = Buffer.concat(chunks)
```

### 大文件上传

使用 `@aws-sdk/lib-storage` 进行分段上传：

```typescript
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

const upload = new Upload({
  client: new S3Client({ region: 'us-east-1' }),
  params: {
    Bucket: 'my-bucket',
    Key: 'large-file.zip',
    Body: fileStream
  },
  queueSize: 4, // 并发上传数
  partSize: 5 * 1024 * 1024, // 5MB 分片
  leavePartsOnError: false
})

upload.on('httpUploadProgress', (progress) => {
  console.log(progress)
})

await upload.done()
```

### 预签名 URL

```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const command = new GetObjectCommand({
  Bucket: 'my-bucket',
  Key: 'file.txt'
})

const url = await getSignedUrl(client, command, {
  expiresIn: 3600 // 1小时有效期
})
```

### 配置优化

#### Socket 管理
```typescript
import { NodeHttpHandler } from '@aws-sdk/node-http-handler'

const client = new S3Client({
  region: 'us-east-1',
  requestHandler: new NodeHttpHandler({
    maxSockets: 50,
    requestTimeout: 30000,
    connectionTimeout: 3000
  })
})
```

#### 客户端复用
```typescript
// 好的做法：复用客户端
const s3Client = new S3Client({ region: 'us-east-1' })

async function uploadFile(file) {
  return s3Client.send(new PutObjectCommand({ ... }))
}

// 避免：每次创建新客户端
async function uploadFile(file) {
  const client = new S3Client({ ... }) // ❌ 不推荐
  return client.send(new PutObjectCommand({ ... }))
}
```

### 最佳实践
- 使用模块化导入，减小打包体积
- 复用客户端实例
- 正确处理流式响应并及时消费
- 使用 @aws-sdk/lib-storage 处理大文件
- 配置合适的 socket 和超时设置
- 避免使用 v2 兼容模式

### 参考资源
- [Javascript AWS SDK v3 S3 guide](https://dev.to/frehner/javascript-aws-sdk-v3-s3-guide-dg5)
- [AWS SDK v3 GitHub](https://github.com/aws/aws-sdk-js-v3)
- [Amazon S3 considerations](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html)

---

## LRU Cache

### 官方文档
- [lru-cache npm 包](https://www.npmjs.com/package/lru-cache)
- [API 文档](https://www.jsdocs.io/package/lru-cache)

### 基本使用

```typescript
import { LRUCache } from 'lru-cache'

// 创建缓存实例
const cache = new LRUCache<string, User>({
  max: 500, // 最大缓存条目数
  maxSize: 5000, // 最大缓存大小（需配合 sizeCalculation）
  ttl: 1000 * 60 * 5, // 5分钟过期时间

  // 计算条目大小（可选）
  sizeCalculation: (value) => {
    return JSON.stringify(value).length
  },

  // 当条目被淘汰时的回调
  dispose: (value, key) => {
    console.log(`Disposed ${key}`)
  }
})

// 设置值
cache.set('user-123', { id: 123, name: 'John' })

// 获取值
const user = cache.get('user-123')

// 检查是否存在
if (cache.has('user-123')) {
  console.log('Cache hit')
}

// 删除
cache.delete('user-123')

// 清空
cache.clear()
```

### 带 TTL 的缓存

```typescript
const cache = new LRUCache({
  max: 100,
  ttl: 1000 * 60 * 5, // 默认 5 分钟
})

// 为单个条目设置不同的 TTL
cache.set('key', 'value', { ttl: 1000 * 60 }) // 1 分钟

// 获取剩余 TTL
const remaining = cache.getRemainingTTL('key')
```

### 批量操作

```typescript
// 获取所有键
const keys = [...cache.keys()]

// 获取所有值
const values = [...cache.values()]

// 遍历
cache.forEach((value, key) => {
  console.log(key, value)
})
```

### 性能优化

```typescript
// 预取：将条目移到最近使用位置，不更新 TTL
cache.get('key', { allowStale: false, updateAgeOnGet: false })

// 允许返回过期的条目
const staleValue = cache.get('key', { allowStale: true })
```

### 安全配置

**必须设置至少一个限制参数：**
- `max`: 最大条目数
- `maxSize`: 最大总大小
- `ttl`: 过期时间

```typescript
// ❌ 不安全：无限制增长
const unsafeCache = new LRUCache({})

// ✅ 安全：有限制
const safeCache = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 60
})
```

### 项目中的使用场景

在本项目中，LRU Cache 用于：
- 缩略图 URL 缓存
- API 响应缓存
- 搜索结果缓存

```typescript
// 示例：缩略图缓存
const thumbnailCache = new LRUCache<string, string>({
  max: 500,
  ttl: 1000 * 60 * 30, // 30分钟
  sizeCalculation: (url) => url.length
})
```

### 最佳实践
- 根据实际需求设置合理的 `max` 和 `ttl`
- 对于大型对象，使用 `sizeCalculation` 和 `maxSize`
- 使用 `dispose` 清理资源
- 考虑使用 `allowStale` 提升性能
- 避免无限制缓存增长

### 参考资源
- [Using LRU Cache in Node.js and TypeScript](https://dev.to/shayy/using-lru-cache-in-nodejs-and-typescript-7d9)
- [Top 5 lru-cache Code Examples](https://snyk.io/advisor/npm-package/lru-cache/example)

---

## Vue Virtual Waterfall

### 官方文档
- [GitHub 仓库](https://github.com/lhlyu/vue-virtual-waterfall)
- [npm 包](https://www.npmjs.com/package/@lhlyu/vue-virtual-waterfall)
- [在线演示](https://waterfall.tatakai.top)
- 版本: 1.0.8

### 简介

Vue Virtual Waterfall 是一个 Vue 3 虚拟瀑布流组件，用于高效展示大量数据集，支持自动列布局。

### 安装

```bash
pnpm add @lhlyu/vue-virtual-waterfall
```

### API 参数

#### Props

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `virtual` | `boolean` | `true` | 是否启用虚拟列表渲染 |
| `rowKey` | `string` | `'id'` | v-for 绑定的键标识符 |
| `enableCache` | `boolean` | `true` | 是否启用缓存机制 |
| `gap` | `number` | `15` | 项目间距（像素） |
| `padding` | `number \| string` | `15` | 容器内边距，可以是数字或字符串（如 `'15px 15px'`） |
| `preloadScreenCount` | `[number, number]` | `[0, 0]` | 预加载屏幕数量 `[上方, 下方]` |
| `itemMinWidth` | `number` | `220` | 单个项目最小宽度（像素） |
| `maxColumnCount` | `number` | `10` | 最大列数限制 |
| `minColumnCount` | `number` | `2` | 最小列数限制 |
| `items` | `any[]` | `[]` | 数据数组 |
| `calcItemHeight` | `(item: any, itemWidth: number) => number` | `() => 250` | 高度计算函数 |

#### Slots

| 名称 | 参数 | 说明 |
|------|------|------|
| `default` | `{ item: any, index: number }` | 渲染自定义项目内容 |

#### Methods

| 方法 | 参数 | 说明 |
|------|------|------|
| `withItemSpaces` | `(cb: (spaces: readonly SpaceOption[]) => Promise<void> \| void)` | 访问项目空间信息 |

### 基本使用

```vue
<script setup>
import { VirtualWaterfall } from '@lhlyu/vue-virtual-waterfall'
import { ref } from 'vue'

interface ItemOption {
  id: number
  img: string
  height?: number
}

const items = ref<ItemOption[]>([
  { id: 1, img: '/img1.jpg' },
  { id: 2, img: '/img2.jpg' }
])

// 高度计算函数
const calcItemHeight = (item: ItemOption, itemWidth: number) => {
  // 根据实际需求计算高度
  return item.height || 250
}
</script>

<template>
  <div style="height: 100vh">
    <VirtualWaterfall
      :items="items"
      :calcItemHeight="calcItemHeight"
      :gap="16"
    >
      <template #default="{ item, index }">
        <div class="card">
          <img :src="item.img" :alt="`Image ${index}`" />
        </div>
      </template>
    </VirtualWaterfall>
  </div>
</template>
```

### 高级配置

#### 自定义列数范围

```vue
<VirtualWaterfall
  :items="items"
  :calcItemHeight="calcItemHeight"
  :minColumnCount="2"
  :maxColumnCount="5"
  :itemMinWidth="200"
  :gap="20"
/>
```

#### 预加载优化

```vue
<VirtualWaterfall
  :items="items"
  :calcItemHeight="calcItemHeight"
  :preloadScreenCount="[1, 2]"
  :enableCache="true"
/>
```

参数说明：
- `[1, 2]` 表示向上预加载 1 屏，向下预加载 2 屏
- 增加预加载可以减少滚动时的白屏，但会增加渲染开销

#### 自定义内边距

```vue
<VirtualWaterfall
  :items="items"
  :calcItemHeight="calcItemHeight"
  :padding="'20px 15px'"
/>
```

### 响应式布局

```vue
<script setup>
import { useWindowSize } from '@vueuse/core'
import { computed } from 'vue'

const { width } = useWindowSize()

// 根据屏幕宽度动态调整列数范围
const minCol = computed(() => width.value < 768 ? 1 : 2)
const maxCol = computed(() => {
  if (width.value < 768) return 2
  if (width.value < 1200) return 4
  return 6
})
</script>

<template>
  <VirtualWaterfall
    :items="items"
    :calcItemHeight="calcItemHeight"
    :minColumnCount="minCol"
    :maxColumnCount="maxCol"
  />
</template>
```

### 访问项目空间信息

```vue
<script setup>
import { ref } from 'vue'

const waterfallRef = ref()

const handleGetSpaces = () => {
  waterfallRef.value?.withItemSpaces((spaces) => {
    console.log('项目空间信息:', spaces)
    // spaces 包含每个项目的位置和尺寸信息
  })
}
</script>

<template>
  <VirtualWaterfall ref="waterfallRef" :items="items" :calcItemHeight="calcItemHeight" />
  <button @click="handleGetSpaces">获取空间信息</button>
</template>
```

### 关键注意事项

#### 1. 容器高度要求（⚠️ 重要）

**必须为包裹 VirtualWaterfall 的容器指定固定高度**，否则虚拟滚动无法正常工作。

```vue
<!-- ✅ 正确 -->
<div style="height: 100vh">
  <VirtualWaterfall :items="items" :calcItemHeight="calcItemHeight" />
</div>

<!-- ❌ 错误 -->
<div>
  <VirtualWaterfall :items="items" :calcItemHeight="calcItemHeight" />
</div>
```

#### 2. 高度计算函数

`calcItemHeight` 函数对性能影响很大：
- 应该返回准确的高度值
- 避免在函数内进行复杂计算
- 如果高度已知，直接返回

```typescript
// ✅ 推荐：使用预计算的高度
const calcItemHeight = (item: ItemOption, itemWidth: number) => {
  return item.height || 250
}

// ⚠️ 谨慎使用：动态计算（可能影响性能）
const calcItemHeight = (item: ItemOption, itemWidth: number) => {
  const aspectRatio = item.width / item.height
  return itemWidth / aspectRatio
}
```

#### 3. 数据项键值

确保每个数据项都有唯一的 `id` 字段（或通过 `rowKey` 指定的字段）：

```typescript
const items = ref([
  { id: 1, content: '...' }, // ✅ 有唯一 id
  { id: 2, content: '...' }
])
```

#### 4. 性能优化建议

- 使用 `shallowRef` 处理大量数据
- 启用缓存机制（默认已启用）
- 合理设置预加载屏幕数量
- 避免在 slot 模板中进行复杂计算

```vue
<script setup>
import { shallowRef } from 'vue'

// ✅ 对于大数组使用 shallowRef
const items = shallowRef([...])
</script>
```

### 项目中的使用

在本项目中，Vue Virtual Waterfall 用于历史记录页面的网格视图，实现虚拟滚动和瀑布流布局。

参考项目中的使用：
- [HistoryGridView.vue](../src/components/history/HistoryGridView.vue)
- [GridTile.vue](../src/components/history/GridTile.vue)

### 参考资源
- [GitHub 仓库](https://github.com/lhlyu/vue-virtual-waterfall)
- [在线演示](https://waterfall.tatakai.top)

---

## 更新日志

- 2025-12-17:
  - 初始版本，记录所有关键第三方库的 API 使用规范
  - 添加 Vue Virtual Waterfall 官方完整 API 文档
