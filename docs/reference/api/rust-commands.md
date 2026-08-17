# Rust 命令参考

> 完整参数/返回值定义请直接阅读 `src-tauri/src/commands/` 源文件，以下为导航索引。

---

## 命令索引

| 分类 | 命令 | 说明 |
|------|------|------|
| **上传** | `upload_file_stream` | 微博上传 |
| | `upload_to_zhihu` | 知乎上传 |
| | `upload_to_nowcoder` | 牛客上传 |
| | `upload_to_bilibili` | B站上传 |
| | `upload_to_nami` | 纳米上传 |
| | `upload_to_qiyu` | 七鱼上传 |
| | `upload_to_smms` | SM.MS 上传 |
| | `upload_to_github` | GitHub 上传 |
| | `upload_to_s3_compatible` | S3 兼容存储上传 |
| | `upload_to_webdav` | WebDAV 图床上传（流式 PUT + 递归建目录）<br/>流式 body 必须显式带 `Content-Length`，否则退回 chunked，部分服务端不接受<br/>`lanHttpConfirmed: bool` 必传（不是可选）——用户已确认明文 HTTP 风险，只放开 fake-ip 一档 |
| **测试** | `test_weibo_connection` | 测试微博连接 |
| | `test_zhihu_connection` | 测试知乎连接 |
| | `test_nowcoder_connection` | 测试牛客连接 |
| | `test_bilibili_connection` | 测试B站连接 |
| | `test_nami_connection` | 测试纳米连接 |
| | `test_webdav_storage` | 测试 WebDAV 图床（传探针图 + 匿名访问公开链接，区分「传不上去」与「链接打不开」）<br/>同样必传 `lanHttpConfirmed: bool`；撞上 fake-ip 时回 `WEBDAV_LAN_HTTP_UNCONFIRMED` 错误类型供前端弹逃生舱 |
| **剪贴板** | `clipboard_has_image` | 检测剪贴板图片 |
| | `read_clipboard_image` | 读取剪贴板图片 |
| | `cleanup_clipboard_temp_file` | 安全清理本次剪贴板图片临时文件（仅允许系统临时目录下 `clipboard_image_*.png`） |
| **工具** | `get_image_metadata` | 获取图片元数据 |
| | `check_image_link` | 检测链接有效性 |
| | `download_image_from_url` | 下载远程图片 |
| | `download_url_image` | 从 URL 下载图片到临时文件 |
| | `read_file_bytes` | 读取文件字节 |
| **图片压缩** | `compress_image` | 压缩图片（质量/尺寸/格式转换） |
| | `cleanup_compressed_files` | 清理压缩临时文件 |
| | `strip_exif_only` | 仅去除 EXIF（不重编码） |
| **S3 管理** | `list_s3_objects` | 列出对象 |
| | `delete_s3_object` | 删除单个对象 |
| | `delete_s3_objects` | 批量删除对象 |
| **Token** | `fetch_nami_token` | 获取纳米 Token |
| | `fetch_qiyu_token` | 获取七鱼 Token |
| | `check_chrome_installed` | 检查 Chrome |
| **编辑器 Server** | `update_server_config` | 启动/停止/更新 HTTP Server |
| | `check_editor_server_status` | 从 Rust 侧探测 `http://127.0.0.1:<port>/status`，返回原始 JSON 文本<br/>`/status` 故意不带 CORS 许可（防任意网页探测本机是否在跑 PicNexus），设置页 webview 与该端口不同源，前端 `fetch` 必被浏览器拦截；Rust 发起的请求不受 CORS 约束 |
| | `check_port_free` | 检测端口是否可用 |
| | `save_cli_config` | 写入 `{app_data_dir}/cli-config.json`（Typora profile + CLI services 表），供无 GUI 的 CLI / Typora 子进程读取<br/>内容用系统钥匙串主密钥做 AES-256-GCM 加密（`PNXCLI1:` 前缀），钥匙串不可用时降级明文并告警<br/>返回 `{ encrypted: bool }`，`false` 表示本次是明文降级，前端须提示用户 |
| | `get_executable_path` | 返回当前可执行文件绝对路径（Typora 自定义命令配置提示用） |
| **密钥管理** | `get_or_create_secure_key` | 读取（或首次生成）配置加密主密钥，Base64 的 32 字节 AES-256 密钥<br/>非便携版存系统钥匙串，便携版存 exe 旁的 `secure-key` 文件 |
| | `set_secure_key` | 覆盖主密钥（备份密码模式下前端用口令派生密钥轮转）<br/>轮转前会先用旧密钥解出 `cli-config.json` 并在换钥后重新加密，否则 CLI/Typora/Obsidian 三条链路会集体解不开配置 |
| **CLI PATH** | `get_cli_path_status` | 读取 PicNexus CLI 是否已加入用户 PATH |
| | `add_cli_to_path` | 将 PicNexus CLI 加入用户 PATH |
| | `remove_cli_from_path` | 从用户 PATH 移除 PicNexus CLI |
| **Analytics** | `analytics_send_batch` | 经隔离 WebView 上报 `first_run` / `app_start` |
| | `analytics_shutdown` | 销毁隔离 WebView 与本地回环服务 |
| | `analytics_start_heartbeat` | 启动在线心跳（Rust 定时器 + Measurement Protocol，25 分钟一次）；返回 `started` 或 `disabled` |
| | `analytics_stop_heartbeat` | 停止在线心跳，幂等 |

> Analytics 心跳：密钥经编译期环境变量 `PICNEXUS_GA_API_SECRET` 注入，未注入时 `analytics_start_heartbeat` 返回 `disabled`。设计取舍见 [composables.md](./composables.md#在线心跳)。

> CLI PATH 命令：Windows 写入用户级注册表；macOS / Linux 创建 `~/.local/bin/picnexus` 符号链接（AppImage 下符号链接指向 `$APPIMAGE`）。macOS 若检测到 `~/.local/bin` 不在 PATH，返回的 `message` 会引导用户把 export 行加入 `~/.zshrc`。

---

## 编辑器 Server 访问控制

`update_server_config` 接收内部使用的可选 `authToken`。桌面端启用编辑器 Server 时会自动生成该值，并随加密配置保存；它不是 Obsidian 插件的用户配置项。

## cli-config.json 的凭证保护

`cli-config.json` 装的是**解密后的**凭证明文（各家 OSS secret key、cookie、WebDAV 的 NAS 密码），因为 CLI / Typora 子进程没有 GUI 上下文，解不开 `.settings.dat`。

保护方式是**信封加密**：系统钥匙串只存 32 字节主密钥（Windows 凭据管理器单条 blob 上限 2560 字节，塞不下整份配置），文件本身用它做 AES-256-GCM 加密。CLI 进程与 GUI 跑在同一用户账号下，钥匙串按账号授权，所以 CLI 直接取得到同一把密钥——不存在「密钥分发」问题。实现与完整边界说明见 `src-tauri/src/secure_key.rs` 头部注释。

**能挡住**：文件被拷走 / 同步到云盘 / 混进备份包 / 随日志外传；同机器上的其他用户账号（Unix 0600 + Windows 默认 ACL）。
**挡不住**：以当前用户身份运行的恶意程序——它同样能问钥匙串要到密钥。这是所有本机凭证存储的共同上限（VS Code 同款问题微软明确表示不修），不是本实现的缺陷。
**便携版例外**：主密钥明文放在 exe 旁的 `secure-key` 文件里，这层加密基本等于没有——这是便携版「拔下 U 盘带走全部数据」前提的既有取舍，与 `.settings.dat` 一致。

带浏览器 `Origin` 的 `POST /upload` 和 `POST /upload/file` 请求必须通过 `X-PicNexus-Token`、`Authorization: Bearer <token>` 或查询参数（`?token=...` / `?authToken=...`）携带匹配值。这样可以阻止普通网页在用户不知情时调用本机上传接口。

不带浏览器 `Origin` 的本机原生客户端请求继续兼容，其中包括 Obsidian 的 `requestUrl`。`GET /status` 不要求认证，仅用于连接检测，但该路由不返回 CORS 许可头，网页脚本不能跨域读取其响应。该边界用于防范浏览器跨源调用，不用于隔离当前系统用户权限下的其他本机进程。

---

## 进度事件

上传命令通过 Tauri 事件报告进度，事件名格式 `upload-progress-{taskId}`。

```typescript
import { listen } from '@tauri-apps/api/event';

interface ProgressPayload {
  progress: number;      // 0-100
  status: 'preparing' | 'uploading' | 'processing' | 'complete';
  bytesUploaded?: number;
  totalBytes?: number;
}

const unlisten = await listen<ProgressPayload>(
  `upload-progress-${taskId}`,
  (event) => {
    console.log('Progress:', event.payload.progress);
  }
);

// 清理
unlisten();
```

---

## 错误处理

所有命令在失败时抛出 `AppError`：

```typescript
interface AppError {
  type: 'Network' | 'Auth' | 'File' | 'InvalidInput' | 'Service' | 'Unknown';
  message: string;
}
```

---

## 相关文档

- [后端架构](../architecture/backend.md)
- [上传器接口](./uploaders.md)
- [添加新图床指南](../guides/add-new-uploader.md)
