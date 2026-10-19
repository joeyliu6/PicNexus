# 深浅色与平台

## 深浅色

- 一个开关：根元素 `data-theme="light"` / `"dark"`。令牌按它取两套值（[tokens.md](./tokens.md)），组件里不写 `[data-theme]` 选择器，只引用令牌。
- 用户设置在 设置 › 通用（`config.theme.mode`：`light` / `dark` / `auto`，默认 `auto` 跟随系统）。`ThemeManager`（`src/theme/ThemeManager.ts`，由 `useThemeManager()` 持有）先写配置、成功后再改 `data-theme`，跟随系统时监听 `prefers-color-scheme`。
- 首屏不闪：`ThemeManager` 同时把选择写进 localStorage 的 `picnexus-theme`（`light-theme` / `dark-theme` / `auto`），`public/preload-theme.js` 在页面加载前按它先写好 `data-theme`，`public/preload.css` 按它铺首屏底色（色值是令牌的手抄副本，见 tokens.md「首屏副本」）。
- Cookie 登录小窗：主窗口打开它时在地址上带 `?theme=light|dark`；内容页由 `useLoginTheme.ts` 写 `data-theme`，标题栏页（`login-titlebar.html`）由 `login-titlebar.ts` 写 `data-theme` 与 `data-platform`。
- 不随主题的区域（图库灯箱、压缩预览）：容器上写 `data-theme="dark"`，里面照常引用令牌。
- 命令面板的「切换到深色 / 浅色」把模式从「跟随系统」改成固定的那一种。

深色模式的目标：图片是主角、界面退后、不刺眼。背景中性灰不偏色，层级越靠上越亮（侧栏 `#151517` < 页面 `#1C1C1E` < 卡片 `#2A2A2D` < 菜单 `#36363A`），浮层用 1px 浅描边代替看不见的阴影，缩略图加 1px 浅描边。

## 平台

- 根元素 `data-platform="windows"` / `"macos"` / `"linux"`，启动时由 `uiPlatform()`（`src/utils/platform.ts`）按 Tauri `os` 插件判定；认不出的按 Windows。
- 三个平台布局、结构、文案完全一致，只换：窗口按钮（Windows 方形三键 / Linux 圆形三键 / macOS 系统红绿灯）、中文字体（`--pn-font-cjk`）、浅色侧栏底色、快捷键写法（Windows / Linux `Ctrl+Shift+C`，macOS `⇧⌘C`）、托盘菜单的系统外观。
- 侧栏不用 Mica / 毛玻璃，三个平台都是令牌里的纯色；做不到或没验证过的平台差异记在 [redesign/README.md](./redesign/README.md)「平台限制记录」。
- Playwright 的 WebKit 项目按 macOS 渲染界面（应用按浏览器标识判断平台），断言前先读 `data-platform`。
