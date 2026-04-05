# 长时间运行/休眠后界面白屏

休眠白屏分两种完全不同的路径，分开处理：

- **Case 1**：应用进程存活，SQLite 连接失效 → Vue 渲染树崩溃
- **Case 2**：WebView2 整页 reload，模块 HTTP 请求被网络栈抖动中止 → Vue 从未挂载

---

## Case 1：SQLite 连接失效导致渲染崩溃

### 问题描述

软件长时间运行，或电脑休眠/睡眠后重新打开，界面一片空白。无任何报错提示，只有空白窗口。

### 问题根源

三个缺陷叠加导致：

1. **SQLite 连接失效但标志未重置**：系统休眠后 SQLite 底层连接断开，但 `HistoryDatabase.initialized` 仍为 `true`，`ensureInitialized()` 直接跳过初始化 → 后续所有查询抛异常
2. **无全局错误处理**：`main.ts` 没有 `app.config.errorHandler`，也没有 `unhandledrejection` 监听。数据库查询异常未被捕获 → Vue 渲染树崩溃 → 白屏
3. **无窗口恢复事件**：应用不监听 `visibilitychange` 或 Tauri 窗口焦点事件，休眠恢复后不会主动刷新任何状态

### 解决方案

#### 1. 全局错误兜底（main.ts）

防止未捕获异常导致渲染树崩溃：

```typescript
app.config.errorHandler = (err, _instance, info) => {
  log.error(`Vue 错误 [${info}]:`, err);
};

window.addEventListener('unhandledrejection', (event) => {
  log.error('未处理的 Promise 拒绝:', event.reason);
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  log.error('未捕获的全局错误:', event.error);
});
```

#### 2. SQLite 连接健康检查（HistoryDatabase.ts）

`ensureInitialized()` 加入 30 秒节流的 `SELECT 1` 健康检查：

```typescript
private lastHealthCheck = 0;
private static readonly HEALTH_CHECK_INTERVAL = 30_000;

private async ensureInitialized(): Promise<Database> {
  if (this.initialized && this.db) {
    const now = Date.now();
    if (now - this.lastHealthCheck > HistoryDatabase.HEALTH_CHECK_INTERVAL) {
      try {
        await this.db.select<{ v: number }[]>('SELECT 1 as v');
        this.lastHealthCheck = now;
      } catch {
        log.warn('数据库连接已断开，正在重连...');
        this.db = null;
        this.initialized = false;
        this.initPromise = null;
      }
    }
  }
  // ... 正常初始化流程
}
```

新增公开方法 `healthCheck()` 和 `reconnect()` 供外部调用。

#### 3. 窗口恢复监听（App.vue）

双保险：`visibilitychange`（Web 标准）+ Tauri `onFocusChanged`（系统级）：

```typescript
async function handleAppResume() {
  if (document.visibilityState !== 'visible') return;
  try {
    await historyDB.healthCheck();
  } catch {
    await historyDB.reconnect();
  }
}

document.addEventListener('visibilitychange', handleAppResume);
getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (focused) handleAppResume();
});
```

#### 4. KeepAlive 资源清理

- `MainLayout.vue`：KeepAlive max 从 6 改为 4（匹配实际视图数量）
- `SettingsView.vue`：新增 `onDeactivated` 清理 3 个定时器，防止长期运行资源泄漏

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/main.ts` | 全局错误处理 |
| `src/services/HistoryDatabase.ts` | healthCheck + reconnect + ensureInitialized 加固 |
| `src/App.vue` | visibilitychange + onFocusChanged 恢复监听 |
| `src/components/layout/MainLayout.vue` | KeepAlive max 6→4 |
| `src/components/views/SettingsView.vue` | onDeactivated 清理定时器 |

### 关键教训

- 桌面应用必须考虑系统休眠/恢复场景，数据库连接不能假设永远有效
- Vue 应用必须设置 `app.config.errorHandler`，否则任何未捕获异常都会导致白屏
- SQLite 的 `SELECT 1` 健康检查开销极低（亚毫秒级），配合节流可以安全地加入每次操作前

---

## Case 2：WebView reload 中模块加载失败（网络栈抖动）

### 问题描述

**Dev 模式下**，电脑休眠唤醒后窗口白屏。控制台报错：

```
Failed to load resource: net::ERR_NETWORK_CHANGED
  :1420/src/uploaders/jd/JDUploader.ts
  :1420/src/uploaders/nowcoder/NowcoderUploader.ts
```

### 问题根源

**现象证据**：日志中 `[SecureStorage] ✓ 密钥初始化成功` 每次休眠唤醒都重新出现一次，证明 WebView2 **整页 reload** 了 main.ts。

**失败链路**：

1. Windows 深度休眠（S3/S4）恢复 → GPU 资源和 Chromium 网络栈被系统释放
2. WebView2 为回到干净状态**主动触发整页 reload**（WebView2 内建行为）
3. reload 时重新请求 `http://localhost:1420/...` 资源
4. 此时 Chromium 网络栈仍在重建（几百毫秒窗口期）→ 部分 ES 模块请求被中止 → `ERR_NETWORK_CHANGED`
5. 静态 `import` 链中断 → Vue **从未挂载** → 白屏
6. Case 1 的 `app.config.errorHandler` 此时还没注册，无法兜底

### Dev vs 生产模式差异

| 模式 | 资源加载方式 | 受影响程度 |
|------|------------|-----------|
| `tauri dev` | HTTP @ localhost:1420 | ✅ 主要问题场景 |
| `tauri build` 生产 exe | Tauri `tauri://` 协议（不走 HTTP） | ⚠️ 理论风险低 |

### 解决方案

在 `index.html` 的 `<script type="module" src="/src/main.ts">` **之前**插入 inline 兜底脚本（早于 Vue 挂载，覆盖 Case 1 的盲区）：

- **首次** script/link 资源加载失败 → 延迟 1.5s reload（给网络栈稳定时间）
- **10 秒内第二次失败** → 不再 reload，显示降级错误页面（带"重试"按钮）
- capture 模式监听（resource error 不冒泡到 window）
- sessionStorage 限流（避免持续断网时无限 reload 死循环）

核心代码：

```javascript
window.addEventListener('error', function (e) {
  var t = e.target;
  if (!t || t === window) return;
  var isResource =
    (t.tagName === 'SCRIPT' && t.src) ||
    (t.tagName === 'LINK' && t.href);
  if (!isResource) return;

  var last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < LIMIT_MS) {
    showFallback(); // 显示降级错误页
    return;
  }
  sessionStorage.setItem(KEY, String(Date.now()));
  setTimeout(function () { window.location.reload(); }, 1500);
}, true); // capture: true
```

### 修改文件

| 文件 | 改动 |
|------|------|
| `index.html` | 在 main.ts 前插入 inline 兜底脚本（reload + 降级页面） |

### 关键教训

- **WebView2 在 Windows 休眠恢复后会主动 reload 整页**，这是内核行为，Tauri 无法阻止
- reload 瞬间的网络栈抖动会让 localhost 的 HTTP 请求也失败（不是真的断网）
- **Vue 挂载之前的错误需要 inline script 兜底**，`app.config.errorHandler` 在此阶段尚未注册
- 浏览器规范禁止重试失败的 ES 模块，唯一手段是 reload 整页
- **必须限次**：无限 reload 会在真实断网场景下导致死循环，应降级到友好错误页面
