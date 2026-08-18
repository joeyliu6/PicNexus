# S3 系图床旧对象：链接在浏览器里变成下载框

## 症状

点开 R2 / COS / OSS / 七牛 / 又拍云 / 自定义 S3 的图片链接，浏览器不显图，直接弹下载框。
链接检测里这些链接落在「疑似」而不是「正常」。

`curl -I <链接>` 会看到：

```
Content-Type: application/octet-stream      # 或 binary/octet-stream
```

## 根因

对象的 Content-Type 是**上传那一刻**由 `PutObject` 写进桶里的元数据。
上传时不带这个头，S3 就按「一坨不知道是什么的二进制」存下来，之后每次 GET 都照原样返回。
浏览器看到这个类型只能弹下载框——它没有别的选择。

PicNexus 曾在两条链路上漏传这个头：

| 链路 | 入口 | 修复版本 |
|---|---|---|
| 桌面 GUI | `upload_to_s3_compatible` | 2026-08-13（`e1f4982`） |
| 编辑器 / CLI / 本地 HTTP server | `s3_put_object` | 2026-08-18（issue #4 同批） |

现在两条链路都按文件扩展名用 `mime_guess` 推断，详见
[upload-flow.md 的 Content-Type 一节](../../flows/upload-flow.md#content-type)。

## ⚠️ 升级不会自愈

**元数据已经写在桶里了，换新版客户端不会回头去改。**

判断某条记录是新是旧，只看它是什么时候传的：修复版本之后传的图才带正确类型。
测试时务必用**新传**的图，拿旧图验证会得到「明明升级了还是坏的」的错误结论。

旧对象有两条补救路径，选一条：

## 方案 A：原地改元数据（推荐，链接不变）

S3 允许对象**复制到自己身上**并替换元数据。对象键不变 → 已经写进 Markdown 的旧链接全部继续有效，
不用改一个字。

### aws-cli

单个对象：

```bash
aws s3 cp s3://<桶名>/<对象键> s3://<桶名>/<对象键> \
  --metadata-directive REPLACE \
  --content-type image/png \
  --endpoint-url <你的 S3 端点>
```

按前缀批量（`--exclude`/`--include` 让每种扩展名各跑一遍，因为一次只能指定一个 content-type）：

```bash
for ext in png jpg jpeg webp gif; do
  case $ext in
    jpg|jpeg) ct=image/jpeg ;;
    *)        ct=image/$ext ;;
  esac
  aws s3 cp s3://<桶名>/<前缀>/ s3://<桶名>/<前缀>/ \
    --recursive --exclude "*" --include "*.$ext" \
    --metadata-directive REPLACE --content-type "$ct" \
    --endpoint-url <你的 S3 端点>
done
```

Cloudflare R2 的端点形如 `https://<account_id>.r2.cloudflarestorage.com`，
凭据用 R2 的 Access Key ID / Secret Access Key（与 PicNexus 设置里填的是同一对）。

### rclone

rclone 认得扩展名，不用按类型分批：

```bash
rclone copyto <remote>:<桶名>/<前缀> <remote>:<桶名>/<前缀> \
  --s3-no-check-bucket --metadata --dry-run
```

先带 `--dry-run` 看清要动哪些对象，确认无误再去掉它。

### 跑之前

- **先在一个对象上试**，`curl -I` 确认类型变了、图还能打开，再放开跑批量。
- 复制到自身会更新对象的 `LastModified`；如果你有按修改时间做的生命周期规则，先确认不会误删。
- 桶的版本控制开着的话，每个对象会多出一个版本，注意存储计费。

## 方案 B：重新上传

在 PicNexus 里把图重传一遍。**代价是对象键会变**（键带唯一化前缀，见
[upload-flow.md 的对象名唯一化](../../flows/upload-flow.md)），
所有已经写进 Markdown 的旧链接都要跟着换。

文档里的链接可以用「批量迁移」或「文档修复」功能替换，见
[batch-migrate-flow.md](../../flows/batch-migrate-flow.md) 与
[md-rescue-flow.md](../../flows/md-rescue-flow.md)。

方案 A 能用就别选这条。

## 关联

- 链接检测为什么把它标成「疑似」：[link-check-flow.md](../../flows/link-check-flow.md)，
  判据在 `link_checker.rs::is_suspicious_image_response`——2xx 且 Content-Type 不以 `image/` 开头即为疑似。
- 未知扩展名（或没有扩展名）的文件上传后仍是 `application/octet-stream`，那是 `mime_guess` 认不出来，属设计内的回退，不是缺陷。
