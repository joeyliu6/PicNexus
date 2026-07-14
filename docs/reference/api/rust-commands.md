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
| **测试** | `test_weibo_connection` | 测试微博连接 |
| | `test_zhihu_connection` | 测试知乎连接 |
| | `test_nowcoder_connection` | 测试牛客连接 |
| | `test_bilibili_connection` | 测试B站连接 |
| | `test_nami_connection` | 测试纳米连接 |
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
| **CLI PATH** | `get_cli_path_status` | 读取 PicNexus CLI 是否已加入用户 PATH |
| | `add_cli_to_path` | 将 PicNexus CLI 加入用户 PATH |
| | `remove_cli_from_path` | 从用户 PATH 移除 PicNexus CLI |

> CLI PATH 命令：Windows 写入用户级注册表；macOS / Linux 创建 `~/.local/bin/picnexus` 符号链接（AppImage 下符号链接指向 `$APPIMAGE`）。macOS 若检测到 `~/.local/bin` 不在 PATH，返回的 `message` 会引导用户把 export 行加入 `~/.zshrc`。

---

## 编辑器 Server 访问控制

`update_server_config` 接收内部使用的可选 `authToken`。桌面端启用编辑器 Server 时会自动生成该值，并随加密配置保存；它不是 Obsidian 插件的用户配置项。

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
