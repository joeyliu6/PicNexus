# Changelog

所有重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

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
