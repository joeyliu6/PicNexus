# Composables API

> Vue Composables API 文档

---

## 概览

项目使用 Composables 模式管理状态，每个 Composable 负责特定功能域。

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
├── useVirtualTimeline.ts # 虚拟滚动
└── useAnalytics.ts       # 分析统计
```

---

## useConfig

配置管理，处理加载、保存和服务连接测试。

### 导出

```typescript
function useConfig(): {
  // 状态
  config: Ref<UserConfig>;
  isLoading: Ref<boolean>;
  isSaving: Ref<boolean>;

  // 方法
  loadConfig(): Promise<void>;
  saveConfig(newConfig: UserConfig, silent?: boolean): Promise<void>;

  // 连接测试
  testWeiboConnection(cookie: string): Promise<ConnectionTestResult>;
  testR2Connection(r2Config: R2Config): Promise<ConnectionTestResult>;
  testWebDAVConnection(webdavConfig: WebDAVConfig): Promise<ConnectionTestResult>;
  testZhihuConnection(cookie: string): Promise<ConnectionTestResult>;
  testNowcoderConnection(cookie: string): Promise<ConnectionTestResult>;
  testNamiConnection(cookie: string): Promise<ConnectionTestResult>;
  testBilibiliConnection(cookie: string): Promise<ConnectionTestResult>;

  // Cookie 获取
  openCookieWebView(serviceId: ServiceType): void;
  setupCookieListener(onCookieUpdate: (cookie: string) => void): () => void;

  // 工具
  getActivePrefix(linkPrefixConfig: LinkPrefixConfig): string | null;
}
```

### 使用示例

```typescript
const { config, loadConfig, saveConfig, testWeiboConnection } = useConfig();

// 加载配置
await loadConfig();

// 读取配置
console.log(config.value.weibo?.cookie);

// 保存配置
await saveConfig({
  ...config.value,
  weibo: { cookie: 'new_cookie' }
});

// 测试连接
const result = await testWeiboConnection('cookie_string');
if (result.success) {
  console.log('连接成功:', result.username);
}
```

---

## useHistory

历史记录管理，与 SQLite 数据库交互。

### 导出

```typescript
function useHistory(): {
  // 状态
  imageMetas: ShallowRef<ImageMeta[]>;
  isLoading: Ref<boolean>;

  // 加载
  loadHistory(forceReload?: boolean): Promise<void>;
  loadPageByNumber(page: number, pageSize: number, serviceFilter?: ServiceType): Promise<PageResult>;
  loadTimePeriodStats(): Promise<TimePeriodStats>;

  // 搜索
  searchHistory(keyword: string, options?: SearchOptions): Promise<ImageMeta[]>;

  // 操作
  deleteHistoryItem(itemId: string): Promise<void>;
  clearHistory(): Promise<void>;

  // 批量操作
  bulkCopyLinks(selectedIds: string[]): Promise<void>;
  bulkExportJSON(selectedIds: string[]): Promise<void>;
  bulkDeleteRecords(selectedIds: string[]): Promise<void>;

  // 导航
  jumpToMonth(year: number, month: number): Promise<void>;

  // 导出
  exportToJson(): Promise<void>;
}
```

### 使用示例

```typescript
const { imageMetas, loadHistory, searchHistory, deleteHistoryItem } = useHistory();

// 加载历史
await loadHistory();

// 遍历历史记录
imageMetas.value.forEach(meta => {
  console.log(meta.fileName, meta.primaryUrl);
});

// 搜索
const results = await searchHistory('screenshot', { limit: 10 });

// 删除
await deleteHistoryItem('item_id_123');
```

---

## useUpload

上传流程管理，编排多服务上传。

### 导出

```typescript
function useUpload(): {
  // 状态
  selectedServices: Ref<ServiceType[]>;
  availableServices: Ref<ServiceType[]>;
  serviceConfigStatus: Record<ServiceType, boolean>;
  isUploading: Ref<boolean>;
  activePrefix: Ref<string | null>;

  // 文件选择
  selectFiles(): Promise<void>;

  // 上传
  handleFilesUpload(filePaths: string[]): Promise<void>;

  // 服务管理
  loadServiceButtonStates(): Promise<void>;
  toggleServiceSelection(serviceId: ServiceType): void;

  // 历史保存
  saveHistoryItem(
    filePath: string,
    uploadResult: MultiUploadResult,
    customId?: string,
    liveResults?: Map<ServiceType, UploadResult>
  ): Promise<void>;

  // 监听
  setupConfigListener(): () => void;
}
```

### 使用示例

```typescript
const {
  selectedServices,
  isUploading,
  selectFiles,
  handleFilesUpload,
  toggleServiceSelection
} = useUpload();

// 切换服务选择
toggleServiceSelection('r2');

// 打开文件选择对话框
await selectFiles();

// 或直接上传文件
await handleFilesUpload(['/path/to/image.png']);

// 检查上传状态
if (isUploading.value) {
  console.log('正在上传...');
}
```

---

## useThumbCache

缩略图缓存管理。

### 导出

```typescript
function useThumbCache(): {
  // 获取缩略图
  getThumb(imagePath: string): Promise<string>;

  // 预加载
  preloadThumbs(imagePaths: string[]): Promise<void>;

  // 清理
  clearCache(): Promise<void>;

  // 统计
  getCacheStats(): Promise<{ count: number; size: number }>;
}
```

### 使用示例

```typescript
const { getThumb, preloadThumbs } = useThumbCache();

// 获取单个缩略图
const thumbUrl = await getThumb('/path/to/image.png');

// 预加载多个
await preloadThumbs(imagePaths.slice(0, 20));
```

---

## useToast

Toast 通知管理。

### 导出

```typescript
function useToast(): {
  showToast(message: string, type?: 'success' | 'error' | 'warn' | 'info'): void;
  showSuccess(message: string): void;
  showError(message: string): void;
  showWarn(message: string): void;
  showInfo(message: string): void;
}
```

### 使用示例

```typescript
const { showSuccess, showError } = useToast();

try {
  await doSomething();
  showSuccess('操作成功');
} catch (error) {
  showError('操作失败: ' + error.message);
}
```

---

## useTheme

主题切换管理。

### 导出

```typescript
function useTheme(): {
  currentTheme: Ref<'dark' | 'light'>;
  isDark: ComputedRef<boolean>;
  toggleTheme(): void;
  setTheme(theme: 'dark' | 'light'): void;
}
```

### 使用示例

```typescript
const { currentTheme, isDark, toggleTheme } = useTheme();

// 检查当前主题
if (isDark.value) {
  console.log('当前是深色模式');
}

// 切换主题
toggleTheme();
```

---

## useWebDAVSync

WebDAV 同步管理。

### 导出

```typescript
function useWebDAVSync(): {
  // 状态
  isSyncing: Ref<boolean>;
  lastSyncTime: Ref<number | null>;

  // 同步操作
  sync(): Promise<SyncResult>;
  pull(): Promise<PullResult>;
  push(): Promise<PushResult>;

  // 配置
  testConnection(config: WebDAVConfig): Promise<ConnectionTestResult>;
}
```

---

## useClipboardImage

剪贴板图片处理。

### 导出

```typescript
function useClipboardImage(): {
  hasImage(): Promise<boolean>;
  readImage(): Promise<string | null>;  // 返回临时文件路径
  pasteAndUpload(): Promise<void>;
}
```

### 使用示例

```typescript
const { hasImage, pasteAndUpload } = useClipboardImage();

// 检查剪贴板
if (await hasImage()) {
  await pasteAndUpload();
}
```

---

## useConfirm

确认对话框。

### 导出

```typescript
function useConfirm(): {
  confirm(options: ConfirmOptions): Promise<boolean>;
  confirmDelete(itemName: string): Promise<boolean>;
  confirmClear(): Promise<boolean>;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'danger' | 'warning' | 'info';
}
```

### 使用示例

```typescript
const { confirm, confirmDelete } = useConfirm();

// 自定义确认
const confirmed = await confirm({
  title: '确认操作',
  message: '确定要执行此操作吗？',
  type: 'warning'
});

// 删除确认
if (await confirmDelete('图片')) {
  await deleteItem();
}
```

---

## useQueueState

上传队列状态管理。

### 导出

```typescript
function useQueueState(): {
  queueItems: Ref<QueueItem[]>;
  addItem(item: QueueItem): void;
  updateProgress(id: string, progress: number, serviceId?: ServiceType): void;
  markComplete(id: string, result: UploadResult): void;
  markFailed(id: string, error: string): void;
  removeItem(id: string): void;
  clearQueue(): void;
}

interface QueueItem {
  id: string;
  fileName: string;
  filePath: string;
  status: 'pending' | 'uploading' | 'complete' | 'failed';
  progress: number;
  serviceProgress: Record<ServiceType, number>;
  result?: UploadResult;
  error?: string;
}
```

---

## useVirtualTimeline

虚拟滚动时间线。

### 导出

```typescript
function useVirtualTimeline(
  items: Ref<TimelineItem[]>,
  itemHeight: number
): {
  containerRef: Ref<HTMLElement | null>;
  visibleItems: ComputedRef<TimelineItem[]>;
  totalHeight: ComputedRef<number>;
  offsetY: ComputedRef<number>;
  scrollTo(index: number): void;
  scrollToMonth(year: number, month: number): void;
}
```

---

## 通用模式

### 单例共享

Composables 使用单例模式共享状态：

```typescript
// 内部实现
let sharedInstance: ReturnType<typeof createState> | null = null;

export function useXxx() {
  if (!sharedInstance) {
    sharedInstance = createState();
  }
  return sharedInstance;
}
```

### 组件内使用

```vue
<script setup lang="ts">
import { useConfig, useHistory, useUpload } from '@/composables';

const { config } = useConfig();
const { imageMetas } = useHistory();
const { isUploading } = useUpload();
</script>
```

---

## 相关文档

- [前端架构](../architecture/frontend.md)
- [数据流](../architecture/data-flow.md)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本 |
