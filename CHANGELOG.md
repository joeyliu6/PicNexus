# Changelog

所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

### Changed
- 移除配置保存时的成功提示弹窗，减少不必要的通知干扰
  - 保留错误提示，确保用户能感知保存失败

### Added
- 新增 Toast 消息集中化管理系统
  - 新增 `src/constants/toastMessages.ts` 统一管理所有通知文案
  - `useToast` 新增 `showConfig()` 方法支持预定义消息配置
  - 便于后续国际化和统一维护
- 新增 `isValidHistoryItem()` 验证函数，用于导入历史记录时的数据验证
- 新增腾讯云 COS 图床支持
  - 支持 SecretId/SecretKey 认证
  - 支持自定义地域、存储桶、路径前缀
  - 支持自定义公开访问域名
- 新增阿里云 OSS 图床支持
  - 支持 AccessKey ID/Secret 认证
  - 支持自定义地域、存储桶、路径前缀
  - 支持自定义公开访问域名
- 新增 COS/OSS 存储管理器，支持云存储文件浏览

### Fixed
- 修复切换时间线视图时的短暂空白问题
  - 添加 visible 和 activationTrigger props 控制骨架屏显示
  - 使用 v-show 替代 v-if 避免组件重复创建销毁
  - 添加 300ms 最小显示时间避免骨架屏闪烁
- 修复上传失败后队列状态仍显示"上传中"的问题
  - 根因：节流更新的 RAF 回调覆盖了失败状态
  - 方案：在设置最终状态时清除过时的节流更新

### Added
- 新增完整的开发文档系统
  - 架构文档 (`docs/architecture/`)
  - API 参考 (`docs/api/`)
  - 开发指南 (`docs/guides/`)
  - 技术决策记录 (`docs/decisions/`)
- 新增 AI 上下文文档 (`.claude/context/`)
- 新增文档自动同步技能 (`doc-sync`)

### Changed
- 更新 CLAUDE.md 添加文档维护规范
- 重构图床设置界面，采用扁平式卡片布局
- 重构图床图标系统
  - 将 16 个内联 SVG 字符串提取为独立 SVG 文件 (`src/assets/icons/services/`)
  - 新增 `serviceIcons.ts` 工具模块，使用 Vite `import.meta.glob` 动态导入
  - SVG 使用 `currentColor` 支持 CSS 颜色控制
  - 新增 `HostingCard.vue` 通用可展开卡片组件
  - 移除多层嵌套结构（Accordion → Tabs → 表单）
  - 按认证类型分组：云存储、免配置图床、Cookie认证、Token认证
  - 配置状态指示器（绿点/灰点）
  - 与常规设置风格统一

---

## [1.0.1] - 2025-01-10

### Fixed
- 修复设置面板样式问题
- 优化时间线年份标签位置，移至当年区域底部
- 修复时间线骨架屏样式

### Changed
- 优化图床设置界面分类和暗黑模式样式
- 统一图床设置为折叠面板界面

---

## [1.0.0] - 2025-01-01

### Added
- 初始版本发布
- 支持多图床同时上传
  - 微博图床
  - 京东图床
  - 七鱼图床
  - TCL 图床
  - 知乎图床
  - 牛客图床
  - 纳米图床
  - Cloudflare R2
- 历史记录管理
  - 表格视图
  - 网格视图
  - 时间线视图
- 链接有效性检测
- R2 文件管理器
- WebDAV 配置同步
- 深色/浅色主题支持
- 剪贴板图片上传

---

## 变更类型说明

- **Added**: 新增功能
- **Changed**: 功能变更
- **Deprecated**: 即将废弃的功能
- **Removed**: 已移除的功能
- **Fixed**: Bug 修复
- **Security**: 安全相关修复
