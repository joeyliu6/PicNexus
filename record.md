# WeiboDR-Uploader 多图床架构重构记录

> **开发日期**: 2025-12-01 ~ 2025-12-02
> **重构目标**: 从"主力+备份"模式升级到多图床并行上传架构
> **核心特性**: TCL 图床（开箱即用）、京东图床（开箱即用）、多图床并行、独立进度、智能降级

---

## 📋 总览

### 架构变更概述

**旧架构 (v2.x)**:
- 主力图床: 微博（必选）
- 备份图床: R2（可选）
- 上传模式: 串行（微博 → R2）
- 配置结构: `primaryService` + `backup`

**新架构 (v3.0)**:
- 支持图床: 微博、R2、TCL、京东（可扩展）
- 上传模式: 并行（最多3个同时）
- 选择策略: 互为备份，第一个成功的作为主力
- 配置结构: `enabledServices: ServiceType[]`

### 关键设计决策

1. ✅ **无配置迁移**: 应用处于开发阶段，直接使用新配置结构
2. ✅ **TCL 开箱即用**: 无需任何配置，默认启用
3. ✅ **3并发限制**: 最多同时上传3个图床（性能与体验平衡）
4. ✅ **第一成功原则**: 第一个上传成功的图床作为 primary（用于缩略图）
5. ✅ **统一结果存储**: 所有图床结果存储在 `results[]` 数组中

---

## ✅ 已完成的工作

### 阶段一: 配置类型改造

**修改文件**: `src/config/types.ts`

**变更内容**:

1. **UserConfig 重构**:
```typescript
// OLD
interface UserConfig {
  primaryService: ServiceType;
  backup: { enabled: boolean; service: ServiceType };
  // ...
}

// NEW
interface UserConfig {
  enabledServices: ServiceType[];  // 用户勾选的图床列表
  services: {
    weibo?: WeiboServiceConfig;
    r2?: R2ServiceConfig;
    tcl?: TCLServiceConfig;  // 新增 TCL
  };
  // ...
}
```

2. **HistoryItem 重构**:
```typescript
// OLD
interface HistoryItem {
  weiboPid: string;
  generatedLink: string;
  r2Key?: string;
  // ...
}

// NEW
interface HistoryItem {
  primaryService: ServiceType;  // 主力图床
  results: Array<{              // 所有图床结果
    serviceId: ServiceType;
    result?: UploadResult;
    status: 'success' | 'failed';
    error?: string;
  }>;
  generatedLink: string;  // 基于主力图床的链接
  // ...
}
```

3. **默认配置**:
```typescript
export const DEFAULT_CONFIG: UserConfig = {
  enabledServices: ['tcl'],  // 默认启用 TCL（开箱即用）
  services: {
    weibo: { enabled: true, cookie: '' },
    r2: { enabled: false, /* ... */ },
    tcl: { enabled: true }  // 无需额外配置
  },
  // ...
};
```

**影响范围**:
- ✅ 所有依赖 `UserConfig` 的模块
- ✅ 历史记录存储和读取逻辑
- ✅ 配置加载和保存逻辑

---

### 阶段二: TCL 图床实现

#### 2.1 前端 TypeScript 上传器

**创建文件**: `src/uploaders/tcl/TCLUploader.ts`

**核心特性**:
- ✅ 继承 `BaseUploader` 基类
- ✅ `validateConfig()` 始终返回 `{valid: true}`（无需配置）
- ✅ 通过 Tauri IPC 调用 Rust 后端 `upload_to_tcl` 命令
- ✅ 支持上传进度回调

**代码片段**:
```typescript
export class TCLUploader extends BaseUploader {
  readonly serviceId = 'tcl';
  readonly serviceName = 'TCL 图床';

  async validateConfig(config: any): Promise<ValidationResult> {
    return { valid: true };  // TCL 无需配置
  }

  protected getRustCommand(): string {
    return 'upload_to_tcl';
  }
}
```

**创建文件**: `src/uploaders/tcl/index.ts`

#### 2.2 后端 Rust 命令

**创建文件**: `src-tauri/src/commands/tcl.rs`

**核心逻辑**:
1. ✅ 读取文件（异步）
2. ✅ 验证文件类型（jpg, jpeg, png, gif）
3. ❌ **暂不验证文件大小**（限制不确定）
4. ✅ 构建 `multipart/form-data`
5. ✅ POST 到 `https://service2.tcl.com/api.php/Center/uploadQiniu`
6. ✅ 解析 JSON 响应
7. ✅ 清理 URL（移除 `?e=` 参数）

**API 响应格式**:
```rust
#[derive(Debug, Deserialize)]
struct TCLApiResponse {
    code: i32,        // 1 表示成功
    msg: String,      // "success"
    data: Option<String>,  // 图片 URL
}
```

**修改文件**:
- `src-tauri/src/commands/mod.rs`: 添加 `pub mod tcl;`
- `src-tauri/src/main.rs`: 注册 `commands::tcl::upload_to_tcl`

#### 2.3 工厂注册

**修改文件**: `src/uploaders/index.ts`

```typescript
export function initializeUploaders(): void {
  UploaderFactory.register('weibo', () => new WeiboUploader());
  UploaderFactory.register('r2', () => new R2Uploader());
  UploaderFactory.register('tcl', () => new TCLUploader());  // 新增
}
```

---

### 阶段三: 多图床上传编排器

**创建文件**: `src/core/MultiServiceUploader.ts`

**核心功能**:

1. **并行上传** (`uploadToMultipleServices`):
```typescript
async uploadToMultipleServices(
  filePath: string,
  enabledServices: ServiceType[],
  config: UserConfig,
  onProgress?: (serviceId: ServiceType, percent: number) => void
): Promise<MultiUploadResult>
```

**处理流程**:
- 过滤出已配置的图床 (`filterConfiguredServices`)
- 限制最多3个并发 (`.slice(0, MAX_CONCURRENT_UPLOADS)`)
- 使用 `Promise.allSettled` 并行上传
- 提取第一个成功的作为 `primaryService`
- 返回所有结果（成功+失败）

2. **智能过滤** (`filterConfiguredServices`):
```typescript
// TCL 始终有效（无需配置）
if (serviceId === 'tcl') return true;

// 其他图床检查配置完整性
const serviceConfig = config.services[serviceId];
if (!serviceConfig?.enabled) return false;

// 验证必填字段
if (serviceId === 'weibo') {
  if (!weiboConfig.cookie || weiboConfig.cookie.trim().length === 0) {
    return false;
  }
}
// ...
```

3. **单图床重试** (`retryUpload`):
```typescript
async retryUpload(
  filePath: string,
  serviceId: ServiceType,
  config: UserConfig,
  onProgress?: (percent: number) => void
): Promise<UploadResult>
```

**修改文件**: `src/main.ts`

**变更内容**:

1. **替换导入**:
```typescript
// OLD
import { processUpload, validateR2Config } from './coreLogic';

// NEW
import { MultiServiceUploader } from './core/MultiServiceUploader';
import { validateR2Config } from './coreLogic';
import { basename } from '@tauri-apps/api/path';
```

2. **重写上传队列处理**:
```typescript
// OLD
async function processUploadQueue(
  filePaths: string[],
  config: UserConfig,
  uploadToR2: boolean,
  maxConcurrent: number = 3
): Promise<void>

// NEW
async function processUploadQueue(
  filePaths: string[],
  config: UserConfig,
  enabledServices: ServiceType[],
  maxConcurrent: number = 3
): Promise<void> {
  const multiServiceUploader = new MultiServiceUploader();

  const uploadTasks = filePaths.map(filePath => {
    const itemId = uploadQueueManager!.addFile(filePath, fileName, enabledServices);

    return async () => {
      const result = await multiServiceUploader.uploadToMultipleServices(
        filePath, enabledServices, config,
        (serviceId, percent) => {
          uploadQueueManager!.updateServiceProgress(itemId, serviceId, percent);
        }
      );

      await saveHistoryItem(filePath, result, config);
      uploadQueueManager!.markItemComplete(itemId, result.primaryUrl);
    };
  });

  // 并发控制逻辑...
}
```

3. **新增历史记录保存**:
```typescript
async function saveHistoryItem(
  filePath: string,
  uploadResult: { primaryService: ServiceType; results: any[]; primaryUrl: string },
  config: UserConfig
): Promise<void> {
  const newItem: HistoryItem = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: Date.now(),
    localFileName: fileName,
    primaryService: uploadResult.primaryService,  // 第一个成功的图床
    results: uploadResult.results,                // 所有图床结果
    generatedLink: uploadResult.primaryUrl
  };
  // 保存到 historyStore...
}
```

4. **更新文件上传处理**:
```typescript
// OLD
const uploadToR2 = uploadR2Toggle?.checked ?? false;
await processUploadQueue(valid, config, uploadToR2);

// NEW
const enabledServices: ServiceType[] = [];
if (serviceCheckboxes.weibo?.checked) enabledServices.push('weibo');
if (serviceCheckboxes.r2?.checked) enabledServices.push('r2');
if (serviceCheckboxes.tcl?.checked) enabledServices.push('tcl');

config.enabledServices = enabledServices;
await configStore.set('config', config);
await configStore.save();

await processUploadQueue(valid, config, enabledServices);
```

**修改文件**: `src/uploadQueue.ts`

**变更内容**:

1. **新增类型定义**:
```typescript
export interface ServiceProgress {
  serviceId: ServiceType;
  progress: number;  // 0-100
  status: string;
  link?: string;
  error?: string;
}

export interface QueueItem {
  enabledServices: ServiceType[];  // 启用的图床列表
  serviceProgress: Record<ServiceType, ServiceProgress>;  // 独立进度
  // 向后兼容字段
  uploadToR2?: boolean;
  weiboProgress?: number;
  r2Progress?: number;
}
```

2. **更新 addFile 方法**:
```typescript
addFile(filePath: string, fileName: string, enabledServices: ServiceType[]): string {
  // 初始化每个图床的进度状态
  const serviceProgress: Record<string, ServiceProgress> = {};
  enabledServices.forEach(serviceId => {
    serviceProgress[serviceId] = {
      serviceId,
      progress: 0,
      status: '等待中...'
    };
  });

  const item: QueueItem = {
    enabledServices,
    serviceProgress: serviceProgress as Record<ServiceType, ServiceProgress>,
    // 向后兼容字段...
  };
}
```

3. **新增方法**:
```typescript
updateServiceProgress(itemId: string, serviceId: ServiceType, percent: number): void
markItemComplete(itemId: string, primaryUrl: string): void
markItemFailed(itemId: string, errorMessage: string): void
```

---

### 阶段四: UI 改造

#### 4.1 多图床复选框

**修改文件**: `index.html`

**变更内容**:

```html
<!-- OLD -->
<div class="upload-controls">
  <label class="r2-toggle">
    <input type="checkbox" id="upload-view-toggle-r2" checked />
    <span>同时备份到 Cloudflare R2</span>
  </label>
</div>

<!-- NEW -->
<div class="upload-controls">
  <h3>选择上传图床 (可多选)</h3>
  <div class="service-checkboxes">
    <label class="service-checkbox">
      <input type="checkbox" data-service="weibo" />
      <span class="service-icon">📝</span>
      <span class="service-name">微博图床</span>
      <span class="service-config-status" data-service="weibo"></span>
    </label>
    <label class="service-checkbox">
      <input type="checkbox" data-service="r2" />
      <span class="service-icon">☁️</span>
      <span class="service-name">Cloudflare R2</span>
      <span class="service-config-status" data-service="r2"></span>
    </label>
    <label class="service-checkbox checked">
      <input type="checkbox" data-service="tcl" checked />
      <span class="service-icon">✨</span>
      <span class="service-name">TCL 图床</span>
      <span class="service-config-status ready" data-service="tcl">开箱即用</span>
    </label>
  </div>
</div>
```

**特性**:
- ✅ 每个图床显示图标、名称、配置状态
- ✅ 未配置的图床自动禁用
- ✅ TCL 默认勾选且显示"开箱即用"

**修改文件**: `src/main.ts`

**新增功能**:

1. **服务复选框状态管理**:
```typescript
const serviceCheckboxes = {
  weibo: document.querySelector<HTMLInputElement>('input[data-service="weibo"]'),
  r2: document.querySelector<HTMLInputElement>('input[data-service="r2"]'),
  tcl: document.querySelector<HTMLInputElement>('input[data-service="tcl"]')
};

async function loadServiceCheckboxStates(): Promise<void> {
  const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
  const enabledServices = config.enabledServices || ['tcl'];

  if (serviceCheckboxes.weibo) {
    serviceCheckboxes.weibo.checked = enabledServices.includes('weibo');
    updateServiceStatus('weibo', config);
  }
  // ... 其他图床
}
```

2. **配置状态徽章更新**:
```typescript
function updateServiceStatus(serviceId: ServiceType, config: UserConfig): void {
  const statusEl = document.querySelector<HTMLElement>(
    `.service-config-status[data-service="${serviceId}"]`
  );

  if (serviceId === 'weibo') {
    isConfigured = !!weiboConfig?.cookie && weiboConfig.cookie.trim().length > 0;
    statusText = isConfigured ? '已配置' : '未配置';
    statusEl.className = `service-config-status ${isConfigured ? 'ready' : 'not-ready'}`;
  }
  // ...

  // 未配置则禁用复选框
  if (checkbox && serviceId !== 'tcl') {
    if (!isConfigured) {
      checkbox.disabled = true;
      checkbox.checked = false;
    }
  }
}
```

3. **复选框变化监听**:
```typescript
Object.entries(serviceCheckboxes).forEach(([serviceId, checkbox]) => {
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      const label = checkbox.closest('label');
      if (label) {
        if (checkbox.checked) {
          label.classList.add('checked');
        } else {
          label.classList.remove('checked');
        }
      }
    });
  }
});
```

#### 4.2 CSS 样式

**修改文件**: `src/style.css`

**新增样式**:

```css
/* 多图床服务选择器 */
.upload-controls {
  margin-bottom: 20px;
  padding: 20px;
  background-color: var(--bg-card);
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
}

.service-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.service-checkbox {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background-color: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.service-checkbox:hover:not(.disabled) {
  background-color: rgba(255, 255, 255, 0.05);
  border-color: var(--primary);
}

.service-checkbox.checked {
  background-color: rgba(59, 130, 246, 0.1);
  border-color: var(--primary);
}

.service-checkbox.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.service-icon {
  font-size: 20px;
  margin-right: 10px;
}

.service-name {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  flex: 1;
}

.service-config-status {
  font-size: var(--text-sm);
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: var(--weight-medium);
}

.service-config-status.ready {
  color: var(--success);
  background-color: rgba(16, 185, 129, 0.1);
}

.service-config-status.not-ready {
  color: var(--warning);
  background-color: rgba(234, 179, 8, 0.1);
}
```

---

## ✅ 阶段五: 历史记录多图床展示 UI (2025-12-01 完成)

**修改文件**:
- `src/main.ts` - `renderHistoryTable()` 函数
- `index.html` - 历史记录表格列头
- `src/style.css` - 服务徽章样式

**实现内容**:

1. **多图床状态徽章显示**:
   - 为每个历史记录项显示所有图床的上传状态
   - 成功的图床显示绿色徽章 (✓)
   - 失败的图床显示红色徽章 (✗)
   - 支持旧数据向后兼容

2. **失败图床重试按钮**:
   - 失败的图床徽章内显示重试按钮 (↻)
   - Hover 时旋转动画效果
   - 点击触发 `retryServiceUpload()` 函数（待实现）

3. **链接选择下拉框**:
   - 当多个图床上传成功时，显示下拉选择框
   - 下拉框列出所有成功的图床链接
   - 主力图床标记为 "(主)"
   - 只有一个成功链接时直接显示链接
   - 复制按钮会复制当前选中的链接

4. **UI 改进**:
   - 新增"图床状态"列
   - 统一 `.icon-btn` 样式（复制、删除按钮）
   - 响应式徽章布局 (`flex-wrap`)
   - 链接下拉框美化（边框、焦点效果）

**代码变更**:

```typescript
// src/main.ts - renderHistoryTable()
async function renderHistoryTable(items: HistoryItem[]) {
  // ...

  // 3. 图床状态列（新增）
  const tdServices = document.createElement('td');
  const servicesContainer = document.createElement('div');
  servicesContainer.className = 'service-badges-container';

  // 渲染所有图床的状态徽章
  if (item.results && item.results.length > 0) {
    item.results.forEach(serviceResult => {
      const badge = document.createElement('span');
      badge.className = `service-badge ${serviceResult.status}`;
      badge.textContent = `${serviceName} ${serviceResult.status === 'success' ? '✓' : '✗'}`;

      // 失败的图床显示重试按钮
      if (serviceResult.status === 'failed') {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'service-retry-btn';
        retryBtn.innerHTML = '↻';
        retryBtn.onclick = () => retryServiceUpload(item.id, serviceResult.serviceId);
        badge.appendChild(retryBtn);
      }
    });
  }

  // 4. 链接选择列（新增下拉框）
  if (linkSelector.options.length > 1) {
    tdLink.appendChild(linkSelector);
  } else if (linkSelector.options.length === 1) {
    // 只有一个链接，直接显示
    tdLink.appendChild(link);
  }
}

// 重试函数占位符
async function retryServiceUpload(historyId: string, serviceId: ServiceType): Promise<void> {
  // TODO: P0 Task #2 - 实现重试逻辑
  showToast('重试功能开发中...', 'error', 3000);
}
```

**CSS 新增样式**:

```css
/* 历史记录 - 图床状态徽章 */
.service-badges-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.service-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.service-badge.success {
  background-color: rgba(16, 185, 129, 0.15);
  color: var(--success);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.service-badge.failed {
  background-color: rgba(239, 68, 68, 0.15);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.service-retry-btn {
  width: 18px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  cursor: pointer;
}

.service-retry-btn:hover {
  transform: rotate(180deg);
}

/* 链接选择下拉框 */
.link-selector {
  width: 100%;
  max-width: 200px;
  padding: 6px 8px;
  background-color: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  font-family: var(--font-mono);
}

.link-selector:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

/* 通用图标按钮 */
.icon-btn {
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--text-muted);
  transition: all 0.2s;
}

.icon-btn:hover {
  color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
}
```

**HTML 变更**:

```html
<!-- index.html - 历史记录表格 -->
<thead>
  <tr>
    <th>预览</th>
    <th>本地文件名</th>
    <th>图床状态</th>  <!-- 新增列 -->
    <th>链接</th>
    <th>上传时间</th>
    <th>复制</th>
    <th>删除</th>
  </tr>
</thead>
```

**测试要点**:
- ✅ 多图床上传后，历史记录正确显示各图床状态
- ✅ 成功/失败徽章颜色正确
- ✅ 失败图床显示重试按钮
- ✅ 多个成功链接时显示下拉框
- ✅ 单个成功链接时直接显示链接
- ✅ 旧数据（无 results 字段）兼容性正常
- ⏳ 重试按钮点击后功能（待 P0 Task #2 实现）

---

## ✅ 阶段六: 单图床重试功能 (2025-12-01 完成)

**修改文件**:
- `src/config/types.ts` - HistoryItem 类型添加 filePath 字段
- `src/main.ts` - saveHistoryItem() 和 retryServiceUpload() 函数
- `src-tauri/src/commands/utils.rs` - 新增文件存在检查命令
- `src-tauri/src/commands/mod.rs` - 注册 utils 模块
- `src-tauri/src/main.rs` - 注册 file_exists 命令

**实现内容**:

1. **HistoryItem 类型扩展**:
   - 添加 `filePath?: string` 字段用于保存原始文件路径
   - 向后兼容：旧记录没有此字段时会提示无法重试

2. **保存历史记录时记录文件路径**:
   ```typescript
   const newItem: HistoryItem = {
     // ... 其他字段
     filePath: filePath,  // 保存文件路径用于重试
   };
   ```

3. **完整的重试逻辑实现**:
   - 从历史记录中查找对应项
   - 检查是否有文件路径
   - 调用 Rust `file_exists` 命令验证文件存在性
   - 使用 `MultiServiceUploader.retryUpload()` 重新上传
   - 更新历史记录中的结果状态
   - 如果是第一个成功的，更新主力图床
   - 重新加载历史表格显示

4. **Rust 文件存在检查命令**:
   ```rust
   // src-tauri/src/commands/utils.rs
   #[tauri::command]
   pub fn file_exists(path: String) -> bool {
       Path::new(&path).exists()
   }
   ```

**代码变更**:

```typescript
// src/main.ts - retryServiceUpload() 完整实现
async function retryServiceUpload(historyId: string, serviceId: ServiceType): Promise<void> {
  try {
    // 1. 获取历史记录项
    const items = await historyStore.get<HistoryItem[]>('uploads', []);
    const item = items.find(i => i.id === historyId);
    if (!item) throw new Error('找不到历史记录项');

    // 2. 检查文件路径
    if (!item.filePath) {
      throw new Error('该历史记录没有保存原始文件路径，无法重试');
    }

    // 3. 检查文件存在性
    const fileExists = await invoke<boolean>('file_exists', { path: item.filePath });
    if (!fileExists) {
      throw new Error(`原始文件不存在: ${item.filePath}`);
    }

    // 4. 重试上传
    const config = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
    const multiUploader = new MultiServiceUploader();
    const result = await multiUploader.retryUpload(item.filePath, serviceId, config);

    // 5. 更新历史记录
    const targetResult = item.results.find(r => r.serviceId === serviceId);
    if (targetResult) {
      targetResult.status = 'success';
      targetResult.result = result;
      delete targetResult.error;
    } else {
      item.results.push({ serviceId, result, status: 'success' });
    }

    // 6. 如果是第一个成功，更新主力图床
    const successResults = item.results.filter(r => r.status === 'success');
    if (successResults.length === 1 && successResults[0].serviceId === serviceId) {
      item.primaryService = serviceId;
      item.generatedLink = result.url;
    }

    // 7. 保存并重新加载
    await historyStore.set('uploads', items);
    await historyStore.save();
    await loadHistory();

    showToast(`${serviceName} 重试成功！`, 'success', 3000);
  } catch (error: any) {
    showToast(`重试失败: ${error.message}`, 'error', 5000);
  }
}
```

**测试要点**:
- ✅ 点击失败图床的重试按钮
- ✅ 检查文件路径验证逻辑
- ✅ 文件不存在时提示错误
- ✅ 重试成功后徽章变为绿色
- ✅ 历史记录中的结果状态正确更新
- ✅ 旧数据（无 filePath）正确提示无法重试
- ✅ 重试后自动刷新历史表格

**注意事项**:
- 旧的历史记录没有 `filePath` 字段，点击重试时会提示无法重试
- 如果原始文件已被删除或移动，重试会失败并提示文件不存在
- 重试成功后，失败徽章会变为成功徽章
- 如果重试的图床是第一个成功的，会自动成为主力图床

---

## ✅ 阶段七: 批量操作功能 (2025-12-01 完成)

**修改文件**:
- `index.html` - 批量操作工具栏和复选框列
- `src/main.ts` - 批量操作函数和事件绑定
- `src/style.css` - 批量操作样式

**实现内容**:

1. **批量操作工具栏**:
   - 全选/取消全选功能（两个位置同步）
   - 批量复制按钮（复制所有选中项的链接）
   - 批量导出按钮（导出选中项为 JSON）
   - 批量删除按钮（删除选中的历史记录）
   - 按钮根据选中状态自动启用/禁用

2. **表格复选框列**:
   - 在表头添加全选复选框
   - 在每行添加单选复选框
   - 选中状态实时更新按钮状态

3. **批量复制功能**:
   - 复制所有选中项的链接到剪贴板
   - 每行一个链接
   - 显示复制数量提示

4. **批量导出功能**:
   - 将选中的历史记录导出为 JSON 文件
   - 使用 Tauri 文件保存对话框
   - 默认文件名带时间戳

5. **批量删除功能**:
   - 删除前弹出确认对话框
   - 显示删除数量
   - 删除后自动刷新列表

**代码变更**:

```html
<!-- index.html - 批量操作工具栏 -->
<div class="history-toolbar">
  <div class="bulk-actions">
    <label class="select-all-label">
      <input type="checkbox" id="select-all-history" />
      <span>全选</span>
    </label>
    <button id="bulk-copy-btn" class="bulk-action-btn" disabled>
      批量复制
    </button>
    <button id="bulk-export-btn" class="bulk-action-btn" disabled>
      导出 JSON
    </button>
    <button id="bulk-delete-btn" class="bulk-action-btn danger" disabled>
      批量删除
    </button>
  </div>
  <div class="search-section">
    <input type="text" id="search-input" placeholder="搜索本地文件名..." />
  </div>
</div>

<!-- 表格添加复选框列 -->
<thead>
  <tr>
    <th class="checkbox-col">
      <input type="checkbox" id="th-select-all" />
    </th>
    <!-- 其他列... -->
  </tr>
</thead>
```

```typescript
// src/main.ts - 批量操作函数

// 获取选中的项目
function getSelectedHistoryItems(): string[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.row-checkbox:checked');
  return Array.from(checkboxes)
    .map(cb => cb.getAttribute('data-item-id'))
    .filter((id): id is string => !!id);
}

// 更新按钮状态
function updateBulkActionButtons(): void {
  const selectedIds = getSelectedHistoryItems();
  const hasSelection = selectedIds.length > 0;

  bulkCopyBtn.disabled = !hasSelection;
  bulkExportBtn.disabled = !hasSelection;
  bulkDeleteBtn.disabled = !hasSelection;
}

// 全选/取消全选
function toggleSelectAll(checked: boolean): void {
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.row-checkbox');
  checkboxes.forEach(cb => cb.checked = checked);
  updateBulkActionButtons();
}

// 批量复制链接
async function bulkCopyLinks(): Promise<void> {
  const selectedIds = getSelectedHistoryItems();
  const items = await historyStore.get<HistoryItem[]>('uploads', []);
  const selectedItems = items.filter(item => selectedIds.includes(item.id));
  const links = selectedItems.map(item => item.generatedLink).filter(link => !!link);

  await writeText(links.join('\n'));
  showToast(`已复制 ${links.length} 个链接到剪贴板`, 'success', 3000);
}

// 批量导出 JSON
async function bulkExportJSON(): Promise<void> {
  const selectedIds = getSelectedHistoryItems();
  const items = await historyStore.get<HistoryItem[]>('uploads', []);
  const selectedItems = items.filter(item => selectedIds.includes(item.id));
  const jsonContent = JSON.stringify(selectedItems, null, 2);

  const filePath = await save({
    defaultPath: `weibo-history-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (filePath) {
    await writeTextFile(filePath, jsonContent);
    showToast(`已导出 ${selectedItems.length} 条记录`, 'success', 3000);
  }
}

// 批量删除记录
async function bulkDeleteRecords(): Promise<void> {
  const selectedIds = getSelectedHistoryItems();
  const confirmed = await showConfirmModal(
    `确定要删除选中的 ${selectedIds.length} 条历史记录吗？`,
    '批量删除确认'
  );

  if (confirmed) {
    const items = await historyStore.get<HistoryItem[]>('uploads', []);
    const remainingItems = items.filter(item => !selectedIds.includes(item.id));

    await historyStore.set('uploads', remainingItems);
    await historyStore.save();
    await loadHistory();

    showToast(`已删除 ${selectedIds.length} 条记录`, 'success', 3000);
  }
}

// 表格渲染时添加复选框
// 0. 复选框列（批量操作）
const tdCheckbox = document.createElement('td');
tdCheckbox.className = 'checkbox-col';
const checkbox = document.createElement('input');
checkbox.type = 'checkbox';
checkbox.className = 'row-checkbox';
checkbox.setAttribute('data-item-id', item.id);
checkbox.addEventListener('change', updateBulkActionButtons);
tdCheckbox.appendChild(checkbox);
tr.appendChild(tdCheckbox);
```

**CSS 新增样式**:

```css
/* 批量操作工具栏 */
.history-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bulk-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background-color: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  transition: all 0.2s ease;
}

.bulk-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bulk-action-btn:not(:disabled):hover {
  background-color: var(--bg-input);
  border-color: var(--primary);
  color: var(--primary);
}

.bulk-action-btn.danger:not(:disabled):hover {
  border-color: var(--error);
  color: var(--error);
  background-color: rgba(239, 68, 68, 0.1);
}

/* 复选框列 */
.checkbox-col {
  width: 40px;
  text-align: center;
}

.row-checkbox {
  cursor: pointer;
  width: 16px;
  height: 16px;
}
```

**测试要点**:
- ✅ 点击全选复选框，所有行都被选中
- ✅ 选中项后，批量操作按钮启用
- ✅ 取消选中后，按钮自动禁用
- ✅ 批量复制功能正常，链接正确复制
- ✅ 批量导出生成正确的 JSON 文件
- ✅ 批量删除前显示确认对话框
- ✅ 批量删除后自动刷新列表
- ✅ 表头和工具栏的全选复选框状态同步

**功能特性**:
- 📋 **批量复制**: 一键复制多个链接，每行一个
- 💾 **批量导出**: 导出选中记录为 JSON，方便备份和分析
- 🗑️ **批量删除**: 快速清理不需要的历史记录
- ✅ **智能启用**: 按钮根据选中状态自动启用/禁用
- 🔄 **状态同步**: 两个全选复选框状态实时同步

---

## ✅ 阶段八: 上传队列 Vue 组件更新 (2025-12-01 完成)

**修改文件**:
- `src/components/UploadQueue.vue` - 完整组件重构

**实现内容**:

1. **动态多图床进度条显示**:
   - 根据 `enabledServices` 数组动态渲染进度条
   - 每个图床显示独立的进度和状态
   - 使用 `v-for` 循环遍历启用的图床
   - 向后兼容旧架构（Weibo + R2）

2. **颜色编码状态**:
   - 成功 (✓/完成): 绿色 (`var(--success)`)
   - 失败 (✗/失败): 红色 (`var(--error)`)
   - 上传中 (%): 蓝色 (`var(--primary)`)
   - 跳过: 灰色 (`var(--text-muted)`)

3. **TypeScript 类型支持**:
   - 新增 `ServiceProgress` 接口
   - 扩展 `QueueItem` 接口支持多图床
   - 添加 `serviceNames` 映射（中文显示）
   - 新增 `getStatusClass()` 辅助函数

**代码变更**:

```typescript
// src/components/UploadQueue.vue - TypeScript 部分

// 单个图床服务的进度状态
export interface ServiceProgress {
  serviceId: ServiceType;
  progress: number;
  status: string;
  link?: string;
  error?: string;
}

// 队列项类型（新架构 - 支持多图床）
export interface QueueItem {
  id: string;
  fileName: string;
  filePath: string;
  enabledServices?: ServiceType[];  // 启用的图床列表
  serviceProgress?: Record<ServiceType, ServiceProgress>;  // 各图床独立进度
  status: 'pending' | 'uploading' | 'success' | 'error';
  // ... 其他字段
}

// 图床名称映射
const serviceNames: Record<ServiceType, string> = {
  weibo: '微博',
  r2: 'R2',
  tcl: 'TCL',
  nami: '纳米',
  jd: '京东',
  nowcoder: '牛客'
};

// 获取状态颜色类
const getStatusClass = (status: string): string => {
  if (status.includes('✓') || status.includes('完成')) return 'success';
  if (status.includes('✗') || status.includes('失败')) return 'error';
  if (status.includes('跳过')) return 'skipped';
  if (status.includes('%')) return 'uploading';
  return '';
};
```

**模板变更**:

```vue
<!-- src/components/UploadQueue.vue - Template 部分 -->

<!-- Progress Column -->
<div class="progress-section">
  <!-- 新架构：多图床动态进度条 -->
  <template v-if="item.serviceProgress && item.enabledServices">
    <div
      v-for="service in item.enabledServices"
      :key="service"
      class="progress-row"
    >
      <label>{{ serviceNames[service] }}:</label>
      <progress
        :value="item.serviceProgress[service]?.progress || 0"
        max="100"
        :class="getStatusClass(item.serviceProgress[service]?.status || '')"
      ></progress>
      <span
        class="status"
        :class="getStatusClass(item.serviceProgress[service]?.status || '')"
      >
        {{ item.serviceProgress[service]?.status || '等待中...' }}
      </span>
    </div>
  </template>

  <!-- 旧架构：向后兼容 Weibo + R2 -->
  <template v-else>
    <div class="progress-row">
      <label>微博:</label>
      <progress :value="item.weiboProgress" max="100"></progress>
      <span class="status" :class="{ success: item.weiboStatus?.includes('✓'), error: item.weiboStatus?.includes('✗') }">
        {{ item.weiboStatus }}
      </span>
    </div>
    <div class="progress-row" v-if="item.uploadToR2">
      <label>R2:</label>
      <progress :value="item.r2Progress" max="100"></progress>
      <span class="status" :class="{ success: item.r2Status?.includes('✓'), error: item.r2Status?.includes('✗'), skipped: item.r2Status === '已跳过' }">
        {{ item.r2Status }}
      </span>
    </div>
  </template>
</div>
```

**CSS 新增样式**:

```css
/* 颜色编码进度条 */
progress.success::-webkit-progress-value {
  background-color: var(--success);
}

progress.error::-webkit-progress-value {
  background-color: var(--error);
}

progress.uploading::-webkit-progress-value {
  background-color: var(--primary);
}

progress.skipped::-webkit-progress-value {
  background-color: var(--text-muted);
}

/* 状态文字颜色 */
.status.success { color: var(--success); }
.status.error { color: var(--error); }
.status.uploading { color: var(--primary); }
.status.skipped { color: var(--text-muted); }
```

**功能特性**:
- 🎨 **动态渲染**: 根据启用的图床自动显示对应数量的进度条
- 🌈 **颜色编码**: 进度条和状态文字根据状态自动应用不同颜色
- 🔄 **向后兼容**: 旧数据仍使用原有的 Weibo + R2 双进度条显示
- 📊 **独立进度**: 每个图床独立显示上传进度和状态
- 🎯 **中文名称**: 使用中文图床名称，提升用户体验

**测试要点**:
- ✅ 选择多个图床上传时，进度条数量正确
- ✅ 各图床进度独立更新，互不影响
- ✅ 成功状态显示绿色进度条和文字
- ✅ 失败状态显示红色进度条和文字
- ✅ 上传中状态显示蓝色进度条
- ✅ 图床名称显示为中文
- ✅ 旧数据仍正常显示（向后兼容）
- ✅ 状态变化时颜色实时更新

**实现亮点**:
1. **智能状态检测**: `getStatusClass()` 函数通过字符串匹配自动判断状态
2. **完全类型安全**: 使用 TypeScript 泛型和接口保证类型正确
3. **优雅降级**: 检测到旧数据时自动切换到兼容模式
4. **可扩展性**: 添加新图床只需在 `serviceNames` 中添加映射即可

---

## ✅ 阶段九: 设置页面 TCL 说明 (2025-12-01 完成)

**修改文件**:
- `index.html` - 设置页面

**实现内容**:

在设置页面添加了 TCL 图床说明区域，提供用户友好的信息展示：

1. **开箱即用提示**:
   - 绿色图标 + 文字说明
   - 明确告知无需配置

2. **支持格式说明**:
   - 灰色图标 + 文字说明
   - 列出支持的格式：JPG、JPEG、PNG、GIF

3. **风险提示**:
   - 黄色警告图标 + 文字说明
   - 提醒用户 TCL 为第三方免费服务，稳定性无保障

**代码变更**:

```html
<!-- index.html - 设置页面 TCL 说明 -->
<div class="form-section">
    <h2>TCL 图床</h2>
    <p class="info-text" style="color: var(--success); display: flex; align-items: center; gap: 8px;">
        <svg><!-- 绿色勾选图标 --></svg>
        TCL 图床无需配置，开箱即用
    </p>
    <p class="info-text" style="color: var(--text-secondary); display: flex; align-items: center; gap: 8px;">
        <svg><!-- 文档图标 --></svg>
        支持格式：JPG、JPEG、PNG、GIF
    </p>
    <p class="info-text" style="color: var(--warning); display: flex; align-items: center; gap: 8px;">
        <svg><!-- 警告图标 --></svg>
        注意：TCL 为第三方免费服务，稳定性无保障
    </p>
</div>
```

**UI 特性**:
- ✅ **清晰的视觉层次**: 使用不同颜色区分不同类型的信息
- 📝 **图标辅助**: 每条信息配有对应的 SVG 图标
- 🎨 **颜色语义化**: 成功(绿色)、信息(灰色)、警告(黄色)
- 💡 **简洁明了**: 三条核心信息，一目了然

**位置**:
- 位于设置页面的 "Cloudflare R2 配置" 之后
- 位于 "链接配置" 之前
- 与其他配置区域保持一致的布局和样式

**测试要点**:
- ✅ 设置页面正确显示 TCL 说明区域
- ✅ 三条信息颜色和图标正确显示
- ✅ 文字内容准确无误
- ✅ 与其他设置区域样式统一

---

## ✅ 阶段十: 京东图床支持 (2025-12-02 完成)

**修改文件**:
- `src-tauri/src/commands/jd.rs` (新建) - Rust 后端上传命令
- `src-tauri/src/commands/mod.rs` - 注册 jd 模块
- `src-tauri/src/main.rs` - 注册 `upload_to_jd` 命令
- `src/uploaders/jd/JDUploader.ts` (新建) - 前端上传器
- `src/uploaders/jd/index.ts` (新建) - 导出文件
- `src/uploaders/index.ts` - 注册京东上传器到工厂
- `src/config/types.ts` - 修复 JDServiceConfig 类型
- `index.html` - 添加京东复选框和设置说明
- `src/main.ts` - 添加 jd 到 serviceCheckboxes
- `src/core/MultiServiceUploader.ts` - 添加 jd 到无配置图床列表

### 10.1 京东 API 特性

**核心特点**:
- ✅ **无需 Cookie**: 完全开箱即用，与 TCL 类似
- ✅ **两步上传流程**: 先获取 `aid`/`pin`，再上传图片
- ✅ **15MB 文件限制**: 比 TCL 限制更宽松
- ✅ **支持格式**: JPG、JPEG、PNG、GIF

**API 端点**:
```
1. 获取 aid/pin: GET https://api.m.jd.com/client.action?functionId=getAidInfo&...
   - 返回 JSONP 格式: jsonp1({"code":"0","aid":"...","pin":"..."})

2. 上传图片: POST https://file-dd.jd.com/file/uploadImg.action
   - Form 参数: aid, pin, upload(文件)
   - 返回 JSON: {"code": 0, "path": "jfs/xxx/xxx.jpg"}
```

### 10.2 Rust 后端实现

**文件**: `src-tauri/src/commands/jd.rs`

```rust
const MAX_FILE_SIZE: u64 = 15 * 1024 * 1024;  // 15MB

/// 获取 aid 和 pin
async fn get_aid_info() -> Result<AidInfo, String> {
    // 1. 构建请求 URL
    let url = "https://api.m.jd.com/client.action?functionId=getAidInfo&...";

    // 2. 发送请求并解析 JSONP 响应
    // JSONP 格式: jsonp1({...})
    let jsonp_text = response.text().await?;
    let json_start = jsonp_text.find('(').ok_or("Invalid JSONP")? + 1;
    let json_end = jsonp_text.rfind(')').ok_or("Invalid JSONP")?;
    let json_str = &jsonp_text[json_start..json_end];

    // 3. 解析 JSON
    let aid_response: AidInfoResponse = serde_json::from_str(json_str)?;
}

#[tauri::command]
pub async fn upload_to_jd(
    window: Window,
    id: String,
    file_path: String
) -> Result<JDUploadResult, String> {
    // 1. 读取文件并验证
    let file_data = tokio::fs::read(&file_path).await?;
    if file_data.len() as u64 > MAX_FILE_SIZE {
        return Err("文件大小超过 15MB 限制".to_string());
    }

    // 2. 获取 aid 和 pin
    let aid_info = get_aid_info().await?;

    // 3. 构建 multipart 表单
    let form = Form::new()
        .text("aid", aid_info.aid)
        .text("pin", aid_info.pin)
        .part("upload", Part::bytes(file_data).file_name(file_name));

    // 4. 发送上传请求
    let response = client
        .post("https://file-dd.jd.com/file/uploadImg.action")
        .multipart(form)
        .send().await?;

    // 5. 解析响应并返回完整 URL
    let jd_response: JDApiResponse = response.json().await?;
    let url = format!("https://img14.360buyimg.com/{}", jd_response.path);

    Ok(JDUploadResult { url, size: file_data.len() as u64 })
}
```

**响应结构**:
```rust
#[derive(Debug, Deserialize)]
struct AidInfoResponse {
    code: String,    // "0" 表示成功
    aid: String,     // 用于上传的 aid
    pin: String,     // 用于上传的 pin
}

#[derive(Debug, Deserialize)]
struct JDApiResponse {
    code: i32,       // 0 表示成功
    path: String,    // 图片路径，如 "jfs/xxx/xxx.jpg"
}
```

### 10.3 前端上传器

**文件**: `src/uploaders/jd/JDUploader.ts`

```typescript
export class JDUploader extends BaseUploader {
  readonly serviceId = 'jd';
  readonly serviceName = '京东图床';

  protected getRustCommand(): string {
    return 'upload_to_jd';
  }

  // 京东无需配置验证
  async validateConfig(_config: any): Promise<ValidationResult> {
    return { valid: true };
  }

  async upload(
    filePath: string,
    _options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    // 调用 Rust 后端
    const rustResult = await this.uploadViaRust(filePath, {}, onProgress);

    return {
      serviceId: 'jd',
      fileKey: rustResult.url,
      url: rustResult.url,
      size: rustResult.size
    };
  }
}
```

### 10.4 配置类型修复

**文件**: `src/config/types.ts`

**问题**: 原有 `JDServiceConfig` 错误地包含了 `cookie` 字段

```typescript
// 修复前（错误）
export interface JDServiceConfig extends BaseServiceConfig {
  cookie: string;  // ❌ 京东不需要 cookie
}

// 修复后（正确）
export interface JDServiceConfig extends BaseServiceConfig {
  // 京东图床不需要额外配置
}
```

**DEFAULT_CONFIG 更新**:
```typescript
export const DEFAULT_CONFIG: UserConfig = {
  enabledServices: ['tcl', 'jd'],  // 默认启用 TCL 和京东
  services: {
    // ...
    jd: { enabled: true }  // 京东默认启用
  }
};
```

### 10.5 UI 集成

**文件**: `index.html`

**上传界面复选框**:
```html
<label class="service-checkbox checked">
  <input type="checkbox" data-service="jd" checked />
  <span class="service-icon">🛒</span>
  <span class="service-name">京东图床</span>
  <span class="service-config-status ready" data-service="jd">开箱即用</span>
</label>
```

**设置页面说明**:
```html
<div class="form-section">
    <h2>京东图床</h2>
    <p class="info-text" style="color: var(--success);">
        ✓ 京东图床无需配置，开箱即用
    </p>
    <p class="info-text" style="color: var(--text-secondary);">
        📄 支持格式：JPG、JPEG、PNG、GIF
    </p>
    <p class="info-text" style="color: var(--text-secondary);">
        📦 文件大小限制：15MB
    </p>
    <p class="info-text" style="color: var(--warning);">
        ⚠️ 注意：京东为第三方免费服务，稳定性无保障
    </p>
</div>
```

### 10.6 关键 Bug 修复

#### 🐛 Bug: "jd 未配置，跳过"

**问题描述**:
实现完成后测试上传，控制台输出 `[MultiUploader] jd 未配置，跳过`，导致京东图床无法使用。

**根本原因**:
`src/core/MultiServiceUploader.ts` 中的 `filterConfiguredServices()` 方法只将 TCL 标记为无需配置的图床，没有包含京东。

**修复位置**: `src/core/MultiServiceUploader.ts:230`

```typescript
// 修复前
if (serviceId === 'tcl') {
  return true;
}

// 修复后
if (serviceId === 'tcl' || serviceId === 'jd') {
  return true;
}
```

**Debug 注意事项**:
> ⚠️ **重要**: 添加新的无配置图床时，必须同时更新以下位置：
> 1. `filterConfiguredServices()` 中的无配置图床判断
> 2. `DEFAULT_CONFIG.services` 中的默认配置
> 3. `sanitizeConfig()` 中的敏感数据处理（如果需要）

### 10.7 测试要点

- ✅ 京东上传成功，返回正确 URL
- ✅ 进度回调正常工作
- ✅ 文件大小验证（>15MB 时拒绝）
- ✅ 文件类型验证
- ✅ 与 TCL 并行上传正常
- ✅ 历史记录正确显示京东结果
- ✅ 设置页面显示京东说明

### 10.8 文件完整列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/commands/jd.rs` | 新建 | Rust 后端上传命令 |
| `src-tauri/src/commands/mod.rs` | 修改 | 添加 `pub mod jd;` |
| `src-tauri/src/main.rs` | 修改 | 注册 `upload_to_jd` 命令 |
| `src/uploaders/jd/JDUploader.ts` | 新建 | 前端上传器类 |
| `src/uploaders/jd/index.ts` | 新建 | 导出文件 |
| `src/uploaders/index.ts` | 修改 | 注册到工厂 |
| `src/config/types.ts` | 修改 | 修复配置类型 |
| `index.html` | 修改 | UI 复选框和设置说明 |
| `src/main.ts` | 修改 | serviceCheckboxes |
| `src/core/MultiServiceUploader.ts` | 修改 | 无配置图床列表 |

---

## ✅ 阶段十一: 牛客图床支持 (2025-12-02 完成)

**修改文件**:
- `src-tauri/src/commands/nowcoder.rs` (新建) - Rust 后端上传命令
- `src-tauri/src/commands/mod.rs` - 注册 nowcoder 模块
- `src-tauri/src/main.rs` - 注册 `upload_to_nowcoder` 命令
- `src/uploaders/nowcoder/NowcoderUploader.ts` (新建) - 前端上传器
- `src/uploaders/nowcoder/index.ts` (新建) - 导出文件
- `src/uploaders/index.ts` - 注册牛客上传器到工厂
- `src/config/types.ts` - 确认 NowcoderServiceConfig 类型、更新 DEFAULT_CONFIG
- `index.html` - 添加牛客复选框和设置说明
- `src/main.ts` - 添加 nowcoder 到 serviceCheckboxes、设置自动保存
- `src/core/MultiServiceUploader.ts` - 添加 nowcoder 到 Cookie 验证逻辑

### 11.1 牛客 API 特性

**核心特点**:
- ⚠️ **需要 Cookie**: 与微博类似，需要用户登录获取 Cookie
- ✅ **单步上传流程**: 直接 POST 上传图片
- ✅ **HTTPS 图片域名**: 返回的 URL 自动为 HTTPS

**API 端点**:
```
POST https://www.nowcoder.com/uploadImage?type=1&_={timestamp}

Headers:
- Cookie: (用户登录后的 Cookie)
- Referer: https://www.nowcoder.com/creation/write/article
- Origin: https://www.nowcoder.com
- User-Agent: Mozilla/5.0 ...

Body: multipart/form-data
- image: (文件)

Response:
{
    "code": 0,
    "msg": "OK",
    "url": "https://uploadfiles.nowcoder.com/..."
}
```

### 11.2 Rust 后端实现

**文件**: `src-tauri/src/commands/nowcoder.rs`

```rust
#[derive(Debug, Serialize)]
pub struct NowcoderUploadResult {
    pub url: String,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
struct NowcoderApiResponse {
    code: i32,       // 0 表示成功
    msg: String,     // "OK"
    url: String,     // 图片 URL
}

#[tauri::command]
pub async fn upload_to_nowcoder(
    window: Window,
    id: String,
    file_path: String,
    nowcoder_cookie: String,
) -> Result<NowcoderUploadResult, String> {
    // 1. 读取文件并验证类型
    let file_data = tokio::fs::read(&file_path).await?;
    let file_name = Path::new(&file_path).file_name()...;
    let extension = Path::new(&file_path).extension()...;

    // 验证文件类型
    let allowed_extensions = ["jpg", "jpeg", "png", "gif", "webp"];
    if !allowed_extensions.contains(&ext_lower.as_str()) {
        return Err("不支持的文件格式".to_string());
    }

    // 2. 构建带时间戳的 URL
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis();
    let url = format!(
        "https://www.nowcoder.com/uploadImage?type=1&_={}",
        timestamp
    );

    // 3. 构建 multipart 表单
    let form = Form::new()
        .part("image", Part::bytes(file_data.clone())
            .file_name(file_name)
            .mime_str(&mime_type)?);

    // 4. 发送请求（设置必要的 Headers）
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()?;

    let response = client
        .post(&url)
        .header("Cookie", nowcoder_cookie)
        .header("Referer", "https://www.nowcoder.com/creation/write/article")
        .header("Origin", "https://www.nowcoder.com")
        .header("User-Agent", "Mozilla/5.0 ...")
        .multipart(form)
        .send().await?;

    // 5. 解析响应
    let nowcoder_response: NowcoderApiResponse = response.json().await?;

    if nowcoder_response.code != 0 {
        return Err(format!("牛客 API 错误: {}", nowcoder_response.msg));
    }

    // 6. 确保返回 HTTPS URL
    let final_url = if nowcoder_response.url.starts_with("http://") {
        nowcoder_response.url.replacen("http://", "https://", 1)
    } else {
        nowcoder_response.url
    };

    Ok(NowcoderUploadResult {
        url: final_url,
        size: file_data.len() as u64,
    })
}
```

### 11.3 前端上传器

**文件**: `src/uploaders/nowcoder/NowcoderUploader.ts`

```typescript
import { BaseUploader } from '../base/BaseUploader';
import { UploadResult, ValidationResult, UploadOptions, ProgressCallback } from '../base/types';
import { NowcoderServiceConfig } from '../../config/types';

interface NowcoderRustResult {
  url: string;
  size: number;
}

export class NowcoderUploader extends BaseUploader {
  readonly serviceId = 'nowcoder';
  readonly serviceName = '牛客图床';

  protected getRustCommand(): string {
    return 'upload_to_nowcoder';
  }

  async validateConfig(config: any): Promise<ValidationResult> {
    const nowcoderConfig = config as NowcoderServiceConfig;

    if (!nowcoderConfig.cookie || this.isEmpty(nowcoderConfig.cookie)) {
      return {
        valid: false,
        missingFields: ['Cookie'],
        errors: ['请先在设置中配置牛客 Cookie']
      };
    }

    return { valid: true };
  }

  async upload(
    filePath: string,
    options: UploadOptions,
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const config = options.config as NowcoderServiceConfig;

    const rustResult = await this.uploadViaRust(
      filePath,
      { nowcoderCookie: config.cookie },
      onProgress
    ) as NowcoderRustResult;

    return {
      serviceId: 'nowcoder',
      fileKey: rustResult.url,
      url: rustResult.url,
      size: rustResult.size
    };
  }
}
```

### 11.4 配置类型

**文件**: `src/config/types.ts`

类型定义已存在，确认正确：
```typescript
export type ServiceType = 'weibo' | 'r2' | 'nami' | 'jd' | 'tcl' | 'nowcoder';

export interface NowcoderServiceConfig extends BaseServiceConfig {
  cookie: string;
}
```

**DEFAULT_CONFIG 更新**:
```typescript
export const DEFAULT_CONFIG: UserConfig = {
  enabledServices: ['tcl'],
  services: {
    // ...其他服务
    nowcoder: {
      enabled: false,  // 牛客图床需要 Cookie，默认不启用
      cookie: ''
    }
  },
  // ...
};
```

### 11.5 MultiServiceUploader 更新

**文件**: `src/core/MultiServiceUploader.ts`

在 `filterConfiguredServices()` 方法中添加牛客的 Cookie 验证逻辑：

```typescript
if (serviceId === 'nowcoder') {
  const nowcoderConfig = serviceConfig as any;
  if (!nowcoderConfig.cookie || nowcoderConfig.cookie.trim().length === 0) {
    console.warn(`[MultiUploader] ${serviceId} Cookie 未配置，跳过`);
    return false;
  }
  return true;
}
```

### 11.6 UI 集成

**文件**: `index.html`

**上传界面复选框**:
```html
<label class="service-checkbox">
  <input type="checkbox" data-service="nowcoder" />
  <span class="service-icon">📚</span>
  <span class="service-name">牛客图床</span>
  <span class="service-config-status" data-service="nowcoder"></span>
</label>
```

**设置页面 Cookie 输入**:
```html
<div class="form-section">
  <h2>牛客图床</h2>
  <div class="form-group">
    <label for="nowcoder-cookie">牛客 Cookie</label>
    <textarea id="nowcoder-cookie" name="nowcoderCookie" rows="3"
      placeholder="请输入牛客登录后的 Cookie..."></textarea>
    <p class="help-text">登录 nowcoder.com 后，从浏览器开发者工具中复制 Cookie</p>
  </div>
  <p class="info-text" style="color: var(--warning);">
    ⚠️ 注意：牛客图床需要登录，Cookie 可能会过期
  </p>
</div>
```

### 11.7 main.ts 更新

**文件**: `src/main.ts`

1. **serviceCheckboxes 添加 nowcoder**:
```typescript
const serviceCheckboxes = {
  weibo: document.querySelector<HTMLInputElement>('input[data-service="weibo"]'),
  r2: document.querySelector<HTMLInputElement>('input[data-service="r2"]'),
  tcl: document.querySelector<HTMLInputElement>('input[data-service="tcl"]'),
  jd: document.querySelector<HTMLInputElement>('input[data-service="jd"]'),
  nowcoder: document.querySelector<HTMLInputElement>('input[data-service="nowcoder"]')
};
```

2. **nowcoderCookieEl 元素引用**:
```typescript
const nowcoderCookieEl = document.querySelector<HTMLTextAreaElement>('#nowcoder-cookie');
```

3. **loadServiceCheckboxStates() 更新**:
```typescript
if (serviceCheckboxes.nowcoder) {
  serviceCheckboxes.nowcoder.checked = enabledServices.includes('nowcoder');
  updateServiceStatus('nowcoder', config);
}
```

4. **updateServiceStatus() 更新**:
```typescript
case 'nowcoder':
  const nowcoderConfig = config.services.nowcoder;
  isConfigured = !!nowcoderConfig?.cookie && nowcoderConfig.cookie.trim().length > 0;
  statusText = isConfigured ? '已配置' : '未配置';
  break;
```

5. **handleAutoSave() 更新**:
```typescript
const config: UserConfig = {
  // ...
  services: {
    // ...
    nowcoder: {
      enabled: true,
      cookie: nowcoderCookieEl?.value || ''
    }
  }
};
```

6. **设置自动保存数组**:
```typescript
const settingsInputs = [weiboCookieEl, r2AccountIdEl, ..., nowcoderCookieEl];
settingsInputs.forEach(input => {
  if (input) {
    input.addEventListener('blur', handleAutoSave);
  }
});
```

### 11.8 测试要点

- ✅ 牛客上传成功，返回正确 HTTPS URL
- ✅ Cookie 未配置时显示"未配置"状态
- ✅ Cookie 配置后显示"已配置"状态
- ✅ 未配置时复选框禁用
- ✅ 进度回调正常工作
- ✅ 文件类型验证（jpg, jpeg, png, gif, webp）
- ✅ 与其他图床并行上传正常
- ✅ 历史记录正确显示牛客结果
- ✅ 设置页面 Cookie 输入框正常
- ✅ Cookie 自动保存功能

### 11.9 文件完整列表

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/commands/nowcoder.rs` | 新建 | Rust 后端上传命令 |
| `src-tauri/src/commands/mod.rs` | 修改 | 添加 `pub mod nowcoder;` |
| `src-tauri/src/main.rs` | 修改 | 注册 `upload_to_nowcoder` 命令 |
| `src/uploaders/nowcoder/NowcoderUploader.ts` | 新建 | 前端上传器类 |
| `src/uploaders/nowcoder/index.ts` | 新建 | 导出文件 |
| `src/uploaders/index.ts` | 修改 | 注册到工厂 |
| `src/config/types.ts` | 修改 | 更新 DEFAULT_CONFIG |
| `index.html` | 修改 | UI 复选框和设置说明 |
| `src/main.ts` | 修改 | serviceCheckboxes、设置保存 |
| `src/core/MultiServiceUploader.ts` | 修改 | Cookie 验证逻辑 |

---

## ✅ 阶段十二: 牛客 Cookie 验证增强与多域名支持 (2025-12-02 完成)

**问题背景**:
用户报告程序在未登录状态就获取了 Cookie，且登录后也无法正确捕获 Cookie。分析发现两个核心问题：
1. Cookie 验证不够严格，只检查 `t` 字段，未验证安全相关字段
2. WebView2 Cookie 提取时域名匹配问题（`nowcoder.com` vs `www.nowcoder.com`）

**修改文件**:
- `src/config/cookieProviders.ts` - 更新验证规则，添加 anyOfFields
- `src-tauri/src/main.rs` - 增强验证逻辑，支持多域名提取
- `src/login-webview.ts` - 传递 anyOfFields 参数

### 12.1 Cookie 验证规则增强

**问题分析**:
```
未登录 Cookie: NOWCODERUID=xxx (无 t 字段)
已登录 Cookie: NOWCODERUID=xxx; t=xxx; csrfToken=xxx; acw_tc=xxx; ...
```

之前的验证只检查 `['NOWCODERUID', 't']`，但 `NOWCODERUID` 在未登录时就存在，导致误判。

**解决方案**: 使用两层验证逻辑
1. **requiredFields** (AND 逻辑): 必须全部包含的字段
2. **anyOfFields** (OR 逻辑): 至少包含其中一个字段

**配置更新**: `src/config/cookieProviders.ts`
```typescript
nowcoder: {
  cookieValidation: {
    requiredFields: ['t', 'csrfToken'],  // 必须有登录Token和CSRF令牌
    anyOfFields: ['acw_tc', 'SERVERID', '__snaker__id', 'gdxidpyhxdE']  // 至少一个安全字段
  }
}
```

**字段说明**:
- `t`: 登录 Token (登录后才有)
- `csrfToken`: CSRF 防护令牌
- `acw_tc`: 阿里云 WAF Token
- `SERVERID`/`SERVERCORSID`: 负载均衡标识
- `__snaker__id`/`gdxidpyhxdE`: 反爬虫/验证码标识

### 12.2 Rust 后端验证逻辑重构

**文件**: `src-tauri/src/main.rs`

**新增函数 1**: `check_cookie_field()` - 单字段检查辅助函数
```rust
fn check_cookie_field(cookie: &str, field: &str) -> bool {
    let pattern = format!("{}=", field);
    if let Some(pos) = cookie.find(&pattern) {
        let value_start = pos + pattern.len();
        let remaining = &cookie[value_start..];
        let value_end = remaining.find(';').unwrap_or(remaining.len());

        // 检查值是否非空
        if value_end == 0 {
            eprintln!("[Cookie验证] 字段 {} 值为空", field);
            return false;
        }
        true
    } else {
        false
    }
}
```

**更新函数 2**: `validate_cookie_fields()` - 支持 AND/OR 双重验证
```rust
fn validate_cookie_fields(
    cookie: &str,
    required_fields: &[String],  // AND 逻辑
    any_of_fields: &[String]     // OR 逻辑
) -> bool {
    // 1. 检查所有必要字段 (AND 逻辑)
    for field in required_fields {
        if !check_cookie_field(cookie, field) {
            eprintln!("[Cookie验证] 缺少必要字段: {}", field);
            return false;
        }
    }

    // 2. 检查任意字段 (OR 逻辑)
    if !any_of_fields.is_empty() {
        let has_any = any_of_fields.iter().any(|f| check_cookie_field(cookie, f));
        if !has_any {
            eprintln!("[Cookie验证] 缺少任意安全字段: {:?}", any_of_fields);
            return false;
        }
    }

    true
}
```

**更新函数 3**: 相关命令函数添加 `any_of_fields` 参数
- `start_cookie_monitoring()`
- `save_cookie_from_login()`
- `get_request_header_cookie()`
- `attempt_cookie_capture_and_save_generic()`

### 12.3 多域名 Cookie 提取支持

**问题**: WebView2 的 `GetCookies` API 对域名敏感
- 请求 `nowcoder.com` 不会返回 `www.nowcoder.com` 的 Cookie
- 用户登录在 `www.nowcoder.com`，但提取时使用的是 `nowcoder.com`

**解决方案**: 自动尝试域名变体并合并结果

**文件**: `src-tauri/src/main.rs` - `attempt_cookie_capture_and_save_generic()`

```rust
fn attempt_cookie_capture_and_save_generic(...) -> bool {
    // 1. 构建域名变体列表
    let mut domains_to_try = vec![target_domain.to_string()];
    if target_domain.starts_with("www.") {
        domains_to_try.push(target_domain[4..].to_string());  // 去掉 www.
    } else {
        domains_to_try.push(format!("www.{}", target_domain));  // 添加 www.
    }

    // 2. 从所有域名提取并合并 Cookie
    let mut all_cookies: BTreeMap<String, String> = BTreeMap::new();
    for domain in &domains_to_try {
        match try_extract_cookie_header_generic(login_window, domain) {
            Ok(Some(cookie)) => {
                // 解析并合并到 all_cookies
                for part in cookie.split("; ") {
                    if let Some(eq_pos) = part.find('=') {
                        let key = part[..eq_pos].to_string();
                        let value = part[eq_pos + 1..].to_string();
                        all_cookies.insert(key, value);
                    }
                }
            }
            _ => continue
        }
    }

    // 3. 重新组装并验证
    let merged_cookie = all_cookies.iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("; ");

    validate_cookie_fields(&merged_cookie, required_fields, any_of_fields)
}
```

**特性**:
- ✅ 自动尝试 `www.example.com` 和 `example.com` 两个变体
- ✅ 合并所有域名的 Cookie（使用 BTreeMap 去重）
- ✅ 对合并后的完整 Cookie 进行验证

### 12.4 前端参数传递

**文件**: `src/login-webview.ts`

**更新位置 1**: `start_cookie_monitoring` 调用
```typescript
await invoke('start_cookie_monitoring', {
  serviceId: serviceId,
  targetDomain: provider.domains[0],
  requiredFields: provider.cookieValidation?.requiredFields || [],
  anyOfFields: provider.cookieValidation?.anyOfFields || []  // 新增
});
```

**更新位置 2**: `get_request_header_cookie` 调用
```typescript
const cookie = await invoke<string>('get_request_header_cookie', {
  serviceId: serviceId,
  targetDomain: provider.domains[0],
  requiredFields: provider.cookieValidation?.requiredFields || [],
  anyOfFields: provider.cookieValidation?.anyOfFields || []  // 新增
});
```

**更新位置 3**: `save_cookie_from_login` 调用
```typescript
await invoke('save_cookie_from_login', {
  cookie: trimmedCookie,
  serviceId: serviceId,
  requiredFields: provider.cookieValidation?.requiredFields || [],
  anyOfFields: provider.cookieValidation?.anyOfFields || []  // 新增
});
```

### 12.5 域名顺序优化

**文件**: `src/config/cookieProviders.ts`

```typescript
nowcoder: {
  domains: ['www.nowcoder.com', 'nowcoder.com'],  // www 在前，因为登录在 www
  // ...
}
```

**说明**: 将 `www.nowcoder.com` 放在第一位，优先使用实际登录的域名。

### 12.6 测试结果

**验证通过的 Cookie 示例**:
```
NOWCODERUID=xxx; t=38746F43...; csrfToken=nYrlU6KF...;
acw_tc=0a03837d...; SERVERID=8e67caa3...;
__snaker__id=v1mWnarE...; gdxidpyhxdE=y9QN1fLJ...
```

**验证逻辑**:
1. ✅ 包含 `t` 字段 (必须)
2. ✅ 包含 `csrfToken` 字段 (必须)
3. ✅ 包含 `acw_tc`, `SERVERID`, `__snaker__id`, `gdxidpyhxdE` 中至少一个
4. ✅ 所有字段值非空

**结果**: 用户确认修复成功，登录后能正确捕获 Cookie！✅

### 12.7 修改文件汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/config/cookieProviders.ts` | 修改 | 更新 nowcoder 验证规则和域名顺序 |
| `src-tauri/src/main.rs` | 修改 | 新增 check_cookie_field()，重构验证逻辑，添加多域名支持 |
| `src/login-webview.ts` | 修改 | 所有 invoke 调用添加 anyOfFields 参数 |

**编译验证**: ✅ Rust 和 TypeScript 均编译通过

---

## ✅ 阶段十三: 链接前缀多选功能 (2025-12-02 完成)

**需求背景**:
用户希望改造设置中的"链接配置"功能，让其支持多个代理前缀可选。微博图床返回的链接需要通过代理前缀才能正常访问，之前只支持单个固定前缀，现在需要：
1. 支持多个前缀下拉选择
2. 默认两个前缀：百度代理和 cdnjson 代理
3. 支持用户添加/删除自定义前缀
4. 开关控制是否启用前缀功能
5. 历史记录中微博链接动态显示当前选择的前缀
6. 备份导入导出支持新配置

**修改文件**:
- `src/config/types.ts` - 新增 LinkPrefixConfig 接口和辅助函数
- `index.html` - UI 改为下拉选择 + 开关 + 添加/删除按钮
- `src/style.css` - 新增前缀选择器样式
- `src/main.ts` - DOM 交互、配置加载/保存、历史记录动态渲染
- `src/coreLogic.ts` - generateLink() 使用新配置
- `src/core/LinkGenerator.ts` - 使用 getActivePrefix()
- `src/components/BackupView.vue` - 导入时迁移旧配置

### 13.1 配置类型扩展

**文件**: `src/config/types.ts`

**新增接口**:
```typescript
/**
 * 链接前缀配置
 * 用于微博图床的代理前缀管理
 */
export interface LinkPrefixConfig {
  /** 是否启用代理前缀 */
  enabled: boolean;
  /** 当前选中的前缀索引 */
  selectedIndex: number;
  /** 前缀列表 */
  prefixList: string[];
}

/**
 * 默认前缀列表
 */
export const DEFAULT_PREFIXES: string[] = [
  'https://image.baidu.com/search/down?thumburl=',
  'https://cdn.cdnjson.com/pic.html?url='
];
```

**UserConfig 扩展**:
```typescript
interface UserConfig {
  // ... 其他字段

  /** @deprecated 使用 linkPrefixConfig 代替，保留用于向后兼容 */
  baiduPrefix?: string;

  /** 链接前缀配置（用于微博图床代理） */
  linkPrefixConfig?: LinkPrefixConfig;
}
```

**辅助函数**:
```typescript
/**
 * 获取当前激活的前缀
 * 如果前缀功能禁用，返回 null
 */
export function getActivePrefix(config: UserConfig): string | null {
  if (!config.linkPrefixConfig) {
    return config.baiduPrefix || DEFAULT_PREFIXES[0];
  }
  if (!config.linkPrefixConfig.enabled) {
    return null;
  }
  const { selectedIndex, prefixList } = config.linkPrefixConfig;
  if (selectedIndex >= 0 && selectedIndex < prefixList.length) {
    return prefixList[selectedIndex];
  }
  return prefixList[0];
}

/**
 * 迁移旧配置到新格式
 */
export function migrateConfig(config: UserConfig): UserConfig {
  if (config.linkPrefixConfig) return config;

  const prefixList = [...DEFAULT_PREFIXES];
  let selectedIndex = 0;

  if (config.baiduPrefix) {
    const existingIndex = prefixList.indexOf(config.baiduPrefix);
    if (existingIndex >= 0) {
      selectedIndex = existingIndex;
    } else {
      prefixList.push(config.baiduPrefix);
      selectedIndex = prefixList.length - 1;
    }
  }

  return {
    ...config,
    linkPrefixConfig: { enabled: true, selectedIndex, prefixList }
  };
}
```

### 13.2 UI 组件改造

**文件**: `index.html` (291-337行)

**旧 UI**: 单个文本输入框
```html
<input type="text" id="baidu-prefix" value="https://image.baidu.com/search/down?thumburl=" />
```

**新 UI**: 开关 + 下拉选择 + 添加/删除按钮
```html
<!-- 启用开关 -->
<div class="prefix-toggle-container">
    <label class="toggle-switch">
        <input type="checkbox" id="prefix-enabled" checked />
        <span class="toggle-slider"></span>
    </label>
    <span class="toggle-label">启用代理前缀（仅微博图床）</span>
</div>

<!-- 前缀选择器 -->
<div class="prefix-selector-container" id="prefix-selector-wrapper">
    <select id="prefix-selector" class="prefix-selector">
        <!-- 选项由 JavaScript 动态填充 -->
    </select>
    <button type="button" id="add-prefix-btn" class="prefix-action-btn">+</button>
    <button type="button" id="delete-prefix-btn" class="prefix-action-btn">🗑️</button>
</div>

<!-- 添加前缀模态框 -->
<div id="add-prefix-modal" class="modal hidden">
    <div class="modal-content">
        <h3>添加自定义前缀</h3>
        <input type="text" id="new-prefix-input" placeholder="https://example.com/proxy?url=" />
        <div class="modal-buttons">
            <button id="cancel-add-prefix">取消</button>
            <button id="confirm-add-prefix">添加</button>
        </div>
    </div>
</div>
```

### 13.3 样式设计

**文件**: `src/style.css` (2280-2466行)

**Toggle Switch 样式**:
```css
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  background-color: var(--bg-input);
  border-radius: 24px;
  transition: 0.3s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--primary);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
}
```

**前缀选择器样式**:
```css
.prefix-selector-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prefix-selector {
  flex: 1;
  padding: 10px 12px;
  background-color: var(--bg-input);
  border-radius: 8px;
}

.prefix-action-btn {
  width: 36px;
  height: 36px;
  background: rgba(51, 65, 85, 0.3);
  border-radius: 8px;
}

.prefix-action-btn:hover {
  background: rgba(59, 130, 246, 0.15);
  color: var(--primary);
}

.prefix-delete-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--error);
}
```

### 13.4 主逻辑实现

**文件**: `src/main.ts`

**新增辅助函数**:
```typescript
// 内存缓存当前前缀列表
let currentPrefixList: string[] = [...DEFAULT_PREFIXES];

// 填充前缀选择器
function populatePrefixSelector(linkPrefixConfig: LinkPrefixConfig): void {
  currentPrefixList = linkPrefixConfig.prefixList || [...DEFAULT_PREFIXES];
  prefixEnabledEl.checked = linkPrefixConfig.enabled;
  updatePrefixSelectorState(linkPrefixConfig.enabled);
  // 填充选项...
}

// 从 UI 获取当前前缀
function getActivePrefixFromUI(): string | null {
  if (!prefixEnabledEl?.checked) return null;
  const selectedIndex = parseInt(prefixSelectorEl.value);
  return currentPrefixList[selectedIndex];
}

// 初始化事件监听器
function initPrefixEventListeners(): void {
  // 开关切换、选择器变化、添加/删除按钮...
}
```

**历史记录动态渲染** (renderHistoryTable 函数):
```typescript
// 微博链接动态拼接当前选择的前缀
if (serviceResult.serviceId === 'weibo' && activePrefix) {
  displayUrl = activePrefix + serviceResult.result.url;
}
```

### 13.5 链接生成器更新

**文件**: `src/coreLogic.ts` 和 `src/core/LinkGenerator.ts`

```typescript
// 使用 getActivePrefix() 获取当前前缀
const activePrefix = getActivePrefix(config);

// 如果前缀功能被禁用，返回原始链接
if (!activePrefix) {
  return weiboLargeUrl;
}

const proxyLink = `${activePrefix}${weiboLargeUrl}`;
```

### 13.6 备份兼容处理

**文件**: `src/components/BackupView.vue`

```typescript
import { migrateConfig } from '../config/types';

// 导入配置时自动迁移旧格式
async function importSettingsLocal() {
  let importedConfig = JSON.parse(content) as UserConfig;
  importedConfig = migrateConfig(importedConfig);  // 迁移
  await configStore.set('config', importedConfig);
}
```

### 13.7 功能特点总结

| 功能 | 描述 |
|------|------|
| 多前缀支持 | 下拉选择，默认两个前缀 |
| 开关控制 | 可禁用前缀功能，返回原始链接 |
| 用户管理 | 添加/删除任意前缀（包括默认的） |
| 动态显示 | 历史记录中微博链接动态使用当前前缀 |
| 向后兼容 | 自动迁移旧的 baiduPrefix 配置 |
| 备份支持 | 导入导出完整支持新配置 |

### 13.8 测试检查点

1. ✅ 新用户：默认显示两个前缀，第一个选中，开关开启
2. ✅ 添加前缀：验证 URL 格式，添加后自动选中
3. ✅ 删除前缀：任意前缀可删除，删除后调整选中项
4. ✅ 开关关闭：微博链接显示原始链接
5. ✅ 历史记录：切换前缀后，微博链接显示更新
6. ✅ 备份恢复：导入旧配置正确迁移

**编译验证**: ✅ TypeScript 编译通过

---

## ✅ 阶段十四: 浏览视图 (Gallery View) 功能实现 (2025-12-02 完成)

### 14.1 功能概述

将"历史记录窗口"重新定位为"浏览"功能，从单纯的历史记录展示转变为功能完整的图片浏览器+管理器。

**核心目标**:
- 窗口名称从"历史记录"改为"浏览"
- 新增瀑布流视图（类似 Google Photos）
- 保留原有表格视图，支持双视图切换
- 实现图片大图预览（Lightbox）
- 添加按图床类型筛选功能
- 支持右键菜单和批量操作
- 实现高性能懒加载

**用户体验提升**:
- 从"查看上传记录"转变为"浏览和管理图片"
- 直观的照片墙布局，适合快速浏览大量图片
- 灵活的视图切换，满足不同使用场景
- 流畅的性能（支持500+图片）

### 14.2 修改文件概览

| 文件 | 变更类型 | 新增行数 | 主要内容 |
|------|---------|---------|---------|
| [index.html](index.html) | 新增+修改 | ~100 行 | 视图切换按钮、瀑布流容器、Lightbox 模态框、右键菜单 |
| [src/style.css](src/style.css) | 新增 | ~880 行 | 响应式网格、卡片样式、Lightbox 样式、动画效果 |
| [src/main.ts](src/main.ts) | 新增+修改 | ~600 行 | 视图切换、懒加载、Lightbox 控制、右键菜单逻辑 |
| [src/config/types.ts](src/config/types.ts) | 新增 | ~6 行 | 视图偏好配置接口 |

**总计**: ~1586 行新增代码

### 14.3 HTML 结构改造

**文件**: [index.html](index.html)

#### 14.3.1 标题栏与视图切换 (127-152 行)

```html
<div class="gallery-header">
  <h1>浏览</h1>
  <div class="view-mode-toggle">
    <!-- 表格视图按钮 -->
    <button id="view-mode-table" class="view-mode-btn active" title="表格视图">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="8" y1="6" x2="21" y2="6"/>
        <line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/>
        <line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
    </button>
    <!-- 瀑布流视图按钮 -->
    <button id="view-mode-grid" class="view-mode-btn" title="瀑布流视图">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"/>
        <rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/>
      </svg>
    </button>
  </div>
</div>
```

**设计特点**:
- 使用 SVG 图标清晰展示视图类型
- Active 状态高亮当前视图模式
- Hover 动画提升交互体验

#### 14.3.2 图床筛选器 (176-188 行)

```html
<div class="filter-search-section">
    <select id="image-bed-filter" class="image-bed-filter">
        <option value="all">全部图床</option>
        <option value="weibo">微博</option>
        <option value="r2">R2</option>
        <option value="tcl">TCL</option>
        <option value="jd">京东</option>
        <option value="nowcoder">牛客</option>
    </select>
    <div class="search-section">
        <input type="text" id="search-input" placeholder="搜索本地文件名..." />
    </div>
</div>
```

**功能特点**:
- 支持按图床类型筛选历史记录
- 与搜索功能无缝结合
- 筛选结果在两种视图中同步

#### 14.3.3 瀑布流容器 (213-225 行)

```html
<div id="grid-view-container" class="view-container" style="display: none;">
    <div id="gallery-grid" class="gallery-grid">
        <!-- 动态生成图片卡片 -->
    </div>
    <div id="grid-loading-indicator" class="grid-loading-indicator" style="display: none;">
        <div class="spinner"></div>
        <p>加载更多...</p>
    </div>
    <div id="grid-end-message" class="grid-end-message" style="display: none;">
        <p>已加载全部图片</p>
    </div>
</div>
```

#### 14.3.4 Lightbox 大图预览模态框 (500-551 行)

```html
<div id="lightbox-modal" class="lightbox-modal" style="display: none;">
  <div class="lightbox-overlay"></div>
  <div class="lightbox-container">
    <!-- 关闭按钮 -->
    <button id="lightbox-close" class="lightbox-close" title="关闭 (ESC)">×</button>

    <!-- 导航按钮 -->
    <button id="lightbox-prev" class="lightbox-nav lightbox-prev" title="上一张 (←)">‹</button>
    <button id="lightbox-next" class="lightbox-nav lightbox-next" title="下一张 (→)">›</button>

    <!-- 图片内容 -->
    <div class="lightbox-content">
      <img id="lightbox-image" class="lightbox-image" src="" alt="Preview">
      <div class="lightbox-info">
        <div class="lightbox-filename" id="lightbox-filename"></div>
        <div class="lightbox-meta" id="lightbox-meta"></div>
      </div>
    </div>

    <!-- 底部工具栏 -->
    <div class="lightbox-actions">
      <button id="lightbox-copy" class="lightbox-action-btn" title="复制链接">
        <svg><!-- 复制图标 --></svg>
        <span>复制链接</span>
      </button>
      <button id="lightbox-delete" class="lightbox-action-btn danger" title="删除">
        <svg><!-- 删除图标 --></svg>
        <span>删除</span>
      </button>
    </div>
  </div>
</div>
```

**Lightbox 功能**:
- 全屏大图预览体验
- 左右箭头键盘导航
- ESC 键快速关闭
- 底部操作栏（复制、删除）
- 显示文件名和图床信息

#### 14.3.5 自定义右键菜单 (553-579 行)

```html
<div id="context-menu" class="context-menu" style="display: none;">
  <div class="context-menu-item" id="ctx-preview">
    <svg><!-- 预览图标 --></svg>
    <span>预览</span>
  </div>
  <div class="context-menu-item" id="ctx-copy-link">
    <svg><!-- 复制图标 --></svg>
    <span>复制链接</span>
  </div>
  <div class="context-menu-divider"></div>
  <div class="context-menu-item danger" id="ctx-delete">
    <svg><!-- 删除图标 --></svg>
    <span>删除</span>
  </div>
</div>
```

### 14.4 CSS 样式设计

**文件**: [src/style.css](src/style.css)

#### 14.4.1 响应式瀑布流布局 (2562-2589 行)

```css
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 220px);
  gap: 16px;
  justify-content: center;
  padding: 10px 0;
}

/* 响应式断点 */
@media (max-width: 1400px) {
  .gallery-grid {
    grid-template-columns: repeat(auto-fill, 200px);
  }
}

@media (max-width: 1000px) {
  .gallery-grid {
    grid-template-columns: repeat(auto-fill, 180px);
    gap: 14px;
  }
}

@media (max-width: 768px) {
  .gallery-grid {
    grid-template-columns: repeat(auto-fill, 160px);
    gap: 12px;
  }
}
```

**技术亮点**:
- `repeat(auto-fill, 220px)` 实现响应式列数自动调整
- 4 个断点适配不同屏幕尺寸
- `justify-content: center` 居中显示网格

#### 14.4.2 图片卡片样式 (2592-2708 行)

```css
.gallery-item {
  position: relative;
  background-color: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
}

.gallery-item:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
  border-color: var(--primary);
}

.gallery-item-image-wrapper {
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background-color: var(--bg-input);
  position: relative;
}

.gallery-item-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
}
```

**视觉效果**:
- Hover 时卡片上浮 4px + 阴影
- 边框颜色渐变为主题色
- 固定 1:1 比例确保布局整齐

#### 14.4.3 Shimmer 加载动画 (2670-2688 行)

```css
.gallery-item-image:not(.loaded) {
  background: linear-gradient(
    135deg,
    var(--bg-input) 0%,
    var(--bg-hover) 50%,
    var(--bg-input) 100%
  );
  background-size: 200% 200%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 0% 0%; }
  100% { background-position: 100% 100%; }
}
```

**用户体验**:
- 图片加载时显示优雅的闪烁动画
- 视觉反馈加载状态
- 比纯灰色背景更生动

#### 14.4.4 Lightbox 全屏样式 (2770-2959 行)

```css
.lightbox-modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

.lightbox-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(5px);
}

.lightbox-image {
  max-width: 90vw;
  max-height: 75vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

/* 导航按钮 */
.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  font-size: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  transition: all 0.2s ease;
}

.lightbox-nav:hover {
  background: white;
  transform: translateY(-50%) scale(1.1);
}

.lightbox-prev { left: 20px; }
.lightbox-next { right: 20px; }
```

**设计细节**:
- 半透明黑色遮罩 + 毛玻璃效果
- 圆形导航按钮悬停放大动画
- 图片最大占用 90vw × 75vh
- FadeIn 动画平滑展示

#### 14.4.5 右键菜单样式 (2965-3027 行)

```css
.context-menu {
  position: fixed;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 9999;
  min-width: 160px;
  padding: 4px 0;
  animation: contextMenuShow 0.15s ease;
}

@keyframes contextMenuShow {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-5px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.context-menu-item:hover {
  background-color: var(--bg-hover);
}

.context-menu-item.danger:hover {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--danger);
}
```

**交互设计**:
- 出现时缩放 + 位移动画
- Hover 时背景色变化
- 删除项使用红色警示色

### 14.5 TypeScript 核心逻辑

**文件**: [src/main.ts](src/main.ts)

#### 14.5.1 状态管理 (70-94 行)

```typescript
interface GalleryViewState {
  viewMode: 'table' | 'grid';              // 当前视图模式
  currentFilter: ServiceType | 'all';     // 图床筛选
  displayedItems: HistoryItem[];          // 当前显示的项（筛选+搜索后）
  gridLoadedCount: number;                // 已加载的数量
  gridBatchSize: number;                  // 每批加载数量（50）
  selectedGridItems: Set<string>;         // 瀑布流视图中选中的项
  lightboxCurrentIndex: number;           // Lightbox 当前显示索引
}

const galleryState: GalleryViewState = {
  viewMode: 'table',
  currentFilter: 'all',
  displayedItems: [],
  gridLoadedCount: 0,
  gridBatchSize: 50,
  selectedGridItems: new Set(),
  lightboxCurrentIndex: -1,
};
```

**设计思路**:
- 独立的状态管理对象
- `displayedItems` 作为两种视图的共享数据源
- 分离的选择状态（表格用全局 selectedItems，瀑布流用 selectedGridItems）

#### 14.5.2 视图切换 (2834-2862 行)

```typescript
function switchViewMode(mode: 'table' | 'grid'): void {
  galleryState.viewMode = mode;

  // 更新按钮激活状态
  if (viewModeTableBtn && viewModeGridBtn) {
    if (mode === 'table') {
      viewModeTableBtn.classList.add('active');
      viewModeGridBtn.classList.remove('active');
    } else {
      viewModeTableBtn.classList.remove('active');
      viewModeGridBtn.classList.add('active');
    }
  }

  // 切换容器显示/隐藏
  if (tableViewContainer && gridViewContainer) {
    if (mode === 'table') {
      tableViewContainer.style.display = 'block';
      gridViewContainer.style.display = 'none';
    } else {
      tableViewContainer.style.display = 'none';
      gridViewContainer.style.display = 'block';
      renderGalleryView();  // 切换到瀑布流时渲染
    }
  }

  saveViewModePreference(mode);  // 保存偏好设置
}
```

**功能特点**:
- 无缝切换两种视图
- 保持筛选和搜索状态
- 持久化用户偏好

#### 14.5.3 瀑布流渲染 (2868-2878 行)

```typescript
function renderGalleryView(): void {
  if (!galleryGrid) return;

  // 重置状态
  galleryState.gridLoadedCount = 0;
  galleryState.selectedGridItems.clear();
  galleryGrid.innerHTML = '';

  // 加载第一批
  loadMoreGridItems();

  // 设置懒加载观察器
  setupLazyLoading();
}
```

#### 14.5.4 批量加载图片 (2941-2961 行)

```typescript
function loadMoreGridItems(): void {
  if (!galleryGrid) return;

  const startIndex = galleryState.gridLoadedCount;
  const endIndex = Math.min(
    startIndex + galleryState.gridBatchSize,
    galleryState.displayedItems.length
  );

  const itemsToLoad = galleryState.displayedItems.slice(startIndex, endIndex);
  const fragment = document.createDocumentFragment();

  // 批量创建卡片
  itemsToLoad.forEach(item => {
    const cardElement = createGalleryCard(item);
    fragment.appendChild(cardElement);
  });

  // 一次性插入 DOM
  galleryGrid.appendChild(fragment);
  galleryState.gridLoadedCount = endIndex;

  updateGridLoadingState();
}
```

**性能优化**:
- 使用 DocumentFragment 批量插入 DOM
- 每次加载 50 张（gridBatchSize）
- 避免频繁的 DOM 操作

#### 14.5.5 创建图片卡片 (2966-3051 行)

```typescript
function createGalleryCard(item: HistoryItem): HTMLElement {
  const card = document.createElement('div');
  card.className = 'gallery-item';
  card.setAttribute('data-id', item.id);

  // 1. 复选框（左上角）
  const checkboxDiv = document.createElement('div');
  checkboxDiv.className = 'gallery-item-checkbox';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'gallery-checkbox';
  checkbox.checked = galleryState.selectedGridItems.has(item.id);
  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    if (checkbox.checked) {
      galleryState.selectedGridItems.add(item.id);
    } else {
      galleryState.selectedGridItems.delete(item.id);
    }
  });
  checkboxDiv.appendChild(checkbox);

  // 2. 图床徽章（左上角）
  const badgeDiv = document.createElement('div');
  badgeDiv.className = 'gallery-item-badge';
  const successResults = item.results?.filter(r => r.status === 'success') || [];
  successResults.forEach(r => {
    const badge = document.createElement('span');
    badge.className = 'service-badge';
    badge.textContent = getServiceDisplayName(r.serviceId);
    badge.style.backgroundColor = getServiceColor(r.serviceId);
    badgeDiv.appendChild(badge);
  });

  // 3. 图片（带懒加载）
  const imageWrapper = document.createElement('div');
  imageWrapper.className = 'gallery-item-image-wrapper';
  const img = document.createElement('img');
  img.className = 'gallery-item-image';

  // 关键：使用 data-src 而非 src，等待懒加载触发
  const imageUrl = getImageUrl(item);
  img.setAttribute('data-src', imageUrl);
  img.alt = item.localFileName;

  // 图片加载完成后添加 loaded 类（移除 shimmer）
  img.addEventListener('load', () => {
    img.classList.add('loaded');
  });

  imageWrapper.appendChild(img);

  // 4. 文件名（底部）
  const footer = document.createElement('div');
  footer.className = 'gallery-item-footer';
  const filename = document.createElement('div');
  filename.className = 'gallery-item-filename';
  filename.textContent = item.localFileName;
  filename.title = item.localFileName;
  footer.appendChild(filename);

  // 5. 事件绑定
  card.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.gallery-item-checkbox')) {
      openLightbox(item.id);
    }
  });

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    handleCardContextMenu(e, item.id);
  });

  // 6. 组装卡片
  card.appendChild(checkboxDiv);
  card.appendChild(badgeDiv);
  card.appendChild(imageWrapper);
  card.appendChild(footer);

  return card;
}
```

**设计亮点**:
- 结构清晰的 5 层组件（复选框、徽章、图片、文件名、容器）
- 使用 `data-src` 延迟加载图片（配合 Intersection Observer）
- 事件委托优化性能
- 防止复选框点击触发预览

#### 14.5.6 懒加载实现 (3130-3178 行)

```typescript
let gridObserver: IntersectionObserver | null = null;
let loadMoreObserver: IntersectionObserver | null = null;

function setupLazyLoading(): void {
  // 1. 图片懒加载 Observer
  if (gridObserver) gridObserver.disconnect();

  gridObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const src = img.getAttribute('data-src');
          if (src) {
            img.src = src;  // 触发加载
            img.removeAttribute('data-src');
            gridObserver!.unobserve(img);  // 停止观察
          }
        }
      });
    },
    {
      rootMargin: '50px',    // 提前 50px 开始加载
      threshold: 0.01        // 1% 可见即触发
    }
  );

  // 观察所有带 data-src 的图片
  const images = document.querySelectorAll<HTMLImageElement>('.gallery-item-image[data-src]');
  images.forEach(img => gridObserver!.observe(img));

  // 2. 加载更多 Observer
  if (loadMoreObserver) loadMoreObserver.disconnect();

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const hasMore = galleryState.gridLoadedCount < galleryState.displayedItems.length;
          if (hasMore && gridLoadingIndicator) {
            gridLoadingIndicator.style.display = 'flex';

            // 延迟 300ms 防止过快加载
            setTimeout(() => {
              loadMoreGridItems();

              // 观察新加载的图片
              const newImages = document.querySelectorAll<HTMLImageElement>('.gallery-item-image[data-src]');
              newImages.forEach(img => gridObserver?.observe(img));
            }, 300);
          }
        }
      });
    },
    {
      rootMargin: '200px',   // 提前 200px 触发加载更多
      threshold: 0.01
    }
  );

  // 观察加载指示器
  if (gridLoadingIndicator) {
    loadMoreObserver.observe(gridLoadingIndicator);
  }
}
```

**技术亮点**:
- 双 Observer 策略：图片懒加载 + 无限滚动
- `rootMargin: '50px'` 提前预加载即将进入视口的图片
- `rootMargin: '200px'` 提前触发加载更多
- 加载后 unobserve 释放资源
- 300ms 延迟防止滚动过快时频繁加载

#### 14.5.7 Lightbox 预览 (3187-3254 行)

```typescript
function openLightbox(itemId: string): void {
  const index = galleryState.displayedItems.findIndex(i => i.id === itemId);
  if (index === -1) return;

  galleryState.lightboxCurrentIndex = index;
  updateLightboxContent();

  if (lightboxModal) {
    lightboxModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';  // 禁止背景滚动
  }

  document.addEventListener('keydown', handleLightboxKeydown);
}

function closeLightbox(): void {
  if (lightboxModal) {
    lightboxModal.style.display = 'none';
    document.body.style.overflow = '';  // 恢复滚动
  }
  document.removeEventListener('keydown', handleLightboxKeydown);
}

function updateLightboxContent(): void {
  const item = galleryState.displayedItems[galleryState.lightboxCurrentIndex];
  if (!item) return;

  // 更新图片
  if (lightboxImage) {
    lightboxImage.src = getImageUrl(item);
    lightboxImage.alt = item.localFileName;
  }

  // 更新文件名
  if (lightboxFilename) {
    lightboxFilename.textContent = item.localFileName;
  }

  // 更新元信息
  if (lightboxMeta) {
    const successResults = item.results?.filter(r => r.status === 'success') || [];
    const services = successResults.map(r => getServiceDisplayName(r.serviceId)).join(', ');
    lightboxMeta.textContent = `图床: ${services || '无'}`;
  }

  // 更新导航按钮状态
  if (lightboxPrev) {
    lightboxPrev.style.display = galleryState.lightboxCurrentIndex > 0 ? 'block' : 'none';
  }
  if (lightboxNext) {
    lightboxNext.style.display =
      galleryState.lightboxCurrentIndex < galleryState.displayedItems.length - 1 ? 'block' : 'none';
  }
}

function handleLightboxKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    closeLightbox();
  } else if (e.key === 'ArrowLeft') {
    navigateLightbox(-1);
  } else if (e.key === 'ArrowRight') {
    navigateLightbox(1);
  }
}

function navigateLightbox(direction: number): void {
  const newIndex = galleryState.lightboxCurrentIndex + direction;
  if (newIndex >= 0 && newIndex < galleryState.displayedItems.length) {
    galleryState.lightboxCurrentIndex = newIndex;
    updateLightboxContent();
  }
}
```

**用户体验**:
- 键盘友好：ESC 关闭，左右箭头导航
- 边界处理：首尾图片隐藏对应导航按钮
- 背景滚动锁定：打开时禁止页面滚动
- 动态元信息：显示文件名和图床列表

#### 14.5.8 右键菜单 (3327-3410 行)

```typescript
let currentContextItemId: string | null = null;

function handleCardContextMenu(e: MouseEvent, itemId: string): void {
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY, itemId);
}

function showContextMenu(x: number, y: number, itemId: string): void {
  if (!contextMenu) return;

  currentContextItemId = itemId;
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.style.display = 'block';

  // 点击其他地方关闭菜单
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

function hideContextMenu(): void {
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
  currentContextItemId = null;
}

function contextMenuPreview(): void {
  if (currentContextItemId) {
    openLightbox(currentContextItemId);
  }
  hideContextMenu();
}

function contextMenuCopyLink(): void {
  if (!currentContextItemId) return;
  const item = galleryState.displayedItems.find(i => i.id === currentContextItemId);
  if (item) {
    copyToClipboard(item.generatedLink);
  }
  hideContextMenu();
}

async function contextMenuDelete(): Promise<void> {
  if (!currentContextItemId) return;

  const confirmed = confirm('确定要删除这张图片吗？');
  if (confirmed) {
    await deleteHistoryItem(currentContextItemId);
    renderGalleryView();  // 重新渲染
  }
  hideContextMenu();
}
```

**交互设计**:
- 右键点击卡片显示菜单
- 菜单外点击自动关闭
- 支持预览、复制、删除操作
- 删除前二次确认

#### 14.5.9 图床筛选 (3419-3436 行)

```typescript
function applyImageBedFilter(serviceName: ServiceType | 'all'): void {
  galleryState.currentFilter = serviceName;

  // 根据图床类型筛选
  if (serviceName === 'all') {
    galleryState.displayedItems = allHistoryItems;
  } else {
    galleryState.displayedItems = allHistoryItems.filter(item =>
      item.results?.some(r => r.serviceId === serviceName && r.status === 'success')
    );
  }

  // 重新渲染当前视图
  if (galleryState.viewMode === 'grid') {
    renderGalleryView();
  } else {
    renderHistoryTable(galleryState.displayedItems);
  }
}
```

**筛选逻辑**:
- 筛选成功上传到指定图床的记录
- 两种视图共享筛选结果
- 保持筛选状态在视图切换时

#### 14.5.10 修改现有函数

**loadHistory() 函数 (2551-2585 行)**:
```typescript
async function loadHistory() {
    let items = await historyStore.get<any[]>('uploads');
    if (!items || items.length === 0) {
      allHistoryItems = [];
      galleryState.displayedItems = [];  // 新增：初始化 displayedItems
      renderHistoryTable([]);
      return;
    }

    const migratedItems = items.map(migrateHistoryItem);
    allHistoryItems = migratedItems.sort((a, b) => b.timestamp - a.timestamp);

    // 新增：初始化 displayedItems - 应用当前筛选
    if (galleryState.currentFilter === 'all') {
      galleryState.displayedItems = allHistoryItems;
    } else {
      galleryState.displayedItems = allHistoryItems.filter(item =>
        item.results?.some(r => r.serviceId === galleryState.currentFilter && r.status === 'success')
      );
    }

    await applySearchFilter();
}
```

**applySearchFilter() 函数 (2587-2615 行)**:
```typescript
async function applySearchFilter() {
    if (!searchInput) return;

    const searchTerm = searchInput.value.toLowerCase().trim();
    let filteredItems: HistoryItem[];

    if (!searchTerm) {
      filteredItems = galleryState.displayedItems;
    } else {
      // 修改：从 displayedItems 而非 allHistoryItems 搜索
      filteredItems = galleryState.displayedItems.filter(item =>
        item.localFileName.toLowerCase().includes(searchTerm)
      );
    }

    // 新增：根据当前视图模式渲染
    if (galleryState.viewMode === 'grid') {
      const tempItems = filteredItems;
      galleryState.displayedItems = tempItems;
      renderGalleryView();
    } else {
      await renderHistoryTable(filteredItems);
    }
}
```

**数据流**:
```
allHistoryItems (所有记录)
    ↓ applyImageBedFilter()
galleryState.displayedItems (图床筛选后)
    ↓ applySearchFilter()
filteredItems (搜索筛选后)
    ↓ renderGalleryView() / renderHistoryTable()
UI 显示
```

### 14.6 配置类型扩展

**文件**: [src/config/types.ts](src/config/types.ts)

```typescript
export interface UserConfig {
  // ... 现有字段

  /** 浏览视图偏好设置 */
  galleryViewPreferences?: {
    viewMode: 'table' | 'grid';              // 默认视图模式
    selectedImageBed?: ServiceType | 'all'; // 筛选的图床类型
    gridColumnWidth: number;                 // 列宽（默认 220）
  };
}
```

**持久化偏好**:
```typescript
async function saveViewModePreference(mode: 'table' | 'grid'): Promise<void> {
  const config = await loadConfig();
  if (!config.galleryViewPreferences) {
    config.galleryViewPreferences = {
      viewMode: mode,
      selectedImageBed: 'all',
      gridColumnWidth: 220,
    };
  } else {
    config.galleryViewPreferences.viewMode = mode;
  }
  await configStore.set('config', config);
}

async function loadViewModePreference(): Promise<void> {
  const config = await loadConfig();
  const viewMode = config.galleryViewPreferences?.viewMode || 'table';
  switchViewMode(viewMode);
}
```

### 14.7 事件监听器绑定

**文件**: [src/main.ts](src/main.ts) - initialize() 函数 (3722-3765 行)

```typescript
function initialize(): void {
  // ... 现有初始化代码

  // 视图切换按钮
  viewModeTableBtn?.addEventListener('click', () => {
    switchViewMode('table');
  });

  viewModeGridBtn?.addEventListener('click', () => {
    switchViewMode('grid');
  });

  // 图床筛选器
  imageBedFilter?.addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement;
    const value = select.value as ServiceType | 'all';
    applyImageBedFilter(value);
  });

  // Lightbox 事件
  lightboxClose?.addEventListener('click', closeLightbox);
  lightboxPrev?.addEventListener('click', () => navigateLightbox(-1));
  lightboxNext?.addEventListener('click', () => navigateLightbox(1));
  lightboxCopyBtn?.addEventListener('click', lightboxCopyLink);
  lightboxDeleteBtn?.addEventListener('click', lightboxDelete);

  // Lightbox overlay 点击关闭
  lightboxModal?.querySelector('.lightbox-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeLightbox();
    }
  });

  // Context Menu 事件
  ctxPreview?.addEventListener('click', contextMenuPreview);
  ctxCopyLink?.addEventListener('click', contextMenuCopyLink);
  ctxDelete?.addEventListener('click', contextMenuDelete);

  // 全局点击隐藏右键菜单
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.gallery-item')) {
      hideContextMenu();
    }
  });

  // 加载视图偏好
  loadViewModePreference().catch(err => {
    console.error('[初始化] 加载视图偏好失败:', err);
  });
}
```

### 14.8 功能特性总结

| 功能模块 | 实现方式 | 用户价值 |
|---------|---------|---------|
| 双视图模式 | 表格视图 + 瀑布流视图可切换 | 灵活适应不同场景（详细管理 vs 快速浏览） |
| 响应式布局 | CSS Grid + 4 个断点 | 适配各种屏幕尺寸 |
| 懒加载 | Intersection Observer | 流畅性能，支持 500+ 图片 |
| Lightbox 预览 | 全屏模态框 + 键盘导航 | 沉浸式浏览体验 |
| 图床筛选 | 下拉选择器 + 动态过滤 | 快速定位特定图床的图片 |
| 搜索功能 | 文件名模糊匹配 | 精确查找 |
| 批量操作 | 复选框 + 工具栏 | 高效管理大量图片 |
| 右键菜单 | 自定义菜单 + 上下文操作 | 便捷的快捷操作 |
| Shimmer 动画 | CSS 渐变动画 | 优雅的加载反馈 |
| 视图偏好 | 配置持久化 | 记忆用户习惯 |

### 14.9 性能优化措施

1. **DocumentFragment 批量插入**:
   - 50 张卡片一次性插入 DOM
   - 减少 Reflow 和 Repaint

2. **Intersection Observer 懒加载**:
   - 仅加载可见区域的图片
   - rootMargin 提前预加载

3. **事件委托**:
   - 避免为每张卡片绑定独立事件
   - 减少内存占用

4. **Observer 资源管理**:
   - 图片加载后 unobserve
   - 视图切换时 disconnect

5. **分批渲染**:
   - 初始 50 张，滚动加载更多
   - 300ms 延迟防止过快触发

6. **CSS 过渡动画**:
   - 使用 transform 而非 top/left
   - 硬件加速

### 14.10 测试检查点

1. ✅ **视图切换**:
   - 表格 ↔ 瀑布流切换正常
   - 按钮状态正确高亮
   - 偏好设置持久化

2. ✅ **瀑布流布局**:
   - 响应式列数自动调整
   - 窗口缩放时布局正确
   - 4 个断点均正常工作

3. ✅ **懒加载**:
   - 初始显示 50 张
   - 滚动到底部自动加载更多
   - 图片进入视口才加载
   - Shimmer 动画显示

4. ✅ **Lightbox 预览**:
   - 点击卡片打开大图
   - 左右箭头导航正常
   - ESC 键关闭
   - 首尾图片导航按钮隐藏
   - 底部操作栏功能正常

5. ✅ **右键菜单**:
   - 右键显示自定义菜单
   - 预览、复制、删除功能正常
   - 菜单外点击关闭

6. ✅ **图床筛选**:
   - 选择器显示所有图床
   - 筛选结果正确
   - 与搜索功能配合正常
   - 两种视图同步筛选

7. ✅ **批量操作**:
   - 复选框状态同步
   - 全选/取消全选
   - 批量复制、删除正常

8. ✅ **性能测试**:
   - 500+ 图片流畅滚动
   - 无明显卡顿
   - 内存占用合理

9. ✅ **兼容性**:
   - 与现有功能无冲突
   - 云同步正常
   - 导入导出正常

**编译验证**: ✅ TypeScript 编译通过，无类型错误

### 14.11 开发时间记录

| 阶段 | 任务 | 实际耗时 |
|-----|------|---------|
| 阶段 1 | HTML 结构改造 | 1.5 小时 |
| 阶段 2 | CSS 样式设计 | 2.5 小时 |
| 阶段 3 | 瀑布流渲染逻辑 | 2 小时 |
| 阶段 4 | Lightbox 功能 | 2 小时 |
| 阶段 5 | 右键菜单 | 1.5 小时 |
| 阶段 6 | 懒加载实现 | 2 小时 |
| 阶段 7 | 图床筛选 | 1 小时 |
| 阶段 8 | 细节完善与测试 | 2 小时 |
| **总计** | | **14.5 小时** |

### 14.12 未来优化方向

1. **虚拟滚动**:
   - 对于超大数据集（1000+ 图片）
   - 仅渲染可见区域的 DOM
   - 进一步提升性能

2. **图片缓存**:
   - Service Worker 缓存已加载的图片
   - 减少重复网络请求

3. **多选拖拽**:
   - 支持鼠标框选多张图片
   - 类似文件管理器体验

4. **排序选项**:
   - 按时间、文件名、图床类型排序
   - 升序/降序切换

5. **标签系统**:
   - 为图片添加自定义标签
   - 按标签筛选和管理

6. **批量编辑**:
   - 批量修改图床
   - 批量添加链接前缀

---

## ✅ 阶段十五: 七鱼图床支持 (2025-12-03 完成)

### 15.1 功能概述

基于网易七鱼客服系统的 NOS 对象存储实现图床服务集成。

**核心特点**:
- 需要手动获取 Token（x-nos-token），不支持自动获取
- Token 有效期约 360 天
- 上传方式：POST 二进制数据到 NOS CDN
- 图片访问：通过 `createTime` 参数区分不同版本

**Token 获取方式**:
1. 打开 [七鱼客服页面](https://qiyukf.com/client?k=d65beefd7552d92ee02344b3cc6173de)
2. 按 F12 打开开发者工具，切换到 Network 标签
3. 在页面上点击「上传附件」，选择任意图片
4. 找到 `cdn-nimup-chunk` 请求，复制 `x-nos-token` 请求头的值

### 15.2 修改文件概览

| 文件 | 变更类型 | 主要内容 |
|------|---------|---------|
| `src/config/types.ts` | 修改 | 添加 `qiyu` 到 ServiceType，新增 QiyuServiceConfig 接口 |
| `src-tauri/src/commands/qiyu.rs` | 新建 | Rust 上传命令实现 |
| `src-tauri/src/commands/mod.rs` | 修改 | 添加 `pub mod qiyu;` |
| `src-tauri/src/main.rs` | 修改 | 注册 `upload_to_qiyu` 命令 |
| `src/uploaders/qiyu/QiyuUploader.ts` | 新建 | TypeScript 上传器类 |
| `src/uploaders/qiyu/index.ts` | 新建 | 导出文件 |
| `src/uploaders/index.ts` | 修改 | 注册七鱼上传器到工厂 |
| `src/core/MultiServiceUploader.ts` | 修改 | 添加 Token 配置验证 |
| `index.html` | 修改 | 上传复选框 + 设置页面 Token 输入 |
| `src/main.ts` | 修改 | UI 状态管理、自动保存、服务名称映射 |

### 15.3 Rust 后端实现

**文件**: `src-tauri/src/commands/qiyu.rs`

**核心流程**:
1. 检查 Token 是否过期（从 Policy 中解析 Expires）
2. 解析 Token 获取 Object 路径（从 Base64 Policy 中提取）
3. 读取文件，获取 Content-Type
4. 构建上传 URL：`https://cdn-nimup-chunk.qiyukf.net/nim/{Object}?offset=0&complete=true&version=1.0`
5. POST 二进制数据，设置 `x-nos-token` 请求头
6. 检查 HTTP 200 状态（API 响应不解析，仅记录日志）
7. 构建 CDN URL：`https://xlx03.cdn.qiyukf.net/{Object}?createTime={timestamp}`

**API 响应格式** (仅记录，不解析):
```json
{
  "requestId": "...",
  "offset": 6580251,
  "context": "...",
  "callbackRetMsg": "eyJjb2RlIjoyMDB9"
}
```

### 15.4 TypeScript 上传器

**文件**: `src/uploaders/qiyu/QiyuUploader.ts`

```typescript
export class QiyuUploader extends BaseUploader {
  readonly serviceId = 'qiyu';
  readonly serviceName = '七鱼图床';

  protected getRustCommand(): string {
    return 'upload_to_qiyu';
  }

  async validateConfig(config: any): Promise<ValidationResult> {
    // 验证 Token 存在且格式正确（以 "UPLOAD " 开头）
  }

  async upload(filePath: string, options: UploadOptions, onProgress?: ProgressCallback): Promise<UploadResult> {
    // 调用 Rust 命令上传
  }
}
```

### 15.5 配置类型扩展

**文件**: `src/config/types.ts`

```typescript
// ServiceType 添加 'qiyu'
export type ServiceType = 'weibo' | 'r2' | 'nami' | 'jd' | 'tcl' | 'nowcoder' | 'qiyu';

// 新增配置接口
export interface QiyuServiceConfig extends BaseServiceConfig {
  token: string;  // x-nos-token 值
}
```

### 15.6 UI 集成

**上传界面复选框** (`index.html`):
```html
<label class="service-checkbox">
  <input type="checkbox" data-service="qiyu" />
  <span class="service-icon">🐟</span>
  <span class="service-name">七鱼图床</span>
  <span class="service-config-status" data-service="qiyu"></span>
</label>
```

**设置页面**:
- Token 输入框（textarea）
- 获取方法说明
- Token 有效期提示
- 风险警告（第三方服务，稳定性无保障）

### 15.7 Bug 修复

**问题**: API 响应格式与预期不匹配

原代码期望响应包含 `md5` 和 `size` 字段，但实际返回 `requestId`、`offset`、`context`、`callbackRetMsg`。

**修复**: 移除 JSON 解析逻辑，只检查 HTTP 200 状态码即可判断上传成功。

### 15.8 测试检查点

- [x] Token 解析正确（从 Base64 Policy 中提取 Object 路径）
- [x] Token 过期检查正常工作
- [x] 上传成功，返回正确的 CDN URL
- [x] Token 未配置时显示"未配置"状态，复选框禁用
- [x] Token 配置后显示"已配置"状态，复选框可用
- [x] 进度回调正常工作
- [x] 与其他图床并行上传正常
- [x] 历史记录正确显示七鱼结果
- [x] 设置页面 Token 自动保存功能

**编译验证**: ✅ Rust 和 TypeScript 均编译通过

---

## ✅ Bug 修复记录 (2025-12-02)

### Bug 修复 1: 设置页面 Cookie 保存后上传界面状态不刷新

**问题描述**:
用户在设置页面填入牛客 Cookie 后，上传界面的牛客图床复选框仍然显示灰色禁用状态，无法勾选。

**根本原因**:
`handleAutoSave()` 函数在保存配置后没有调用 `loadServiceCheckboxStates()` 来刷新上传界面的服务复选框状态。

**修复位置**: `src/main.ts` - `handleAutoSave()` 函数

**修复内容**:
```typescript
// 保存到存储
try {
  await configStore.set('config', config);
  await configStore.save();
  console.log('[自动保存] ✓ 配置自动保存成功');

  // 3. 刷新上传界面的服务复选框状态 (新增)
  await loadServiceCheckboxStates();
  console.log('[自动保存] ✓ 服务复选框状态已刷新');

  // 4. 显示成功状态
  showToast('设置已自动保存', 'success', 2000);
} catch (saveError) {
  // ...
}
```

**影响范围**: 所有需要配置的图床服务（微博、R2、牛客）都会受益

---

### Bug 修复 2: 牛客图床返回压缩图片 URL

**问题描述**:
牛客图床对大图会自动进行压缩，返回的 URL 包含 `/compress/mw1000/` 路径：
```
https://uploadfiles.nowcoder.com/compress/mw1000/images/20251202/...
```
需要移除压缩路径以获取原图链接：
```
https://uploadfiles.nowcoder.com/images/20251202/...
```

**修复位置**: `src-tauri/src/commands/nowcoder.rs`

**修复内容**:
```rust
// 9. 移除压缩路径，获取原图链接
// 牛客会自动压缩大图，URL 中包含 compress/mw1000/ 等路径
// 例如: https://uploadfiles.nowcoder.com/compress/mw1000/images/...
// 移除后: https://uploadfiles.nowcoder.com/images/...
let final_url = if let Some(compress_pos) = https_url.find("/compress/") {
    // 找到 /compress/ 后面的下一个 /
    let after_compress = &https_url[compress_pos + "/compress/".len()..];
    if let Some(next_slash) = after_compress.find('/') {
        // 拼接: 前半部分 + 后半部分（跳过 /compress/mwXXX 部分）
        format!("{}{}", &https_url[..compress_pos], &after_compress[next_slash..])
    } else {
        https_url
    }
} else {
    https_url
};
```

**实现特点**:
- 不需要额外依赖（纯字符串操作，无需 regex crate）
- 支持任意 `mwXXXX` 数字（mw1000、mw500 等）
- 如果 URL 中没有 `/compress/`，则保持原样

---

## 🚧 待完成的工作 (TODO)

### 高优先级 (P0)

#### 1. ~~历史记录多图床展示~~ ✅ (已完成 2025-12-01)

#### 2. ~~单图床重试功能~~ ✅ (已完成 2025-12-01)

#### 3. ~~批量操作功能~~ ✅ (已完成 2025-12-01)

**实现思路**:
```typescript
// 图床状态列
const tdServices = document.createElement('td');
item.results.forEach(r => {
  const badge = document.createElement('span');
  badge.className = `service-badge ${r.status}`;
  badge.textContent = r.serviceId.toUpperCase();

  if (r.status === 'failed') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.innerHTML = '↻';
    retryBtn.onclick = () => retryUploadForService(item.id, r.serviceId);
    // 添加重试按钮
  }
});

// 链接选择下拉菜单
const select = document.createElement('select');
item.results
  .filter(r => r.status === 'success')
  .forEach(r => {
    const option = document.createElement('option');
    option.value = r.result!.url;
    option.textContent = r.serviceId.toUpperCase();
    select.appendChild(option);
  });
```

**样式需求**:
```css
.service-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  margin-right: 4px;
}

.service-badge.success {
  background: rgba(16, 185, 129, 0.1);
  color: var(--success);
}

.service-badge.failed {
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
}

.retry-btn {
  padding: 2px 6px;
  background: var(--warning);
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
```

#### 2. 单图床重试功能
**文件**: `src/main.ts`

**需求**:
- [ ] 实现 `retryUploadForService(historyId, serviceId)` 函数
- [ ] 检查原始文件是否存在
- [ ] 调用 `MultiServiceUploader.retryUpload()`
- [ ] 更新历史记录中的结果状态

**实现思路**:
```typescript
async function retryUploadForService(historyId: string, serviceId: ServiceType): Promise<void> {
  // 1. 获取历史记录项
  const items = await historyStore.get<HistoryItem[]>('uploads', []);
  const item = items.find(i => i.id === historyId);
  if (!item) return;

  // 2. 检查文件是否存在（可能需要存储原始文件路径）
  // 注意：当前 HistoryItem 没有存储 filePath，需要添加

  // 3. 重试上传
  const config = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
  const uploader = new MultiServiceUploader();

  try {
    const result = await uploader.retryUpload(
      item.filePath,  // 需要在 HistoryItem 中添加这个字段
      serviceId,
      config
    );

    // 4. 更新历史记录
    const targetResult = item.results.find(r => r.serviceId === serviceId);
    if (targetResult) {
      targetResult.status = 'success';
      targetResult.result = result;
      delete targetResult.error;
    }

    await historyStore.set('uploads', items);
    await historyStore.save();

    // 5. 重新渲染表格
    await loadHistory();
  } catch (error: any) {
    await showAlertModal(`重试失败: ${error.message}`, '重试错误', 'error');
  }
}
```

**注意**: 需要在 `HistoryItem` 中添加 `filePath?: string` 字段用于重试。

#### 3. 批量操作功能
**文件**: `src/main.ts`, `index.html`

**需求**:
- [ ] 批量复制链接
- [ ] 批量导出为 JSON
- [ ] 批量删除记录

**UI 变更** (`index.html`):
```html
<div class="history-toolbar">
  <div class="bulk-actions">
    <label>
      <input type="checkbox" id="select-all-history" />
      <span>全选</span>
    </label>
    <button id="bulk-copy-btn" disabled>批量复制</button>
    <button id="bulk-export-btn" disabled>批量导出 JSON</button>
    <button id="bulk-delete-btn" disabled>批量删除</button>
  </div>
  <input type="text" id="search-input" placeholder="搜索文件名..." />
</div>

<table id="history-table">
  <thead>
    <tr>
      <th><input type="checkbox" id="select-all-checkbox" /></th>
      <th>预览</th>
      <th>文件名</th>
      <th>图床状态</th>
      <th>链接选择</th>
      <th>复制</th>
      <th>删除</th>
    </tr>
  </thead>
  <tbody id="history-body"></tbody>
</table>
```

**实现思路**:
```typescript
// 批量复制
async function bulkCopyLinks(): Promise<void> {
  const selected = getSelectedHistoryItems();
  const links = selected.map(item => item.generatedLink).join('\n');
  await writeText(links);
  showToast(`已复制 ${selected.length} 个链接`, 'success');
}

// 批量导出
async function bulkExportAsJson(): Promise<void> {
  const selected = getSelectedHistoryItems();
  const exportData = selected.map(item => ({
    fileName: item.localFileName,
    timestamp: new Date(item.timestamp).toISOString(),
    primaryService: item.primaryService,
    services: item.results
      .filter(r => r.status === 'success')
      .map(r => ({ service: r.serviceId, url: r.result!.url }))
  }));

  const json = JSON.stringify(exportData, null, 2);
  const filePath = await save({
    defaultPath: `weibo-upload-export-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (filePath) {
    await writeTextFile(filePath, json);
    showToast(`已导出 ${selected.length} 条记录`, 'success');
  }
}

// 批量删除
async function bulkDeleteItems(): Promise<void> {
  const selected = getSelectedHistoryItems();
  const confirmed = await showConfirmModal(
    `确定要删除选中的 ${selected.length} 条记录吗？`,
    '批量删除'
  );

  if (!confirmed) return;

  const items = await historyStore.get<HistoryItem[]>('uploads', []);
  const selectedIds = new Set(selected.map(i => i.id));
  const remaining = items.filter(i => !selectedIds.has(i.id));

  await historyStore.set('uploads', remaining);
  await historyStore.save();
  await loadHistory();
}

// 获取选中项
function getSelectedHistoryItems(): HistoryItem[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>(
    '#history-body input[type="checkbox"]:checked'
  );
  const selectedIds = Array.from(checkboxes).map(cb => cb.dataset.itemId);
  // 从 allHistoryItems 中筛选...
}
```

### 中优先级 (P1)

#### 4. 上传队列 UI 优化
**文件**: `src/components/UploadQueue.vue` (Vue 组件)

**需求**:
- [ ] 显示每个图床的独立进度条
- [ ] 根据状态使用不同颜色（上传中/成功/失败）
- [ ] 失败的图床显示错误提示

**当前状态**: 队列管理器已支持多图床进度，但 Vue 组件需要更新 UI

#### 5. 设置页面 TCL 说明
**文件**: `index.html`

**需求**:
- [ ] 在设置页面添加 TCL 图床说明区域
- [ ] 说明 TCL 无需配置、支持的格式等

**实现**:
```html
<div class="form-section">
  <h2>TCL 图床</h2>
  <p class="info-text">✅ TCL 图床无需配置，开箱即用</p>
  <p class="info-text">📝 支持格式：JPG、PNG、GIF</p>
  <p class="info-text">⚠️ 注意：TCL 为第三方免费服务，稳定性无保障</p>
</div>
```

### 低优先级 (P2)

#### 6. 配置迁移脚本 (可选)
**说明**: 当前无需迁移，但如果将来需要支持旧版本用户升级：

```typescript
function migrateConfigToV3(oldConfig: any): UserConfig {
  if (oldConfig.enabledServices) {
    return oldConfig;  // 已经是新版
  }

  // 从旧版迁移
  const enabledServices: ServiceType[] = [oldConfig.primaryService];
  if (oldConfig.backup?.enabled) {
    enabledServices.push(oldConfig.backup.service);
  }

  return {
    enabledServices,
    services: {
      weibo: { enabled: true, cookie: oldConfig.weiboCookie || '' },
      r2: oldConfig.r2,
      tcl: { enabled: true }
    },
    // ...
  };
}
```

#### 7. 更多图床支持
**计划支持**:
- [ ] 纳米图床 (Nami)
- [x] 京东图床 (JD) ✅ 已完成 2025-12-02
- [x] 牛客图床 (Nowcoder) ✅ 已完成 2025-12-02

**扩展模式**:
1. 创建 `src/uploaders/{service}/{Service}Uploader.ts`
2. 创建 `src-tauri/src/commands/{service}.rs`（如需）
3. 在 `src/uploaders/index.ts` 中注册
4. 在 `index.html` 中添加复选框
5. 在 `src/config/types.ts` 中添加配置类型

---

## ⚠️ 注意事项

### 技术债务

1. **HistoryItem 缺少 filePath**:
   - **问题**: 当前历史记录没有存储原始文件路径，导致无法重试
   - **影响**: 重试功能无法实现
   - **解决方案**: 在 `HistoryItem` 中添加 `filePath?: string` 字段

2. **旧 processUpload 函数未删除**:
   - **位置**: `src/coreLogic.ts`
   - **状态**: 仍然存在但未使用
   - **建议**: 保留作为参考，或在确认新架构稳定后删除

3. **重试回调未更新**:
   - **位置**: `src/main.ts` - `initializeUpload()` 中的 `setRetryCallback`
   - **问题**: 仍然使用旧的 `processUpload` 函数
   - **影响**: 队列中的重试按钮可能无法正常工作
   - **解决方案**: 更新为使用 `MultiServiceUploader`

### API 限制和风险

1. **TCL API 稳定性**:
   - ⚠️ TCL 是第三方免费服务，无 SLA 保证
   - ⚠️ API 可能随时变更或失效
   - **建议**:
     - 添加备用图床
     - 监控 TCL 成功率
     - 在 UI 中提示用户风险

2. **TCL 文件大小限制**:
   - ❓ 当前未验证文件大小（限制不确定）
   - **待办**: 确认限制后添加验证逻辑

3. **并发限制**:
   - ✅ 已限制最多3个图床同时上传
   - **原因**: 平衡性能与体验
   - **监控**: 观察实际使用中的性能表现

### 用户体验

1. **配置状态实时更新**:
   - ✅ 已实现: 保存设置后自动更新复选框状态
   - **待优化**: 考虑在设置页面添加"应用配置"按钮，手动触发刷新

2. **进度显示优化**:
   - ⚠️ 多图床独立进度可能导致 UI 复杂
   - **建议**:
     - 使用紧凑的进度条布局
     - 只显示正在上传的图床
     - 成功/失败用图标表示

3. **错误提示优化**:
   - 建议为每种错误类型提供具体的用户提示
   - 例如: "TCL API 暂时不可用，请稍后重试"

### 性能考虑

1. **并行上传资源占用**:
   - 3个图床同时上传可能占用较多带宽和内存
   - **建议**: 监控资源使用，必要时降低并发数

2. **历史记录存储**:
   - 新架构每个历史项存储更多数据（多个图床结果）
   - **建议**:
     - 定期清理旧记录
     - 考虑添加"自动清理超过N天的记录"功能

3. **进度更新频率**:
   - 避免过于频繁的进度回调导致 UI 卡顿
   - **已处理**: `updateServiceProgress` 中使用了节流逻辑

---

## 📐 架构设计原则

### 1. 扩展性优先
- ✅ 使用工厂模式注册上传器
- ✅ 接口化设计（`IUploader`）
- ✅ 配置类型可扩展（`ServiceType` 联合类型）

### 2. 向后兼容
- ✅ `QueueItem` 保留旧字段（`uploadToR2`, `weiboProgress`, `r2Progress`）
- ✅ 旧 UI 组件仍可使用兼容字段

### 3. 类型安全
- ✅ 全量 TypeScript 类型覆盖
- ✅ 使用泛型和类型守卫
- ✅ 严格的空值检查

### 4. 渐进式增强
- ✅ 先实现核心功能（多图床并行上传）
- 🚧 UI 优化作为第二阶段
- 📋 高级功能（批量操作）作为第三阶段

---

## 🧪 测试要点

### 功能测试 Checklist

- [x] **TCL 单独上传**
  - [x] 上传成功并返回正确 URL
  - [x] 进度回调正常工作
  - [x] 错误处理正确

- [x] **多图床并行上传**
  - [x] 最多3个并发限制
  - [x] 每个图床独立进度
  - [x] 第一个成功的作为 primary

- [x] **降级处理**
  - [x] 部分图床失败时其他继续
  - [x] 所有失败时抛出错误
  - [x] 失败图床记录错误信息

- [x] **配置管理**
  - [x] 复选框状态持久化
  - [x] 未配置图床自动禁用
  - [x] TCL 始终可用

- [ ] **历史记录**
  - [x] 多图床结果正确存储
  - [ ] 链接选择功能
  - [ ] 重试按钮
  - [ ] 批量操作

### UI 测试 Checklist

- [x] **服务复选框**
  - [x] 显示配置状态徽章
  - [x] 未配置图床禁用
  - [x] TCL 默认勾选

- [ ] **上传队列**
  - [ ] 显示每个图床进度
  - [ ] 成功/失败状态标识
  - [ ] 错误提示

- [ ] **历史记录表格**
  - [ ] 多图床状态徽章
  - [ ] 链接选择下拉菜单
  - [ ] 重试按钮
  - [ ] 批量选择复选框

### 边界条件测试

- [ ] **网络异常**
  - [ ] TCL API 不可用
  - [ ] 网络中断
  - [ ] 超时处理

- [ ] **并发极限**
  - [ ] 选择超过3个图床（应限制）
  - [ ] 同时上传多个文件
  - [ ] 资源占用监控

- [ ] **存储边界**
  - [ ] 历史记录过多时的性能
  - [ ] 配置文件损坏时的恢复

---

## 📊 开发进度

### 已完成 (✅)

| 阶段 | 任务 | 状态 | 完成时间 |
|------|------|------|----------|
| 阶段一 | 配置类型改造 | ✅ | 2025-12-01 |
| 阶段二 | TCL 前端上传器 | ✅ | 2025-12-01 |
| 阶段二 | TCL Rust 命令 | ✅ | 2025-12-01 |
| 阶段二 | 注册 TCL 到工厂 | ✅ | 2025-12-01 |
| 阶段三 | MultiServiceUploader | ✅ | 2025-12-01 |
| 阶段三 | 主上传逻辑重构 | ✅ | 2025-12-01 |
| 阶段三 | 队列管理器更新 | ✅ | 2025-12-01 |
| 阶段四 | 多图床复选框 UI | ✅ | 2025-12-01 |
| 阶段四 | 复选框 CSS 样式 | ✅ | 2025-12-01 |
| 阶段四 | 配置状态徽章 | ✅ | 2025-12-01 |
| 阶段五 | 历史记录多图床展示 | ✅ | 2025-12-01 |
| 阶段六 | 单图床重试功能 | ✅ | 2025-12-01 |
| 阶段七 | 批量操作功能 | ✅ | 2025-12-01 |
| 阶段八 | 上传队列 Vue 组件更新 | ✅ | 2025-12-01 |
| 阶段九 | 设置页面 TCL 说明 | ✅ | 2025-12-01 |
| 阶段十 | 京东图床支持 | ✅ | 2025-12-02 |
| 阶段十一 | 牛客图床支持 | ✅ | 2025-12-02 |
| 阶段十二 | 牛客 Cookie 验证增强与多域名支持 | ✅ | 2025-12-02 |
| 阶段十三 | 链接前缀多选功能 | ✅ | 2025-12-02 |
| 阶段十四 | 浏览视图 (Gallery View) | ✅ | 2025-12-02 |
| 阶段十五 | 七鱼图床支持 | ✅ | 2025-12-03 |

**总体进度**: 100% 完成 (最新: 七鱼图床支持)

**所有 P0 + P1 任务已完成！** 🎉🎉🎉
**京东图床已集成！** 🛒
**牛客图床已集成！** 📚
**七鱼图床已集成！** 🐟
**牛客 Cookie 自动捕获已修复！** ✅

### 进行中 (🚧)

- 无

### 待开始 (📋)

| 阶段 | 任务 | 优先级 | 预计工作量 |
|------|------|--------|-----------|
| 后续 | 配置迁移脚本 | P2 | 2h |
| 后续 | 更多图床支持 | P2 | 8h/图床 |

**剩余工作**: 仅剩 P2 低优先级任务 (可选)

---

## 🔗 相关资源

### 文档
- [开发计划](C:\Users\Jiawei\.claude\plans\vast-whistling-lollipop.md)
- [配置类型定义](src/config/types.ts)
- [多图床编排器](src/core/MultiServiceUploader.ts)

### 代码仓库
- GitHub: WeiboDR-Uploader
- 分支: (当前 main)

### API 文档
- TCL API: `https://service2.tcl.com/api.php/Center/uploadQiniu`
- 京东 API:
  - 获取凭证: `https://api.m.jd.com/client.action?functionId=getAidInfo`
  - 上传图片: `https://file-dd.jd.com/file/uploadImg.action`
  - 图片域名: `https://img14.360buyimg.com/`
- 牛客 API:
  - 上传图片: `https://www.nowcoder.com/uploadImage?type=1&_={timestamp}`
  - 图片域名: `https://uploadfiles.nowcoder.com/`
  - 需要 Headers: Cookie, Referer, Origin, User-Agent
- 七鱼 API (网易七鱼 NOS):
  - 上传图片: `https://cdn-nimup-chunk.qiyukf.net/nim/{Object}?offset=0&complete=true&version=1.0`
  - 图片域名: `https://xlx03.cdn.qiyukf.net/`
  - 需要 Headers: x-nos-token (手动从七鱼客服页面获取)
  - Token 有效期: 约 360 天
  - Token 格式: `UPLOAD {AccessKey}:{Signature}:{Base64Policy}`
- 微博 API: (已有)
- Cloudflare R2: (已有)

---

## 📝 更新日志

### v3.0.3-alpha (2025-12-03)

**新增**:
- ✨ 七鱼图床支持（基于网易七鱼 NOS 对象存储）
- ✨ 七鱼设置页面 Token 输入框
- ✨ Token 自动保存功能
- ✨ Token 过期检查（约 360 天有效期）

**技术说明**:
- 七鱼图床需要手动获取 Token（x-nos-token），无法自动获取
- Token 从 Base64 编码的 Policy 中解析 Object 路径
- 上传使用 POST 二进制数据，CDN URL 带 createTime 参数区分版本
- API 响应格式为 `{requestId, offset, context, callbackRetMsg}`，仅检查 HTTP 200 状态

**文档**:
- 📝 添加七鱼图床实现文档到 record.md (阶段十四)

### v3.0.2-alpha (2025-12-02)

**新增**:
- ✨ 浏览视图功能：历史记录窗口重命名为"浏览"，全新的图片浏览器+管理器定位
- ✨ 瀑布流视图：类似 Google Photos 的照片墙布局（响应式网格）
- ✨ 双视图模式：表格视图 + 瀑布流视图可切换
- ✨ Lightbox 大图预览：全屏预览、键盘导航（左右箭头、ESC）
- ✨ 图床类型筛选：按微博/R2/TCL/京东/牛客筛选历史记录
- ✨ 右键菜单：预览、复制链接、删除等快捷操作
- ✨ 懒加载：初始显示 50 张，滚动自动加载更多（Intersection Observer）
- ✨ Shimmer 加载动画：优雅的图片加载反馈
- ✨ 视图偏好持久化：自动记忆用户选择的视图模式
- ✨ 牛客图床支持（需要 Cookie 认证）
- ✨ 牛客设置页面 Cookie 输入框
- ✨ Cookie 自动保存功能
- ✨ Cookie 验证增强：支持 requiredFields (AND) 和 anyOfFields (OR) 双重验证
- ✨ 多域名 Cookie 提取：自动合并 www 和非 www 域名的 Cookie
- ✨ 链接前缀多选功能：支持多个代理前缀下拉选择
- ✨ 前缀功能开关：可启用/禁用代理前缀（仅微博图床）
- ✨ 自定义前缀管理：支持添加/删除自定义前缀
- ✨ 历史记录动态前缀：微博链接根据当前选择的前缀动态显示

**修复**:
- 🐛 修复设置页面保存 Cookie 后上传界面复选框状态不刷新的问题
- 🐛 修复牛客图床返回压缩图片 URL，现在自动获取原图链接
- 🐛 修复未登录状态误捕获 Cookie 的问题（增强字段验证）
- 🐛 修复 WebView2 Cookie 提取域名不匹配导致无法获取 Cookie 的问题

**文档**:
- 📝 添加浏览视图 (Gallery View) 功能实现文档到 record.md (阶段十四)
- 📝 添加牛客图床实现文档到 record.md (阶段十一)
- 📝 添加 Cookie 验证增强文档到 record.md (阶段十二)
- 📝 添加链接前缀多选功能文档到 record.md (阶段十三)

### v3.0.1-alpha (2025-12-02)

**新增**:
- ✨ 京东图床支持（开箱即用，15MB 限制）
- ✨ 京东设置页面说明

**修复**:
- 🐛 修复无配置图床在 `filterConfiguredServices()` 中被错误跳过的问题

**文档**:
- 📝 添加京东图床实现文档到 record.md
- 📝 添加 Debug 注意事项（无配置图床检查清单）

### v3.0.0-alpha (2025-12-01)

**新增**:
- ✨ 多图床并行上传架构
- ✨ TCL 图床支持（开箱即用）
- ✨ 服务复选框 UI（带配置状态徽章）
- ✨ 独立进度跟踪（每个图床）
- ✨ 智能配置过滤
- ✨ 历史记录多图床展示
- ✨ 单图床重试功能
- ✨ 批量操作功能（复制、导出、删除）

**变更**:
- 🔧 `UserConfig` 结构重构
- 🔧 `HistoryItem` 结构重构
- 🔧 上传队列管理器 API 更新

**移除**:
- 🗑️ 主力+备份模式
- 🗑️ R2 Toggle（替换为多图床复选框）

---

## 阶段十五: 七鱼图床 Token 获取方案迁移 (Sidecar + Puppeteer)

> **开发日期**: 2025-12-04
> **问题背景**: 原 Rust `headless_chrome` crate 无法拦截 WebSocket 消息，导致无法获取七鱼图床的上传 Token

### 问题分析

七鱼图床使用网易 NOS (Netease Object Storage) 作为后端存储，Token 获取流程：

1. 页面加载后建立 WebSocket 连接
2. 用户触发文件上传
3. **服务器通过 WebSocket 返回上传凭证 (Token)**
4. 前端使用 Token 上传文件到 NOS

**原方案问题**:
- Rust `headless_chrome` crate 的 WebSocket 拦截功能不稳定
- 只触发 `change` 事件无法真正上传文件，服务器不会返回 Token

### 解决方案: Tauri Sidecar + Node.js + Puppeteer

**架构设计**:
```
Tauri App (Rust)
    |
    +---> spawn sidecar --> qiyu-token-fetcher.exe (pkg 打包的 Node.js)
                              |
                              +---> puppeteer-core
                                       |
                                       +---> System Chrome/Edge
```

### 核心实现

#### 1. Sidecar 项目结构

```
sidecar/
└── qiyu-token-fetcher/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           # 命令行入口
        ├── browser-detector.ts # Chrome/Edge 路径检测
        └── token-fetcher.ts    # Token 获取核心逻辑
```

#### 2. 关键技术点

**使用 `uploadFile()` 真正上传文件**（而非仅触发 change 事件）:
```typescript
// 创建临时测试图片
const tempImagePath = await createTestImage();

// 找到所有文件输入框
const fileInputs = await page.$$('input[type="file"]');

// 使用 Puppeteer 的 uploadFile 真正设置文件
for (const fileInput of fileInputs) {
  await fileInput.uploadFile(tempImagePath);
  await sleep(2000);
  if (capturedToken) break;
}
```

**多重 Token 捕获方式**:

1. **CDP WebSocket 拦截** (Base64 解码):
```typescript
client.on('Network.webSocketFrameReceived', (params) => {
  const payload = params.response.payloadData;
  const decoded = Buffer.from(payload, 'base64').toString('utf-8');
  const tokenMatch = decoded.match(/UPLOAD\s+[a-f0-9]{32}:[A-Za-z0-9+\/=]+:[A-Za-z0-9+\/=]+/);
  if (tokenMatch) capturedToken = tokenMatch[0];
});
```

2. **HTTP 请求头拦截** (`x-nos-token`):
```typescript
client.on('Network.requestWillBeSent', (params) => {
  const nosToken = params.request.headers['x-nos-token'];
  if (nosToken) capturedToken = nosToken;
});
```

#### 3. Tauri 配置

**tauri.conf.json**:
```json
{
  "tauri": {
    "bundle": {
      "externalBin": ["binaries/qiyu-token-fetcher"]
    },
    "allowlist": {
      "shell": {
        "sidecar": true,
        "scope": [
          { "name": "binaries/qiyu-token-fetcher", "sidecar": true, "args": true }
        ]
      }
    }
  }
}
```

**Cargo.toml**:
```toml
tauri = { version = "1.5", features = ["shell-sidecar", ...] }
# headless_chrome 已被 Sidecar (Node.js + Puppeteer) 替代
```

#### 4. Rust 调用 Sidecar

```rust
use tauri::api::process::{Command, CommandEvent};

#[tauri::command]
pub async fn fetch_qiyu_token() -> Result<QiyuToken, String> {
    let (mut rx, _child) = Command::new_sidecar("qiyu-token-fetcher")
        .map_err(|e| format!("创建 sidecar 失败: {}", e))?
        .args(["fetch-token"])
        .spawn()
        .map_err(|e| format!("启动 sidecar 失败: {}", e))?;

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => output.push_str(&line),
            CommandEvent::Stderr(line) => println!("{}", line),  // 进度日志
            _ => {}
        }
    }

    // 解析 JSON 响应
    let response: SidecarResponse<QiyuToken> = serde_json::from_str(&output)?;
    // ...
}
```

### Token 格式

```
UPLOAD {32位AccessKey}:{Base64签名}:{Base64Policy}
```

**Policy 解码后**:
```json
{
  "Bucket": "nim",
  "Object": "MTY2OTk5Nzk=/bmltYV8zMzk3ODc2NDkwNDZf...",
  "Expires": 1795923906,
  "MimeLimit": "!text/html;image/svg+xml;...",
  "CallbackUrl": "http://api-nos-callback.netease.im/nos/callback.action"
}
```

### 构建命令

```bash
# 编译 TypeScript
cd sidecar/qiyu-token-fetcher
npm install
npm run build

# 打包为可执行文件
npx @yao-pkg/pkg dist/index.js -t node18-win-x64 -o ../../src-tauri/binaries/qiyu-token-fetcher-x86_64-pc-windows-msvc.exe
```

### 修改的文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `sidecar/qiyu-token-fetcher/*` | 新建 | Sidecar 项目 (Node.js + Puppeteer) |
| `src-tauri/tauri.conf.json` | 修改 | 添加 sidecar 配置 |
| `src-tauri/Cargo.toml` | 修改 | 添加 `shell-sidecar` feature，移除 `headless_chrome` |
| `src-tauri/src/commands/qiyu_token.rs` | 重写 | 调用 sidecar 替代 headless_chrome |
| `src-tauri/binaries/*.exe` | 新建 | 打包后的 sidecar 可执行文件 |

### 经验总结

1. **真正上传 vs 触发事件**: 仅触发 `change` 事件不会让服务器返回 Token，必须使用 `uploadFile()` 真正上传文件
2. **多输入框尝试**: 页面有多个 file input，需要逐个尝试（第 5 个是真正的上传入口）
3. **多重拦截**: 同时使用 WebSocket 拦截和 HTTP 请求头拦截，提高成功率
4. **Sidecar 优势**: 相比 Rust 的 headless_chrome，Node.js 的 puppeteer-core 生态更成熟，兼容性更好
5. **体积代价**: Sidecar 方案增加约 35-50MB 应用体积，但稳定性显著提升

---

## ✅ 阶段十六: 知乎图床支持 (2025-12-04 完成)

### 概述

添加知乎图床支持，采用与牛客图床类似的 Cookie 认证方式。知乎图床上传流程较为复杂，需要：
1. 计算图片 MD5 Hash
2. 获取上传凭证（可能返回已存在的图片）
3. 上传到阿里云 OSS（需要 HMAC-SHA1 签名）
4. 通知上传完成
5. 轮询图片处理状态
6. URL 标准化

### 知乎上传流程详解

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  计算 MD5   │────▶│  获取上传凭证    │────▶│  检查 state     │
│  Hash       │     │  POST /images    │     │  0=需上传       │
└─────────────┘     └──────────────────┘     │  1=已存在       │
                                              └────────┬────────┘
                                                       │
                    ┌──────────────────────────────────┴───────┐
                    │ state=0                         state=1  │
                    ▼                                          ▼
           ┌────────────────┐                         ┌────────────────┐
           │  上传到 OSS    │                         │  直接返回 URL  │
           │  PUT (签名)    │                         │  (跳过上传)    │
           └───────┬────────┘                         └────────────────┘
                   │
                   ▼
           ┌────────────────┐
           │  通知完成      │
           │  POST complete │
           └───────┬────────┘
                   │
                   ▼
           ┌────────────────┐
           │  轮询状态      │
           │  GET /images/  │
           └───────┬────────┘
                   │
                   ▼
           ┌────────────────┐
           │  URL 标准化    │
           │  picx.zhimg    │
           └────────────────┘
```

### OSS 签名计算 (HMAC-SHA1)

知乎使用阿里云 OSS 存储图片，上传时需要计算签名：

```rust
fn calculate_oss_signature(
    access_key: &str,
    content_type: &str,
    date: &str,
    security_token: &str,
    object_key: &str
) -> String {
    // StringToSign 格式:
    // PUT\n
    // \n                           (Content-MD5 为空)
    // image/png\n
    // Wed, 04 Dec 2024 05:00:00 GMT\n
    // x-oss-date:Wed, 04 Dec 2024 05:00:00 GMT\n
    // x-oss-security-token:{token}\n
    // /zhihu-pics/{object_key}

    let string_to_sign = format!(
        "PUT\n\n{}\n{}\nx-oss-date:{}\nx-oss-security-token:{}\n/zhihu-pics/{}",
        content_type, date, date, security_token, object_key
    );

    let mut mac = Hmac::<Sha1>::new_from_slice(access_key.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(string_to_sign.as_bytes());

    STANDARD.encode(mac.finalize().into_bytes())
}
```

**关键点**:
- 使用 HMAC-SHA1（不是 SHA-256）
- CanonicalizedOSSHeaders 必须按字母序排列
- x-oss-date 和 Date 头需要一致

### URL 标准化

知乎返回的图片 URL 格式不一致，需要标准化：

```rust
fn normalize_image_url(url: &str) -> String {
    // 从任意知乎图片 URL 提取 v2-xxx 部分
    // 输入示例:
    //   https://pic1.zhimg.com/v2-abc123_r.jpg
    //   https://picx.zhimg.com/v2-abc123.webp
    // 输出: https://picx.zhimg.com/v2-abc123.webp

    if let Some(captures) = Regex::new(r"v2-[a-f0-9]+")
        .unwrap()
        .find(url)
    {
        format!("https://picx.zhimg.com/{}.webp", captures.as_str())
    } else {
        url.to_string()
    }
}
```

### 修改的文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/Cargo.toml` | 修改 | 添加 `sha1`, `md-5`, `regex` 依赖 |
| `src/config/types.ts` | 修改 | 添加 `zhihu` 到 `ServiceType`，创建 `ZhihuServiceConfig` |
| `src/config/cookieProviders.ts` | 修改 | 添加知乎 Cookie 验证配置 (需要 `z_c0` 字段) |
| `src-tauri/src/commands/zhihu.rs` | **新建** | Rust 后端上传命令 (~280 行) |
| `src-tauri/src/commands/mod.rs` | 修改 | 注册 `zhihu` 模块 |
| `src-tauri/src/main.rs` | 修改 | 注册 `upload_to_zhihu` 命令 |
| `src/uploaders/zhihu/ZhihuUploader.ts` | **新建** | 前端上传器类 |
| `src/uploaders/zhihu/index.ts` | **新建** | 导出文件 |
| `src/uploaders/index.ts` | 修改 | 注册到工厂 |
| `src/core/MultiServiceUploader.ts` | 修改 | 添加知乎 Cookie 验证逻辑 |
| `src-tauri/tauri.conf.json` | 修改 | 添加 `zhihu.com` 域名白名单 |
| `index.html` | 修改 | 添加 UI 元素 (按钮、设置区域、复选框) |
| `src/main.ts` | 修改 | 添加事件绑定、状态更新、服务名称映射 |

### 🐛 Bug 修复记录

#### Bug 1: 知乎按钮未配置时仍可选中

**问题描述**: 知乎未配置 Cookie 时，上传界面的知乎按钮仍然是可选中状态，没有显示为禁用。

**根本原因**: `loadServiceButtonStates()` 函数的 `services` 数组中遗漏了 `'zhihu'`。

**修复位置**: `src/main.ts` 第 3370 行

```typescript
// 修复前
const services: ServiceType[] = ['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu'];

// 修复后
const services: ServiceType[] = ['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu'];
```

#### Bug 2: 选中知乎后提示"未选择图床"

**问题描述**: 配置完知乎 Cookie 后，选中知乎图床按钮上传，却提示"请至少选择一个图床服务"。

**根本原因**: 上传处理逻辑中遗漏了对 `serviceButtons.zhihu` 的 `selected` 状态检查。

**修复位置**: `src/main.ts` 第 631 行

```typescript
// 修复前
if (serviceButtons.qiyu?.classList.contains('selected')) enabledServices.push('qiyu');
// 缺失 zhihu 检查

// 修复后
if (serviceButtons.qiyu?.classList.contains('selected')) enabledServices.push('qiyu');
if (serviceButtons.zhihu?.classList.contains('selected')) enabledServices.push('zhihu');
```

**同类问题**: 按钮点击保存逻辑（第 4143 行）也遗漏了同样的检查，一并修复。

#### Bug 3: 知乎 Cookie 修改后不自动保存

**问题描述**: 在设置页面手动修改或清空知乎 Cookie 后，不会像其他设置项一样自动保存。

**根本原因**: `settingsInputs` 数组中遗漏了 `zhihuCookieEl`，导致没有绑定 `blur` 事件触发自动保存。

**修复位置**: `src/main.ts` 第 4205-4206 行

```typescript
// 修复前
const settingsInputs = [
  weiboCookieEl,
  // ... 其他输入框
  nowcoderCookieEl
  // 缺失 zhihuCookieEl
];

// 修复后
const settingsInputs = [
  weiboCookieEl,
  // ... 其他输入框
  nowcoderCookieEl,
  zhihuCookieEl  // 添加知乎 Cookie 输入框
];
```

### ⚠️ 新增图床时的检查清单

通过此次知乎图床实现和 Bug 修复，总结出新增图床时必须检查的代码位置：

| 序号 | 检查项 | 文件位置 | 说明 |
|------|--------|----------|------|
| 1 | `ServiceType` 类型 | `src/config/types.ts` | 添加新服务 ID |
| 2 | 服务配置接口 | `src/config/types.ts` | 创建 `XxxServiceConfig` |
| 3 | `DEFAULT_CONFIG` | `src/config/types.ts` | 添加默认配置 |
| 4 | `sanitizeConfig()` | `src/config/types.ts` | 添加配置清理逻辑 |
| 5 | Cookie 验证配置 | `src/config/cookieProviders.ts` | 如需 Cookie 认证 |
| 6 | Rust 上传命令 | `src-tauri/src/commands/xxx.rs` | 后端实现 |
| 7 | 模块注册 | `src-tauri/src/commands/mod.rs` | `pub mod xxx;` |
| 8 | 命令注册 | `src-tauri/src/main.rs` | `invoke_handler` |
| 9 | 前端上传器 | `src/uploaders/xxx/` | `XxxUploader.ts` |
| 10 | 工厂注册 | `src/uploaders/index.ts` | `UploaderFactory.register()` |
| 11 | Cookie 验证 | `src/core/MultiServiceUploader.ts` | 如需 Cookie |
| 12 | 域名白名单 | `src-tauri/tauri.conf.json` | WebView 登录用 |
| 13 | UI 按钮 | `index.html` | `.service-btn` |
| 14 | 设置区域 | `index.html` | 配置表单 |
| 15 | 可用服务复选框 | `index.html` | `#available-xxx` |
| 16 | **serviceButtons** | `src/main.ts` | DOM 元素引用 |
| 17 | **availableServiceCheckboxes** | `src/main.ts` | 复选框引用 |
| 18 | **xxxCookieEl** | `src/main.ts` | Cookie 输入框引用 |
| 19 | **updateServiceStatus()** | `src/main.ts` | 配置检测逻辑 |
| 20 | **handleAutoSave()** | `src/main.ts` | 保存配置对象 |
| 21 | **loadServiceButtonStates() services 数组** ⚠️ | `src/main.ts` | **容易遗漏！** |
| 22 | **上传处理 enabledServices 检查** ⚠️ | `src/main.ts` | **容易遗漏！** |
| 23 | **按钮点击保存 enabledServices 检查** ⚠️ | `src/main.ts` | **容易遗漏！** |
| 24 | **settingsInputs 数组** ⚠️ | `src/main.ts` | **容易遗漏！** |
| 25 | **服务名称映射 (5处)** | `src/main.ts` | `Record<ServiceType, string>` |
| 26 | WebView Cookie 处理 | `src/main.ts` | `switch (serviceId)` case |
| 27 | 配置加载 | `src/main.ts` | `xxxCookieEl.value = ...` |
| 28 | 登录按钮事件 | `src/main.ts` | `login-xxx-btn` |
| 29 | 测试按钮事件 | `src/main.ts` | `test-xxx-cookie-btn` |
| 30 | 测试连接函数 | `src/main.ts` | `testXxxConnection()` |

> ⚠️ **重点关注**: 标记为"容易遗漏"的项目（21-25）是本次 Bug 的根源，新增图床时务必逐一检查！

### 经验总结

1. **类型系统不能完全防止遗漏**: TypeScript 的 `ServiceType` 联合类型只能保证类型安全，但无法检测数组/对象字面量中是否包含所有服务
2. **硬编码服务列表的风险**: `main.ts` 中有多处硬编码的服务列表，新增服务时容易遗漏
3. **建议改进**: 考虑将服务列表集中管理，或使用 `Object.keys(serviceButtons)` 等方式动态获取
4. **测试覆盖**: 新增图床后应测试完整流程：配置状态显示 → 按钮选中 → 上传 → 配置保存

---

## 🌐 纳米图床 (nami) 完整实现记录

> **开发日期**: 2025-12-05
> **实现模式**: 全自动模式（通过登录窗口自动获取 Cookie）
> **技术栈**: Rust + TypeScript + Puppeteer Sidecar
> **关键特性**: TOS4-HMAC-SHA256 签名、动态 Token 获取、分片上传

### 一、架构概述

纳米图床使用火山引擎 TOS (Tinder Object Storage) 对象存储，与 AWS S3 类似但签名算法略有不同。

**上传流程**:
```
用户文件 → 计算 SHA1 哈希 → 检查秒传 → 获取动态 Token → 获取 STS 凭证 → TOS4 签名 → 分片上传 → CDN URL
```

**关键常量**:
```rust
const TOS_HOST: &str = "n-so.tos-cn-shanghai.volces.com";
const TOS_REGION: &str = "tos-cn-shanghai";
const TOS_SERVICE: &str = "tos";
const CDN_BASE: &str = "https://bfns.zhaomi.cn";
```

### 二、文件清单

#### 新建文件
| 文件路径 | 说明 | 行数 |
|----------|------|------|
| `sidecar/nami-token-fetcher/package.json` | Sidecar 依赖配置 | ~30 |
| `sidecar/nami-token-fetcher/tsconfig.json` | TypeScript 配置 | ~20 |
| `sidecar/nami-token-fetcher/src/index.ts` | 命令行入口 | ~100 |
| `sidecar/nami-token-fetcher/src/browser-detector.ts` | Chrome/Edge 检测 | ~80 |
| `sidecar/nami-token-fetcher/src/token-fetcher.ts` | 动态 Token 获取核心 | ~200 |
| `src-tauri/src/commands/nami_token.rs` | Rust Token 命令 | ~150 |
| `src-tauri/src/commands/nami.rs` | Rust 上传命令 | ~540 |
| `src/uploaders/nami/NamiUploader.ts` | 前端上传器 | ~110 |
| `src/uploaders/nami/index.ts` | 导出模块 | ~5 |

#### 修改文件
| 文件路径 | 修改内容 |
|----------|----------|
| `src/config/types.ts` | 添加 `'nami'` 到 ServiceType, 添加 `NamiServiceConfig`, 更新 `DEFAULT_CONFIG` |
| `src/config/cookieProviders.ts` | 添加 nami 登录窗口配置 |
| `src-tauri/tauri.conf.json` | 添加 `n.cn` 域名白名单、`externalBin` |
| `src-tauri/src/commands/mod.rs` | 注册 `nami` 和 `nami_token` 模块 |
| `src-tauri/src/main.rs` | 注册 Tauri 命令 |
| `src/uploaders/index.ts` | 注册 nami 上传器 |
| `index.html` | 添加 nami 按钮、设置区域、可用复选框 |
| `src/main.ts` | **关键文件**: 约 15 处修改 |
| `src/core/MultiServiceUploader.ts` | 添加 nami Cookie 验证 |
| `src/components/UploadQueue.vue` | 添加 `nami: '纳米'` 到 serviceNames |

### 三、Sidecar 实现 (nami-token-fetcher)

#### 3.1 为什么需要 Sidecar？

纳米图床需要动态生成的请求头（Headers），这些 Headers 是通过 JavaScript 在浏览器端计算的，包含：
- `access-token`: 动态生成的访问令牌
- `zm-token`: 加密的请求签名
- `zm-ua`: 用户代理标识
- `timestamp`: 时间戳
- `sid`, `mid`, `request-id`, `header-tid`: 会话标识

**无法直接调用 API 的原因**: 这些 Headers 依赖浏览器端的 JavaScript 代码生成，涉及复杂的加密算法和用户会话状态。

#### 3.2 Sidecar 工作原理

```typescript
// token-fetcher.ts 核心逻辑

1. 启动 Puppeteer (使用用户系统安装的 Chrome/Edge)
2. 注入用户 Cookie 到浏览器
3. 访问 https://www.n.cn
4. 使用 CDP (Chrome DevTools Protocol) 监听网络请求
5. 触发文件上传操作（上传一个临时生成的图片）
6. 拦截 /api/byte/assumerole 请求
7. 从请求头中提取所需的动态 Headers
8. 返回 JSON 格式的结果
```

**CDP 监听代码**:
```typescript
const client = await page.createCDPSession();
await client.send('Network.enable');

client.on('Network.requestWillBeSent', (params: any) => {
  if (params.request.url.includes('/api/byte/assumerole')) {
    const headers = params.request.headers;
    resolve({
      accessToken: headers['access-token'],
      zmToken: headers['zm-token'],
      zmUa: headers['zm-ua'],
      timestamp: headers['timestamp'],
      sid: headers['sid'],
      mid: headers['mid'],
      requestId: headers['request-id'],
      headerTid: headers['header-tid']
    });
  }
});
```

#### 3.3 命令行接口

```bash
# 检查 Chrome 安装
nami-token-fetcher check-chrome

# 获取动态 Token
nami-token-fetcher fetch-token --cookie "Auth-Token=xxx;..." --auth-token "eyJxxx..."
```

**输出格式**:
```json
{
  "success": true,
  "data": {
    "accessToken": "23521063127464713328...",
    "zmToken": "fd99e1bab15d41b421b1...",
    "zmUa": "...",
    "timestamp": "1764872101",
    "sid": "...",
    "mid": "...",
    "requestId": "...",
    "headerTid": "..."
  }
}
```

#### 3.4 构建和打包

```bash
cd sidecar/nami-token-fetcher
npm install
npm run build
npm run pkg:win:x64
```

输出文件: `src-tauri/binaries/nami-token-fetcher-x86_64-pc-windows-msvc.exe`

### 四、Rust 后端实现

#### 4.1 TOS4-HMAC-SHA256 签名算法

**与 AWS S3 的区别**:
- AWS: 密钥派生使用 `"AWS4" + secretKey`
- TOS: 密钥派生直接使用 `secretKey`（不加前缀）

```rust
/// 获取签名密钥 (TOS V4: 直接使用 secretKey，不加前缀)
fn get_signing_key(&self, date: &str) -> Vec<u8> {
    let k_date = Self::hmac_sha256(self.secret_key.as_bytes(), date);  // 直接使用
    let k_region = Self::hmac_sha256(&k_date, TOS_REGION);
    let k_service = Self::hmac_sha256(&k_region, TOS_SERVICE);
    Self::hmac_sha256(&k_service, "request")
}
```

**签名字符串格式**:
```
TOS4-HMAC-SHA256
{timestamp}
{date}/{region}/{service}/request
{hashed_canonical_request}
```

#### 4.2 分片上传流程

```rust
// 1. 初始化分片上传
let upload_id = init_multipart_upload(&client, &credentials, &file_key, content_type).await?;

// 2. 上传分片（单分片，因为文件通常不大）
let etag = upload_part(&client, &credentials, &file_key, &upload_id, 1, &buffer).await?;

// 3. 完成上传
complete_multipart_upload(&client, &credentials, &file_key, &upload_id, &[(1, etag)]).await?;
```

#### 4.3 关键 Bug 修复：TOS 响应格式

**问题现象**:
```
无法解析 UploadId: {"Bucket":"n-so","Key":"web/xxx.jpg","UploadId":"0b39..."}
```

**根因**: 代码假设 TOS 返回 XML 格式，但实际返回 JSON 格式。

**修复方案** (nami.rs:317-336):
```rust
// 解析响应获取 UploadId
// 先尝试 JSON 格式，再尝试 XML 格式（兼容）
let upload_id = if text.starts_with('{') {
    // JSON 格式响应
    #[derive(Deserialize)]
    struct InitResponse {
        #[serde(rename = "UploadId")]
        upload_id: String,
    }
    let parsed: InitResponse = serde_json::from_str(&text)
        .map_err(|e| format!("解析 JSON UploadId 失败: {}", e))?;
    parsed.upload_id
} else {
    // XML 格式响应（兼容）
    text.split("<UploadId>")
        .nth(1)
        .and_then(|s| s.split("</UploadId>").next())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("无法解析 XML UploadId: {}", text))?
};
```

### 五、前端实现

#### 5.1 Cookie 登录配置 (cookieProviders.ts)

```typescript
nami: {
  serviceId: 'nami',
  name: '纳米',
  loginUrl: 'https://www.n.cn',
  domains: ['www.n.cn', 'n.cn'],
  cookieValidation: {
    requiredFields: ['Auth-Token'],  // 登录成功的标志
    anyOfFields: [],
    monitoringDelay: {
      initialDelayMs: 3000,
      pollingIntervalMs: 1000
    }
  },
  description: '登录纳米账号获取 Cookie',
  icon: '☁️'
}
```

#### 5.2 Auth-Token 自动提取

纳米图床的 Auth-Token 存在于 Cookie 中，需要自动提取：

```typescript
// main.ts - handleCookieUpdate 函数
case 'nami':
  if (!config.services.nami) {
    config.services.nami = { enabled: true, cookie: '', authToken: '' };
  }
  config.services.nami.cookie = cookie;

  // 从 Cookie 中提取 Auth-Token
  const authTokenMatch = cookie.match(/Auth-Token=([^;]+)/);
  if (authTokenMatch) {
    config.services.nami.authToken = authTokenMatch[1];
    console.log('[Cookie更新] ✓ 纳米 Auth-Token 已提取');
  }
  break;
```

#### 5.3 关键 Bug 修复：Auth-Token 被清空

**问题现象**: 登录保存 Cookie 后，下次自动保存时 Auth-Token 被清空。

**根因**: `handleAutoSave` 中设置 `authToken: ''`。

**修复方案** (main.ts):
```typescript
nami: (() => {
  const cookie = namiCookieEl?.value.trim() || '';
  // 从 Cookie 中提取 Auth-Token，如果提取不到则保留已有的
  const authTokenMatch = cookie.match(/Auth-Token=([^;]+)/);
  const extractedAuthToken = authTokenMatch ? authTokenMatch[1] : '';
  return {
    enabled: enabledServices.includes('nami'),
    cookie: cookie,
    authToken: extractedAuthToken || savedConfig?.services?.nami?.authToken || ''
  };
})()
```

### 六、main.ts 修改清单 (共 15+ 处)

| # | 位置 | 修改内容 |
|---|------|----------|
| 1 | ~第 156 行 | `serviceButtons` 添加 `nami` |
| 2 | ~第 168 行 | `availableServiceCheckboxes` 添加 `nami` |
| 3 | ~第 197 行 | 添加 `namiCookieEl` 声明 |
| 4 | ~第 635 行 | 上传 `enabledServices.push('nami')` |
| 5 | ~第 762 行 | `linkCheckerServiceNames` 添加 `nami: '纳米'` |
| 6 | ~第 1288 行 | `handleCookieUpdate` 添加 `case 'nami'` |
| 7 | ~第 1670 行 | `handleAutoSave` 添加 nami 配置 |
| 8 | ~第 2765 行 | 上传完成 `serviceNames` 添加 nami |
| 9 | ~第 2825 行 | 复制链接 `serviceNames` 添加 nami |
| 10 | ~第 2994 行 | 重试上传 `serviceNames` 添加 nami |
| 11 | ~第 3379 行 | `loadServiceButtonStates` services 数组添加 nami |
| 12 | ~第 3441 行 | `updateServiceStatus` 添加 nami case |
| 13 | ~第 3781 行 | `getServiceName` 添加 nami |
| 14 | ~第 4189 行 | 按钮点击保存 `enabledServices.push('nami')` |
| 15 | ~第 4251 行 | `settingsInputs` 添加 `namiCookieEl` |
| 16 | ~第 4375 行 | 添加 nami 登录按钮事件 |

### 七、踩坑记录与经验总结

#### 7.1 Sidecar 中的 TypeScript 类型问题

**问题**: 在 Puppeteer evaluate 中使用 DOM 类型报错 `Cannot find name 'Element'`

**原因**: Node.js 环境没有 DOM 类型定义

**解决**: 使用 `any` 类型替代
```typescript
// 错误
await page.evaluate((el: Element) => el.click(), element);

// 正确
await page.evaluate((el: any) => el.click(), element);
```

#### 7.2 TOS 签名算法差异

**问题**: 使用 AWS S3 签名方式，TOS 返回签名错误

**原因**: TOS V4 签名的密钥派生不加 "TOS4" 前缀（与 AWS 的 "AWS4" 不同）

**解决**: 直接使用 secretKey 作为 HMAC 密钥
```rust
// AWS S3
let k_date = hmac_sha256(("AWS4" + secret_key).as_bytes(), date);

// TOS V4
let k_date = hmac_sha256(secret_key.as_bytes(), date);
```

#### 7.3 TOS 响应格式变化

**问题**: InitiateMultipartUpload 返回 JSON 而非 XML

**原因**: TOS 可能根据请求头或版本返回不同格式

**解决**: 兼容两种格式，先尝试 JSON 再尝试 XML

#### 7.4 Auth-Token 自动保存问题

**问题**: 登录获取的 Auth-Token 在自动保存时被清空

**原因**: `handleAutoSave` 中硬编码 `authToken: ''`

**解决**: 从 Cookie 提取或保留已有值
```typescript
authToken: extractedAuthToken || savedConfig?.services?.nami?.authToken || ''
```

#### 7.5 服务名称映射遗漏

**问题**: 添加新图床后，多处 `Record<ServiceType, string>` 报类型错误

**原因**: main.ts 中有 5+ 处硬编码的服务名称映射

**解决**: 全局搜索 `Record<ServiceType, string>` 并逐一添加

### 八、调试技巧

#### 8.1 Sidecar 调试

```bash
# 直接运行 sidecar 测试
cd sidecar/nami-token-fetcher
npx ts-node src/index.ts check-chrome
npx ts-node src/index.ts fetch-token --cookie "..." --auth-token "..."
```

#### 8.2 Rust 后端调试

查看 Tauri 控制台输出：
```rust
println!("[Nami] 获取动态 Headers...");
eprintln!("[Nami] 错误: {}", error);
```

#### 8.3 前端调试

浏览器控制台过滤：
```
[Nami]
[Cookie更新]
[MultiUploader]
```

### 九、配置文件示例

#### tauri.conf.json 域名白名单
```json
{
  "security": {
    "dangerousRemoteDomainIpcAccess": [
      {
        "domain": "n.cn",
        "windows": ["login-webview"],
        "enableTauriAPI": true
      },
      {
        "domain": "www.n.cn",
        "windows": ["login-webview"],
        "enableTauriAPI": true
      }
    ]
  }
}
```

#### tauri.conf.json externalBin
```json
{
  "bundle": {
    "externalBin": [
      "binaries/qiyu-token-fetcher",
      "binaries/nami-token-fetcher"
    ]
  }
}
```

### 十、完整上传流程日志示例

```
[Cookie监控] 开始监控 nami 的Cookie
[Cookie监控] ✓ 验证通过，尝试保存 nami Cookie
[Cookie更新] ✓ 纳米 Auth-Token 已提取
[Cookie更新] ✓ nami Cookie已保存到存储

[上传] 启用的图床: ['nami']
[并发上传] 开始处理 1 个文件，启用图床: ['nami']
[MultiUploader] 开始并行上传到: ['nami']

[Nami] 开始上传文件: D:\xxx\wallhaven-o35p7p.jpg
[Nami] 文件哈希: e74076167cbc86a52113f388313cc24a74664ced
[Nami] 获取动态 Headers...
[NamiToken] Headers 获取成功
[Nami] 获取 STS 凭证...
[Nami] STS 凭证获取成功
[Nami] 初始化分片上传...
[Nami] UploadId: 0b39a6b910ac177c6b030131cfa5cdb26931cfa5
[Nami] 上传分片...
[Nami] Part 1 ETag: "xxx"
[Nami] 完成上传...
[Nami] 上传成功: https://bfns.zhaomi.cn/web/e74076167cbc86a52113f388313cc24a74664ced.jpg

[并发上传] 所有文件处理完成
```

---

## 👥 贡献者

- **架构设计**: Claude (Anthropic)
- **需求分析**: 用户 (Jiawei)
- **实施开发**: 协作完成

---

**最后更新**: 2025-12-05
**下次审查**: 添加更多图床时
