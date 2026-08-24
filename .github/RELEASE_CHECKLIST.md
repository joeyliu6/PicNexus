# PicNexus 发版前手动回归清单

## 自动化测试
- [ ] PR / main CI 基线已通过：lint、build、unit、coverage
- [ ] 手动触发 `CI` workflow，勾选 `run_visual=true`，确认 visual regression 通过并保留 `playwright-visual-report`
- [ ] 手动触发 `CI` workflow，勾选 `run_e2e=true`，确认 mocked Playwright E2E 通过并保留 `playwright-e2e-report`
- [ ] 如平台支持，手动触发 `CI` workflow 勾选 `run_tauri_e2e=true`，或本地运行 `npm run test:tauri:e2e` 真实桌面冒烟
- [ ] tag 触发的 `Release` workflow 中 web smoke E2E、Windows Tauri E2E、安装包 / AppImage 冒烟、Windows 便携版 ZIP 冒烟通过
- [ ] `Obsidian plugin` CI 已通过 typecheck、build、发布清单校验，且生成的 `main.js` 已提交

## 上传流程
- [ ] 拖入一张图 → 历史页出现
- [ ] 剪贴板上传 → 成功
- [ ] 批量上传 5+ 张 → 进度条动画正常
- [ ] 失败重试 → 状态恢复

## 历史页
- [ ] 翻页 / 跳页
- [ ] 搜索（中文 + 英文 + 空结果）
- [ ] 图床筛选
- [ ] 单条删除
- [ ] 批量删除
- [ ] 收藏切换
- [ ] 视图切换（表格 / 时间轴 / 瀑布流 / 收藏）

## 设置页
- [ ] 每个 tab 都能正常打开
- [ ] 至少 3 家图床切换 + 测试连接
- [ ] 主题切换
- [ ] 快捷键设置

## 同步
- [ ] WebDAV 手动上传一次
- [ ] WebDAV 手动下载一次
- [ ] 同步日志记录正确

## 其他
- [ ] Markdown 修复工具走一次
- [ ] 批量迁移工具走一次
- [ ] 启动 → 主窗口可见 → 关闭正常

## 安装与更新
- [ ] Release body 已重写为面向用户的中文条目（一行一条、动词开头、相关修复合并成一句、按感知度排序），不是 git-cliff 的原始提交清单
- [ ] 重写前用 `git log --oneline <上一个 tag>..<本 tag>` 通读全部提交——**盘点起点必须是上一个 tag 而不是 `origin/main`**，v1.1.1 就因此漏了 5 条用户可感知的修复
- [ ] 应用内检查更新失败时，「手动下载」能打开最新 Release 页面
- [ ] Windows：更新下载完成后显示「正在安装更新」，应用自动关闭并在安装完成后自行重启
      （plugin 拉起安装器后紧接 `exit(0)`，**「重启完成更新」按钮在此平台不会出现**，见 `docs/flows/auto-update-flow.md` 图 2）
- [ ] macOS / Linux：更新下载完成后停留在「重启完成更新」，不会自动重启应用
- [ ] Windows 更新实际下载的是 `x64-setup.exe` 而非 `.msi`（发版后可查 `latest.json` 的 `windows-x86_64`）
- [ ] 如已接入 Windows Authenticode 证书，确认安装包签名与时间戳有效；未接入时在发布说明中接受 SmartScreen 风险
- [ ] 如启用备用镜像，确认镜像资产、`latest.json` 与 minisign 签名和 GitHub Release 完全一致；未启用时保持 GitHub 官方下载入口

## Obsidian 插件
- [ ] `manifest.json`、`package.json`、`package-lock.json`、`versions.json` 的插件版本一致
- [ ] `Release Obsidian plugin` 成功，独立仓库 Release 标签与插件版本完全一致且不带 `v`
- [ ] 独立插件 Release 直接包含 `main.js`、`manifest.json`、`styles.css`
- [ ] 桌面端 Release 包含 `picnexus-obsidian-*.zip`，ZIP 根目录只有上述三个文件
- [ ] 使用全新测试仓库通过 BRAT 或 ZIP 安装，测试连接、粘贴上传、拖拽上传和禁用/重载插件
- [ ] `SHA256SUMS.txt` 包含 Obsidian 插件 ZIP

## 跨平台（至少抽检一个）
- [ ] Windows `x64-setup.exe` 安装 + 启动
- [ ] Windows `.msi` 安装 + 启动
- [ ] Windows 便携版 ZIP 解压后 `PicNexus.exe --version` 正常，`data/portable.json` 存在
- [ ] macOS `.dmg` 安装 + 启动（arm64 或 Intel 之一）
- [ ] Linux AppImage 启动
