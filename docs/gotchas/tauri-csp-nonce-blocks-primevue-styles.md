# Tauri 2.x CSP Nonce 机制导致 PrimeVue 样式丢失

## 现象

开发模式（`npm run tauri dev`）下 PrimeVue 组件样式正常，但编译后（`npm run tauri build`）样式全部丢失：
- ToggleSwitch 变成原生 checkbox
- InputNumber/InputText 失去 PrimeVue 样式，显示为浏览器默认样式
- 左侧导航栏出现异常边框

## 根因

**Tauri 2.x 的 CSP nonce 注入机制与 PrimeVue 4.x 的运行时样式注入冲突。**

PrimeVue 4.x（使用 `@primevue/themes` 的 styled mode）通过 JavaScript 在运行时动态创建 `<style>` 元素来注入组件样式。这些样式**不是**预编译的静态 CSS，而是由主题预设在组件渲染时动态生成的。

Tauri 2.x 的 CSP 处理流程：
1. 即使你在 `tauri.conf.json` 中声明了 `style-src 'self' 'unsafe-inline'`
2. Tauri 在构建时会**自动将 `'unsafe-inline'` 替换为 nonce**
3. HTML 中已有的 `<style>` 标签会被自动加上 nonce（正常工作）
4. 但 JavaScript 动态创建的 `<style>` 元素**没有 nonce**，被浏览器 CSP 静默拦截

开发模式不受影响，因为 Tauri 对 `devUrl`（localhost dev server）不做 nonce 变换。

## 解决方案

在 `src-tauri/tauri.conf.json` 的 `app.security` 中添加 `dangerousDisableAssetCspModification`：

```json
"security": {
  "csp": "default-src 'self'; ... style-src 'self' 'unsafe-inline'; ...",
  "dangerousDisableAssetCspModification": ["style-src"]
}
```

这告诉 Tauri 仅对 `style-src` 指令保留原始的 `'unsafe-inline'`，不做 nonce 替换。其他指令（`script-src` 等）的 nonce 保护不受影响。

## 安全影响

- `style-src 'unsafe-inline'` 的安全风险极低，特别是对桌面应用
- CSS 注入攻击的危害远小于 JS 注入，且本应用不渲染用户生成的 HTML
- 这是 PrimeVue 4.x styled mode 的架构要求，无法绕过

## 关键知识

- `dangerousDisableAssetCspModification` 接受 `true`（禁用全部）或**字符串数组**（如 `["style-src"]`）
- ❌ 不接受对象格式 `{"style-src": true}`，会报 schema 校验错误
- 所有使用运行时 CSS 注入的库（PrimeVue、Emotion、styled-components 等）在 Tauri 2.x 中都会遇到此问题
