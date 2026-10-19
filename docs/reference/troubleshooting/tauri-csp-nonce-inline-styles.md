# Tauri 2 的 CSP nonce 会挡掉运行时插入的样式

## 现象

开发版（`npm run tauri dev`）样式正常，打成正式版（`npm run tauri build`）后，由 JavaScript 运行时插入的 `<style>` 全部不生效，界面退回浏览器默认样式。

## 根因

`tauri.conf.json` 里写了 `style-src 'self' 'unsafe-inline'`，Tauri 打包时会把 `'unsafe-inline'` 换成 nonce，并给 HTML 里已有的 `<style>` 加上 nonce；运行时用 JavaScript 新建的 `<style>` 元素没有 nonce，被浏览器的 CSP 静默拦下。开发版连的是本机开发服务器，Tauri 不做这层替换，所以只在正式版出现。

## 现在的配置

`src-tauri/tauri.conf.json` 的 `app.security`：

```json
"csp": "... style-src 'self' 'unsafe-inline'; ...",
"dangerousDisableAssetCspModification": ["style-src"]
```

只对 `style-src` 保留原样的 `'unsafe-inline'`，`script-src` 等指令的 nonce 保护不受影响。`style-src 'unsafe-inline'` 对本应用风险很低：不渲染用户提供的 HTML，CSS 注入的危害也远小于脚本注入。

这条配置是为 PrimeVue 的运行时主题样式加的。PrimeVue 已卸载，界面样式现在都在构建时打进 CSS 文件，Vue 与 Reka UI 改行内样式走的是 `element.style`（不受这条 CSP 管）；去掉这条配置后正式版是否一切正常，还没在正式版里验证过，验证前不要删（见 `docs/TODO.md`）。

## 关键知识

- `dangerousDisableAssetCspModification` 接受 `true`（全部不替换）或字符串数组（如 `["style-src"]`）；写成对象 `{"style-src": true}` 会报 schema 错误。
- 所有运行时插入 `<style>` 的库（Emotion、styled-components、带运行时主题的组件库）在 Tauri 2 正式版里都会遇到这个问题。
