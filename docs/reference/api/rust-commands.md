# Rust 命令参考

> Tauri invoke 命令完整参考

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

---

## 上传命令

### upload_file_stream

微博图床上传。

```typescript
interface Params {
  id: string;           // 上传任务 ID
  filePath: string;     // 文件绝对路径
  weiboCookie: string;  // 微博 Cookie
}

interface Result {
  pid: string;          // 图片 ID
  url: string;          // 图片 URL
  width: number;
  height: number;
}

// 使用
const result = await invoke<Result>('upload_file_stream', {
  id: 'task_123',
  filePath: 'C:/images/test.png',
  weiboCookie: 'SUB=xxx; SUBP=xxx',
});
```

### upload_to_zhihu

知乎图床上传。

```typescript
interface Params {
  id: string;
  filePath: string;
  zhihuCookie: string;
}

interface Result {
  url: string;
  imageId: string;
}
```

### upload_to_s3_compatible

S3 兼容存储上传（R2/COS/OSS/七牛/又拍云）。

```typescript
interface Params {
  id: string;
  filePath: string;
  endpoint: string;      // 如 "https://xxx.r2.cloudflarestorage.com"
  accessKey: string;
  secretKey: string;
  region: string;        // 如 "auto"
  bucket: string;
  key: string;           // 对象键名
  publicDomain: string;  // 可选，公开访问域名
}

interface Result {
  url: string;
  key: string;
  etag: string;
}

// 使用示例 - R2
const result = await invoke<Result>('upload_to_s3_compatible', {
  id: 'task_123',
  filePath: 'C:/images/test.png',
  endpoint: 'https://accountid.r2.cloudflarestorage.com',
  accessKey: 'xxx',
  secretKey: 'xxx',
  region: 'auto',
  bucket: 'my-bucket',
  key: 'images/test.png',
  publicDomain: 'https://cdn.example.com',
});
```

### upload_to_github

GitHub 仓库上传。

```typescript
interface Params {
  id: string;
  filePath: string;
  githubToken: string;
  owner: string;         // 用户名或组织名
  repo: string;          // 仓库名
  branch: string;        // 分支名
  path: string;          // 文件路径
}

interface Result {
  url: string;           // raw.githubusercontent.com URL
  htmlUrl: string;       // GitHub 页面 URL
  sha: string;
}
```

### upload_to_smms

SM.MS 图床上传。

```typescript
interface Params {
  id: string;
  filePath: string;
  smmsToken: string;     // API Token
}

interface Result {
  url: string;
  deleteUrl: string;
  hash: string;
}
```

---

## 连接测试命令

### test_weibo_connection

```typescript
interface Params {
  weiboCookie: string;
}

// 返回用户名或错误信息
type Result = string;

const username = await invoke<string>('test_weibo_connection', {
  weiboCookie: 'SUB=xxx',
});
```

### test_nami_connection

```typescript
interface Params {
  cookie: string;
  authToken: string;
}

type Result = string;
```

---

## 剪贴板命令

### clipboard_has_image

检测剪贴板是否有图片。

```typescript
const hasImage = await invoke<boolean>('clipboard_has_image');
```

### read_clipboard_image

读取剪贴板图片到临时文件。

```typescript
// 返回临时文件路径
const tempPath = await invoke<string>('read_clipboard_image');
// tempPath: "C:/Users/xxx/AppData/Local/Temp/clipboard_image.png"
```

---

## 工具命令

### get_image_metadata

获取图片元数据。

```typescript
interface Params {
  filePath: string;
}

interface Result {
  width: number;
  height: number;
  aspectRatio: number;
  size: number;          // 字节数
  format: string;        // "png", "jpeg", "webp", etc.
}

const meta = await invoke<Result>('get_image_metadata', {
  filePath: 'C:/images/test.png',
});
```

### check_image_link

检测图片链接有效性。

```typescript
interface Params {
  link: string;
}

interface Result {
  valid: boolean;
  statusCode: number;
  contentType: string | null;
  contentLength: number | null;
  errorType: 'none' | 'network' | 'not_found' | 'forbidden' | 'server_error';
  suggestion: string | null;
}

const result = await invoke<Result>('check_image_link', {
  link: 'https://example.com/image.png',
});
```

### download_image_from_url

下载远程图片到临时目录。

```typescript
interface Params {
  url: string;
}

// 返回本地临时文件路径
const localPath = await invoke<string>('download_image_from_url', {
  url: 'https://example.com/image.png',
});
```

---

## S3 管理命令

### list_s3_objects

列出 S3 存储桶中的对象。

```typescript
interface Params {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  prefix?: string;       // 可选，路径前缀
  maxKeys?: number;      // 可选，最大返回数量
}

interface S3Object {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

const objects = await invoke<S3Object[]>('list_s3_objects', {
  endpoint: 'https://xxx.r2.cloudflarestorage.com',
  accessKey: 'xxx',
  secretKey: 'xxx',
  region: 'auto',
  bucket: 'my-bucket',
  prefix: 'images/',
  maxKeys: 100,
});
```

### delete_s3_object

删除单个对象。

```typescript
interface Params {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
  bucket: string;
  key: string;
}

await invoke('delete_s3_object', {
  // ...credentials
  key: 'images/test.png',
});
```

### delete_s3_objects

批量删除对象。

```typescript
interface Params {
  // ...same as above
  keys: string[];        // 要删除的对象键列表
}

interface Result {
  deleted: string[];
  errors: Array<{ key: string; message: string }>;
}

const result = await invoke<Result>('delete_s3_objects', {
  // ...credentials
  keys: ['images/1.png', 'images/2.png'],
});
```

---

## 进度事件

上传命令通过 Tauri 事件报告进度。

### 监听进度

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

try {
  await invoke('upload_file_stream', params);
} catch (error) {
  const appError = error as AppError;
  console.error(`${appError.type}: ${appError.message}`);
}
```

---

## 相关文档

- [后端架构](../architecture/backend.md)
- [上传器接口](./uploaders.md)
- [添加新图床指南](../guides/add-new-uploader.md)

---

## 维护记录

| 日期 | 变更 |
|------|------|
| 2025-01-13 | 初始版本 |
| 2026-03-24 | 新增 `update_server_config`（编辑器兼容 HTTP Server）|
| 2026-03-25 | 新增 `compress_image`、`cleanup_compressed_files`、`strip_exif_only`（图片压缩）|
| 2026-03-25 | 新增 `download_url_image`（URL 图片下载）|

---

## update_server_config

启动/停止/更新编辑器兼容 HTTP Server（PicGo 协议）。

```typescript
interface Params {
  enabled: boolean;                 // 是否启用 Server
  port: number;                     // 监听端口（推荐 36799，避免与 PicGo 36677 冲突）
  serviceConfigJson: string | null; // JSON 序列化的 ServerUploadConfig，null 表示未配置
}

// serviceConfigJson 格式示例
// 京东图床
'{"type":"jd"}'
// GitHub
'{"type":"github","token":"ghp_xxx","owner":"user","repo":"repo","branch":"main","path":"images/"}'
// SM.MS
'{"type":"smms","token":"xxx"}'
// Imgur
'{"type":"imgur","clientId":"xxx"}'

// 返回
type Result = string; // 成功提示，如 "Server 已在端口 36799 启动"

// 错误情况
// - 端口已被占用 → AppError（建议用户换端口）
// - serviceConfigJson 格式错误 → AppError
```

**注意**：此命令会先停止当前运行的 Server（如有），再按新参数启动。调用时机：
- `onMounted` 时如配置已启用
- 用户修改设置时（`@update:editor-server`）

---

## 图片压缩命令

### compress_image

压缩图片，支持 JPEG/PNG/WebP/BMP 输入。支持质量调整、等比缩放、格式转换。GIF 动图不支持，会返回错误。

```typescript
interface Params {
  filePath: string;      // 原图绝对路径
  quality: number;       // 压缩质量 1-100（JPEG/WebP 有效）
  maxLongSide: number;   // 最长边限制（像素），0 表示不限制
  outputFormat: string;  // 输出格式："original" | "webp" | "jpeg"
}

interface Result {
  outputPath: string;     // 压缩后临时文件路径
  originalSize: number;   // 原始文件大小（字节）
  compressedSize: number; // 压缩后大小（字节）
  ratio: number;          // 压缩率（0.0 ~ 1.0，越小越好）
  width: number;          // 压缩后宽度
  height: number;         // 压缩后高度
  format: string;         // 输出格式
}
```

**注意**：输出到系统临时目录。上传完成后应调用 `cleanup_compressed_files` 或依赖 `compress_image` 启动时的自动清理。

---

### cleanup_compressed_files

清理压缩产生的所有临时文件（匹配 `picnexus_compressed_*` 模式）。

```typescript
// 无参数
// 返回 void
await invoke('cleanup_compressed_files');
```

---

### strip_exif_only

仅去除图片 EXIF 数据（不重编码，保持原图质量），支持 JPEG。

```typescript
interface Params {
  filePath: string; // 原图绝对路径
}

// 返回：处理后临时文件路径
type Result = string;
```

---

## URL 下载命令

### download_url_image

从图片 URL 下载到临时文件。支持 Content-Type 校验和魔术字节双重验证，确保下载内容为图片。

```typescript
interface Params {
  url: string; // 图片 URL（需以 http:// 或 https:// 开头）
}

interface Result {
  filePath: string;    // 临时文件绝对路径
  contentType: string; // MIME 类型（如 "image/jpeg"）
  fileSize: number;    // 文件大小（字节）
}

// 错误情况
// - URL 为空或格式不合法 → AppError::validation
// - HTTP 请求失败 → AppError::network
// - Content-Type 非图片 → AppError::validation
// - 下载超时（30 秒）→ AppError::network
```

**注意**：下载的临时文件使用后需手动清理，或由上传完成后的清理流程统一处理。

