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
- 「复制」可固定某个图床；固定的图床失败时退回「最先完成」（设计未画，按最接近的规则补）。上传与复制的完整规则见 [upload-flow.md](../../flows/upload-flow.md) 图 1 与「重试」不变量 4。
- 新配置字段只加不改、有默认值：复制固定图床（`linkOutput.copyFromService`）、文档文件夹、自动检测（默认每 7 天）。渐进提示「只出现一次」记在本机 localStorage（`picnexus-hint-fast-upload`），不进配置。
- 通知：最多叠 3 条时先挤掉最旧的普通通知，带「撤销」倒计时的尽量留着（免得来不及撤销就生效）；确认框排队，一次只显示一个。
- 侧栏：窗口窄于 1000px 强制收成图标栏且不给「展开」（展开后内容区只剩 592px，会横向滚动）；宽窗口下 `Ctrl+\` 手动收起，记在本机 localStorage，不进配置、不随云同步。
- 尚未重写的旧页面挂在新外壳里，由外壳代画顶部标题行与窗口按钮（路由 `meta.legacyTitle`）；`/hosts` 过渡期复用 SettingsView 的图床面板（`fixedTab`）。
- 拖入与 `Ctrl+V` / `⌘V` 是全局上传入口，任何页面都接（输入框内、弹窗打开时不接）；过渡期链接健康页不接拖入，留给旧的文档修复接 .md，阶段 5 改回。
- 传输中心现在只有「上传」一组；「备份」「检测」两组随阶段 5 加。
- 视觉基准：新界面在 `tests/redesign/`，跑真应用 + `tests/e2e/mocks` 的原生接口模拟（配置、历史、上传结果都在页面加载前写进去），每页一份 `*.visual.spec.ts`，图名前缀是画板编号；1400×900 与 800×600、浅深各一套。`npm run test:visual:update` 重录。

## 设计没画、开发时补的（首页）

- 上传进行中再拖入或粘贴：提示「请稍候」，不排队（沿用现有行为）。
- 上传失败的说法（交接说明第 9 节「错误 = 原因 + 处理办法」）：认得出的原因用固定说法——网络超时、网络连接中断、登录已过期（Cookie 登录的图床）/ 凭证无效（其余）、文件超出图床大小限制、图床不支持此格式、图床服务异常；认不出的保留原文。整张失败时接处理办法，超时照设计稿写「网络超时。请检查网络后重试。」。代码在 `src/utils/uploadFailureMessage.ts` 的 `describeUploadFailure`。
- 首页在屏时，单张失败与整批结果都不弹通知（卡片上已经画出来）；在别的页面拖入或粘贴时照常弹。
- 焦点卡在第一个图床传完前显示占位图，不做本地预览。
- 焦点卡失败时可「换个图床」只给这一张重传（复用「上传到」浮层的单次模式）。
- 从 URL 下载：不逐行标出无效链接，沿用现有通知（链接无效 / 超过数量上限）。
- 花瓣角标数字用 9px，是字号刻度外的例外（设计稿原值，令牌 `--pn-size-petal-badge-text`）。
- 「最近上传」的「清空」只清这个列表，不删图库记录；上传中不可清空。

## 按交接说明去掉的旧功能

- 补充备份：来源图床 / 上传时间 / 备份份数筛选、「只补已经坏了一份的」、永久跳过、导出报告。范围固定为「仅有 1 份的图片」，只选目标图床。
- 文档修复：「包含子文件夹 / 代码块」选项、逐行换替换来源、「以后优先用 X」。改为固定的文档文件夹 + 自动选响应最快的备份。
- 上传队列与「清空已完成」：改为焦点卡 +「最近上传」。
- 托盘网页浮窗：改为系统原生菜单。

## 实施阶段

| 阶段 | 内容 | 画板 | 状态 |
|---|---|---|---|
| 0 准备 | 设计包入库、令牌、`data-theme` / `data-platform`、依赖 | Foundations | 已完成 |
| 1 外壳 | 侧栏 / 图标栏、标题栏与窗口按钮、路由 | H17 K01 | 已完成 |
| 2 基础件 | Pn 控件、PnToaster / PnConfirmHost（接在 useToast / useUndoToast / useConfirm 下面，调用方式不变）、HostIcon、PetalGlyph、BgDecor、CopyButton、LinkBlock | Controls Patterns PetalScale HostIcons BgDecor N01 | 已完成 |
| 3 首页·快传 | 焦点卡、最近上传、批量、三个浮层、URL 下载、渐进提示、第一次使用、全局拖放与粘贴、命令面板、传输中心 | H01–H21 HB1–3 | 进行中 |
| 4 图库 | 网格 / 列表、筛选、多选、详情、灯箱、刻度条、空与加载 | G01–G13 K02 K03 K07 | 未开始 |
| 5 链接健康 | 状态栏、上传日历、工具卡、失效清单、两个弹窗、自动检测 | L01–L18 K04 K08 | 未开始 |
| 6 图床 | 双栏、接入表单、目录、测试连接、敏感字段、窄窗口、Cookie 小窗 | P01–P16 K09 | 未开始 |
| 7 设置 | 7 个分组、快捷键录制、云同步、更新卡片 | S01–S21 K05 K10 | 未开始 |
| 8 托盘 | 原生菜单、托盘图标进度 | T01–T08 K11 | 未开始 |
| 9 引导·弹窗 | 新手引导、备份密码弹窗、启动还原 | O01–O03 D01–D05 | 未开始 |
| 10 动效 | ③ 逐片点亮、⑥ 完成绽放、⑦ 拖入感应优先 | M01–M08 | 未开始 |
| 11 收尾 | 卸载 PrimeVue、删旧主题、改写 `docs/design/*.md` 与相关 flows、跑验收清单 | 全部 | 未开始 |

## 平台限制记录

- **侧栏材质**：不用 Mica / 毛玻璃，三平台都用令牌里的纯色侧栏（浅色 Windows `#F3F3F3` / macOS `#ECECEC` / Linux `#F4F4F4`，深色 `#151517`）。理由：Mica 只在 Windows 11 生效，需要整窗透明，Windows 10 上会露底；开发机是 Windows 10，macOS 无真机，都没法验证。
- **macOS 红绿灯**：`tauri.macos.conf.json` 设 `titleBarStyle: Overlay`、`trafficLightPosition {18, 20}`，没有在 macOS 真机上看过位置；收起成图标栏时 Logo 行留空给红绿灯。
- **Windows 关闭键悬停**：沿用系统外观（红底白叉 `#C42B1C`），设计稿没画悬停态。
- （待实测：原生托盘菜单能否勾选后不关、Windows 默认项加粗、WebKit 毛玻璃。）
