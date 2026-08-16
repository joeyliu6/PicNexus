# WebDAV 图床测试环境搭建

改动 WebDAV 图床链路后用来做真机回归。三套环境覆盖不同侧面，按需选：

| 环境 | 覆盖什么 | 搭建成本 |
|------|----------|----------|
| [dufs](#dufs局域网-http--基础协议) | 局域网 HTTP、自动建目录、连接测试两条反例 | ~2 分钟 |
| [OpenList](#openlist端到端正例) | 端到端正例（匿名固定直链） | ~30 分钟 |
| [坚果云](#坚果云公网商业-webdav) | 公网 HTTPS、真实商业服务端 | ~10 分钟 |
| [pinggy 隧道](#pinggy-隧道fake-ip-逃生舱) | fake-ip 逃生舱（明文 HTTP 确认弹窗） | ~3 分钟 |

协议层可用 [`scripts/test-webdav-compat.ps1`](../../../scripts/test-webdav-compat.ps1) 先扫一遍，
不必开着 app 手点。

---

## dufs（局域网 HTTP + 基础协议）

`dufs` 是单二进制静态文件服务器，**WebDAV 写入与匿名 HTTP 读取共用同一端口同一目录**，
天然满足「公开域名根路径 = WebDAV 根路径」，正好对上默认模板 `{domain}/{path}`。

```powershell
cargo install dufs --locked          # 已装过则跳过
New-Item -ItemType Directory -Force C:\Users\<你>\webdav-root
dufs C:\Users\<你>\webdav-root -b 192.168.80.1 -p 5001 -A -a "admin:admin123@/:rw" -a "@/"
```

`-a admin:admin123@/:rw` = 管理员可读写，`-a @/` = 匿名只读——正是图床要的形态。

> ⚠️ **绑定地址不要用 `0.0.0.0`**：那会把一个带写权限的服务暴露给整个局域网。
> 例中的 `192.168.80.1` 是 VMware host-only 网卡，既是私有 IP（命中 `is_private_or_reserved_host` 分支），
> 又不桥接物理网络。用 `127.0.0.1` 则只会走回环分支（`url_policy.rs` 里回环与私有 IP 是两条独立分支），
> **测不到 NAS 场景**。本机 IP 会变，先跑 `Get-NetIPAddress -AddressFamily IPv4` 确认。

> ⚠️ **必须填 IP 字面量，不能填主机名**：开了 TUN 的机器上（`Meta` 网卡挂 `198.18.0.1`），
> 任何主机名都会解析进 fake-ip 池、被 `validate_webdav_url_for_request` 拒绝，连 `nas.local` 也不例外。

PicNexus 侧配置（设置 → 图床设置 → 私有存储 → 添加 WebDAV）：

| 字段 | 值 |
|------|-----|
| WebDAV 地址 | `http://192.168.80.1:5001` |
| 用户名 / 密码 | `admin` / `admin123` |
| 图片目录 | `picnexus/新目录`（故意填不存在的多级中文目录，顺带验证自动建目录） |
| 公开访问域名 | `http://192.168.80.1:5001` |
| 链接模板 | 留空（默认 `{domain}/{path}`） |

### 回归连接测试的两条反例

两条走的是**不同分支**，必须分开测。判据逐字写死，看到笼统的「连接失败」就是回归：

| 分支 | 怎么造 | 应该看到 |
|------|--------|----------|
| 状态码 | WebDAV 地址改成 `http://192.168.80.1:5001/wrong-prefix`（公开域名不动） | `图片已上传，但公开链接打不开 (HTTP 404)——请检查「公开访问域名」和 URL 模板` |
| Content-Type | 地址改回，链接模板填 `{domain}/`（指向目录列表，返回 HTML） | `公开链接返回的不是图片 (Content-Type: text/html; charset=utf-8)——多半是模板指向了登录页或分享页` |

测完把地址和模板改回原值。

---

## OpenList（端到端正例）

唯一能验「匿名固定直链」的环境——即完整走通「传上去 → 拿到能直接引用的链接」。

```powershell
New-Item -ItemType Directory -Force C:\Users\<你>\openlist-data\pics
docker run -d --restart=unless-stopped `
  -v C:\Users\<你>\openlist-data:/opt/openlist/data `
  -p 5244:5244 -e UMASK=022 --name openlist openlistteam/openlist:latest
docker logs openlist   # 日志里有 "the initial password is: xxxxx"
```

官方文档给的是 Linux 命令（带 `--user $(id -u)` 和 `chown 1001`），
Windows 下 Docker Desktop 的绑定挂载不走那套 Linux 属主，用上面这版即可。

### ⚠️ 四个默认值会让验收卡住，全都不在官方 WebDAV 文档里

后台 `http://127.0.0.1:5244`，用 `admin` + 初始密码登录后逐项处理：

| # | 坑 | 症状 | 位置 |
|---|----|------|------|
| 1 | 驱动名叫「**本机存储**」不是「本地存储」 | 添加存储时按「本地」搜不到 | 存储 → 添加 → 驱动 |
| 2 | 全局「**签名所有**」默认开启 | 直链带 `?sign=xxx`，签名逐文件计算，**URL 模板里没有变量能生成它** | 设置 → 全局 → `sign_all` |
| 3 | admin 的「**WebDAV 管理**」默认关闭 | MKCOL / PUT 全返回 403。「WebDAV 读取」默认开着所以 PROPFIND 能过，**极易误判成图片目录填错** | 用户 → admin → 权限 |
| 4 | **guest 默认停用** | 匿名 GET 直链 401，测不到正例（退化成「传上去了但链接打不开」） | 用户 → guest → 取消「停用」 |

存储配置：挂载路径 `/pics`，根文件夹路径 `/opt/openlist/data/pics`。

> 改 admin 自己的权限后会被强制登出，属正常。admin 编辑页的密码框会回填明文，保存不会清空。

**`/d/` 前缀本身没问题**：关掉签名后 `/p/`（代理）和 `/d/`（直链）都返回 `200 + image/png`。
真正卡人的是上表 2 和 3。

四项处理完后，协议序列应全部通过：
`PROPFIND 207` → `MKCOL 201`（含中文目录）→ `PUT 201` → 匿名 `GET 200 + image/png`。

PicNexus 侧配置（`127.0.0.1` 走 [url_policy.rs:379](../../../src-tauri/src/url_policy.rs#L379)
回环分支，不碰 DNS，不受 TUN 影响）：

| 字段 | 值 |
|------|-----|
| WebDAV 地址 | `http://127.0.0.1:5244/dav` |
| 用户名 / 密码 | `admin` / 初始密码 |
| 图片目录 | `pics/picnexus` |
| 公开访问域名 | `http://127.0.0.1:5244` |
| 链接模板 | `{domain}/d/{path}` |

WebDAV 根（`/dav`）与直链根（`/d`）指向同一位置，所以同一个 `{path}` 两边通用。

**判据**：测试连接「验证成功」+ 真传一张图后浏览页缩略图正常显示。
链接粘进地址栏会触发下载，这是 OpenList 的行为不是缺陷，
详见 [排查手册](../troubleshooting/webdav-image-host-issues.md#公开链接在浏览器地址栏里变成下载)。

---

## 坚果云（公网商业 WebDAV）

验的是「不听我们摆布的服务端认不认这串请求」，以及常规 HTTPS 策略路径没被局域网豁免弄坏。

**先生成应用密码**：网页端 → 右上角头像 → 账户信息 → 安全选项 → 第三方应用管理 →
添加应用 → 生成密码。**权限必须是读写**，只读传不上去。建议单独生成一个，
不要和备份用的共用——出问题能单独吊销。

| 字段 | 值 |
|------|-----|
| WebDAV 地址 | `https://dav.jianguoyun.com/dav/`（**末尾斜杠不能少**） |
| 用户名 | 坚果云注册邮箱 |
| 密码 | 上面生成的读写应用密码 |
| 图片目录 | `picnexus-test` |
| 公开访问域名 | 同 WebDAV 地址 |
| 链接模板 | 留空 |

### 判据和别处相反：报错才算通过

坚果云不提供匿名直链（官方明说仅供第三方工具调用，不支持浏览器直接访问），所以：

> ✅ **通过**：`图片已上传，但公开链接打不开 (HTTP 401)`（403 同理）
>
> ❌ **不通过**：`认证失败` / `路径不存在` / `上传失败：...`

**「图片已上传」这半句才是重点**——它证明 PROPFIND、MKCOL、PUT 三步在真实商业服务端上全过了。
后半句是坚果云的产品设计，不是 PicNexus 的毛病。

**别只信提示**：回坚果云网页端确认根目录下多出了 `picnexus-test` 文件夹。
探针图传完即删，所以只会看到空文件夹——这是正常的，同时也证明清理逻辑有效。

---

## pinggy 隧道（fake-ip 逃生舱）

专测「明文 HTTP 逃生舱」（[fake-ip-dns-policy-distortion.md#逃生舱已实现](../troubleshooting/fake-ip-dns-policy-distortion.md#逃生舱已实现)）。
前三套环境全用 IP 字面量，天生绕开 fake-ip；这个功能恰恰要**测主机名**，
所以反过来要故意造一个「本机判不清、但真连得通」的地址——理想情况下用真实 NAS 的公网主机名最直接，
但不是每个人手头都有（2026-08-16 那次群晖在 DSM 7.2+ 已下架 WebDAV Server 套件），下面是等价替代。

**本机开着 TUN + fake-ip 时，任意主机名都会被解析进 `198.18.0.0/15`**
（见 [fake-ip-dns-policy-distortion.md](../troubleshooting/fake-ip-dns-policy-distortion.md)）。
借这个特性：只要有一个**真实公网可达**的主机名，本机看它就是「看不见」，正好触发逃生舱；
连接本身由 TUN 底层按真实 DNS 路由，照样能连通。

```powershell
# 1. 本机起 dufs（复用 Digest 夹具同款工具，见上文 dufs 小节），密码随机生成，不用默认弱密码
New-Item -ItemType Directory -Force C:\Users\<你>\webdav-escape-test\pics
dufs C:\Users\<你>\webdav-escape-test -b 127.0.0.1 -p 5021 -A -a "admin:<随机密码>@/:rw" -a "@/"
```

```bash
# 2. 借 pinggy.io 的免费 TCP 隧道把它发布成公网真实域名，无需注册账号
ssh -p 443 -R0:localhost:5021 tcp@free.pinggy.io
# 输出形如 tcp://xxxx-x-x-x-x.run.pinggy-free.link:端口 —— 把 tcp:// 换成 http:// 就是要填的地址
```

PicNexus 侧配置：WebDAV 地址与公开访问域名都填上面那个地址（协议换成 `http://`），
图片目录填 `pics`。

> ⚠️ **免费额度 60 分钟到期自动断开**，逃生舱那 6 条判据尽量一口气跑完；断了重开地址会变，需重填。
> ⚠️ **`serveo.net` 的匿名 TCP 转发已失效**（`ssh -R 0:localhost:端口 serveo.net` 报
> `remote port forwarding failed for listen port 0`），只剩 HTTPS 终结的 HTTP 隧道模式——
> 那种模式在网络边缘就把明文变成密文了，测不出「明文 HTTP」这条分支，踩过这个坑不用再试。
> ⚠️ 用前先 `curl -X PROPFIND -u admin:密码 -H "Depth: 1" http://隧道地址/` 确认能拿到 `207`，
> 免得把「隧道没搭好」误判成「逃生舱代码有问题」。

判据表与本次验收结果见
[webdav-digest-and-lan-http-escape-hatch-acceptance.md](../../audits/webdav-digest-and-lan-http-escape-hatch-acceptance.md)。

---

## 测试素材

验证同名覆盖行为需要同名不同色的图：

```powershell
Add-Type -AssemblyName System.Drawing
function New-SolidPng($path, $color) {
  $bmp = New-Object System.Drawing.Bitmap 240,240
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromName($color)); $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
$dir = "$env:TEMP\picnexus-webdav-fixtures"
New-Item -ItemType Directory -Force "$dir\red","$dir\blue" | Out-Null
New-SolidPng "$dir\red\test.png" Red
New-SolidPng "$dir\blue\test.png" Blue
New-SolidPng "$dir\中文 图片.png" Green   # 验证 percent-encode
```

---

## 相关文档

- 验收记录：[docs/audits/webdav-acceptance-2026-08-14.md](../../audits/webdav-acceptance-2026-08-14.md)
- 症状排查：[webdav-image-host-issues.md](../troubleshooting/webdav-image-host-issues.md)
- 上传流程：[docs/flows/upload-flow.md](../../flows/upload-flow.md)
