# Playwright MCP 桥接测试方法

> 一套让 AI 自主完成 UI 视觉验证的测试模式，无需人工截图。

## 适用场景

PicNexus 是 Tauri 桌面应用，核心 UI 跑在 WebView 里。传统 Playwright E2E 测试面临一个障碍：**Tauri 原生 API（文件对话框、文件读写、shell 命令）在浏览器环境中不可用**。

本方法通过在组件中注入 **dev-only 测试桥接**，直接操作 Vue 响应式状态来模拟各种 UI 阶段，绕过 Tauri 原生依赖。

**核心思路**：不测真实的后端流程，只测前端 UI 在各种数据状态下的渲染是否正确。

---

## 方法论

### 1. 识别组件的状态驱动模型

大多数复杂页面都是**状态机驱动**的。先梳理：

- 有哪些 **阶段**（phase / stage）
- 每个阶段的 UI 由哪些 **响应式变量** 控制
- 哪些变量是 `ref`（可直接赋值），哪些是 `computed`（需要间接驱动）

#### 示例：文档修复功能

```
phase: 'idle' | 'scanning' | 'fixing' | 'done'
scanStage: 'checking' | 'backups' | 'complete'

关键 ref：imageLinks, readyFiles, phase, scanStage
关键 computed（不可直接赋值）：fileHealthList, groupedRows, bottomStats
```

> **重要**：`computed` 不能直接 `.value = xxx`，必须通过设置它的上游 `ref` 来间接驱动。

### 2. 加 dev-only 测试桥接

在目标组件的 `<script setup>` 末尾加桥接代码：

```typescript
// Dev-only: 暴露响应式状态供 Playwright 测试
if (import.meta.env.DEV) {
  (window as any).__xxxTest = {
    // 暴露需要操控的 ref
    phase,
    imageLinks,
    scanStage,
    readyFiles,
    // 暴露 computed（只读，用于验证）
    fileHealthList,
    bottomStats,
    // 暴露方法
    resetRescue,
  };
}
```

**命名约定**：`window.__[功能缩写]Test`，如 `__mrTest`（md-rescue）、`__hcTest`（history-check）。

**注意事项**：
- `import.meta.env.DEV` 确保生产构建时 tree-shake 掉
- 暴露的 ref 和 computed 保持 Vue 的响应式，Playwright 通过 `.value` 操作
- 测试完毕后**必须移除桥接代码**，不要提交到仓库

### 3. 构造模拟数据

为每个测试阶段准备符合类型定义的模拟数据。关键是**让 computed 链正确计算**。

#### 模拟数据模板

```javascript
// 通过 browser_evaluate 注入
() => {
  const t = window.__xxxTest;

  // 1. 先设置底层 ref（computed 的数据源）
  t.imageLinks.value = [
    {
      originalText: '![alt](https://example.com/img.png)',
      url: 'https://example.com/img.png',
      altText: 'alt',
      lineNumber: 5,
      syntax: 'markdown',
      sourceFile: 'C:/docs/test.md',
      sourceFileName: 'test.md',
      checkResult: {
        link: 'https://example.com/img.png',
        is_valid: true,  // 或 false
        error_type: 'success',  // 或 'http_4xx', 'network', 'timeout'
        browser_might_work: false,
      },
    },
  ];

  // 2. 设置 readyFiles（驱动 fileHealthList.ready 字段）
  t.readyFiles.value = new Set(['C:/docs/test.md']);

  // 3. 最后设置阶段状态（触发 UI 切换）
  t.scanStage.value = 'complete';
  t.phase.value = 'scanning';

  // 4. 验证 computed 是否正确计算
  return {
    fileHealthList: t.fileHealthList.value.length,
    bottomStats: t.bottomStats.value,
  };
}
```

> **顺序很重要**：先设数据，再设阶段。反过来会导致瞬间出现空状态闪烁。

### 4. Playwright MCP 测试流程

```
browser_navigate → 导航到页面
browser_snapshot  → 获取可交互元素的 ref
browser_click     → 点击导航到目标 Tab
browser_evaluate  → 注入模拟数据
browser_take_screenshot → 截图验证
```

#### 截图命名约定

```
step{N}-{阶段描述}.png

例：
step1-idle-state.png
step2-scanning-healthy.png
step3-scan-complete-all-ok.png
step4-broken-links.png
step5-filter-switch.png
step6-reset-idle.png
```

---

## 完整示例：文档修复功能测试

### 桥接代码位置

`src/components/views/linkcheck/MdRescueInline.vue` — `<script setup>` 末尾

### 需要暴露的状态

| 变量 | 类型 | 用途 |
|------|------|------|
| `phase` | ref | 控制阶段切换 |
| `imageLinks` | ref | 图片链接数据（驱动所有 computed） |
| `readyFiles` | ref (shallowRef Set) | 标记文件扫描完成 |
| `scanStage` | ref | 扫描子阶段 |
| `isCollecting` | ref | 收集中状态 |
| `fixingProgress` | ref | 修复进度 |
| `repairReceipt` | ref | 修复结果 |
| `fileHealthList` | computed | 验证用（只读） |
| `bottomStats` | computed | 验证用（只读） |

### 测试场景清单

| 场景 | 注入方式 | 验证点 |
|------|---------|--------|
| 空状态 | 默认（不注入） | 功能说明文案、拖放区样式 |
| 扫描中 + 全部正常 | imageLinks 全 valid + scanStage='checking' | 健康文件流水列表 |
| 扫描完成 + 全部正常 | scanStage='complete' | 「所有图片链接正常」提示 |
| 扫描完成 + 有异常 | imageLinks 含 invalid + scanStage='complete' | 分组列表、host badge 颜色 |
| 筛选切换 | 点击芯片 | 列表过渡动画 |
| 重置 | phase='idle' + 清空数据 | 空状态恢复 |

---

## 推广到其他功能

### 链接检测（HistoryCheckPanel）

```typescript
if (import.meta.env.DEV) {
  (window as any).__hcTest = {
    // 从 useLinkCheckManager 暴露
    links, isChecking, progress, selectedServiceId,
  };
}
```

### 批量迁移（BatchMigratePanel）

```typescript
if (import.meta.env.DEV) {
  (window as any).__bmTest = {
    // 从 useBatchMigrate 暴露
    phase, migrateProgress, results,
  };
}
```

### 通用步骤

1. 找到组件使用的 composable，梳理 ref vs computed
2. 在 `<script setup>` 末尾加 `if (import.meta.env.DEV)` 桥接
3. 用 `browser_evaluate` 注入模拟数据
4. `browser_take_screenshot` 截图
5. **测完移除桥接代码**

---

## 局限性

| 局限 | 说明 |
|------|------|
| 无法测试真实数据流 | 跳过了 Tauri 后端，只测 UI 渲染 |
| 无法验证动画流畅度 | 截图是静态帧，过渡动画需人工体验 |
| 无法测试原生交互 | 文件拖放、对话框等 Tauri 原生功能无法模拟 |
| 需要手动清理 | 桥接代码不应提交到仓库 |

**适用于**：UI 改版后的视觉回归验证、组件各状态渲染正确性检查。

**不适用于**：端到端业务流程测试、性能测试、Tauri 原生功能测试。
