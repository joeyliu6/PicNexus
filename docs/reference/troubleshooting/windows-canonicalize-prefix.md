# Windows 上 canonicalize 后比前缀永远不成立

## 现象

开着「上传前压缩」上传后，`%TEMP%\picnexus_compress` 里的压缩 / 去 EXIF 副本一个都没删，越攒越多；日志里每个文件都是「[清理] 拒绝删除非临时目录文件」。macOS / Linux 上正常。

## 根因

`std::fs::canonicalize()`（`Path::canonicalize`）在 Windows 上返回 verbatim 路径 `\\?\C:\Users\…`，而 `std::env::temp_dir()`、Tauri 的 `path().temp_dir()` 给的是普通路径 `C:\Users\…`。拿前者对后者 `starts_with`，组件对不上，永远是 false。`cleanup_compressed_files` 用这个比较做「只许删临时目录里的文件」的安全检查，于是一个都不删，也不报错。

## 修法

两边都 `canonicalize` 再比：`src-tauri/src/commands/image_compress.rs` 的 `is_compress_temp_file`，与 `clipboard.rs` 的 `is_clipboard_temp_path` 同一写法。目录不存在时 canonicalize 失败，按「不是临时文件」处理。

回归护栏：`cleanup_accepts_files_inside_the_compress_dir`（Windows 上旧写法必红）、`cleanup_refuses_files_outside_or_escaping_the_compress_dir`。

## 举一反三

- 凡是「路径在不在某目录下」的判断，两边要么都规范化，要么都不规范化；混着比只在 Windows 上坏，开发机若是 macOS / Linux 就测不出来。
- 要把 canonicalize 的结果交给前端或拼进 URL 时，先去掉 verbatim 前缀（见 `md_scanner.rs` 的 `strip_verbatim_prefix`）。
