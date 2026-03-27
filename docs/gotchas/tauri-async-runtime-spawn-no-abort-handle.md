# tauri::async_runtime::spawn 不支持 abort_handle()

## 现象

在 Tauri 命令中使用 `tauri::async_runtime::spawn` 启动后台任务，并试图保存 `AbortHandle` 用于后续取消：

```rust
let task = tauri::async_runtime::spawn(async move { ... });
*handle = Some(task.abort_handle()); // 编译错误！
```

编译报错：

```
error[E0599]: no method named `abort_handle` found for enum
`tauri::async_runtime::JoinHandle<T>` in the current scope

note: the method `abort_handle` exists on the type `TokioJoinHandle<()>`
```

## 陷阱原因

`tauri::async_runtime::spawn` 返回的是 Tauri 自己封装的 `JoinHandle` 类型，而非原生的 `tokio::task::JoinHandle`。

Tauri 的包装类型**故意不暴露** `abort_handle()` 方法（以及其他底层 tokio 特性），导致无法直接获取 `AbortHandle`。

```rust
// tauri::async_runtime::JoinHandle — Tauri 封装，不含 abort_handle()
// tokio::task::JoinHandle — 原生 tokio，含 abort_handle()
```

## 正确做法

需要 `AbortHandle` 时，**直接使用 `tokio::task::spawn`** 替代 `tauri::async_runtime::spawn`：

```rust
// ✅ 正确：直接用 tokio::task::spawn
let task = tokio::task::spawn(async move {
    if let Err(e) = server::start_server(port, config_arc).await {
        log::error!("[Server] 启动失败: {}", e);
    }
});
*handle = Some(task.abort_handle()); // 编译通过
```

## 错误示例

```rust
// ❌ 错误：tauri 封装类型不支持 abort_handle
let task = tauri::async_runtime::spawn(async move {
    do_something().await;
});
*handle = Some(task.abort_handle()); // E0599
```

## 正确示例

```rust
// ✅ 正确：使用原生 tokio spawn
let task = tokio::task::spawn(async move {
    do_something().await;
});
*handle = Some(task.abort_handle()); // 正常
```

## 适用场景

需要对后台长驻任务（如 HTTP Server）进行运行时取消/重启时，必须通过原生 `tokio::task::spawn` 保存 `AbortHandle`。

Tauri 使用 tokio 作为异步运行时，`tokio::task::spawn` 会在同一个 tokio 运行时中执行，行为与 `tauri::async_runtime::spawn` 一致，无需担心运行时兼容性问题。

## 相关文件

- `src-tauri/src/main.rs` — `update_server_config` 命令，使用此模式管理 HTTP Server 生命周期
