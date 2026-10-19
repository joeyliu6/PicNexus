# 设置页面排版规范

设置页（`src/views/settings/`）的排版以设计源文件 `docs/design/redesign/handoff/design-source/project/SettingsScreen.dc.html` 为准（画板 S01–S21），只用 `--pn-*` 令牌（`src/styles/tokens.css`，设计稿有而令牌没收录的写进 `tokens-extra.css`）。设计没画、开发时补的做法见 [decisions/settings.md](./redesign/decisions/settings.md)。

## 骨架

| 层 | 组件 | 规格 |
|----|------|------|
| 二级栏 | `SettingsNav.vue` | 7 组，选中项浅灰底；窄窗口（< 1000px）照样显示，侧栏先收成 56px |
| 标题行 | `SettingsView.vue` | 组名（20/26，600）+ 一句说明；窗口按钮、传输按钮在右上 |
| 滚动区 | `SettingsView.vue` | 内容最宽 680，800×600 下不横向滚动；刷新横幅在标题下、各组之上 |
| 一组 | `SettingsSection.vue` | 12px 小标题（`--pn-text2`，600）→ 卡片 → 卡片下方一句灰色脚注说清后果；间距 8 |
| 卡片 | `SettingsCard.vue` | 圆角 `--pn-radius-settings-card`（12），一圈 1px `--pn-border`；「备份与同步」的大卡圆角 14（`large`） |
| 一行 | `SettingRow.vue` | 标题（正文色）+ 描述（12/16，`--pn-text3`，可单行截断）+ 右侧控件；行间 1px 分隔线，不套框；改动成功在右侧闪「✓ 已保存」1.5 秒 |

## 规则

- **每项改动即保存**，没有「保存」按钮；保存失败红色通知「未能保存 / 原因，请重试」（见 [settings-ui-architecture.md](../flows/settings-ui-architecture.md) 图 1）。
- **少用描边**：卡片外一圈 1px 是唯一的框，卡内用分隔线，卡内不再套带框的子卡。
- **每页一个主按钮**：设置页属于较早定稿的页面，次要按钮照设计稿用白底描边按钮（`PnButton variant="secondary"`）；危险操作按钮红字（「清空…」「恢复…」「关闭…」）。
- **正常状态不打标记**：同步、编辑器卡、最近操作都不画绿点；出问题才是琥珀 ⚠ 或红字。
- **会再确认或打开新窗口 / 弹窗的按钮文字后加「…」**，设计稿漏加的也加（「编辑…」「修改…」「关闭…」「设置密码…」）。
- **命令面板能搜到每一行**：新加一行要登记在 `settingsGroups.ts` 的 `SETTING_ROWS`，行上带 `data-setting-row`，跳转时浅蓝闪 1.5 秒。
