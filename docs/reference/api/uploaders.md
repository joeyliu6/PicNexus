# 上传器接口

> 完整接口定义请直接阅读源文件，以下为导航索引。

---

## 核心文件

| 文件 | 职责 |
|------|------|
| `src/uploaders/base/IUploader.ts` | 上传器接口定义（serviceId / validateConfig / upload / getPublicUrl） |
| `src/uploaders/base/BaseUploader.ts` | 抽象基类（通用上传逻辑、进度监听、Rust 命令调用） |
| `src/uploaders/base/UploaderFactory.ts` | 工厂类（注册/获取上传器实例） |
| `src/uploaders/index.ts` | 集中注册所有上传器 |

---

## 已实现的上传器

| 服务 | 类名 | 文件 | 认证方式 |
|------|------|------|---------|
| 微博 | `WeiboUploader` | `weibo/WeiboUploader.ts` | Cookie |
| 知乎 | `ZhihuUploader` | `zhihu/ZhihuUploader.ts` | Cookie |
| 牛客 | `NowcoderUploader` | `nowcoder/NowcoderUploader.ts` | Cookie |
| B站 | `BilibiliUploader` | `bilibili/BilibiliUploader.ts` | Cookie |
| 纳米 | `NamiUploader` | `nami/NamiUploader.ts` | Cookie + Token |
| 七鱼 | `QiyuUploader` | `qiyu/QiyuUploader.ts` | 无需认证 |
| 京东 | `JDUploader` | `jd/JDUploader.ts` | 无需认证 |
| TCL | `TCLUploader` | `tcl/TCLUploader.ts` | 无需认证 |
| SM.MS | `SmmsUploader` | `smms/SmmsUploader.ts` | API Token |
| GitHub | `GithubUploader` | `github/GithubUploader.ts` | Personal Token |
| R2 | `R2Uploader` | `r2/R2Uploader.ts` | API Key |
| COS | `COSUploader` | `cos/COSUploader.ts` | SecretId/Key |
| OSS | `OSSUploader` | `oss/OSSUploader.ts` | AccessKey |
| 七牛 | `QiniuUploader` | `qiniu/QiniuUploader.ts` | AK/SK |
| 又拍云 | `UpyunUploader` | `upyun/UpyunUploader.ts` | 操作员/密码 |

> 新增上传器的完整步骤见 [添加新图床指南](../guides/add-new-uploader.md)。

---

## 相关文档

- [添加新图床指南](../guides/add-new-uploader.md)
- [后端架构](../architecture/backend.md)
- [Rust 命令参考](./rust-commands.md)
