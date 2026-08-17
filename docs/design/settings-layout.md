# 设置页面排版规范

设置页面（`src/components/settings/`）有一套完整的排版体系，所有设置面板必须遵循。

共享样式定义在 `src/styles/settings-shared.css`，各面板通过 `@import` 引入。

## 标题层级

| 层级 | Class | 字号 | 粗细 | 颜色 | 用途 |
|------|-------|------|------|------|------|
| 页面标题 | `.section-header h2` | 24px (`--text-2xl`) | 600 (`--weight-bold`) | `--text-primary` | 每个设置 Tab 的顶部标题 |
| 卡片标题 | `.card-title` | 14px (`--text-base`) | 600 (`--weight-semibold`) | `--text-primary` | 可折叠卡片标题（如"图片压缩""Typora""Obsidian""Cloudflare R2"） |
| 区块标签 | `.group-label` | 16px (`--text-lg`) | 600 (`--weight-semibold`) | `--text-primary` | 功能分区标题（如"外观主题""应用行为"） |
| 行标题 | `.toggle-row-label` | 14px (`--text-base`) | 500 (`--weight-medium`) | `--text-primary` | 设置项名称（如"开机自启动"） |

## 描述文字层级（3 级）

| 层级 | Class | 字号 | 颜色 | Margin | 用途 | 示例 |
|------|-------|------|------|--------|------|------|
| **L1** 页面描述 | `.section-desc` | 14px | `--text-secondary` | 0 | H2 标题下方 | "管理应用外观、启动行为与链接输出。" |
| **L2** 区块说明 | `.helper-text` | 13px | `--text-muted` | -3px 0 12px 0 | group-label 下方 | "在任何应用中通过快捷键直接触发上传…" |
| **L3** 行内描述 | `.toggle-row-desc` 等 | 12px | `--text-muted` | 0 | 设置项下方小字 | "系统启动时自动运行 PicNexus" |

> **L3 行内描述**在不同面板中使用不同 class 名（`.toggle-row-desc`、`.settings-row-desc`、`.subsection-hint`、`.config-hint`、`.port-hint`、`.service-section-desc`、`.link-card-desc`），但样式值必须统一为 **12px / --text-muted / line-height 1.4**。

## 折叠卡片公共样式

所有可折叠配置卡片（HostingCard、CollapsibleSettingsCard、ImageCompressionPanel、WebDAVConfigCollapsible 等）共享以下统一类名，定义在 `settings-shared.css`：

| 语义 | Class | 说明 |
|------|-------|------|
| 头部按钮 | `.card-header` | flex 布局，14px 16px 内边距，hover 背景 |
| 左侧容器 | `.header-left` | flex, gap 12px |
| 信息容器 | `.header-info` | flex-column, gap 2px |
| 标题 | `.card-title` | 14px / 600 / `--text-primary` |
| 描述 | `.card-description` | 13px / `--text-muted` |
| 右侧容器 | `.header-right` | flex, gap 12px |
| 状态点 | `.status-dot` | 8px 圆点 + `.active`/`.verified`/`.pending`/`.error` |
| 展开图标 | `.expand-icon` | 14px / `--text-muted` |
| 内容包装 | `.card-content-wrapper` | CSS Grid 展开动画 |
| 内容区 | `.card-content` | overflow hidden |
| 卡内子章节 | `.card-subsection` | 上分隔线 + 16px 上外边距/内边距 |
| 子章节标题 | `.subsection-title` | 13px / 600 / `--text-primary` |
| 子章节说明 | `.subsection-hint` | 12px / `--text-muted` |
| 子章节标题行 | `.subsection-title-row` | flex，左「标题+说明」右控件（开关/按钮） |
| 标题行文字块 | `.subsection-title-text` | flex-column，`flex:1` + `min-width:0` |

> 各组件只需保留自己的**容器类**（如 `.hosting-card`、`.collapsible-card`）和组件特有逻辑。

## 容器规范

| 容器类型 | 圆角 | 背景 | 边框 | 示例 |
|---------|------|------|------|------|
| 设置项分组卡片 | 8px | `--bg-card` | `1px solid --border-subtle` | `.toggle-group`、`.preset-config-box` |
| 小型选择芯片 | 6px | `--bg-card` | `1px solid --border-subtle` | `.preset-chip`、`.format-tab` |
| 大型选择卡片 | 8px | `--bg-card` | `1px solid --border-subtle` | `.theme-card`、`.format-card` |
| 提示信息块 | 8px | `--primary-alpha-8` | `1px solid --primary-alpha-15` | `.reload-banner`、`.exec-path-row` |

> ⚠️ **提示信息块目前没有共享 class**，三处各写了一份局部样式：[ReloadBanner.vue](../../src/components/common/ReloadBanner.vue)、[TyporaCard.vue](../../src/components/settings/external-editor/TyporaCard.vue)、[CliCard.vue](../../src/components/settings/external-editor/CliCard.vue)。它们的实际形态都是**「一句说明 + 一个轻量动作」**（复制路径、重新加载），不是纯文字提示框。新增同类块时复用上面这套配色值，不要塞进设置开关这类持久化控件——那属于[卡内开关行](#折叠卡片内部布局)。

## 折叠卡片内部布局

> ❌ **折叠卡片内部禁止再套带边框的卡片。**

`.hosting-card` / `.collapsible-card` 内部的子块一律用**分隔线**划分层级，不画整圈边框。原因是折叠卡与子块背景同为 `--bg-card`，同色套同色时那圈边框只剩噪音没有信息；而外层 `.content-inner` 已有 16px 内边距，子块再叠自己的内边距会让文字比同卡其他控件右移十几像素，看着像个缩进的孤岛。

**卡内开关行的标准写法**（`.card-subsection` + `.subsection-title-row`）：

```html
<div class="card-subsection">
  <div class="subsection-title-row">
    <div class="subsection-title-text">
      <label class="subsection-title">防止图片互相覆盖</label>
      <span class="subsection-hint">上传时自动重命名，image.png 会存成……</span>
    </div>
    <ToggleSwitch v-model="enabled" />
  </div>
</div>
```

参考实现：`PrivateStorageGroup.vue`（WebDAV 唯一后缀）、`ZhihuSourceSection.vue`、`GithubProxySection.vue`、`WeiboLinkPrefixSection.vue`。

⚠️ **不要在卡内裸用 `.toggle-row`** —— 它自带 `border` + `border-radius` + `background`，只有被 `.toggle-group` 包住时才会被抹掉。裸用就会变成"卡中卡"。`.toggle-row` 的定位是**页面级**设置项（见下方标准结构），不是卡内子项。

**唯一例外**：靠**背景色差**而非边框制造层级的纯展示块，例如 `HostingCard.vue` 的 `.builtin-status`（用 `--bg-secondary`，与卡片底色不同，且无交互控件）。

## 激活态

| 元素类型 | 背景 | 边框 | 阴影 | 粗细 |
|---------|------|------|------|------|
| 大型选择卡片 | `--primary-alpha-8` | `--primary` | `0 0 0 1px --primary` | 600 |
| 小型选择芯片 | `--primary-alpha-8` | `--primary` | 无 | 600 |
| 下拉菜单项 | `--primary-alpha-10` | 无 | 无 | — |

## 间距规范

| 场景 | 值 |
|------|-----|
| 设置项行 padding | 12px 16px |
| section-header margin-bottom（h2 到 desc） | 8px |
| form-group margin-top | 16px |
| Divider 分隔区块 | PrimeVue `<Divider />` |
| transition 时长 | 0.15s |

## 代码示例

```html
<!-- 标准设置面板结构 -->
<div class="my-settings-panel">
  <!-- L0: 页面标题 -->
  <div class="section-header">
    <h2>面板标题</h2>
    <p class="section-desc">L1: 页面描述文字。</p>
  </div>

  <!-- 区块 -->
  <div class="form-group">
    <label class="group-label">区块标签</label>
    <p class="helper-text">L2: 区块说明文字。</p>

    <div class="toggle-group">
      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-row-label">设置项名称</span>
          <span class="toggle-row-desc">L3: 行内描述文字</span>
        </div>
        <ToggleSwitch ... />
      </div>
    </div>
  </div>

  <Divider />

  <!-- 下一个区块 -->
  <div class="form-group">
    <label class="group-label">另一个区块</label>
    <!-- ... -->
  </div>
</div>
```
