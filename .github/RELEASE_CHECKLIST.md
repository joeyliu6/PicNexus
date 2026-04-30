# PicNexus 发版前手动回归清单

## 自动化测试
- [ ] PR / main CI 基线已通过：lint、build、unit、coverage
- [ ] 手动触发 `CI` workflow，勾选 `run_visual=true`，确认 visual regression 通过并保留 `playwright-visual-report`
- [ ] 手动触发 `CI` workflow，勾选 `run_e2e=true`，确认 mocked Playwright E2E 通过并保留 `playwright-e2e-report`
- [ ] 如平台支持，手动触发 `CI` workflow 勾选 `run_tauri_e2e=true`，或本地运行 `npm run test:tauri:e2e` 真实桌面冒烟
- [ ] tag 触发的 `Release` workflow 中 web smoke E2E、Windows Tauri E2E、安装包 / AppImage 冒烟、Windows 便携版 ZIP 冒烟通过

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

## 跨平台（至少抽检一个）
- [ ] Windows `.msi` 安装 + 启动
- [ ] Windows 便携版 ZIP 解压后 `PicNexus.exe --version` 正常，`data/portable.json` 存在
- [ ] macOS `.dmg` 安装 + 启动（arm64 或 Intel 之一）
- [ ] Linux AppImage 启动
