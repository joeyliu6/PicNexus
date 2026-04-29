# 自动测试流水线

## 问题

改了代码当时没问题，过了很久才发现某个功能悄悄坏了（回归 bug）。

## 方案：三层防护

### 第一层：Pre-commit Hook（本地）

每次 `git commit` 前自动跑与修改文件相关的测试。

- **工具**：husky + lint-staged
- **配置文件**：`.husky/pre-commit` + `package.json` 中的 `lint-staged` 字段
- **命令**：`vitest related --run`（只跑相关测试，2-5 秒）
- **效果**：测试不过 → commit 被阻止

### 第二层：CI Workflow（远程）

push 到 main 或开 PR 时自动跑全量测试 + 类型检查。

- **配置文件**：`.github/workflows/ci.yml`
- **PR / main 必跑**：typecheck、lint、build、unit、coverage（coverage 只在 Ubuntu 跑并上传 `coverage-report`）
- **手动触发**：`run_visual=true` 跑 visual regression，`run_e2e=true` 跑 mocked Playwright E2E，`run_tauri_e2e=true` 跑 Windows 真实 Tauri 桌面冒烟

### 第三层：Release 门禁

发布前跑一遍测试，不过则阻止 release。

- **配置文件**：`.github/workflows/release.yml`
- **tag 后自动门禁**：Ubuntu mocked web smoke E2E、release matrix 中的 lint / unit、Windows 真实 Tauri E2E、Windows / Linux 安装包启动冒烟
- **打 tag 前建议手动跑**：visual、mocked E2E、真实 Tauri E2E（平台和 driver 可用时）

## Tauri 应用的测试边界

| 可测试 | 不可测试（需手动验证） |
|--------|----------------------|
| 纯工具函数、链接格式化、MD 解析 | Rust 后端实际上传 |
| 多图床编排逻辑（mock UploaderFactory） | Tauri 事件系统（进度条） |
| 配置验证（validateConfig） | 剪贴板/通知/快捷键 |
| Vue 组件交互（happy-dom） | 真实 SQLite 数据库操作 |

**原则**：测试覆盖到 `invoke` 边界——验证"传给 Rust 的参数对不对"和"Rust 返回后处理得对不对"。

## 补充测试优先级

| 优先级 | 模块 | 原因 |
|--------|------|------|
| P0 | linkFormatter、mdParser、semaphore、renameUtils | 纯函数，投入最少回报最大 |
| P1 | UploaderFactory、各图床 validateConfig | 需要 mock 但价值高 |
| P2 | 复杂 composable 的辅助函数 | 中等难度，持续补充 |

## 运行机制

### husky 是怎么生效的？

husky 是**触发式**运行，不是后台常驻。原理很简单：

1. `npm install` 时，`package.json` 里的 `"prepare": "husky"` 脚本会自动执行
2. husky 把 `.husky/pre-commit` 注册为 git 的 pre-commit 钩子
3. 之后每次你 `git commit`，git 会先执行这个钩子
4. 钩子里写的是 `npx lint-staged`，它会找到你本次改的文件，跑相关测试

**也就是说**：你 `npm install` 之后，husky 就自动生效了，不需要任何额外操作。

### 什么时候会跑测试？

| 场景 | 触发方式 | 跑什么 | 耗时 |
|------|---------|--------|------|
| `git commit` | 自动（pre-commit hook） | 只跑跟改动文件相关的测试 | 2-5 秒 |
| push 到 main / 开 PR | 自动（GitHub Actions） | typecheck + lint + build + unit + coverage | 数分钟，受三平台和 sidecar 构建影响 |
| 手动 CI | workflow_dispatch | visual / mocked E2E / 真实 Tauri E2E 按输入选择 | 视所选 job 而定 |
| 打 tag 发版 | 自动（release workflow） | mocked web smoke + lint + unit + Windows Tauri E2E + 安装包冒烟 | 视打包矩阵而定 |
| 手动 | 你自己在终端跑 | 看你用什么命令 | — |

## 日常使用

### 正常流程（你什么都不用管）

```bash
# 照常写代码、照常提交
git add .
git commit -m "feat: xxx"
# ↑ husky 在这一步自动跑测试
#   通过 → 正常提交
#   失败 → commit 被阻止，终端会显示哪个测试挂了
```

### 手动跑测试

```bash
npm run test:run        # 跑一遍所有测试
npm run test:coverage   # 跑测试 + 生成覆盖率报告（在 coverage/ 目录）
npm run test:visual     # 跑 Playwright 视觉截图测试
npm run test:e2e        # 跑 mocked Playwright E2E
npm run test:tauri:e2e  # 跑真实 Tauri 桌面冒烟（需要平台 driver）
npm test                # 监听模式，改一下文件自动重跑（开发时用）
```

### 万一 hook 拦住了但你确定没问题？

```bash
git commit -m "docs: 更新文档" --no-verify
```

⚠️ 不建议经常用，绕过测试就失去了保护意义。

## .gitignore 说明

| 目录/文件 | 是否提交到仓库 | 原因 |
|-----------|--------------|------|
| `.husky/` | ✅ 需要提交 | 其他人 clone 后 `npm install` 即可自动生效 |
| `coverage/` | ❌ 已忽略 | 本地生成的报告，每次跑都会重新生成 |
| `node_modules/` | ❌ 已忽略 | 依赖目录，`npm install` 恢复 |
