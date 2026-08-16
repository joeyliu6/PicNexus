# 上传器接口

> 完整接口定义请直接阅读源文件，以下为导航索引。

---

## 核心文件

| 文件 | 职责 |
|------|------|
| `src/uploaders/base/IUploader.ts` | 上传器接口定义（serviceId / validateConfig / upload / getPublicUrl） |
| `src/uploaders/base/BaseUploader.ts` | 抽象基类（通用上传逻辑、进度监听、Rust 命令调用） |
| `src/uploaders/base/UploaderFactory.ts` | 工厂类（注册/获取上传器实例） |
| `src/uploaders/s3/BaseS3Uploader.ts` | S3 兼容存储基类（R2 / 腾讯 / 阿里 / 七牛 / 又拍 / 自定义 S3 共用） |
| `src/uploaders/index.ts` | 集中注册所有上传器 |

---

## 已实现的上传器

### 单实例（serviceId 固定）

| 服务 | 类名 | 文件 | 认证方式 |
|------|------|------|---------|
| 微博 | `WeiboUploader` | `weibo/WeiboUploader.ts` | Cookie |
| 知乎 | `ZhihuUploader` | `zhihu/ZhihuUploader.ts` | Cookie |
| 牛客 | `NowcoderUploader` | `nowcoder/NowcoderUploader.ts` | Cookie |
| B站 | `BilibiliUploader` | `bilibili/BilibiliUploader.ts` | Cookie |
| 超星 | `ChaoxingUploader` | `chaoxing/ChaoxingUploader.ts` | Cookie |
| 纳米 | `NamiUploader` | `nami/NamiUploader.ts` | Cookie + Token |
| 七鱼 | `QiyuUploader` | `qiyu/QiyuUploader.ts` | 无需认证 |
| 京东 | `JDUploader` | `jd/JDUploader.ts` | 无需认证 |
| SM.MS | `SmmsUploader` | `smms/SmmsUploader.ts` | API Token |
| Imgur | `ImgurUploader` | `imgur/ImgurUploader.ts` | Client ID |
| GitHub | `GithubUploader` | `github/GithubUploader.ts` | Personal Token |
| Cloudflare R2 | `R2Uploader` | `r2/R2Uploader.ts` | API Key |
| 腾讯云 COS | `TencentUploader` | `tencent/TencentUploader.ts` | SecretId/Key |
| 阿里云 OSS | `AliyunUploader` | `aliyun/AliyunUploader.ts` | AccessKey |
| 七牛云 | `QiniuUploader` | `qiniu/QiniuUploader.ts` | AK/SK |
| 又拍云 | `UpyunUploader` | `upyun/UpyunUploader.ts` | 操作员/密码 |

### 多实例（serviceId 由用户 profile 动态生成）

| 服务 | 类名 | 文件 | 复合 ID | 认证方式 |
|------|------|------|---------|---------|
| 自定义 S3 | `CustomS3Uploader` | `custom-s3/CustomS3Uploader.ts` | `custom_s3:<profileId>` | AccessKey |
| WebDAV | `WebDAVUploader` | `webdav/WebDAVUploader.ts` | `webdav:<profileId>` | Basic Auth（密码加密存储） |

多实例上传器不在 `initializeUploaders()` 里静态注册，而是由 `syncCustomS3Uploaders()` / `syncWebDAVUploaders()` 按当前 profile 列表重建。调用点：应用启动流程（`main.ts`）与设置页保存/加载（`profileServiceSync.ts`）。

> 新增上传器的完整步骤见 [添加新图床指南](../guides/add-new-uploader.md)。

---

## WebDAV 图床要点

WebDAV 是网盘协议而非图床协议，上传成功不等于拿到可用的图片链接 —— 端点本身通常需要认证，直接当图片链接用会被要求登录。因此：

- `publicDomain` 与 `publicUrlTemplate` 是**必填项**，链接由模板渲染而来，程序不假设 WebDAV 地址可匿名访问
- 模板变量：`{domain}` `{path}` `{filename}`；默认 `{domain}/{path}`，OpenList / Alist 一般为 `{domain}/d/挂载点/{path}`
- percent-encode **只在 Rust 侧做一次**（`webdav_upload.rs`），编码后的路径返回给前端填模板，两边各编码一次会让 `%20` 变成 `%2520`
- 连接测试（`test_webdav_storage`）会上传探针图并**匿名** GET 公开链接，用于区分「传不上去」和「传上去了但链接打不开」
- 网络策略为 WebDAV 单独放开局域网地址（群晖 / 自建 NAS），详见 `src/security/networkPolicy.ts` 与 `src-tauri/src/url_policy.rs`
- 只支持 **Basic** 认证。401 时会读 `WWW-Authenticate`，服务端只给 Digest 时换用专属文案，避免把用户引去反复核对没错的密码
- `lanHttpConfirmed` 是明文 HTTP 逃生舱的开关：TUN + fake-ip 环境下判不出目标是否在局域网时，用户可显式确认。
  **只放开 fake-ip 一档**，确证公网 / 链路本地在确认后仍硬拒绝；改地址自动作废（`LanHttpConsent` 的 doc 是这条的真相源）

---

## 相关文档

- [添加新图床指南](../guides/add-new-uploader.md)
- [后端架构](../architecture/backend.md)
- [Rust 命令参考](./rust-commands.md)
