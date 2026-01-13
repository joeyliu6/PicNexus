# 图床缩略图 API 文档

本文档记录各图床的缩略图 URL 格式，便于参考和维护。

## 缩略图尺寸分类

| 类型 | 用途 | 尺寸范围 |
|------|------|----------|
| 小缩略图 | 表格视图图片列、上传队列 | ~50-76px |
| 中等缩略图 | 悬浮预览、时间线视图 | ~400-800px |
| 原图 | Lightbox 查看原图 | 完整尺寸 |

---

## 知乎图床

**原图：**
```
https://picx.zhimg.com/v2-{hash}.webp
```

**小缩略图（_xs）：**
```
https://picx.zhimg.com/v2-{hash}_xs.webp
```

**中等缩略图（_qhd）：**
```
https://picx.zhimg.com/v2-{hash}_qhd.webp
```

---

## 七鱼图床

基于网易 NOS 对象存储，使用 `imageView` 图片处理参数。

**原图：**
```
https://xlx03.cdn.qiyukf.net/{path}?createTime={timestamp}
```

**小缩略图（50px）：**
```
https://xlx03.cdn.qiyukf.net/{path}?imageView&thumbnail=50x0
```

**中等缩略图（400px）：**
```
https://xlx03.cdn.qiyukf.net/{path}?imageView&thumbnail=400x0
```

---

## 京东图床

使用 URL 路径前缀方式生成缩略图。

**原图：**
```
https://img30.360buyimg.com/imgzone/jfs/t{date}/{id}/{size}/{hash}.jpg
```

**小缩略图（76x76）：**
```
https://img30.360buyimg.com/imgzone/s76x76_jfs/t{date}/{id}/{size}/{hash}.jpg
```

**中等缩略图（500px 宽）：**
```
https://img30.360buyimg.com/imgzone/s500x0_jfs/t{date}/{id}/{size}/{hash}.jpg
```

---

## 纳米图床

基于火山引擎 TOS 对象存储，使用 `x-tos-process` 图片处理参数。

**原图：**
```
https://bfns.zhaomi.cn/web/{hash}.jpg
```

**小缩略图（75px）：**
```
https://bfns.zhaomi.cn/web/{hash}.jpg?x-tos-process=image/resize,l_75/quality,q_70/format,jpg
```

**中等缩略图（500px）：**
```
https://bfns.zhaomi.cn/web/{hash}.jpg?x-tos-process=image/resize,l_500/quality,q_80/format,jpg
```

---

## 牛客图床

基于阿里云 OSS，使用 `x-oss-process` 图片处理参数。

**原图：**
```
https://uploadfiles.nowcoder.com/images/{date}/{id}/{hash}
```

**小缩略图（75x75）：**
```
https://uploadfiles.nowcoder.com/images/{date}/{id}/{hash}?x-oss-process=image%2Fresize%2Cw_75%2Ch_75%2Cm_mfit%2Fformat%2Cpng
```

**中等缩略图（400px 宽）：**
```
https://uploadfiles.nowcoder.com/images/{date}/{id}/{hash}?x-oss-process=image%2Fresize%2Cw_400%2Cm_mfit%2Fformat%2Cpng
```

---

## 微博图床

使用 URL 路径中的尺寸标识符控制图片大小。

**原图（large）：**
```
https://tvax1.sinaimg.cn/large/{pid}.jpg
```

**小缩略图（thumb150，150x150）：**
```
https://tvax1.sinaimg.cn/thumb150/{pid}.jpg
```

**中等缩略图（mw690，690px 宽）：**
```
https://tvax1.sinaimg.cn/mw690/{pid}.jpg
```

**其他可用尺寸：**
- `thumbnail` - 最小缩略图
- `thumb150` - 150x150
- `bmiddle` - 约 440px
- `mw690` - 690px 宽
- `large` - 原图

---

## R2 图床（Cloudflare R2）

R2 本身不提供图片处理，使用 [wsrv.nl](https://wsrv.nl/) 代理服务生成缩略图。

**原图：**
```
https://img.example.com/{path}/{filename}.jpg
```

**小缩略图（75x75）：**
```
https://wsrv.nl/?url={encodedUrl}&w=75&h=75&fit=cover&a=center&q=75&output=webp
```

**中等缩略图（800px 宽）：**
```
https://wsrv.nl/?url={encodedUrl}&w=800&q=80&output=webp
```

**wsrv.nl 常用参数：**
- `w` - 宽度
- `h` - 高度
- `fit` - 裁剪模式（cover, contain, fill）
- `a` - 锚点（center, top, bottom, left, right）
- `q` - 质量（1-100）
- `output` - 输出格式（webp, jpg, png）

---

## 代码实现

缩略图 URL 生成逻辑位于 `src/composables/useThumbCache.ts`：

- `generateThumbnailUrl()` - 生成小缩略图 URL
- `generateMediumThumbnailUrl()` - 生成中等缩略图 URL
