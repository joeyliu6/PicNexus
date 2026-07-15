# Sidecar 二进制

本目录存放由源码生成的 Tauri sidecar 可执行文件，生成物不由 Git 跟踪。

在仓库根目录运行：

```bash
npm run setup:sidecars
```

该命令会安装两个 sidecar 包的依赖、构建当前平台目标，并校验 `src-tauri/tauri.conf.json` 所需的文件名。
