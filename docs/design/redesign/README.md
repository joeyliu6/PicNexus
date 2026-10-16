# 界面重构 · 入口

> 读者：维护者，以及按设计稿写代码的 AI。设计已验收（2026-10-16），这里是实施的唯一入口。

## 先读什么

| 文件 | 内容 |
|---|---|
| [handoff/HANDOFF.md](./handoff/HANDOFF.md) | 交接说明：产品规则（第 4 节，硬约束）、文案（第 9 节）、已否决的方案（第 12 节）、验收清单（第 14 节） |
| [handoff/states/STATES.md](./handoff/states/STATES.md) | 154 张状态图索引：每张由哪个源组件、什么参数渲染，附设计说明 |
| [handoff/tokens/](./handoff/tokens/) | 设计令牌（`tokens.css` 已原样放进 `src/styles/tokens.css`） |
| [handoff/design-source/project/](./handoff/design-source/project/) | 设计源文件 `*.dc.html`：尺寸、颜色、文案的最终依据（格式见 [design-source/README.md](./handoff/design-source/README.md)） |
| [tech-stack.md](./tech-stack.md) | 用什么做：Reka UI + 自写 Pn 组件 + `--pn-*` 令牌 |

在线画布（可交互，可切深浅色与平台）：https://claude.ai/code/artifact/9dbe340e-3ff9-4fa9-ae80-4ddc199785f3

## 已定的事

- 零件：Reka UI + 自写 `Pn*` 组件 + scoped CSS，不用 Tailwind / shadcn-vue（理由见 tech-stack 第 2 节）。
- 分支 `feat/redesign`，每阶段门禁全绿就提交，不 push。
- 图床配置沿用两层字段，不迁移：`availableServices` = 已添加，`enabledServices` = 启用 = 首页「上传到」勾选的那些。「已添加」= 在 `availableServices` 里，并且免配置或已填凭证。
- 「复制」可固定某个图床；固定的图床失败时退回「最先完成」（设计未画，按最接近的规则补）。
- 新配置字段只加不改、有默认值：复制固定图床、文档文件夹、自动检测（默认每 7 天）、渐进提示已出现、侧栏手动收起。

## 按交接说明去掉的旧功能

- 补充备份：来源图床 / 上传时间 / 备份份数筛选、「只补已经坏了一份的」、永久跳过、导出报告。范围固定为「仅有 1 份的图片」，只选目标图床。
- 文档修复：「包含子文件夹 / 代码块」选项、逐行换替换来源、「以后优先用 X」。改为固定的文档文件夹 + 自动选响应最快的备份。
- 上传队列「清空已完成 / 清空列表」：改为焦点卡 +「最近上传」。
- 托盘网页浮窗：改为系统原生菜单。

## 实施阶段

| 阶段 | 内容 | 画板 | 状态 |
|---|---|---|---|
| 0 准备 | 设计包入库、令牌、`data-theme` / `data-platform`、依赖 | Foundations | 进行中 |
| 1 外壳 | 侧栏 / 图标栏、标题栏与窗口按钮、路由、全局拖放与粘贴、侧栏材质 | H07 H17 K01 | 未开始 |
| 2 基础件 | Pn 控件、PnToast / PnDialog、业务组件、命令面板、传输中心 | Controls Patterns PetalScale HostIcons BgDecor LoadingRules H14–H16 N01 | 未开始 |
| 3 首页·快传 | 焦点卡、最近上传、批量、三个浮层、URL 下载、渐进提示、第一次使用 | H01–H21 HB1–3 | 未开始 |
| 4 图库 | 网格 / 列表、筛选、多选、详情、灯箱、刻度条、空与加载 | G01–G13 K02 K03 K07 | 未开始 |
| 5 链接健康 | 状态栏、上传日历、工具卡、失效清单、两个弹窗、自动检测 | L01–L18 K04 K08 | 未开始 |
| 6 图床 | 双栏、接入表单、目录、测试连接、敏感字段、窄窗口、Cookie 小窗 | P01–P16 K09 | 未开始 |
| 7 设置 | 7 个分组、快捷键录制、云同步、更新卡片 | S01–S21 K05 K10 | 未开始 |
| 8 托盘 | 原生菜单、托盘图标进度 | T01–T08 K11 | 未开始 |
| 9 引导·弹窗 | 新手引导、备份密码弹窗、启动还原 | O01–O03 D01–D05 | 未开始 |
| 10 动效 | ③ 逐片点亮、⑥ 完成绽放、⑦ 拖入感应优先 | M01–M08 | 未开始 |
| 11 收尾 | 卸载 PrimeVue、删旧主题、改写 `docs/design/*.md` 与相关 flows、跑验收清单 | 全部 | 未开始 |

## 平台限制记录

（落地时实测后写在这里：原生菜单能否勾选不关、Windows 默认项加粗、侧栏材质、WebKit 毛玻璃。）
