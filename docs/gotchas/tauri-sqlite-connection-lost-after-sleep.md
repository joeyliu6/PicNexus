# Tauri SQLite 连接在系统休眠后失效

## 现象

使用 `@tauri-apps/plugin-sql`（SQLite）时，系统休眠/睡眠后恢复，数据库查询静默失败或抛异常。应用层的 `initialized` 标志仍为 `true`，导致不会触发重连。

## 原因

SQLite 底层通过文件锁和文件描述符维护连接。操作系统休眠时：
- 文件描述符可能被回收
- WAL 模式下的共享内存映射可能失效
- 进程虽然恢复，但底层 I/O 状态已不一致

Tauri 的 SQL 插件不会自动检测连接失效，也不提供心跳机制。

## 解决方案

在 `ensureInitialized()` 中加入节流健康检查（`SELECT 1`），检测失败时重置状态并重新 `open()`：

```typescript
private lastHealthCheck = 0;
private static readonly HEALTH_CHECK_INTERVAL = 30_000; // 30 秒

if (now - this.lastHealthCheck > HistoryDatabase.HEALTH_CHECK_INTERVAL) {
  try {
    await this.db.select('SELECT 1 as v');
    this.lastHealthCheck = now;
  } catch {
    // 连接失效，重置并重连
    this.db = null;
    this.initialized = false;
    this.initPromise = null;
  }
}
```

## 适用范围

任何使用 `@tauri-apps/plugin-sql` 的 Tauri 应用，只要需要长时间运行或需要在系统休眠后继续工作。
