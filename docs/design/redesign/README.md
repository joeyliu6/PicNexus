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

## 怎么区分「已定」和「待过目」

- 「已定的事」「按交接说明去掉的旧功能」：与维护者一起定的，照做。
- 「设计没画、开发时补的」（`decisions/` 下每页一份）：AI 按交接说明的规则自行补的做法，**全部阶段做完后统一请维护者过目**，不同意的再改。
- 标 **待拍板** 的：设计稿自相矛盾、必须维护者选一个的，同样留到最后一起定；①–㊱ 汇总成一张表在 [pending-decisions.md](./pending-decisions.md)。

## 已定的事

- 零件：Reka UI + 自写 `Pn*` 组件 + scoped CSS，不用 Tailwind / shadcn-vue（理由见 tech-stack 第 2 节）。
- 分支 `feat/redesign`，每阶段门禁全绿就提交，不 push。
- 图床配置沿用两层字段，不迁移：`availableServices` = 已添加，`enabledServices` = 启用 = 首页「上传到」勾选的那些。「已添加」= 在 `availableServices` 里，并且免配置或已填凭证。
- 「复制」可固定某个图床；固定的图床失败时退回「最先完成」（设计未画，按最接近的规则补）。上传与复制的完整规则见 [upload-flow.md](../../flows/upload-flow.md) 图 1 与「重试」不变量 4。
- 新配置字段只加不改、有默认值：复制固定图床（`linkOutput.copyFromService`）、文档文件夹、自动检测（默认每 7 天）。渐进提示「只出现一次」记在本机 localStorage（`picnexus-hint-fast-upload`），不进配置。
- 通知：最多叠 3 条时先挤掉最旧的普通通知，带「撤销」倒计时的尽量留着（免得来不及撤销就生效），到时间才执行的从不挤；确认框排队，一次只显示一个。
- 侧栏：窗口窄于 1000px 强制收成图标栏且不给「展开」（展开后内容区只剩 592px，会横向滚动）；宽窗口下 `Ctrl+\` 手动收起，记在本机 localStorage，不进配置、不随云同步。
- 图床的连接、凭证、启用只在图床页（`src/views/hosts/`）；设置页没有图床分组，从不写图床配置。
- 拖入与 `Ctrl+V` / `⌘V` 是全局上传入口，任何页面都接（输入框内、弹窗打开时不接）。
- 传输中心按任务分组：上传、补充备份、链接检测，没有的组不出现。
- 启动还原备份配置时点「跳过，使用默认配置」：把加密的 `.settings.dat` 原样另存为数据文件夹里的 `picnexus-encrypted-settings-年月日-时分秒.json`（核对一字不差后才删原文件），以默认配置启动；之后可在 设置 › 备份与同步 ›「从文件导入…」输入备份密码还原。不覆盖、不删除加密配置。
- 视觉基准：新界面在 `tests/redesign/`，跑真应用 + `tests/e2e/mocks` 的原生接口模拟（配置、历史、上传结果都在页面加载前写进去），每页一份 `*.visual.spec.ts`，图名前缀是画板编号；1400×900 与 800×600、浅深各一套。每张图截图前先量一遍验收规则（`designRules.ts`）。`npm run test:visual:update` 重录。

## 设计没画、开发时补的

AI 按交接说明的规则自行补的做法，每页一份，全部阶段做完后统一请维护者过目：

| 页面 | 文件 |
|---|---|
| 首页·快传 | [decisions/home.md](./decisions/home.md) |
| 图库 | [decisions/gallery.md](./decisions/gallery.md) |
| 链接健康 | [decisions/health.md](./decisions/health.md) |
| 图床 | [decisions/hosts.md](./decisions/hosts.md) |
| 设置 | [decisions/settings.md](./decisions/settings.md) |
| 托盘 | [decisions/tray.md](./decisions/tray.md) |
| 引导·弹窗 | [decisions/onboarding.md](./decisions/onboarding.md) |
| 动效 | [decisions/motion.md](./decisions/motion.md) |

## 按交接说明去掉的旧功能

- 补充备份：来源图床 / 上传时间 / 备份份数筛选、「只补已经坏了一份的」、永久跳过、导出报告。范围固定为「仅有 1 份的图片」，只选目标图床。
- 文档修复：「包含子文件夹 / 代码块」选项、逐行换替换来源、「以后优先用 X」。改为固定的文档文件夹 + 自动选响应最快的备份。
- 上传队列与「清空已完成」：改为焦点卡 +「最近上传」。
- 托盘网页浮窗：改为系统原生菜单。浮窗里的「历史记录」「切换到深色 / 浅色」不进新菜单（托盘不放历史；主题在 设置 › 通用）。

## 实施阶段

| 阶段 | 内容 | 画板 | 状态 |
|---|---|---|---|
| 0 准备 | 设计包入库、令牌、`data-theme` / `data-platform`、依赖 | Foundations | 已完成 |
| 1 外壳 | 侧栏 / 图标栏、标题栏与窗口按钮、路由 | H17 K01 | 已完成 |
| 2 基础件 | Pn 控件、PnToaster / PnConfirmHost（接在 useToast / useUndoToast / useConfirm 下面，调用方式不变）、HostIcon、PetalGlyph、BgDecor、CopyButton、LinkBlock | Controls Patterns PetalScale HostIcons BgDecor N01 | 已完成 |
| 3 首页·快传 | 焦点卡、最近上传、批量、三个浮层、URL 下载、渐进提示、第一次使用、全局拖放与粘贴、命令面板、传输中心 | H01–H21 HB1–3 | 已完成 |
| 4 图库 | 网格 / 列表、筛选、多选、详情、灯箱、刻度条、空与加载、读屏与键盘 | G01–G13 K02 K03 K07 | 已完成 |
| 5 链接健康 | 状态栏、上传日历、工具卡、失效清单、两个弹窗、自动检测 | L01–L18 K04 K08 | 已完成 |
| 6 图床 | 双栏、接入表单、目录、测试连接、敏感字段、窄窗口、Cookie 小窗 | P01–P16 K09 | 已完成 |
| 7 设置 | 7 个分组、快捷键录制、云同步、更新卡片、自动上传剪贴板 | S01–S21 K05 K10 | 已完成 |
| 8 托盘 | 原生菜单、托盘图标进度 | T01–T08 K11 | 已完成 |
| 9 引导·弹窗 | 新手引导、备份密码弹窗、启动还原 | O01–O03 D01–D05 | 已完成（D01–D05 弹窗随阶段 7 做完，本阶段在真应用里核对 D01 D02） |
| 10 动效 | ③ 逐片点亮、⑥ 完成绽放、⑦ 拖入感应；其余五个的去留见 [decisions/motion.md](./decisions/motion.md) | M01–M08 | 已完成 |
| 11 收尾 | 卸载 PrimeVue、删旧主题、改写 `docs/design/*.md` 与相关 flows、跑验收清单 | 全部 | 已完成（验收结果见下一节；等维护者亲手验收） |

## 验收清单（交接说明第 14 节）

2026-10-19 逐条跑过。「自动」= 写成了测试或 lint 门禁，每条都先看到它在改坏的代码上报错一次；截图前的检查随 366 张基准图各跑一次（宽 1400×900 与窄 800×600、浅深各一半）。

| # | 条目 | 结果 | 怎么验的 |
|---|---|---|---|
| 1 | 六种组合下每页与画板一致 | Windows 浅 / 深：跑过且通过；macOS / Linux：没跑 | 截图基准 366 张逐张对过画板；Windows 真机五页 × 浅深看过。本机没有 macOS / Linux，WebKit 只在 e2e 里跑主要流程、不比画面 |
| 2 | 800×600 无横向滚动；< 1000px 侧栏 56 | 跑过且通过（自动） | `designRules.ts`：整页与每个可滚动容器都不横向溢出、图标栏宽 56；真机 915 宽五页 × 浅深 |
| 3 | 字号只用 20 / 17 / 15 / 13 / 12 / 11，字重只用 400 / 500 / 600 | 跑过且通过（自动） | 截图前量画出来的值 + `check-type-scale.mjs` 查令牌与源码；例外：花瓣角标 9、日历星期 10、图床图标里的两个字 |
| 4 | 正常状态无绿点；问题只用琥珀；失败才用红 | 绿点：跑过且通过（自动）；颜色分工：人工看过，冲突列为待拍板 ⑧ ㉜ | 绿色小圆点只许出现在通知 ✓ 与 P07 测试结果 |
| 5 | 每页最多一个主按钮 | 跑过且通过（自动） | 页面与每个弹窗分别数 |
| 6 | 弹窗宽 520、圆角 16、居中、按钮高 34 | 跑过且通过（自动） | 量每个 `.pn-dialog`；压缩预览是整窗查看器（待拍板 ㉗），引导与命令面板各有 decisions |
| 7 | 「改用备份」「修复」不弹确认、通知带撤销；危险操作才确认 | 跑过且通过 | 单测：修复（`useHealthRepair`）、改用（`useGalleryActions`）、撤销各轮互不顶替（`useUndoToast`）；确认框只给不可逆操作（`tone: 'danger'`） |
| 8 | 日历一格一天、一次一年、6 年 +「更早」、默认年份、失效清单不受年份影响、点某天筛选可移除 | 跑过且通过 | 单测 `healthCalendar` / `healthModel`、e2e `health`、截图 L 系列 |
| 9 | 多选缩到 86%、不外扩；刻度条毛玻璃、自动淡出 | 跑过且通过（截图与 e2e）；「淡出」只验了出现，没单独验消失 | 截图 G04、e2e `gallery-keyboard`（刻度条聚焦时出现） |
| 10 | 托盘是原生菜单，文案与设置页同名 | 跑过且通过（结构与文案）；外观：阶段 8 真机看过 | e2e `tray` 查菜单结构与「同一份配置」；同名冲突列为待拍板 ㉒ |
| 11 | 文案逐字一致；数字与单位间空格；快捷键写法按平台 | 部分：抽查与各阶段截图对过；没有逐字自动比对 | 设计稿文案藏在源文件模板里，逐字比对写不成可靠的门禁；冲突列为待拍板 |
| 12 | 「减少动态效果」时无位移、花瓣不闪 | 跑过且通过（自动） | e2e `motion`（Chromium + WebKit）：花瓣、Logo、拖入遮罩不动，共用转圈停住；「位移改淡入」见待拍板 ㉞ |

## 平台限制记录

- **侧栏材质**：不用 Mica / 毛玻璃，三平台都用令牌里的纯色侧栏（浅色 Windows `#F3F3F3` / macOS `#ECECEC` / Linux `#F4F4F4`，深色 `#151517`）。理由：Mica 只在 Windows 11 生效，需要整窗透明，Windows 10 上会露底；开发机是 Windows 10，macOS 无真机，都没法验证。
- **macOS 红绿灯**：`tauri.macos.conf.json` 设 `titleBarStyle: Overlay`、`trafficLightPosition {18, 20}`，没有在 macOS 真机上看过位置；收起成图标栏时 Logo 行留空给红绿灯。
- **Windows 关闭键悬停**：沿用系统外观（红底白叉 `#C42B1C`），设计稿没画悬停态。
- **Cookie 登录小窗**：macOS 上窗口用 Overlay 标题栏 + 系统红绿灯（`cookie_login.rs`），红绿灯用默认位置（窗口构建接口没有设位置的方法）、标题让出左 80；没有 macOS 真机，未编译、未看过。
- **托盘菜单点完即关**：三个平台的系统菜单点任何一项都会关（Windows 是模态菜单 `TrackPopupMenu`，macOS / GTK 同理），「上传到」做不到「勾选后菜单不关、方便连选」。退而求其次：点一项菜单就关，下次打开时勾选已更新。
- **原生菜单画不了的**：右侧灰字（Windows 放在菜单右列，颜色与正文相同；macOS / Linux 菜单没有右列，写成「上传到 · 3 个图床」）、「复制为」格式样子的等宽字（用菜单字体）、「上传到」的琥珀小点（写成「⚠」）、状态行的细进度条（不画，托盘图标的花瓣已在显示进度）。macOS 的强调色整行高亮、行高由系统决定。
- **状态行整行发灰**：不可点的菜单项连图标一起被系统画灰（Windows 真机已见；macOS / Linux 推断同样），状态行前的彩色小花瓣看不出颜色；改成可点会有悬停高亮、像能点，所以保持不可点。
- **Windows 默认项加粗**：Tauri 没有接口，由 Rust 拿到菜单句柄调用系统的 `SetMenuDefaultItem` 实现（Windows 真机已看到加粗）。
- **托盘图标**：运行时重画（逐片点亮、变淡）三平台都用 `TrayIcon.setIcon`；macOS 用模板图，系统按菜单栏深浅上色，没有 macOS 真机，未看过。Linux 读不到面板颜色，固定白色，浅色面板（如部分 KDE 主题）上会看不清。
- **Linux 托盘没有点击和悬停事件**（系统托盘接口不提供）：点图标只能弹菜单，「剪贴板无图片」没法在打开菜单前刷新，第一项一直可点，没图片时由系统通知说明。
- （待实测：WebKit 毛玻璃。）
