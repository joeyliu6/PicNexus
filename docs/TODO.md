# 开发待办

> 本文件是仓库内未完成开发需求的详细记录来源。其他文档只链接到对应条目，不重复维护需求内容。

## 待验收

### [~] WebDAV 图床支持

- **来源**：[GitHub Issue #1：支持 WebDAV 图床](https://github.com/joeyliu6/PicNexus/issues/1)
- **状态**：已实现，待真实 WebDAV 服务端到端验收

#### 目标

把图片上传到用户自己的 WebDAV 网盘或 NAS，通过二进制 PUT 写入，并按配置的公开 URL 模板返回可引用的图片链接。

#### 关键约束

- 图片上传目录与配置、历史记录的 WebDAV 备份目录相互隔离。
- 公开链接由用户配置的 URL 模板生成，不假设 WebDAV 地址可以匿名访问。
- 不承诺所有 WebDAV 网盘都支持图片直链；分享页或临时下载地址不能作为稳定直链。
- 保持现有 WebDAV 备份配置和旧版本配置兼容。

#### 与原调研方案的偏离

原方案计划**复用现有 WebDAV profile**（`config.webdav`）作为图床配置，实现时改为**独立配置**（`config.webdav_profiles`）：

- 图床需要 `publicDomain` / `publicUrlTemplate`，备份用不上，混在一起会让备份配置长出无用字段
- 用户的备份服务（如坚果云）与图床服务（如 OpenList）往往不是同一个，强行共用一份凭证反而别扭
- 代价是同一台服务器要填两次账号密码；换来两套配置互不干扰，备份功能零改动

#### 调研时漏掉、实现时补上的一项

网络策略会把局域网地址拦死，而群晖 / 自建 NAS（`http://192.168.1.10:5005`）正是 WebDAV 图床最主要的用户群。已为 WebDAV 单独放开，共三层：

1. `assertAllowedWebDAVUrl`（前端请求校验）
2. `validate_webdav_url`（Rust 请求校验）
3. `safeImageUrl`（应用内图片显示）—— 漏掉这层会导致上传成功但历史记录缩略图全裂

放开仅作用于 WebDAV 链路，其他图床仍是 HTTPS-only；链路本地段（含云元数据 `169.254.169.254`）与公网明文 HTTP 依旧拒绝。

#### 建议测试环境

- [OpenList](https://doc.oplist.org/guide/advanced/webdav)：本地端到端测试，覆盖 WebDAV 上传和固定公开直链。
- [InfiniCLOUD](https://infini-cloud.net/en/developer_webdav.html)：公网 WebDAV 协议兼容测试，不依赖其分享地址作为图片直链。

#### 验收清单

已由单元测试覆盖：

- [x] 多个 WebDAV profile 可以独立启用、选择和上传。
- [x] 图片目录与 `settings.json`、`history.json` 的备份目录隔离（两套独立配置）。
- [x] 中文、空格及需要 URL 编码的文件名可以正确上传和访问（编码逻辑单测）。
- [x] 认证失败、无写入权限、路径错误和存储空间不足时返回明确错误。
- [x] WebDAV 图床可以参与多图床上传、重试和主链接选择流程。
- [x] 配置文件中密码为密文，明文不进 formData 也不落盘。

需真实服务器验证（尚未执行）：

- [ ] 自动创建远程目录并以二进制 PUT 上传图片。
- [ ] 上传成功后按配置模板生成公开 URL，并写入上传历史。
- [ ] 连接测试能区分「传不上去」和「传上去了但链接打不开」。
- [ ] 内网 HTTP（NAS）场景下历史记录缩略图正常显示。
- [ ] 现有 WebDAV 备份功能及旧配置无需手动迁移即可继续使用。
- [ ] OpenList 本地端到端测试和 InfiniCLOUD 公网兼容测试通过。
