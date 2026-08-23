# Windows 自动更新慢：排查与修复记录（2026-08-24）

> 触发：用户反馈「应用下载完，安装的时候花了好久，几分钟到十来分钟」。
> 相关流程图：[auto-update-flow.md](../flows/auto-update-flow.md)（图 2 / 图 3 / 图 4 已同步）

## 一句话总结

自动更新一直在下载**错误的安装包**（65.7MB 的 MSI 而非 42.7MB 的 NSIS），而且安装阶段有 90 秒完全没有界面反馈——
前者靠 CI 改写 `latest.json` 修掉，后者靠新增 `installing` 状态填上。两个根因互相独立。

---

## 实测数据：时间线是怎么切出来的

体感「十来分钟」需要落到实测。方法是**两份日志对齐**：

1. **Windows 事件日志**给出安装器的精确起止（PowerShell，需要 `MsiInstaller` provider）：

   ```powershell
   Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='MsiInstaller'; StartTime=(Get-Date).AddDays(-30)} |
     Where-Object { $_.Message -like "*PicNexus*" }
   ```

   拿到 Event 1040（事务开始）/ 11707 + 1033（安装完成）/ 1042（事务结束）。
   1040 的消息里带安装源路径，`%TEMP%\PicNexus-1.1.0-updater-XXXXXX\PicNexus-1.1.0-installer.msi`——
   `-updater-` 这个临时目录是 plugin 自己建的，**这行本身就证明了自动更新装的是 MSI**。

2. **应用日志**（`%LOCALAPPDATA%\us.picnex.app\logs\PicNexus.log`，时间戳是 UTC）给出应用侧的动作。
   按秒聚合能一眼看出会话边界：

   ```bash
   grep -n "^\[2026-08-22\]" PicNexus.log | awk -F'[][]' '{print $4}' | uniq -c
   ```

对齐后的时间线（本地时间 = UTC+8）：

| 时刻 | 阶段 | 耗时 | 用户看到什么 |
|---|---|---|---|
| 09:52:19 | 最后一条前端日志（点「立即更新」） | — | 进度条 |
| → 09:53:58 | 下载 65.7MB MSI | **99s** | 进度条在走 |
| → 09:55:17 | msiexec 事务（卸旧版 → 解压 → 装新版） | **79s** | ❗窗口已消失 |
| 09:55:18 → 09:55:29 | 新版启动到就绪 | **11s** | ❗仍然什么都没有 |

**合计约 3 分 10 秒，其中后 90 秒屏幕上完全空白。** 没有反馈的等待，主观时间大致是实际的 2~3 倍——
这解释了「十来分钟」的体感与 79 秒的事务记录之间的落差。

---

## 根因 1：自动更新错拿 MSI

### 现象

`latest.json` 的通用键 `windows-x86_64` 指向 `PicNexus_1.1.0_x64_en-US.msi`（65.7MB），
而不是 `PicNexus_1.1.0_x64-setup.exe`（42.7MB）。两者的差别不只是体积：

- **NSIS setup.exe**：自解压，把文件铺到 `%LOCALAPPDATA%\PicNexus`
- **MSI**：交给 Windows Installer 系统服务，走事务（先卸旧版再装新版），实测 79 秒

### 为什么客户端不会自己挑对

`tauri-plugin-updater` 2.10.0 的 `get_urls`（`updater.rs:578-586`）按顺序查两个键：

```
1. windows-x86_64-{installer}    ← installer 来自 bundle_type()
2. windows-x86_64                ← 兜底
```

`bundle_type()`（`tauri-utils/src/platform.rs:353`）读的是编译进二进制的静态串 `__TAURI_BUNDLE_TYPE`，
由 bundler 在打包时把占位符替换成 `..._MSI` / `..._NSS`。**决定性证据**——直接查已安装的 exe：

```bash
grep -a -o "__TAURI_BUNDLE_TYPE_VAR_[A-Z]*" "$LOCALAPPDATA/PicNexus/PicNexus.exe"
#   1 __TAURI_BUNDLE_TYPE_VAR_UNK      ← UNK = 占位符从未被替换
```

戳是空的 → `bundle_type()` 返回 `None` → 第 1 步拼不出来 → 只查兜底键 → 拿到 MSI。

> 这一条把结论从「这个用户装错了包」拉到「**所有 Windows 用户都中招**」——
> 不管当初用 setup.exe 还是 msi 装的，自动更新一律走兜底键。
> 注册表旁证：`HKCU\...\Uninstall\PicNexus` 留着 1.0.8 的 NSIS 条目（无 `WindowsInstaller` 值），
> 而 1.1.0 在 `HKLM` 下是 GUID 键且 `WindowsInstaller=1`——这台机器确实是被自动更新从 NSIS 换成 MSI 的。

### 修复

CI 在 `release-checklist` 里改写 `latest.json`（[release.yml](../../.github/workflows/release.yml)）：

- `platforms['windows-x86_64'] = platforms['windows-x86_64-nsis']`
- 删除 `platforms['windows-x86_64-msi']`——将来 bundler 的打包戳修好后，MSI 装的用户会优先查那个键，
  留着它等于埋一颗「又跌回 MSI」的雷
- 四道硬校验（NSIS 键存在 / url 以 `-setup.exe` 结尾 / signature 非空 / platforms 是对象），任一不满足就 `throw`

⚠️ **顺序是硬约束**：必须跑在 `Generate SHA256SUMS` 之前，否则校验和对不上改写后的文件。

MSI 继续作为手动下载资产发布（企业批量部署），只是不再参与自动更新。

---

## 根因 2：安装阶段是死代码

`updater.rs:865`——`install_inner` 用 `ShellExecuteW` 拉起安装器后，**下一行就是 `std::process::exit(0)`**。

因此 `downloadAndInstall()` 的 `await` 在 Windows 上永不返回，这些东西**从来没有在 Windows 上执行过**：

- `useAutoUpdate.ts` 里 `status.value = 'install-pending'`
- `retryRelaunch()`
- UpdateCard 的 `install-pending` 分支（「重启完成更新」按钮）
- 流程图图 2 原本画的「显示重启完成更新」

（macOS / Linux 的 `install()` 会正常返回，这些仍然可达，所以不能删。）

### 修复：不写平台判断

`Finished` 事件的时机是关键——它发生在**下载完成、`install()` 尚未开始**之间
（`updater.rs:723-730`：`download(...).await?` 之后才 `install()`）。

于是让 `Finished` 统一进入新增的 `installing` 态，能走到 `await` 之后的平台再升级为 `install-pending`：

- Windows 被 `exit(0)` 截断 → 停在 `installing`
- macOS / Linux 正常返回 → 进 `install-pending`

**行为按平台分流，代码里没有一个 `if`。** 顺带删掉了声明过但从未被赋值的 `ready` 状态。

UI 文案「正在安装更新 / 应用会自动关闭，安装完成后自行重启」，**刻意不放按钮**——
进程即将退出，给按钮只会诱导无效点击。

---

## 验证

| 项 | 结果 |
|---|---|
| `npm run lint` / `typecheck` | 通过 |
| `npm run test:unit` | 217 文件 / 2995 用例通过 |
| `npm run test:updater-manifest`（改写逻辑单测） | 11/11 |
| workflow 步骤端到端模拟（真实 script + mock octokit + v1.1.0 真实 latest.json） | 10/10 |
| workflow YAML + 内嵌 JS 语法 + 步骤顺序 | 改写确在校验和之前 |
| 4 个 mermaid 块（括号、alt/end 嵌套平衡） | 通过 |

改写逻辑没有只靠「发版时看看」来验证，且**没有内联在 workflow 里**——
内联的话测试测的就是另一份拷贝，两者会悄悄漂移。现在的分工：

| 位置 | 职责 |
|---|---|
| [scripts/rewrite-updater-manifest.mjs](../../scripts/rewrite-updater-manifest.mjs) | 纯逻辑：校验 + 改写，不碰网络和磁盘 |
| [.github/workflows/release.yml](../../.github/workflows/release.yml) | 只剩 IO：找 draft release、下载 / 删除 / 上传 asset，动态 `import()` 上面那个模块 |
| [scripts/test/updater-manifest-rewrite.test.mjs](../../scripts/test/updater-manifest-rewrite.test.mjs) | 11 个用例，直接 import 同一个模块（与 `scripts/test/` 下其他测试的做法一致）；已接入 `npm run test:updater-manifest` 与 `ci:prepush` |

⚠️ **抽取时差点埋的雷**：`rewriteUpdaterManifest` 是纯函数、**不修改入参**，
而原先内联的版本是就地 mutate 的。如果替换时漏改上传那行（仍传 `manifest` 而不是返回的 `rewritten`），
改写会完全失效**且静默通过所有校验**——因为校验跑在改写之前，看的是输入。

单测抓不到这类接线错误，所以另外跑了一次**端到端模拟**：从 `release.yml` 里解析出那一步的真实 script，
用 mock 的 octokit 执行，断言 `uploadReleaseAsset` **实际收到**的 payload
（脚本见会话 scratchpad，10/10 通过）。关键断言是「上传的不等于原始文件」——
专门用来抓上面那个雷。

### 单测新增的两条

- `Finished` 事件当场进入 `installing`（**断言写在 mock 外部**：`downloadAndInstall` 的 `await` 包在
  try/catch 里，回调内 `expect` 失败会被当成下载异常吞掉，测试转而以 `status='error'` 的形式误报）
- `installing` 时再次点下载按钮不触发二次 `downloadAndInstall`

---

## 真机验收判据（待跑）

⚠️ **v1.1.1 这一次验不出安装提速**：这台机器的 1.1.0 是 MSI 装的，
Tauri 的 NSIS 模板检测到已有 WiX 安装会先 `ExecWait` 调 msiexec 卸载它，那一次大概率持平甚至略慢。

| 判据 | 何时可验 | 怎么验 |
|---|---|---|
| `latest.json` 的 `windows-x86_64` 指向 `x64-setup.exe`，且无 `windows-x86_64-msi` 键 | v1.1.1 发布后立即 | 拉取 release 的 `latest.json` |
| 下载体积 65.7MB → 42.7MB | v1.1.1 更新时 | 进度条时长 / 事件日志 |
| 安装阶段出现「正在安装更新」文案 | v1.1.1 更新时 | 肉眼 |
| 安装耗时从 79s 降下来 | **v1.1.2 更新时** | MsiInstaller 事件日志里不该再有 PicNexus 记录；改看 NSIS 落盘时间 |
| 注册表从 `HKLM` GUID 键（`WindowsInstaller=1`）变回 `HKCU` 普通键 | v1.1.1 更新后 | 查 Uninstall 注册表 |

---

## 过程中踩到的三个坑（记录备查）

1. **管道会吞掉 git 的退出码。** `git push origin main 2>&1 | tail -30` 返回的是 `tail` 的 0，
   推送其实失败了（`SSL_ERROR_SYSCALL`）却报成功。涉及退出码判断时不要接管道。

2. **这台机器的 git 写操作间歇失败。** 只读操作（`ls-remote`）探测三次全通，
   `push` 三次里挂两次，且都断在连接阶段（pre-push 钩子都没启动，所以失败很快、不浪费门禁时间）。
   `-c http.version=HTTP/1.1` 能提高成功率但不是稳定解，最后靠重试循环推上去。
   属 TUN 环境问题，与仓库/凭证无关，参见 fake-ip 相关记录。

3. **mermaid 块里避开圆括号。** 全文档其他节点都刻意不用 `()`，跟着办即可
   （flowchart 的 `A[text]` 里 `()` 会与 round node 语法冲突；sequence/state 的 label 虽然容忍，
   但保持一致零风险）。校验脚本：提取所有 ```mermaid 块，检查括号数与 alt/end 平衡。

---

## 执行记录

| 提交 | 内容 |
|---|---|
| `ea110d36` | ci(release): point the Windows updater at the NSIS installer |
| `2b021985` | fix(update): show an installing state during the Windows install window |
| `bb7490b4` | docs(update): correct the install sequence and record the NSIS switch |

随 v1.1.1 发布（tag `20b0132a`）。

发版清单里原有一条「更新下载完成后停留在『重启完成更新』」在 Windows 上**永远不可能勾上**，
已拆成分平台两条，另加一条「确认 Windows 更新拉的是 setup.exe 而非 msi」作为长期锚点。
