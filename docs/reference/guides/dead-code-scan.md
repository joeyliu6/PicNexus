# 扫死代码

找没人用的导出、文件、命令和依赖。工具结果只是候选名单：逐条排除下文的误报后再删，一批一类，每批删完跑 `npm run ci:full`。

## 1. 前端：knip

knip 不装进项目，用 `npx --yes knip@6` 跑。配置放系统临时目录，用 `-c <绝对路径>` 传入（命令在仓库根目录执行）：

```json
{
  "entry": [
    "src/main.ts!", "src/login-webview.ts!", "src/login-titlebar.ts!",
    "public/*.js!", "src-tauri/src/analytics/bootstrap.js!", "src/**/*.d.ts!",
    "scripts/claude-hooks/flows-router.mjs", "tests/e2e/mocks/*.ts", "tests/types/*.d.ts"
  ],
  "project": [
    "src/**/*.{ts,vue}!", "public/*.js!", "src-tauri/src/**/*.js!",
    "tests/**/*.{ts,mjs,cjs}", "scripts/**/*.{mjs,cjs,js}", "*.{ts,mjs,cjs}"
  ]
}
```

| 跑法 | 找什么 |
|------|--------|
| `npx --yes knip@6 -c <配置>` | 没人导入的文件、导出、类型（含「只在本文件用、多了 `export`」的） |
| 配置里加 `"ignoreExportsUsedInFile": true` | 连本文件都不用的，才是真死代码 |
| 加 `--production` | 只看生产代码：报出来的是「只剩测试在调」的函数和文件 |

- 路径末尾的 `!` 标记生产代码。`--production` 只分析带 `!` 的入口，漏标就等于什么都没分析，结果却显示一切正常。
- e2e 的 Tauri 替身（`tests/e2e/mocks/*`）靠 vite 别名用字符串拼路径加载，knip 看不见，所以登记成入口。
- knip 看不见对象里的属性：`TOAST_MESSAGES`、`UI_COPY` 的键要逐个搜 `TOAST_MESSAGES.组.键` 这种写法。
- `--fix --fix-type exports,types` 能去掉多余的 `export`，但会留下孤零零的 `;` 和空行，还可能把整个文件换成 CRLF。跑完先看 diff；它在 `.vue` 里定位准不准没验证过，`.vue` 用配置里的 `"ignore": ["**/*.vue"]` 排除后手改。

## 2. Rust：编译器

```bash
cd src-tauri && cargo clippy -- --force-warn dead_code -A clippy::all
```

`--force-warn` 能看穿 `#[allow(dead_code)]`，`--` 后面的参数只作用于本项目，依赖不会重编。再加 `--force-warn unused` 会多出一批「unreachable statement」，全指向 `#[tauri::command]` 函数签名，是宏展开的副产物。

## 3. 前后端之间：命令

编译器只知道命令注册了，不知道前端调没调。拿 `src-tauri/src/main.rs` 里 `generate_handler!` 的清单逐个搜前端（`src/`、`public/`、三个 HTML）有没有这个字符串，再看 `src-tauri/capabilities/*.json` 有没有放行 `allow-<命令名>`。两边都没有的，前端调不到，可以删。`npm run lint` 输出里「命令名不是字面量」的几处要单独看一眼。

## 4. 已知误报

| 候选 | 为什么不删 |
|------|-----------|
| `wdio.tauri.e2e.conf.cjs`、`tests/tauri-e2e/*`，依赖 `@wdio/local-runner` / `mocha-framework` / `spec-reporter` | `npm run test:tauri:e2e` 在用，wdio 配置用字符串引用它们 |
| `scripts/generate-icons.mjs`（连同 `icon-gen`、`sharp`）、`seed-tauri-e2e-portable.mjs`、`webdav-auth-fixture.mjs` | 手动运行的工具，见各自文件头 |
| `__reset…ForTests` 一类复位函数 | 测试专用钩子，生产模式下必然报 |
| `HistoryDatabase` 导出的分页、搜索、导入结果类型 | 类的方法签名用到，测试也引用 |
| `typescript-eslint`、未声明的 `postcss` | 依赖问题，不是死代码，改依赖另议 |
| `sidecars/` | 项目规则不手改 |
