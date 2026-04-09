# PicNexus 自动化测试指南

> 供项目开发完成后进行测试编写时参考。

## 技术选型

| 类型 | 框架 | 说明 |
|-----|------|------|
| 单元/组件测试 | Vitest + @vue/test-utils | 与 Vite 共享配置，无需额外 transform |
| DOM 环境 | happy-dom | 比 jsdom 更快 |
| 覆盖率 | @vitest/coverage-v8 | V8 原生覆盖率 |
| E2E | WebdriverIO | 有官方 tauri-driver 支持 |

## 目录结构

```
src/test/
├── setup.ts              # 全局 Mock 初始化
├── mocks/
│   ├── tauri/            # Tauri API Mocks（invoke/event/path/fs/dialog/clipboard/sql/http）
│   │   └── index.ts      # setupTauriMocks() 统一入口
│   ├── primevue.ts
│   └── services/
├── fixtures/             # 测试数据（图片/历史记录/配置/上传结果）
├── factories/            # 数据工厂（historyFactory/configFactory/uploadResultFactory）
├── utils/
│   ├── render.ts         # 自定义 render（集成 PrimeVue）
│   └── wait.ts           # 异步等待工具
├── unit/                 # 单元测试（utils/uploaders/core/services）
├── composables/          # Composables 测试
├── components/           # 组件测试
├── integration/          # 集成测试（upload-flow/history-sync）
└── e2e/                  # E2E 测试（单独运行）
```

## Mock 策略

### Tauri API Mock 要点

- `invoke`：用 `Map<cmd, handler>` 映射，支持 `registerInvokeHandler(cmd, fn)` 动态注册
- `event`：内存 `Map<event, Set<callback>>`，提供 `triggerEvent()` 测试辅助
- `sql`：内存对象模拟 SQLite（支持 CREATE/INSERT/SELECT/UPDATE/DELETE），类名 `MockDatabase`
- 其他插件（fs/dialog/clipboard/http/notification/shell）：简单 `vi.fn()` 即可

### 全局 Setup 必做

```typescript
// setup.ts 关键点
beforeAll(() => setupTauriMocks());
afterEach(() => vi.clearAllMocks());
afterAll(() => cleanupTauriMocks());
config.global.plugins = [PrimeVue];
// 还需 mock：window.crypto / matchMedia / ResizeObserver
```

### PrimeVue 组件 Mock

对 Toast/ConfirmDialog 等服务型组件用 `vi.fn()` mock；纯展示组件可直接 mount。

## 测试编写规范

### 命名约定

- 文件：`<被测模块>.spec.ts`
- describe：被测函数/类名
- it：`should <行为> when <条件>`

### 测试优先级（按 ROI 排序）

| 优先级 | 模块 | 原因 |
|--------|------|------|
| P0 | utils/（纯函数） | 无副作用，最容易测 |
| P0 | uploaders/UploaderFactory | 核心分发逻辑 |
| P1 | core/MultiServiceUploader | 上传核心流程 |
| P1 | services/HistoryDatabase | 数据持久层 |
| P2 | composables/ | 需 Mock 较多，但覆盖核心业务 |
| P3 | components/ | 依赖多，收益递减 |

### 异步测试模式

```typescript
// Tauri invoke
it('should upload file', async () => {
  registerInvokeHandler('upload_file_stream', async () => ({ pid: 'test', width: 100, height: 100 }));
  const result = await uploader.upload(file);
  expect(result.url).toContain('test');
});

// 事件监听
it('should handle progress event', async () => {
  const handler = vi.fn();
  await listen('upload-progress', handler);
  triggerEvent('upload-progress', { percent: 50 });
  expect(handler).toHaveBeenCalledWith({ payload: { percent: 50 } });
});
```

### 自定义 Render

```typescript
// utils/render.ts — 组件测试统一入口
export function renderWithPlugins(component, options?) {
  return render(component, {
    global: { plugins: [PrimeVue, ToastService, ConfirmationService] },
    ...options,
  });
}
```

## 运行命令

```json
{
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage",
  "test:ui": "vitest --ui"
}
```

## CI 集成

三层防护（详见 `patterns/auto-testing-pipeline.md`）：
1. **pre-commit hook**：`vitest run --reporter=verbose`
2. **CI workflow**：push/PR 触发全量测试 + 覆盖率
3. **release 门禁**：覆盖率阈值（第一阶段 40%）

## 覆盖率目标

| 阶段 | lines | functions | branches |
|------|-------|-----------|----------|
| 第一阶段 | 40% | 40% | 30% |
| 第二阶段 | 60% | 60% | 50% |
| 长期 | 80% | 80% | 70% |

范围：`src/composables/`、`src/core/`、`src/services/`、`src/uploaders/`、`src/utils/`
