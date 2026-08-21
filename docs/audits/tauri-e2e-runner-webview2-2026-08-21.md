# CI 跑手 WebView2 会话失败诊断（2026-08-21，v1.1.0 发版前）

> 结论先行：**跑手环境问题，非应用缺陷**。windows-2025 镜像 2026-08-18 更新（WebView2
> 149→151）后，msedgedriver 与 WebView2 的调试握手必然失败。四轮控制变量实验排除了
> 全部本侧假设，最终按「非阻断 + 立案」处置放行 v1.1.0 发版。
> 待办与恢复条件见 [TODO.md](../TODO.md)「Tauri E2E 在 CI 跑手上建会话失败」。

## 症状

发版 v1.1.0 前手动触发 CI 加测（`run_tauri_e2e=true`），`Tauri desktop E2E smoke`
（windows-latest）失败：

```
WebDriverError: session not created: DevToolsActivePort file doesn't exist
when running "http://127.0.0.1:4444/session" with method "POST"
```

注意这是该 job **历史上第一次真正执行**（此前的 dispatch 都没勾选，全部 skipped），
所以没有「以前是绿的」基线——但 `release.yml` 里逐字相同的步骤在 v1.0.10
（2026-07-14）发版时是通过的。

## 环境对比（硬证据）

| | v1.0.10 release（过） | 2026-08-21（挂） | 本机（过） |
|---|---|---|---|
| 镜像 | windows-2025-vs2026（20260624.560） | 同名镜像 **20260818.207.1** | Windows 10 Pro |
| WebView2 | 149.0.4022.98 | 151.0.4129.86 | 151.0.4129.93 |
| msedgedriver | 匹配 149 | 匹配 .86（工具自动对齐） | 151.0.4129.93 |
| 结果 | 4 passing | 60s 超时 | 4 passing |

## 四轮控制变量实验（分支 `diag/tauri-e2e-runner`）

| 轮次 | run | 实验 | 结果 → 排除的假设 |
|------|-----|------|------------------|
| 1 | 32472333974 | E2E 失败后**绕过驱动裸启动应用** 25 秒 | 应用存活、webview 进程齐全、启动日志全绿（配置解密/钥匙串/快捷键/sidecar 正常）→ **排除「应用在跑手上起不来」** |
| 2 | 32473518344 | 导出 Edge 策略；写 `RemoteDebuggingAllowed=1`；`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--do-not-de-elevate` | 三个策略键本就不存在；两种修复后同样挂 → **排除「策略禁调试」**（降权假设此轮未真正生效，第 4 轮补测） |
| 3 | 32474934108 | 升级 WebView2 运行时 .86→.101 并重配驱动；**绕开 tauri-driver 直接驱动 msedgedriver（--verbose）** | 仍挂；verbose 日志只有 `Launching ... picnexus.exe` → 60s → `Failed to connect to msedge` → **排除「补丁版本」与「tauri-driver 的锅」** |
| 4 | 32476368456 | 全程每 2 秒全盘监视 `DevToolsActivePort` 落盘位置；`runas /trustlevel:0x20000` **去提权整套重跑** | 端口文件**从未在任何目录出现**；去提权后同样挂法 → **排除「提权降权掐断握手」「驱动找错目录」** |

## 定性与处置

WebView2 151 的浏览器进程在该跑手环境下**根本没有开启远程调试**（不是写到了别处，
是从未写出）。应用侧、驱动版本、策略、权限全部排除后，剩余解释只能落在
WebView2 151 运行时与 Windows Server 2025 跑手会话的组合上——超出本仓库可修范围。

处置（`c70a7af5`）：

- `ci.yml` `tauri-e2e` job 与 `release.yml` Windows E2E 步骤 `continue-on-error: true`
- 应用可运行性兜底不变：release 安装包冒烟（`App running OK, killing...`）+
  发版清单里的本地 `npm run test:tauri:e2e`（本轮 4/4 通过，驱动需匹配版本，
  过期驱动的报错见下）

## 顺带修掉的本机坑

本机首跑 `npm run test:tauri:e2e` 报
`This version of Microsoft Edge WebDriver only supports Microsoft Edge version 147`
——`~/.cargo/bin/msedgedriver.exe` 停在 147 而 WebView2 已升 151。
从 `https://msedgedriver.microsoft.com/<版本>/edgedriver_win64.zip` 下载精确匹配版
替换即可（旧驱动备份为 `msedgedriver-147.bak.exe`）。

## 经验

- `continue-on-error: true` 的步骤在 jobs API 里 `conclusion` 显示 success 是**掩码值**，
  真实成败要看 step 日志或 `outcome`——本次曾因此误判「策略修复生效」一次。
- 驱动会用自己的 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 覆盖你在 step env 里设的同名
  变量，想给 webview 加参数不能走这条路。
