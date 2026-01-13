# 前端架构

> Vue 3 + TypeScript + PrimeVue 前端架构详解

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue | 3.x | 响应式框架，Composition API |
| TypeScript | 5.x | 类型安全 |
| PrimeVue | 4.x | UI 组件库 |
| Vite | 5.x | 构建工具 |

---

## 组件架构

### 目录结构

```
src/components/
├── views/                    # 主视图（路由级）
│   ├── UploadView.vue       # 上传界面
│   ├── history/             # 历史记录模块
│   │   ├── HistoryTableView.vue   # 表格视图
│   │   ├── HistoryGridView.vue    # 网格视图
│   │   └── HistoryLightbox.vue    # 图片预览
│   └── timeline/            # 时间线模块
│       └── TimelineView.vue
│
├── settings/                 # 设置面板
│   ├── SettingsPanel.vue    # 设置主面板
│   ├── UploaderSettings.vue # 图床设置
│   └── GeneralSettings.vue  # 通用设置
│
├── layout/                   # 布局组件
│   ├── TitleBar.vue         # 标题栏（窗口控制）
│   ├── Sidebar.vue          # 侧边导航
│   └── MainLayout.vue       # 主布局容器
│
├── common/                   # 通用组件
│   ├── ThumbnailImage.vue   # 缩略图组件
│   ├── ServiceBadge.vue     # 服务标识
│   └── LoadingSpinner.vue   # 加载状态
│
└── dialogs/                  # 对话框
    ├── SyncConflictDialog.vue
    └── BatchRenameDialog.vue
```

### 组件命名规范

| 类型 | 命名模式 | 示例 |
|------|---------|------|
| 视图组件 | `*View.vue` | `UploadView.vue` |
| 面板组件 | `*Panel.vue` | `SettingsPanel.vue` |
| 对话框 | `*Dialog.vue` | `SyncConflictDialog.vue` |
| 通用组件 | 语义化名称 | `ThumbnailImage.vue` |

---

## 状态管理

项目使用 **Vue Composition API + Composables** 模式管理状态，不使用 Vuex/Pinia。

### Composables 概览

```
src/composables/
├── useConfig.ts          # 配置管理
├── useHistory.ts         # 历史记录
├── useUpload.ts          # 上传流程
├── useThumbCache.ts      # 缩略图缓存
├── useToast.ts           # Toast 通知
├── useTheme.ts           # 主题切换
├── useWebDAVSync.ts      # WebDAV 同步
├── useAutoSync.ts        # 自动同步
├── useClipboardImage.ts  # 剪贴板图片
├── useConfirm.ts         # 确认对话框
├── useQueueState.ts      # 上传队列状态
└── useVirtualTimeline.ts # 虚拟滚动时间线
```

### 核心 Composables

#### useConfig

配置管理，处理加载、保存和服务连接测试。

```typescript
const {
  config,           // Ref<UserConfig> - 当前配置
  isLoading,        // Ref<boolean> - 加载状态
  isSaving,         // Ref<boolean> - 保存状态
  loadConfig,       // () => Promise<void>
  saveConfig,       // (config, silent?) => Promise<void>
  testWeiboConnection,    // (cookie) => Promise<Result>
  testR2Connection,       // (r2Config) => Promise<Result>
  openCookieWebView,      // (serviceId) => void
} = useConfig();
```

#### useHistory

历史记录管理，与 SQLite 数据库交互。

```typescript
const {
  imageMetas,       // ShallowRef<ImageMeta[]> - 历史列表
  isLoading,        // Ref<boolean>
  loadHistory,      // (forceReload?) => Promise<void>
  deleteHistoryItem,     // (id) => Promise<void>
  clearHistory,          // () => Promise<void>
  searchHistory,         // (keyword, options) => Promise<ImageMeta[]>
  loadPageByNumber,      // (page, size, filter?) => Promise<PageResult>
  loadTimePeriodStats,   // () => Promise<TimePeriodStats>
} = useHistory();
```

#### useUpload

上传流程管理，编排多服务上传。

```typescript
const {
  selectedServices,      // Ref<ServiceType[]> - 选中的服务
  availableServices,     // Ref<ServiceType[]> - 可用服务
  serviceConfigStatus,   // Record<ServiceType, boolean> - 配置状态
  isUploading,           // Ref<boolean>
  activePrefix,          // Ref<string | null>
  selectFiles,           // () => Promise<void>
  handleFilesUpload,     // (filePaths) => Promise<void>
  toggleServiceSelection,// (serviceId) => void
  saveHistoryItem,       // (...) => Promise<void>
} = useUpload();
```

### 状态共享模式

Composables 使用单例模式共享状态：

```typescript
// useConfig.ts
let sharedState: ConfigState | null = null;

export function useConfig() {
  if (!sharedState) {
    sharedState = createConfigState();
  }
  return sharedState;
}
```

---

## 主题系统

### CSS 变量体系

所有颜色使用 CSS 变量，自动适配深色/浅色主题。

```css
/* 背景色 */
--bg-app          /* 应用主背景 */
--bg-card         /* 卡片背景 */
--bg-input        /* 输入框背景 */

/* 文本色 */
--text-main       /* 主文本 */
--text-muted      /* 次要文本 */
--text-disabled   /* 禁用文本 */

/* 边框色 */
--border-subtle   /* 普通边框 */
--border-focus    /* 焦点边框 */

/* 状态色 */
--primary         /* 主品牌色 */
--success         /* 成功 */
--warning         /* 警告 */
--error           /* 错误 */
```

### 主题文件

```
src/theme/
├── dark-theme.css         # 深色主题变量定义
├── light-theme.css        # 浅色主题变量定义
├── primevue-overrides.css # PrimeVue 组件覆盖
├── transitions.css        # 主题切换动画
├── ThemeManager.ts        # 主题切换逻辑
└── index.ts               # PrimeVue 预设配置
```

### 使用规范

```css
/* ✅ 正确：使用变量 */
.card {
  background-color: var(--bg-card);
  color: var(--text-main);
}

/* ❌ 错误：硬编码颜色 */
.card {
  background-color: #1e293b;
  color: #f8fafc;
}
```

详见 [样式设计规范](../style-design.md)。

---

## 路由与导航

项目采用侧边栏导航 + 视图切换模式，不使用 Vue Router。

### 视图切换

```typescript
// Sidebar.vue
const currentView = ref<ViewType>('upload');

const views = {
  upload: UploadView,
  history: HistoryTableView,
  timeline: TimelineView,
  settings: SettingsPanel,
};
```

### 视图类型

| 视图 | 组件 | 说明 |
|------|------|------|
| `upload` | `UploadView` | 默认视图，上传入口 |
| `history` | `HistoryTableView` | 表格形式历史记录 |
| `grid` | `HistoryGridView` | 网格形式历史记录 |
| `timeline` | `TimelineView` | 时间线浏览 |
| `settings` | `SettingsPanel` | 设置面板 |

---

## 与 Tauri 交互

### invoke 调用

```typescript
import { invoke } from '@tauri-apps/api/core';

// 调用 Rust 命令
const result = await invoke<UploadResult>('upload_file_stream', {
  id: uploadId,
  filePath: '/path/to/image.png',
  weiboCookie: cookie,
});
```

### 事件监听

```typescript
import { listen } from '@tauri-apps/api/event';

// 监听上传进度
const unlisten = await listen<ProgressEvent>('upload-progress', (event) => {
  console.log('Progress:', event.payload.progress);
});

// 清理监听器
onUnmounted(() => unlisten());
```

### 窗口操作

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();
await appWindow.minimize();
await appWindow.close();
```

---

## 性能优化

### 虚拟滚动

时间线视图使用虚拟滚动处理大量图片：

```typescript
// useVirtualTimeline.ts
const {
  visibleItems,     // 当前可见项
  containerRef,     // 容器引用
  scrollTo,         // 滚动到指定位置
  itemMap,          // 项目缓存
} = useVirtualTimeline(items, itemHeight);
```

### 图片懒加载

缩略图组件使用 Intersection Observer 懒加载：

```vue
<!-- ThumbnailImage.vue -->
<template>
  <img
    v-if="isVisible"
    :src="thumbUrl"
    loading="lazy"
  />
  <div v-else class="placeholder" />
</template>
```

### 缩略图缓存

本地缓存缩略图，避免重复生成：

```typescript
const { getThumb, preloadThumbs } = useThumbCache();

// 获取缩略图（自动缓存）
const thumbUrl = await getThumb(imagePath);
```

---

## 相关文档

- [架构总览](./overview.md)
- [Composables API](../api/composables.md)
- [样式设计规范](../style-design.md)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本 |
