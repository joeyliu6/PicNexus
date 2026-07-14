# 开发待办

> 本文件是仓库内未完成开发需求的详细记录来源。其他文档只链接到对应条目，不重复维护需求内容。

## 待排期

### [ ] WebDAV 图床支持

- **来源**：[GitHub Issue #1：支持 WebDAV 图床](https://github.com/joeyliu6/PicNexus/issues/1)
- **状态**：可行性调研完成，待排期开发

#### 目标

将现有 WebDAV profile 作为可选图床，通过二进制 PUT 上传图片，并按配置的公开 URL 模板返回可引用的图片链接。

#### 关键约束

- 图片上传目录与配置、历史记录的 WebDAV 备份目录相互隔离。
- 公开链接由用户配置的 URL 模板生成，不假设 WebDAV 地址可以匿名访问。
- 不承诺所有 WebDAV 网盘都支持图片直链；分享页或临时下载地址不能作为稳定直链。
- 保持现有 WebDAV 备份配置和旧版本配置兼容。

#### 建议测试环境

- [OpenList](https://doc.oplist.org/guide/advanced/webdav)：本地端到端测试，覆盖 WebDAV 上传和固定公开直链。
- [InfiniCLOUD](https://infini-cloud.net/en/developer_webdav.html)：公网 WebDAV 协议兼容测试，不依赖其分享地址作为图片直链。

#### 验收清单

- [ ] 多个 WebDAV profile 可以独立启用、选择和上传。
- [ ] 图片目录与 `settings.json`、`history.json` 的备份目录隔离。
- [ ] 支持自动创建远程目录并以二进制 PUT 上传图片。
- [ ] 中文、空格及需要 URL 编码的文件名可以正确上传和访问。
- [ ] 上传成功后按配置模板生成公开 URL，并写入上传历史。
- [ ] 认证失败、无写入权限、路径错误和存储空间不足时返回明确错误。
- [ ] WebDAV 图床可以参与多图床上传、重试和主链接选择流程。
- [ ] 现有 WebDAV 备份功能及旧配置无需手动迁移即可继续使用。
- [ ] OpenList 本地端到端测试和 InfiniCLOUD 公网兼容测试通过。
