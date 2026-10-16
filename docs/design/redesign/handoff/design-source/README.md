# 设计源文件格式（.dc.html）

这些文件来自 Claude Design 画布，每个文件是一个可复用的界面组件。它们依赖画布的运行时（`support.js`），**不能直接双击在浏览器里打开**；要看渲染效果请打开在线画布。作为实现依据，直接读源码即可，所有数值都在文件里。

## 结构

```html
<x-dc>
  <helmet>…字体与基础样式…</helmet>
  <div style="…">                 ← 界面标记：所有尺寸、颜色、间距都写在行内 style 里
    {{c.text1}}                   ← 占位：取自下方脚本 renderVals() 的返回值
    <sc-if value="{{flag}}">…</sc-if>        ← 条件渲染（= Vue 的 v-if）
    <sc-for list="{{rows}}" as="r">…</sc-for> ← 列表渲染（= Vue 的 v-for）
    <dc-import name="HostIcon" host="jd" size="16"></dc-import>  ← 引用另一个组件（= 子组件 + props）
  </div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"state":{"editor":"enum","options":[…]}…}'>
class Component extends DCLogic {
  renderVals() {
    const c = dark ? {…深色令牌…} : {…浅色令牌…};   ← 颜色令牌
    …根据 this.props.state 计算每个状态的数据和文案…
    return { c, … };
  }
}
</script>
```

- `data-props` 列出组件参数及可选值，例如 `HealthScreen` 的 `state` 有 18 个取值，每个取值对应画布上的一张状态图。
- `renderVals()` 里的数据就是设计稿用的示例数据和**定稿文案**；实现时把示例数据换成真实数据，文案保持一致。
- 画板文件（如 `L04-Problems.dc.html`）只是用某组参数引用源组件，真正的实现都在 `*Screen.dc.html`、`TrayWindow.dc.html`、`Onboarding.dc.html`、`Dialogs.dc.html` 以及设计系统的 `Foundations / Controls / Patterns` 里。

## 目录

- `project/`：现行设计（148 个文件）。
- `archive/`：已废弃的早期方向（`Main`、`DirectionB`、`DirectionC`、`Round2`、`BatchUploading`、`BatchDone`），仅存档，不要实现。
- `canvas.json`：画布索引，含每张画板的标题、所属页面和全部注释便签原文。
