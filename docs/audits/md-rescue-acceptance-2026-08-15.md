# 文档修复批次 1 真机验收（2026-08-15）

> 对应 [fix-plan-2026-08-13.md](./fix-plan-2026-08-13.md) 批次 1 的三条判据。**三条全过。**
> 判据原文见该计划批次 1 各条的「验收」行（TODO 待验收条目已于 2026-08-22 归档），
> 本文记**怎么构造的**和**看到了什么**。

## 结果

| 判据 | 结果 | 证据 |
|------|------|------|
| 1.1 同名文件备份不互串 | ✅ | 备份保留 `a/` `b/` 两层；撤销后两文件 SHA256 与各自备份**完全一致**，交叉比对不同 |
| 1.2 备份目录不被重扫 | ✅ | `[MdScanner] 跳过备份目录: "D:\mdtest\.picnexus-backup"`，结果只含 `note.md` |
| 1.3 非 UTF-8 拒绝写回 | ✅ | 提示 `编码不受支持（非 UTF-8），已跳过以免写回乱码`，文件未被加载、未被改动 |

**跑的过程中另外挖出两个真缺陷**，都不在批次 1 范围内，已单独修复：

- [setup 上下文失效](../reference/troubleshooting/../../flows/md-rescue-flow.md#setup-上下文约束)——
  「修复链接」「撤销」按钮点了就抛，1.1 一度**根本跑不起来**
- [拖放路径不在 fs 白名单](../flows/md-rescue-flow.md#文件访问白名单)——
  拖放这个主入口对用户目录里的文件完全不可用

## 1.1 的构造：难点在哪

判据只说「含失效链接的 README.md」，但实际约束比这严得多：

**只有真的被修复过的文件才会产生备份**（`executeReplace` 按 `fileReplacements` 建备份），
所以两个同名文件必须各自至少有一张**能修好**的失效图。「能修好」要同时满足：

1. 该 URL 在 PicNexus 历史里（`buildUrlIndex` 命中）
2. 同一条历史记录里**还有另一个 `status=success` 的 URL**，且它当场检测为有效

也就是说，随便写一个坏链接是没用的——扫描能发现它失效，但没有备用链接就不会进修复流程，
不修复就不产生备份，1.1 什么也验不到。

### 可控的造法：本地 dufs + 一个公网图床

```powershell
# dufs 已装则跳过：cargo install dufs --locked
New-Item -ItemType Directory -Force C:\Users\<你>\webdav-root\pics
dufs C:\Users\<你>\webdav-root -b 127.0.0.1 -p 5001 -A -a "admin:admin123@/:rw" -a "@/"
```

> 这里**故意用 `127.0.0.1`**，与 [webdav-testing-environments.md](../reference/guides/webdav-testing-environments.md)
> 的局域网 IP 建议不同。那份建议是为了覆盖「NAS 场景」那条 URL 策略分支；
> 本验收只需要一个能传能删的服务器，回环地址更省事也不暴露给局域网。

PicNexus 侧：地址 `http://127.0.0.1:5001`、`admin`/`admin123`、图片目录 `pics`、
公开域名 `http://127.0.0.1:5001`、链接模板留空。

然后：

1. **同时勾选 dufs + 京东**传一张图 → 一条历史记录、两个可用链接
2. 到 `webdav-root\pics\` 把那个文件**删掉** → dufs 链接 404（失效），京东链接仍有效（备用）
3. 建 `D:\mdtest2\a\README.md` 与 `D:\mdtest2\b\README.md`，内容写得**明显不同**
   （一个全 A、末尾 `A-END`，一个全 B、末尾 `B-END`），各放那条失效链接
4. 选文件夹 `D:\mdtest2` → 勾「包含子文件夹」→ 修复 → 撤销

### 判据核对必须用哈希，不能靠眼睛

```powershell
(Get-FileHash D:\mdtest2\.picnexus-backup\<ts>\a\README.md).Hash -eq (Get-FileHash D:\mdtest2\a\README.md).Hash
```

再加一条**交叉核对**（a 的备份 vs b 的当前必须不同），否则「两个文件都被同一份备份覆盖」
这种情况下，单看「各自与自己的备份一致」是可能假通过的。

实测：`a` 备份与当前一致、`b` 备份与当前一致、交叉不同——三条同时成立才算过。

## 1.2 的简化：不必先跑通 1.1

判据原文写的是「对上一步修复过的文件夹再扫一次」，依赖 1.1 先成功。
但 Rust 侧只按**目录名**跳过（`md_scanner.rs` 的 `BACKUP_DIR_NAME`），
所以**手工造一个** `.picnexus-backup\20260815_120000\old.md` 效果完全等价，3 分钟就能测完。

先跑 1.2 还有个附带收益：它顺带证明了「选择文件夹」的授权覆盖到目录内的文件
（成功读出链接），从而确认 1.1 不会卡在文件访问权限上。

## 1.3 最便宜，应该第一个跑

编码检查发生在**加载文件的那一刻**，不需要失效图、不需要网络、不需要任何构造：
记事本存一个 ANSI 编码含中文的 `.md`，拖进去（或用「选择单个文件」）即可。

> ⚠️ 第一次尝试用拖放，撞上了 `forbidden path` ——那是拖放白名单缺陷，不是 1.3 的结果。
> 用「选择单个文件」才走到编码判断。**报错文案不同就是不同的缺陷，别混为一谈。**

## 收尾

```powershell
Stop-Process -Name dufs -Force
Remove-Item -Recurse -Force D:\mdtest2, D:\mdtest, C:\Users\<你>\webdav-root
```

历史记录里那条 dufs + 京东的上传记录可以留着——它是下次再跑 1.1 时现成的素材。
