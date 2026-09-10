# Cookie 事件监控的静默失效链（2026-09-09）

> 结论先行：`setup_cookie_event_monitoring` 里那条「WebView2 事件通道失败就降级到轮询」的
> 兜底**从来没有生效过**，而且不是偶发——是结构性的。降级判断挂在 `with_webview` 的返回值上，
> 而那个返回值与闭包成败无关。真失败时用户看到的是「登录窗口正常打开 → 登录完成 → 永远没反应、
> 没有任何提示」。
>
> 起因是核对 [rust-command-relocation-2026-09-09.md](./rust-command-relocation-2026-09-09.md)
> 的执行证据时发现 `start_cookie_monitoring` 无人调用，顺着唯一的内部调用点查下去，
> 挖出的是比「多暴露一个命令」严重得多的东西。

## 一、根因：`with_webview` 的 `Ok` 不代表闭包跑过

旧代码的形状：

```rust
let result = login_webview.with_webview(move |webview| {
    let core = match controller.CoreWebView2() {
        Ok(c) => c,
        Err(e) => { log::warn!("获取 CoreWebView2 失败: {:?}", e); return; }   // ← 只是退出闭包
    };
    if let Err(e) = core.add_NavigationCompleted(&handler, &mut token) {
        log::warn!("注册 NavigationCompleted 失败: {:?}", e);
        // 降级到轮询模式提示                                                   ← 注释在说谎
        return;                                                                // ← 只是退出闭包
    }
});

let _ = app_for_ready.emit("cookie-monitoring-ready", ());                      // ← 无条件发

if result.is_err() {                                                           // ← 恒为 false
    return start_cookie_monitoring(...).await;                                 // ← 永远不执行
}
```

闭包内两个 `return` 都只是从闭包返回，**不会让外层 `result` 变成 `Err`**。

实证链（读 `~/.cargo/registry/src/index.crates.io-*/`，不是推测）：

| 层 | 位置 | 事实 |
|---|---|---|
| 1 | `tauri-2.10.3/src/webview/mod.rs:1650` | 闭包签名 `FnOnce(PlatformWebview) + Send`，**返回类型 `()`**——类型层面就没有结果回传通道 |
| 2 | `tauri-runtime-wry-2.10.1/src/lib.rs:1537` | `with_webview` 转发到 `send_user_message(Message::Webview(.., WithWebview(..)))` |
| 3 | `tauri-runtime-wry-2.10.1/src/lib.rs:234` | `send_user_message` 分两路：**主线程**→`handle_user_message` 同步执行但仍恒返回 `Ok`；**非主线程**→`proxy.send_event(message)`，**投递即返回**，唯一错误是 `FailedToSendMessage` |
| 4 | `tauri-2.10.3/src/ipc/mod.rs` | `async fn` 命令由 `async_runtime::spawn` 执行，运行时是多线程 tokio → **必然不是主线程** |

所以 `result.is_err()` 的真实语义是「事件循环已关闭、应用正在退出」，跟 WebView2 能不能用毫无关系。

**推论 2（同样重要）**：既然闭包晚于外层执行，「闭包里设个 `Arc<AtomicBool>`、外层读一下再决定降级」
也是错的——外层读到的必然是初值。想阻塞等结果就得上 channel，而那正是
`try_extract_cookie_header_generic` 的做法，在 WebView2 UI 线程上调它必死锁（旧代码里有注释警告过）。
**唯一正确解法：在闭包内部就地启动兜底。**

## 二、后果链：为什么会"连超时都不报"

1. handler 没注册上，但 `cookie-monitoring-ready` 已在闭包外无条件发出
2. 前端 `src/login-webview.ts` 收到 ready 就 `window.location.href = provider.loginUrl` 跳转
3. **超时计时线程和轮询兜底都内联在 NavHandler 的「首次导航完成」分支里**——handler 没注册，
   这两条兜底就永远不会启动
4. 于是 `cookie-monitoring-timeout` 也发不出去，前端 `useConfig.ts` 那个超时提示监听空等

三层兜底（事件 → 轮询 → 超时通知）全部挂在同一个前提上，前提一塌全塌。

## 三、顺带发现：ready 事件本身就发早了

`emit("cookie-monitoring-ready")` 原本在 `with_webview` **返回之后**执行，而闭包此时往往还没跑。
所以那句注释「通知前端 handler 已注册完成，可以安全跳转」是假的：前端可能在 handler 真正注册好
之前就跳转，把首次 `NavigationCompleted` 丢掉。纯 SPA 登录页之后可能再无导航事件——
这条竞态的表现和上面那条静默失效**一模一样**，但成因不同。

现在改成闭包内的 `Drop` 守卫，三个出口（注册成功 / CoreWebView2 失败 / 注册失败）都会发，
语义变成「监控已就绪（事件模式或降级模式）」。前端 `finishReady()` 本来就有幂等门 + 3 秒超时兜底，
迟到的 ready 不会出问题。

## 四、处置

| 改动 | 说明 |
|---|---|
| 抽出 `arm_timeout_and_poll_fallback` | 把「超时计时 + 轮询兜底」这一对从 NavHandler 里提出来，用 `armed: Arc<AtomicBool>` 的 swap 做一次性令牌。三处调用：首次导航 / CoreWebView2 失败 / handler 注册失败 |
| 两个降级点就地 arm | 闭包内直接启动兜底，不再试图回传外层 |
| `result.is_err()` 改为返回 `Err` | 剩下的唯一语义是应用正在退出，此时降级毫无意义（轮询同样走 `with_webview`），如实报错 |
| 加 8 秒看门狗 | 补两个降级点都盖不到的最后一个洞：`with_webview` 的闭包压根没被事件循环处理。判据是闭包内打的 `closure_ran` 卡，**不是** `armed`——见下方「看门狗为什么不能用 armed 判据」 |
| `ReadyGuard` | 见第三节 |
| 引入 `CookieMonitorCtx` | 同一套参数四处要用，散着传每处重复六行 clone，还得挂 `#[allow(clippy::too_many_arguments)]` |
| 抽出 `capture_and_save_once` | 「提取 → 校验 → 抢保存权 → 落盘」原本在 NavHandler 和轮询循环里各写了一遍，约 90 行重复 |
| 删除 `start_cookie_monitoring` | 全仓零前端 `invoke`，唯一调用者就是那条永不触发的降级路径。连带删除只被它调用的 `attempt_cookie_capture_and_save_generic` |
| 补 24 条单测 | 这个 1200+ 行文件此前**没有一个** `#[cfg(test)]` |

删除 `start_cookie_monitoring` 的额外理由：它比现存的 `spawn_cookie_poll_fallback` 严格更差——
不支持 `field_value_checks`、没有取消机制、超时不发通知，而且头上写着「保留供非 Windows 降级使用」
但函数体第一件事就是在非 Windows 上 `return Err`，注释自相矛盾，内部还有一整段死代码。


### 看门狗为什么不能用 `armed` 判据

初版看门狗写的是「8 秒后若没人 arm 过兜底，就自己 arm」。这是错的，而且错得不显眼。

`arm_timeout_and_poll_fallback` 是**成对**启动超时计时和轮询的，所以**调用时刻就是掐表起点**。
用 `armed` 当判据，等于把「闭包跑了、handler 也注册好了，只是登录页还没加载完」也算成故障，
于是在第 8 秒抢跑 arm，把掐表起点从「登录页可用」提前到「命令发出」。

`timeout_ms` 默认只有 60 秒（`DEFAULT_TIMEOUT_MS`），提前多少就等于从用户的输密码/扫码时间里
扣掉多少。具体失效场景：慢网下微博登录页 25 秒才可用 → 倒计时从第 8 秒起算 → 第 68 秒弹
「自动获取超时，请手动点击」，而用户从页面能用算起才过了 43 秒，二维码可能还没扫完；
更糟的是轮询线程的 `while elapsed < total` 用的是同一个 60 秒，到点即收工，
**用户第 70 秒登录成功也再不会被抓到**。

改用闭包顶端打的 `closure_ran` 卡后：闭包跑过就交回给它自己的三个出口判断，掐表起点重新回到
首次导航；闭包真没跑时没有「首次导航」可等，8 秒起算不存在这个副作用。

原报告里同时列的第二个理由（「handler 注册上了但首次导航被跳转竞态吃掉」）已被本次的
`ReadyGuard` 改动大部分堵住——ready 现在在注册之后才发。残留窗口只剩前端那个 3 秒兜底计时器
抢跑，而那种情况下 handler 终究会注册上、后续导航仍能接上，不值得用「无条件偷 8 秒」去换。

## 五、调试开关：让降级路径第一次留下执行证据

两个降级点要 WebView2 自身出故障才走得到，正常机器上复现不了。这正是它们从上线到现在
**`cargo test` 和真机验收都没碰过**的原因——2026-09-09 那次验收命中的是
`✓ NavigationCompleted 事件注册成功`，`[轮询兜底]` 日志一次都没出现。

所以加了 debug-only 的 `PICNEXUS_COOKIE_FORCE_FALLBACK`（取值 `corewebview2` / `add_handler`）。
release 构建里 `forced_failure_stage()` 恒返回 `None`，两处判断被常量折叠掉，不构成配置面。

真机验收判据见下节。

## 六、真机验收清单

```powershell
$env:RUST_LOG = 'picnexus=debug'
```

| # | 操作 | 期望 | 验的是 |
|---|---|---|---|
| 1 | 不设开关，正常登录一次 | `✓ NavigationCompleted 事件注册成功` → `启动 60000ms 超时计时器 + 轮询兜底（触发源: 首次导航）` → Cookie 保存成功、窗口自动关 | 主路径没坏 |
| 2 | 同上，日志里数 `启动 .* 超时计时器` | **恰好 1 次** | `armed` 幂等：多次导航不会重复 spawn，超时提示不会发两遍 |
| 3 | `$env:PICNEXUS_COOKIE_FORCE_FALLBACK='add_handler'` 后登录 | `调试开关强制跳过 NavigationCompleted 注册` → `事件通道不可用，降级到轮询模式` → 每 2 秒 `[轮询兜底]` → 登录后保存成功 | **降级点 B 的第一份执行证据** |
| 4 | 同开关，打开窗口但不登录，等满 60 秒 | `⏰ 超时（60000ms），发送通知` + 主窗口超时 Toast | **超时兜底在降级路径下也在**——这是原缺陷链丢掉的最后一环 |
| 5 | 开关改 `corewebview2`，重跑 3、4 | `调试开关强制 CoreWebView2 失败` → `（触发源: 强制降级(CoreWebView2)）`，其余同上 | 降级点 A |
| 6 | 步骤 3 中途手动关掉登录窗口 | 2 秒内 `[轮询兜底] 登录窗口已关闭，轮询退出` + `取消超时计时`，之后无日志 | 线程泄漏 / 幽灵 Toast |

## 七、经验

- **`Result` 不等于"这件事做成了"**。跨线程投递型 API（`send_event` / `post_message` 一类）的
  `Ok` 只代表"消息发出去了"。把业务分支挂在这种返回值上，写出来的兜底是装饰品。
  判断依据只能是读实现，不能看签名。
- **兜底不能和主路径共用触发条件**。三层兜底全挂在「首次 NavigationCompleted」上，
  主路径一断，三层一起没。兜底的触发点必须比它要保护的东西更靠外。
- **"没有执行证据"本身就是缺陷信号**。这条路径能潜伏这么久，就是因为它既进不了单测、
  真机也走不到。发现这种函数体时，优先补一个人为触发口，而不是"看着像对的就放过"。
