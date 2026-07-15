# Windows 便携版

PicNexus 提供 Windows 便携版 ZIP，用于需要应用和重要用户数据一起迁移的场景。

解压后从 `PicNexus` 文件夹运行 `PicNexus.exe`。便携模式标记文件是
`data/portable.json`。

预期目录结构：

```text
PicNexus/
  PicNexus.exe
  README-portable.txt
  bin/
    qiyu-token-fetcher.exe
    nami-token-fetcher.exe
  icons/
    icon.png
  data/
    portable.json
    settings.dat
    history.db
    cli-config.json
    secure-key
    logs/
```

便携模式会把设置、上传历史、日志、CLI 配置和本地加密密钥放在 `data/` 下。
图片 / 浏览器缓存仍刻意保留在 Windows 常规缓存位置，避免大体积预览缓存撑大
便携目录，也减少移动盘写入压力。

`qiyu-token-fetcher.exe` 和 `nami-token-fetcher.exe` 是七鱼/纳米上传使用的本机辅助程序，
由 PicNexus 的 Rust 后端按需启动，用于获取当次上传所需的动态 token/headers。
它们不持久化账号凭据，相关日志会按脱敏规则记录。

Windows release 构建完成后，可在本地生成 ZIP：

```powershell
npm run setup:sidecars
npm run tauri build
npm run package:portable:win
```

输出位置：

```text
src-tauri/target/release/portable/PicNexus_<version>_windows_x64_portable.zip
```
