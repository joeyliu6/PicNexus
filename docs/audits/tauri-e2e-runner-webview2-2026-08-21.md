# CI 跑手 WebView2 会话失败诊断（2026-08-21，v1.1.0 发版前）

> ## ⚠️ 2026-09-09 追记：本文两处结论需要修正，先看这段再往下读
>
> **① 下表「提权降权掐断握手 → 已排除」是错误结论。** 恰恰相反，提权就是根因。
> 第 4 轮用的是 `runas /trustlevel:0x20000`（受限令牌），**跟"降到 Medium 完整性级别"
> 不是一回事**；而且几乎肯定漏了 `icacls` 那一步——降权后进程失去 workspace 读写权限，
> 应用根本起不来，那个失败被归类成了"降权也没用"。
>
> **② 「超出本仓库可修范围」应改为「超出本仓库可修范围，但本仓库可以绕过」。**
>
> **真实根因**（微软确认 by-design，**不会有上游修复，等镜像更新是白等**）：
> WebView2 Runtime **150** 起，宿主进程提权（High Integrity）时，WebView2 **故意忽略**
> `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量、HKCU 策略与命令行开关，只认 HKLM
> 策略和 API 传参。而 msedgedriver 恰恰只能通过那个环境变量注入
> `--remote-debugging-port=0` → 端口不开 → `DevToolsActivePort` 不落盘 → 60 秒超时。
> GitHub 托管的 Windows 跑手默认以管理员运行，所以 100% 复现。
>
> - [tauri-apps/wry#1782](https://github.com/tauri-apps/wry/issues/1782) —— 主线 issue，
>   其中 2026-08-14 的评论是 **Runtime 151 上的独立复现**，`msedgedriver --verbose`
>   日志与本文第 3 轮一字不差（同样 60 秒 gap、同样 `DevToolsActivePort`）
> - [WebView2Feedback#5645](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)
>   —— 微软回复「intentionally dropped」
> - [官方安全文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security#recommended-privilege-level-for-webview2-host-applications)
>   已把这条行为写进「Recommended privilege level」
>
> **处置**：2026-09-09 在 `ci.yml` / `release.yml` 接入 `gsudo --integrity Medium` 降权
> workaround（含必需的 `icacls` 授权），并加了一步 `whoami /groups` 完整性级别探针取证。
> 待一次 dispatch 复验转绿后摘掉两处 `continue-on-error`，并把 `if:` 放开到 push / PR。
>
> **另一处判断也随之作废**：本文与 TODO 里「等镜像更新」的跟踪思路是无效的——
> `actions/runner-images` 根本不追踪 WebView2 版本（它是 Evergreen 自更新），
> 而且 WebView2 从 152（2026-08-28）起改成两周发布节奏，漂移只会更快。
>
> 以下为 2026-08-21 的原始记录，除本段外未作改动。

---

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
| 4 | 32476368456 | 全程每 2 秒全盘监视 `DevToolsActivePort` 落盘位置；`runas /trustlevel:0x20000` **去提权整套重跑** | 端口文件**从未在任何目录出现**；去提权后同样挂法 → ~~排除「提权降权掐断握手」~~ ❌ **这条结论是错的，见文首 2026-09-09 追记**；「驱动找错目录」的排除仍成立 |

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
- **（2026-09-09 补）控制变量实验只能排除"我试的那个具体做法"，不能排除"那个假设"。**
  第 4 轮用 `runas /trustlevel:0x20000` 没成功，被记成了「提权不是原因」——实际只证明了
  「这条降权命令没解决问题」。两者差着一个量词。写排除结论时要把实验手段一起写进结论，
  否则半年后没人记得当时试的是哪种降权。
- **（2026-09-09 补）本侧假设排完，不等于结论就是"环境问题、等上游"。** 这次真正的
  下一步是去上游 issue 里搜同样的报错签名——那里已经躺着一条精确命中的 issue 三周了。
  四轮实验花掉的时间，一次 `DevToolsActivePort WebView2` 搜索就能省下大半。

---

## 2026-09-10 结案：根因、处置与复验证据

> 由 `docs/TODO.md` 迁入（条目关闭后正文按归档规则搬来这里）。

- **来源**：2026-08-21 发版 v1.1.0 前触发 CI 加测，`Tauri desktop E2E smoke` 首次真正执行即失败
- **症状**：`WebDriverError: session not created: DevToolsActivePort file doesn't exist`——
  msedgedriver 拉起 `picnexus.exe` 后等 60 秒，WebView2 从未把调试端口文件写到任何目录
  （全盘监视确认，见诊断第 4 轮）
- **定性**（2026-09-09 修正，原记的「等上游镜像修」是错的）：**微软 by-design 的安全硬化，
  不会有上游修复，等镜像更新是白等**。WebView2 Runtime 150 起，宿主进程提权（High Integrity）
  时故意忽略 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`，而 msedgedriver 只能靠这个环境变量注入
  `--remote-debugging-port` → 端口不开 → 文件不落盘。GitHub 跑手默认以管理员运行，故必现。
  依据：[wry#1782](https://github.com/tauri-apps/wry/issues/1782)（其中 2026-08-14 的评论是
  Runtime 151 上的独立复现，日志与我们一字不差）、
  [WebView2Feedback#5645](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)（微软回复
  intentionally dropped）、[官方安全文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security#recommended-privilege-level-for-webview2-host-applications)
- 本机 Windows 10 + WebView2 151 同套件 4/4 通过（本机不提权，符合上述定性）

四轮诊断已排除的假设（分支 `diag/tauri-e2e-runner` 的 4 次 run，编号 32472333974 /
32473518344 / 32474934108 / 32476368456；完整证据链见
[tauri-e2e-runner-webview2-2026-08-21.md](audits/tauri-e2e-runner-webview2-2026-08-21.md)）：

| 假设 | 排除依据 |
|------|---------|
| 应用在跑手上起不来 | 裸启动 25 秒健康存活，webview 进程齐全，启动日志全绿 |
| 驱动/运行时版本不匹配 | msedgedriver-tool 精确匹配 .86；升运行时到 .101 后仍挂 |
| Edge 策略禁远程调试 | 三个策略键全部不存在；显式写 `RemoteDebuggingAllowed=1` 无效 |
| ~~提权降权掐断握手~~ | ❌ **这条排除是错的**：`runas /trustlevel:0x20000` ≠ 降到 Medium 完整性级别，且漏了降权后必需的 `icacls` 授权（应用起不来被误判成"降权没用"）。提权就是根因 |
| tauri-driver 的问题 | 绕开它直接驱动 msedgedriver（`--verbose`）同样复现 |

**当前处置**：`ci.yml` 的 `tauri-e2e` job 与 `release.yml` 的 Windows E2E 步骤均
`continue-on-error: true`。应用可运行性由 release 的安装包冒烟（`App running OK`）和
发版清单里的本地 `npm run test:tauri:e2e` 兜底。

**2026-09-09 处置**：已接入 [wry#1782](https://github.com/tauri-apps/wry/issues/1782) 里
2026-09-07 给出的降权 workaround——用 `gsudo --integrity Medium` 把整条链
（node → wdio → tauri-driver → msedgedriver → picnexus.exe）降到 Medium 完整性级别运行。
⚠️ 配套的 `icacls "$GITHUB_WORKSPACE" /grant "Everyone:(OI)(CI)F"` **不能省**：降权后进程
会失去 workspace 读写权限，应用起不来会被误判成"降权也没用"。同时加了一步
`whoami /groups` 完整性级别探针取证。

**2026-09-10 复验通过，本条关闭**（[run 34428364202](https://github.com/joeyliu6/PicNexus/actions/runs/34428364202)）。
三个判据全中：

| 判据 | 实测 |
| --- | --- |
| 完整性级别探针 | `Mandatory Label\High Mandatory Level`（S-1-16-12288）——跑手确以管理员运行，根因坐实 |
| job 结果 | 转绿，`DevToolsActivePort` 未再出现（WebView2 151.0.4129.101，正是出问题的那一支） |
| **用例真的跑了** | `4 passing (1m 9.5s)` / `Spec Files: 2 passed, 2 total` ——不是空转假绿 |

已随之落地：

1. 摘掉 `ci.yml` `tauri-e2e` 的 job 级 `continue-on-error`
2. `if:` 放开到 **push + 勾选的 dispatch，刻意不含 PR** + `needs: test`：

   ```yaml
   if: ${{ github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.run_tauri_e2e) }}
   ```

   原以为要拍板的「与 testing-guide 冲突」是误读：该文原话是「不建议直接放入**每个 PR**」，
   拦的是 PR，没拦 push。之所以撞上，是因为提案照抄了 `e2e` job 的 `if:`，而那个形状 push + PR 都跑。
   把 PR 摘掉即两全，**testing-guide 无需修改**。选 push 的实证依据：最近 20 次 CI 触发是
   3 push / 16 schedule / 1 dispatch，PR 数为 0，只挂 PR 等于不跑；而 `ci:prepush` 本地门禁里
   没有 Tauri E2E，CI 再不跑就永远不会自动跑。代价是冷缓存下每次 push main 多等 15~25 分钟（并行，不阻塞其他 job）。
3. **加了 gsudo 退出码透传自检**（两个 workflow 都加）。这一步的成败完全押在 gsudo 把子进程
   退出码原样透传上，透传坏掉就是「测试挂了也放行」的假门禁——比没有门禁更危险。而 choco
   当前发的是 gsudo **v2.6.1（2025-10）**，上游两个「退出码丢失」修复
   （[gsudo#410](https://github.com/gerardog/gsudo/issues/410)、[#421](https://github.com/gerardog/gsudo/issues/421)）
   **2026-05 才合入、尚未随任何 release 发布**，所以不能假设它是好的。改为每次跑
   `gsudo --integrity Medium cmd /c "exit 42"` 实测，不等于 42 就当场 throw。
4. `release.yml` 的 step 级 `continue-on-error` **刻意保留**：本次给发版路径新增了
   `choco install gsudo` 这条外网依赖，choco 源抽风会卡住发版。等 ci.yml 侧稳跑几次、
   或给 gsudo 做缓存/固定版本后再摘。

若降权后仍挂（探针显示 Medium 但报错不变），说明本方案被证伪，回落 Linux +
WebKitWebDriver + xvfb（[Tauri 官方 CI 示例](https://v2.tauri.app/develop/tests/webdriver/ci/)
就是这条路；`wdio.tauri.e2e.conf.cjs` 已有 Linux 分支，发版矩阵也已在 ubuntu 上构建；
钥匙串问题可用 `portable.json` 绕开）。

**历史记录**：2026-09-08 第一次复验仍失败
（[run 34179056938](https://github.com/joeyliu6/PicNexus/actions/runs/34179056938)，
[issue #5](https://github.com/joeyliu6/PicNexus/issues/5) 已关闭）。
[issue #6](https://github.com/joeyliu6/PicNexus/issues/6) 提醒重试镜像 `20260907` ——
2026-09-09 已按根因关闭：**盯镜像这件事本身就是错的**，`actions/runner-images` 不追踪
WebView2 版本（Evergreen 自更新），而且这是 by-design 硬化，不会因镜像更新消失。
配套的云端盯梢例行任务应一并停掉。
