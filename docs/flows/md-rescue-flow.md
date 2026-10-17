# 文档修复流程

> 链接健康页的「修复」= 把图片「复制时使用」的那份切到可访问的备份，并替换「文档文件夹」里 Markdown 文档中的旧链接（交接说明第 4 节规则 8）。
> 排查「文档没被更新」「用于 N 个文档对不上」「写回乱码」「撤销没还原」时查看此文档。

---

## 图 1：文档文件夹与索引

文档文件夹记在配置 `linkHealth.docFolders`（本机路径，云同步合并时保留本机的这一份）。进入链接健康页、增删文件夹、修复后各扫一次，结果只放内存。

> **关键源文件**：`src/views/health/useDocFolders.ts`（增删、扫描）、`src/views/health/docIndex.ts`（索引与修复计划，纯函数）、`src-tauri/src/commands/md_scanner.rs`（`scan_md_folder`）

```mermaid
flowchart TD
    A["进入页面 / 增删文件夹 / 修复后"] --> B["useDocFolders.scan<br/>排队执行，一次扫一个文件夹"]
    B --> C["allowUserPaths：申请访问权限<br/>（授权只活在本次进程内，每次都要申请）"]
    C --> D["invoke('scan_md_folder', { dir, includeSubfolders: true, includeCodeBlocks: false })"]
    D -- 路径不存在 / 没权限 --> D1["这一行写「文件夹不存在」/「没有读取权限」"]
    D --> E["Rust：递归找 .md / .markdown（跳过 .picnexus-backup）<br/>读 UTF-8、按行提取图片链接"]
    E --> F["buildDocIndex：文档里每条链接对上哪张图的哪一份<br/>原始链接 / 加了前缀的链接 / 剥掉已知前缀后的链接都认"]
    F --> G["每张图「用于 N 个文档」<br/>文档弹窗「需要修复的文档 · 几处失效几处可替换」"]
```

- 只认 PicNexus 记录里的链接：文档里别处来的图片不检测、不计入、不替换。
- 一处引用「失效」= 它指向的那一份被查出失效；「可替换」= 这张图有能用的那份（复制时使用的那份可访问就用它，否则用改用的那份）。

## 图 2：修复与撤销

> **关键源文件**：`src/views/health/useHealthRepair.ts`（`repair`、撤销、通知）、`src/views/health/docFiles.ts`（`writeDocs`、`restoreDocs`、`describeDocError`）、`src/views/health/mdTextIo.ts`

```mermaid
flowchart TD
    A["修复 N 张 / 行内「改用 X」/ 文档弹窗「修复 N 处」"] --> B{同一时间只跑一个}
    B --> C["planDocWrites：按修复前的模型算好每个文档换哪几条"]
    C --> D["逐张 historyDB.switchPrimaryService（记下原来那份）"]
    D --> E["writeDocs：逐个文档<br/>严格 UTF-8 读 → 替换 → 没变就跳过 → 备份 → 写回（补回 BOM）"]
    E --> F["通知：已修复 N 张 · 已更新 M 个文档中的 K 处旧链接 +「撤销」"]
    E -- 有文档写不成 --> G["红色通知：原因 + 处理办法 +「重试」<br/>只重写这几个，写成的并进同一次撤销"]
    F -.撤销.-> H["restoreDocs：当前内容仍是写进去的那份才还原，改过的跳过并说明<br/>+ 复制时使用改回原来那份"]
```

### 备份路径不变量

备份放在 `<文档文件夹>/.picnexus-backup/<YYYYMMDD_HHmmss>/<相对路径>`，一文件一路径，否则撤销会把同一份备份写进两个文件：

1. Rust 扫描返回的路径已剥掉 Windows verbatim 前缀（`\\?\C:\x`），与对话框给的路径形态一致。
2. `relativeToFolder` 再剥一次、统一分隔符、大小写不敏感比对前缀。
3. 相对路径算不出来时用 `hash_basename`（FNV-1a 32 位，8 个十六进制字符），不退化成裸文件名。

每个文件夹只留最近 5 次备份。目录名在 Rust（`md_scanner.rs`）与前端（`docFiles.ts`）各写一份，由 `scripts/check-cross-language-constants.mjs` 守着：Rust 扫描靠它跳过备份目录，漂移了会把「修复前的原件」当正常文档再修一遍。

### 编码约束

只处理 UTF-8。plugin-fs 的 `readTextFile` 用非 fatal 的 `TextDecoder`，GBK 等字节会被静默换成 `�` 再写回——永久损坏原文。`mdTextIo.readUtf8TextFile` 读原始字节 + `TextDecoder('utf-8', { fatal: true })`，解不出来就抛 `NonUtf8FileError`，这个文档不备份、不写回。原文件的 BOM 记下来、写回时补回。

### 替换规则

`mdParser.replaceImageLinks` 只改图片语法（`![alt](url)`、`<img src="url">`）里的地址：跳过围栏代码块与行内代码（与 Rust 提取同一套 CommonMark 规则），普通链接、裸 URL 不动；按文档里的原样链接查替换表。

## 排查指南

| 现象 | 可能原因 | 对照位置 |
|------|---------|---------|
| 修复了，文档没被更新 | 没添加文档文件夹（通知只说切换了复制链接）；或文档里的链接不是这张图记录里的任何写法 | 图 1 `buildDocIndex` |
| 「用于 N 个文档」写「未被文档引用」，可文档里明明有 | 文档里的链接加了不认识的前缀；或扫描还没结束（`scanned` 为 false 时这一列不写） | 图 1 |
| 文件夹行写「文件夹不存在 / 没有读取权限」 | 换了电脑、路径改名，或系统拒绝访问；云同步不会带来别的电脑的文件夹 | 图 1 `statusOfError` |
| 红色通知「编码不受支持（非 UTF-8）」 | 原文件不是 UTF-8（记事本 ANSI / GBK）。转成 UTF-8 后重试 | 编码约束 |
| 红色通知「被其他程序占用」 | Windows os error 32 / 33：编辑器锁着文件。关掉后点「重试」 | `describeDocError` |
| 撤销后有个文档没还原 | 修复后又被编辑过：不还原免得盖掉新改动，备份仍在 `.picnexus-backup/` | 图 2 `restoreDocs` |
| 再扫一次失效数虚高 | `.picnexus-backup` 被扫了进来：检查两侧目录名是否一致（`npm run lint` 会拦） | 备份路径不变量 |
| 代码块里的图片链接没被换 | 设计行为：代码块里的是示例，不改 | 替换规则 |

---

## 相关文档

- [链接检测流程](./link-check-flow.md) — 失效是怎么判出来的、健康模型
- [补充备份流程](./batch-migrate-flow.md) — 同一页的另一个工具
