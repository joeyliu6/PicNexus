# WebDAV 图床验收记录（2026-08-14）

- **需求来源**：[GitHub Issue #1：支持 WebDAV 图床](https://github.com/joeyliu6/PicNexus/issues/1)
- **结论**：真机验收 **6/6 全部通过**
- **环境重建**：[webdav-testing-environments.md](../reference/guides/webdav-testing-environments.md)
- **排查手册**：[webdav-image-host-issues.md](../reference/troubleshooting/webdav-image-host-issues.md)

## 为什么这次验收可信

覆盖**三个互相独立的服务端实现**，而不是三个同宗同源的服务：

| 服务端 | 血统 | 类型 | 验的是什么 |
|--------|------|------|-----------|
| dufs | Rust 单二进制 | 极简自建 | 基础协议 + 局域网 HTTP 场景 |
| OpenList | Go / AList 血统 | 聚合网盘 | 端到端正例（含匿名固定直链） |
| 坚果云 | 闭源商业 | 公网 HTTPS | 协议兼容 + 常规 HTTPS 策略路径 |

三个毫无关系的代码库都接受同一串请求，说明发出的是标准 WebDAV，不是在迁就某一家的脾气。

## 设计决策记录

### 与原调研方案的偏离：独立配置而非复用备份 profile

原方案计划复用 `config.webdav`（备份用），实现时改为独立的 `config.webdav_profiles`：

- 图床需要 `publicDomain` / `publicUrlTemplate`，备份用不上，混在一起会让备份配置长出无用字段
- 用户的备份服务（如坚果云）与图床服务（如 OpenList）往往不是同一个，强行共用凭证反而别扭
- **代价**：同一台服务器要填两次账号密码
- **换来**：两套配置互不干扰，备份功能零改动

### 调研时漏掉、实现时补上：局域网 HTTP 放行

网络策略原本把局域网地址拦死，而群晖 / 自建 NAS（`http://192.168.1.10:5005`）正是 WebDAV 图床最主要的用户群。

已为 WebDAV 单独放开，共三层。**注意备份链路与图床链路走的是两套函数，改一边不会自动影响另一边**：

| 层 | 备份 WebDAV | 图床 WebDAV |
|----|-------------|-------------|
| 1. 前端请求校验 | `assertAllowedWebDAVUrl` | `assertAllowedWebDAVStorageUrl` |
| 2. Rust 请求校验 | `validate_webdav_url`（同步） | `validate_webdav_url_for_request`（异步，带 DNS 裁决） |
| 3. 应用内图片显示 | 共用 `safeImageUrl` —— 漏掉这层会导致上传成功但历史缩略图全裂 | |

两条链路的差别只在 HTTP **主机名**上：备份链路在前端就拒绝 `http://主机名`（只认 IP 字面量），
图床链路放行到 Rust 侧、按 DNS 解析结果裁决，好让 `http://nas.local:5005` 这类地址能用。

放开仅作用于 WebDAV 链路，其他图床仍是 HTTPS-only；链路本地段（含云元数据 `169.254.169.254`）
与公网明文 HTTP 依旧拒绝。DNS 裁决同样先拒绝链路本地 / 组播 / 保留段，再判断是否局域网——
判据是 `is_allowed_lan_addr`，**不能**直接用 `is_private_or_reserved_host`（它的语义是「非公网」，
会把云元数据地址一起放进来）。

`is_allowed_lan_addr` 还会拒绝代理的 fake-ip 池 `198.18.0.0/15`：该段出现在 DNS 答案里
只说明本机开着 TUN，对目标的真实位置零信息量，当局域网证据会让公网明文 HTTP 全线放行。

## 验收清单

### 已由单元测试覆盖

- [x] 多个 WebDAV profile 可以独立启用、选择和上传
- [x] 图片目录与 `settings.json`、`history.json` 的备份目录隔离（两套独立配置）
- [x] 中文、空格及需要 URL 编码的文件名可以正确上传和访问
- [x] 认证失败、无写入权限、路径错误和存储空间不足时返回明确错误
- [x] WebDAV 图床可以参与多图床上传、重试和主链接选择流程
- [x] 配置文件中密码为密文，明文不进 formData 也不落盘

### 真实服务器验证

| # | 项 | 载体 | 日期 |
|---|----|------|------|
| ① | 自动创建远程目录并以二进制 PUT 上传图片 | dufs | 08-13 |
| ② | 按配置模板生成公开 URL 并写入上传历史 | dufs | 08-13 |
| ③ | 连接测试能区分「传不上去」和「传上去了但链接打不开」 | dufs | 08-14 |
| ④ | 内网 HTTP（NAS）场景下历史缩略图正常显示 | `192.168.80.1` 私有 IP | 08-13 |
| ⑤ | 现有备份功能及旧配置无需迁移即可继续使用 | 坚果云 | 08-13 |
| ⑥a | 本地端到端（含匿名固定直链） | OpenList / Docker | 08-14 |
| ⑥b | 公网商业 WebDAV 协议兼容 | 坚果云 | 08-14 |

### ③ 的两条反例（本次验收最有价值的一条）

`test_webdav_storage` 的两条失败分支各自命中，文案与源码逐字一致，未退化成笼统「连接失败」：

| 分支 | 复现方式 | 实测提示 |
|------|----------|----------|
| 状态码<br>`!is_ok_status(status)` | WebDAV 地址改成 `.../wrong-prefix`（域名不动）——图落到 `/wrong-prefix/...`，公开链接按原域名拼出来指向空目录 | `图片已上传，但公开链接打不开 (HTTP 404)——请检查「公开访问域名」和 URL 模板` |
| Content-Type<br>`!content_type.starts_with("image/")` | 链接模板改成 `{domain}/`，指向 dufs 目录列表 | `公开链接返回的不是图片 (Content-Type: text/html; charset=utf-8)——多半是模板指向了登录页或分享页` |

服务端响应形态已用 curl 独立确认：A 返回 404 无 Content-Type；B 返回 200 + `text/html`；
正确链接返回 200 + `image/png`。探针文件上传后被正常清理，无 `.picnexus-probe-*` 残留。

### ⑥b 为什么从 InfiniCLOUD 换成坚果云

InfiniCLOUD 注册时撞上**候补名单**：官方改成排队制，账号要等邮件才开通，客服查不了排队位置
也不能插队，等待时长不公布——这条会被无限期挂住。

这条验收要的从来不是某个牌子，而是三个属性，坚果云全中：

| 要的属性 | 为什么 | 坚果云 |
|---|---|---|
| 真实商业 WebDAV（非自建） | dufs / OpenList 都是自己搭的、参数自己定，验不了「不听我们摆布的服务端」 | ✅ |
| 公网 HTTPS | 前面全是局域网 HTTP，需证明为 NAS 放开的三层改动没弄坏常规 HTTPS 链路 | ✅ |
| 不提供匿名直链 | 正是「传上去了但链接打不开」分支的真实用例 | ✅ 官方明说仅供第三方工具调用，不支持浏览器直接访问 |

**实测结果**：提示 `图片已上传，但公开链接打不开 (HTTP 401)`，且坚果云网页端 `picnexus-test`
文件夹真实存在且为空——上传确实发生过、探针图也被正常清理，不是提示在自说自话。
这正是预期的通过形态：前半句证明协议兼容，后半句是坚果云的产品设计。

顺带验到两件 dufs / OpenList 验不了的事：

1. 同一个服务商账号下，**图床目录与备份目录互不干扰**（该账号同时挂着备份 WebDAV 配置）
2. 常规 HTTPS 策略路径未被局域网豁免改动破坏

> InfiniCLOUD 排到后可作补充回归，不阻塞验收。

## 验收顺带修掉的 3 个缺陷（均已合入 main）

| 提交 | 缺陷 | 一句话 |
|------|------|--------|
| `2923ee1` | 首页不显示 WebDAV 图床 | `UploadView.vue` 只展开了 custom_s3 profile，`webdav_profiles` 一次都没读 |
| `f0ec7df` | 上传队列显示 `WebDAV (msrlkrjz3...)` | `getServiceDisplayName` 的 config 是可选参数，38 个调用点里 31 个没传 |
| `a322dba` | **备份 WebDAV 密码每次保存被静默清空** | 调了两个 Rust 侧从未存在的命令；单测把它们 mock 成存在的，所以测试全绿、生产全挂 |

## 遗留观察

**成功分支的 Rust 文案是死代码**：`test_webdav_storage` 成功时返回
`"连接成功，公开链接可正常访问"`，但 `WebDAVUploader.testConnection` 成功路径只回
`{ success, latency }`，把 message 丢掉了，UI 实际显示的是通用文案「验证成功 / 配置有效」。
失败路径才透传 `result.message`。

要么让成功文案也透传，要么把 Rust 那句删掉——现在这样容易让人按源码文案去对 UI，对不上。

## 已知边界：6/6 通过 ≠ 所有 WebDAV 网盘都能用

这个功能实际是两半，泛化能力天差地别：

| | 干什么 | 靠什么 | 能否泛化 |
|---|---|---|---|
| 上半段 | 把图传上去 | WebDAV 协议（RFC 4918） | ✅ 三个独立实现均通过 |
| 下半段 | 拼出公开链接 | 用户填的 URL 模板 | ❌ 各家自己发明，无标准 |

**下半段注定有相当比例用户配不成**，因此「连接测试能区分两种失败」（验收 ③）
是本功能的核心价值而非锦上添花——它决定这些用户是去改配置，还是认定产品坏了。

缺口与排查方式详见 [webdav-image-host-issues.md](../reference/troubleshooting/webdav-image-host-issues.md)。
其中 **Digest 认证不支持**已作为待办登记在 [TODO.md](../TODO.md)。
