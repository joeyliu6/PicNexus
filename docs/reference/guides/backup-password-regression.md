# 备份密码真机回归：怎么测

> 改动 `config.webdav`（备份 WebDAV）密码链路后用来做真机回归。
> 判据清单在 [TODO 待验收](../../TODO.md#待验收)，本文只讲**怎么操作**。
>
> 图床 WebDAV（`config.webdav_profiles`）是另一条链路，环境搭建见
> [webdav-testing-environments.md](./webdav-testing-environments.md)。

## 先看这四个坑

这类测试最大的风险不是测不出问题，是**测出个假的「通过」**。

### 坑 1：点窗口 X 不会退出应用

`closeToTray` 默认 `true`（[defaults.ts:145](../../../src/config/defaults.ts)），
Rust 侧在读到配置之前就已经默认 `true`（[main.rs:317](../../../src-tauri/src/main.rs)）。
点 X 只是 `window.hide()`，进程还活着，**配置根本没重新从磁盘加载**。

这条最要命：所有「重启后仍然成功」的判据，只要是这么"重启"的，结论全部无效。

**完整退出的两种方式**（Windows）：

1. **托盘右键 →「退出」**（[trayMenu.ts:265](../../../src/services/trayMenu.ts)，走 `process::exit`，一定杀进程）
2. 或先去 设置 → 通用 关掉「关闭时最小化到托盘」，再点 X

任务管理器里确认 `PicNexus.exe` 已消失，再启动。

> 托盘图标**左键是唤起主窗口**，右键才弹菜单。

### 坑 2：dev 和正式版共用同一份数据

`identifier` 全仓库只有一个 `us.picnex.app`（[tauri.conf.json](../../../src-tauri/tauri.conf.json)），
没有 dev/release 区分。所以 `npm run tauri dev` 跑起来的 app 和已安装的正式版共用：

- 同一份 `.settings.dat`
- 同一个系统钥匙串密钥
- 同一个 `history.db` 和 logs 目录

**测试会污染你的真实配置。** 而且注册了 single-instance
（[main.rs:274](../../../src-tauri/src/main.rs)）：正式版还在托盘驻留时启动 dev 版，
第二个实例会被拦截、只是唤起已有窗口——**你以为在测新代码，其实在点老版本**。

对策，按干净程度排序：

| 做法 | 说明 |
|------|------|
| 便携版（最干净） | exe 同级建 `data\portable.json`，数据全走 `data\`，与正式版彻底隔离 |
| 备份后用 dev | 先把 `.settings.dat` 复制一份到别处，测完还原 |
| 直接用 dev | 只在你不在意当前配置时 |

**动手前一定先从托盘退出正式版。**

### 坑 3：配置同步必须先设备份密码，而设备份密码有已知缺陷

配置上传 / 双向同步在没有备份密码时会被拒绝
（[sync-flow.md](../../flows/sync-flow.md) 图 1 下方要点）。

但设置备份密码会换掉 `secureStorage` 的钥匙，触发
[孤儿密文缺陷](../../TODO.md#待处理)——已存的 WebDAV 密码变成解不开的孤儿。

**所以顺序不能反**：先设备份密码，**再**填 WebDAV 密码。反过来做，你会看到
「密码解密失败，请重新输入密码后再测试」，那是已知缺陷不是回归。

### 坑 4：日志里看不到明文，那是设计如此

logger 做了强脱敏（[logger.ts](../../../src/utils/logger.ts)）：token / cookie / password
一律 `[REDACTED]`，Windows 路径变 `[path:<basename>#<hash>]`。
**别把这个当成"密码丢了"的证据。**

## 环境准备

### 坚果云应用密码

网页端 → 头像 → 账户信息 → 安全选项 → 第三方应用管理 → 添加应用 → 生成密码。
**权限必须读写。** 建议为回归单独生成一个，出问题能单独吊销。

填在 设置 → 备份与同步 → **WebDAV 连接**（不是图床那个 tab）：

| 字段 | 值 |
|------|-----|
| 服务器 URL | `https://dav.jianguoyun.com/dav/`（**末尾斜杠不能少**） |
| 用户名 | 坚果云注册邮箱 |
| 密码 | 上面生成的读写应用密码 |
| 远程路径 | `/PicNexus-regression/`（和日常备份分开，别互相污染） |

### 启动

```
npm ci
npm run setup:sidecars      # 首次必须，否则 sidecar 缺失
npm run tauri dev
```

`npm run dev` 是纯 vite、没有 Tauri API，**不能**用来做真机测试。

## 关键文件与目录

| 东西 | 普通安装 / dev | 便携版 |
|------|----------------|--------|
| 配置 | `C:\Users\<你>\AppData\Roaming\us.picnex.app\.settings.dat` | `<解压目录>\data\.settings.dat` |
| 日志 | `C:\Users\<你>\AppData\Roaming\us.picnex.app\logs\` | `<解压目录>\data\logs\` |

> `.settings.dat` 有前导点，资源管理器要开「显示隐藏项目」才看得见。
> 文件整体是 AES-GCM 加密的，**用记事本打开是乱码，这正常**，别指望肉眼验证密码存没存。

日志也可以从 设置 → 关于 →「日志目录」一键打开。

## 出问题时看什么

日志消息格式是 `[模块名] 消息`，直接搜方括号：

| Logger 名 | 对应环节 |
|-----------|---------|
| `WebDAVBackupConfig` | 密码框的加密 / 解密失败 |
| `WebDAVSecrets` | 保存时的批量加密 |
| `WebDAV` | 底层 HTTP 请求与认证 |
| `WebDAVSync` / `BackupSync` | 同步链路 |
| `Store` | 配置读写、解密、自愈、损坏备份 |

dev 模式下这些日志同时出现在**终端**和 **DevTools console**；
release 版**只写文件**（Webview target 只在 debug 构建注册）。

## 测完收尾

1. 托盘退出
2. 还原 `.settings.dat`——**先读下面那条警告，跑过第二轮就不能还原**
3. 坚果云网页端删掉 `PicNexus-regression` 目录，吊销那个专用应用密码

> 🚨 **跑过第二轮（设过备份密码）之后，那份备份文件就作废了，还原它会毁掉配置。**
>
> 备份是用旧密钥加密的，而 `setBackupPassword` 的 `set_secure_key` 把钥匙串里的旧密钥
> **覆盖且无备份**。把老文件放回去 = 用新密钥开老锁，
> [`EncryptedStore`](../../../src/store/EncryptedStore.ts) 整份读不出来直接抛
> `加密数据解密失败`——损失远大于"几个密码要重填"。
>
> 跑过第二轮之后的正确收尾：**保留当前 `.settings.dat`**，把变成孤儿的密码逐个重填
> （备份那一个 + `config.webdav_profiles` 里每一个）。备份文件直接删掉。
>
> 想要"测完能一键还原"，唯一可靠的做法是**用便携版**（坑 2 的表格第一行）——
> 数据在独立目录、连钥匙串都不共用，删掉整个 `data\` 就干净了。
> 「备份后用 dev」这条只对**不设备份密码**的第一轮成立。
