# 前端架构

> Vue 3 + TypeScript 前端架构：页面、零件、状态、主题与 Tauri 交互

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue | 3.x | 响应式框架，Composition API |
| TypeScript | 5.x | 类型安全 |
| Reka UI | 2.x | 无样式零件（键盘、焦点、读屏）；样子由自写 `Pn*` 组件给 |
| Vite | 5.x | 构建工具 |

---

## 组件架构

### 目录结构

页面在 `src/views/<页面>/`（首页 `home/`、图库 `gallery/`、链接健康 `health/`、图床 `hosts/`、设置 `settings/`，每页一个 `*View.vue`），外壳在 `src/shell/`，托盘原生菜单在 `src/tray/`（由外壳装上，见 [window-system-integration.md](../../flows/window-system-integration.md) 图 2），零件在 `src/components/pn/` 与 `src/components/biz/`。

```
src/views/settings/
├── SettingsView.vue          # 二级栏 + 标题行 + 滚动区 + 刷新横幅
├── settingsGroups.ts         # 7 组与每一行的表（命令面板的设置项也从这里生成）
├── useSettingsConfig.ts      # 设置页写配置的唯一入口（读最新 → 只改这一项 → 保存）
├── settingsEffects.ts        # 要先改系统的几项（开机自启、关闭到托盘、恢复默认）
├── GeneralGroup.vue … AboutGroup.vue   # 每组一个组件
└── useCloudSync.ts / useShortcutRecorder.ts / useEditorCards.ts   # 各组的状态

src/components/
├── login/LoginPanel.vue      # Cookie 登录小窗准备页（P16）
├── common/ThumbnailImage.vue # 缩略图组件
└── dialogs/                  # 对话框
    ├── BackupPasswordDialog.vue   # D01–D05（PnDialog）
    └── CompressionPreviewDialog.vue
```

### 组件命名规范

| 类型 | 命名模式 | 示例 |
|------|---------|------|
| 视图组件 | `*View.vue` | `HomeView.vue` |
| 面板组件 | `*Panel.vue` | `LoginPanel.vue` |
| 对话框 | `*Dialog.vue` | `PortDialog.vue` |
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
├── backup-sync/          # 备份与同步（ConfigSync / HistorySync / backupFiles / backupPassword / backupSyncUtils；界面状态在 views/settings/useCloudSync）
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
  totalCount,            // Ref<number> - 记录总数（stats 缓存）
  favoriteSet,           // Readonly<Ref<Set<string>>> - 收藏 ID 集合
  favoriteCount,         // Ref<number>
  isLoading,             // Ref<boolean>
  loadStats,             // (forceReload?) => Promise<void> 仅查 COUNT + favoriteIdList + 各图床计数
  clearHistory,          // () => Promise<void>
  removeRecords,         // (ids) => Promise<HistoryItem[]> 不确认直接删，返回删掉的完整记录供撤销
  restoreRecords,        // (items) => Promise<void> 撤销「移除记录」：原样插回
  bulkExportJSON,        // (ids) => Promise<void>
  loadTimePeriodStats,   // () => Promise<TimePeriodStats[]>
  toggleFavorite,        // (id) => Promise<boolean>
  batchSetFavorite,      // (ids, favorited) => Promise<void>
} = useHistoryManager();
```

> 图库的网格（`useTimelineDayPagination`，按天）与列表（`historyDB.getListPage`，按页）各自取记录，收藏是其中一个筛选条件；模块不维护全量 `imageMetas`。
> 收藏操作的对外 API 不变；写入数据库时会同步维护 `favoriteUpdatedAt` / `favoriteUpdatedBy`，供多设备合并时独立裁决收藏状态。

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

## 主题与样式

- 根元素 `data-theme="light|dark"`（`src/theme/ThemeManager.ts`，经 `useThemeManager()` 使用）与 `data-platform="windows|macos|linux"`（`src/utils/platform.ts`）。
- 令牌在 `src/styles/tokens.css`（设计稿导出）与 `tokens-extra.css`（具名补充），全局基础样式在 `pn-base.css`、菜单在 `pn-menu.css`，由 `src/main.ts` 引入。
- 组件只写 `var(--pn-*)`，不写颜色、字号、间距等数值；`npm run lint` 会拦。

```css
/* ✅ */
.card { background: var(--pn-surface); color: var(--pn-text1); border-radius: var(--pn-radius-card); }
/* ❌ */
.card { background: #f5f7fa; color: #171717; border-radius: 16px; }
```

详见 [docs/design/tokens.md](../../design/tokens.md) 与 [themes.md](../../design/themes.md)。

---

## 路由与导航

外壳在 `src/shell/`（`AppShell.vue` = 侧栏 / 窄窗口图标栏 + 主栏），页面切换用 vue-router 内存模式（`src/router.ts`）。

| 路径 | 页面 | 说明 |
|------|------|------|
| `/home` | 快传 | 默认页 |
| `/gallery` | 图库 | |
| `/health` | 链接健康 | |
| `/hosts` | 图床 | 从设置里搬出来的独立页 |
| `/settings` | 设置 | |

托盘与应用内各处仍发 `navigate-to` 事件（旧的视图名 `upload` / `history` / `link-check` / `settings`），由 `src/shell/navigatePayload.ts` 翻译成路径、`src/shell/useAppNavigation.ts` 执行跳转。界面设计包与各页做法见 `docs/design/redesign/README.md`。

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
- [设计规范](../../design/)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本 |
