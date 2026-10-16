# 全部状态索引

> 由画布 canvas.json 自动生成。每一行 = 画布上的一张状态图。「组件 + 参数」说明它由哪个源组件、以什么参数渲染——开发时按「组件」实现一次，用参数覆盖全部状态。

## 原型 · 核心流程

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| 原型 · 拖入上传 → 已复制 → 搜索旧图 → 改用备份 → 撤销 | `Prototype.dc.html` | 1400×980 | `（独立组件）` |  |

## 设计系统

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| 基础 · 浅色 | `Foundations.dc.html` | 1400×1480 | `（独立组件）` |  |
| 基础 · 深色 | `FoundationsDark.dc.html` | 1400×1480 | `Foundations theme="dark"` |  |
| 基础控件 · 浅色 | `Controls.dc.html` | 1400×1660 | `（独立组件）` |  |
| 基础控件 · 深色 | `ControlsDark.dc.html` | 1400×1660 | `Controls theme="dark"` |  |
| 反馈与业务组件 · 浅色 | `Patterns.dc.html` | 1400×1940 | `（独立组件）` |  |
| 反馈与业务组件 · 深色 | `PatternsDark.dc.html` | 1400×1940 | `Patterns theme="dark"` |  |
| 应用图标与品牌色 | `BrandIcon.dc.html` | 1400×820 | `（独立组件）` |  |
| 图床图标规范 | `HostIcons.dc.html` | 1400×760 | `（独立组件）` |  |
| HostIcon 组件 | `HostIcon.dc.html` | 40×40 | `（独立组件）` |  |
| 花瓣与图床数量 | `PetalScale.dc.html` | 1400×700 | `（独立组件）` |  |
| BgDecor 背景装饰组件（首页 + 空白状态共用） | `BgDecor.dc.html` | 1192×900 | `（独立组件）` |  |
| 加载状态规则 | `LoadingRules.dc.html` | 1400×660 | `（独立组件）` |  |

## Logo 动效

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| ① 光粒子汇聚 · 启动 | `M01-Converge.dc.html` | 360×420 | `（独立组件）` |  |
| ② 流光描边 · 检测中 | `M02-Trace.dc.html` | 360×420 | `（独立组件）` |  |
| ③ 花瓣逐片点亮 · 上传进度 | `M03-Progress.dc.html` | 360×420 | `（独立组件）` |  |
| ④ 分发粒子 · 多图床上传 | `M04-Dispatch.dc.html` | 360×420 | `（独立组件）` |  |
| ⑤ 呼吸光晕 · 后台任务 | `M05-Breathe.dc.html` | 360×420 | `（独立组件）` |  |
| ⑥ 完成绽放 · 已复制 | `M06-Done.dc.html` | 360×420 | `（独立组件）` |  |
| ⑦ 拖入感应 | `M07-Receive.dc.html` | 360×420 | `（独立组件）` |  |
| ⑧ 修复替换 · 改用备份 | `M08-Repair.dc.html` | 360×420 | `（独立组件）` |  |

## 外壳 + 首页·快传

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| H01 · 第一次使用 | `H01-FirstUse.dc.html` | 1400×900 | `HomeScreen state="firstUse"` | 没有任何记录时，投放区放大居中，下面三条说明告诉你还能怎么传。拖入 / 粘贴 / 选择文件任一方式开始上传；第一张传完后切换成常规布局。底部「更改」打开「上传到 / 复制为」。「最近上传」不出现。 |
| H02 · 没有可用的图床 | `H02-NoHost.dc.html` | 1400×900 | `HomeScreen state="noHost"` | 点「启用京东图床」→ 弹公共图床风险确认 → 确认后加入上传组合，回到常规布局。「去连接其他图床」跳到图床页的未连接分组。这时拖入图片：遮罩写「先启用一个图床」，不上传。 |
| H03 · 上传中（单张） | `H03-Uploading.dc.html` | 1400×900 | `HomeScreen state="uploading"` | 焦点卡显示刚拖入的图，花瓣逐个点亮。第一个图床传完 → 链接出现、自动复制，卡片变成「已复制」。上传期间离开首页，进度在标题栏传输图标里继续。 |
| H04 · 全部成功 · 已复制 | `H04-JustCopied.dc.html` | 1400×900 | `HomeScreen state="justCopied"` | 「已复制 · Markdown」既告诉你剪贴板里是什么，也是格式开关：点它换个格式再复制。点预览图在图库里查看。花瓣不再配文字，悬停才说是哪几个图床。下一张上传后，这张收进下面的列表。 |
| H19 · 第一次使用 · 上传到（选两个互为备份） | `H19-FirstUsePick.dc.html` | 1400×900 | `HomeScreen state="firstUsePick"` | 第一次使用：同一个面板，只有京东（已选）和七鱼两个免配置图床，点一下就能加上七鱼做备份。连接其他图床走右下角「管理图床」。 |
| H05 · 部分失败 | `H05-Partial.dc.html` | 1400×900 | `HomeScreen state="partial"` | 链接照常来自最先成功的图床，已经复制好。失败的图床花瓣变红，下面一行写原因 + 两个下一步。「重新登录」打开 Cookie 登录窗口，登录成功后自动重试这张的微博。 |
| H06 · 全部失败 | `H06-AllFailed.dc.html` | 1400×900 | `HomeScreen state="allFailed"` | 所有图床都没传上：不显示链接，并明说剪贴板没有变。「重试」原样再传；「换个图床」打开上传到浮层，只对这一张生效。 |
| H07 · 拖放悬停 | `H07-DragOver.dc.html` | 1400×900 | `HomeScreen state="dragOver"` | 图片拖进窗口任何一页都会出现，侧栏保持可见，表示「还在当前页」。夹带的非图片文件提前说明会被跳过。在「文档修复」页拖入 .md 时，文案换成「松开开始检查文档」。Esc 或拖出窗口即取消。 |
| H08 · 一次传 30 张 · 上传中 | `H08-BatchUploading.dc.html` | 1400×900 | `HomeScreen state="batchUploading"` | 每张一块缩略图：已完成正常显示，上传中有进度环，等待中变灰；同时传 3 张。整批结束前不动剪贴板。某个图床整批失败（微博）只说一行。 |
| 背景 · 深色 · 极光 | `HB2-AuroraDark.dc.html` | 1400×900 | `HomeScreen state="justCopied"` |  |
| H20 · 多图床时怎么复制 | `CopyMulti.dc.html` | 1400×800 | `（独立组件）` |  |
| H21 · 上传到 · 已连接十几个图床时 | `H21-MenuUploadToMany.dc.html` | 1400×900 | `HomeScreen state="menuUploadToMany"` | 图床很多时（16 个）还是同一套标签，自动换行排成一片： ① 已选的自动排在最前面（面板打开期间不跳动，下次打开再排序），不需要拖动——复制的是最先完成的链接，顺序不影响结果。 ② 超过 6 个时顶部出现搜索框；标签区高度固定，内部滚动，底部渐隐。 ③ 标题旁写「已选 4 / 16」。 |
| 背景 · 深色 · 极光（第一次使用） | `HB3-AuroraFirstUse.dc.html` | 1400×900 | `HomeScreen state="firstUse"` |  |
| H09 · 30 张传完 · 部分失败 | `H09-BatchDone.dc.html` | 1400×900 | `HomeScreen state="batchDone"` | 一次复制全部成功的链接，每行一个、按拖入顺序。失败的块标红，悬停看原因；「重试这 2 张」只重传失败的。点任意一块 = 复制那一张。 |
| H10 · 从 URL 下载 | `H10-UrlDialog.dc.html` | 1400×900 | `HomeScreen state="urlDialog"` | 从投放区或命令面板打开。与其他对话框同一规格：垂直居中、宽 520、左侧 40px 图标块、标题 17px、按钮高 34。实时显示识别到几个地址；提交后不是图片的地址逐行标红「这个地址不是图片」。下载中按钮变「正在下载…」，下载完照常上传。 |
| H11 · 「上传到」展开 | `H11-MenuUploadTo.dc.html` | 1400×900 | `HomeScreen state="menuUploadTo"` | 上传到：图床做成一排轻量标签，点一下勾选、再点取消，可多选。 已选的标签浅蓝底、蓝字、带小对勾；未选的浅灰底、灰字。没有边框、没有大卡片，整体很轻。 异常的图床在名称后面加一个琥珀小点，下方一行写清原因并给「重新登录」。 底部一行：左边「复制 最先完成的链接 ▾」（可改为固定某个图床），右边「管理图床 ›」。 |
| H12 · 「复制为」展开 | `H12-MenuCopyAs.dc.html` | 1400×900 | `HomeScreen state="menuCopyAs"` | 只列格式名称：URL、Markdown、HTML、BBCode、自定义，当前选中的打勾；底部「编辑自定义模板…」。每种格式的具体样子在设置页看，菜单里不重复。选中 = 改默认格式，并按新格式重新复制焦点卡的链接（标签同步变成「已复制 · HTML」）。 |
| 背景 · 浅色 · 花瓣 | `HB1-PetalsLight.dc.html` | 1400×900 | `HomeScreen state="justCopied"` |  |
| H13 · 「压缩」展开 | `H13-MenuCompress.dc.html` | 1400×900 | `HomeScreen state="menuCompress"` | 方案名 + 一行参数。「关」= 原图上传。「压缩设置与预览…」跳到 设置 › 上传与链接 › 图片压缩。 |
| H14 · 传输中心 | `H14-Transfer.dc.html` | 1400×900 | `HomeScreen state="transfer"` | 从标题栏传输图标打开。上传 / 补充备份 / 链接检测分组显示，没有的组不出现。盖在内容上方、不挤压布局；点外面或 Esc 关闭。完成的任务保留到手动清除或退出应用。 |
| H15 · 命令面板 · 空输入 | `H15-CmdEmpty.dc.html` | 1400×900 | `HomeScreen state="cmdEmpty"` | Ctrl K（macOS ⌘ K）打开。空输入时给最近 3 张、常用跳转和动作，右侧是各自的快捷键。↑↓ 选择，Enter 执行。 |
| H16 · 命令面板 · 输入「架构」 | `H16-CmdSearch.dc.html` | 1400×900 | `HomeScreen state="cmdSearch"` | 按文件名实时匹配，命中的字用蓝色。图片：Enter 复制链接（面板不关，行内显示「已复制」），Ctrl Enter 在图库中定位。设置项：Enter 跳到那一项并高亮 1 秒。 |
| H17 · 外壳 · 侧栏收起 | `H17-CollapsedNav.dc.html` | 1400×900 | `HomeScreen state="justCopied"` | 窗口窄于 1000px 自动收起，也可以按 Ctrl \ 手动收起。收起后宽 56，悬停图标出名字气泡；当前页图标用蓝色。 |
| H18 · 渐进提示：第一次点「选择文件」之后 | `H18-Hint.dc.html` | 1400×900 | `HomeScreen state="hint"` | 不在界面上常驻解释快捷键，而是在用户第一次用了慢的方法（点按钮选文件）之后，轻轻告诉他更快的路。只出现一次，点「知道了」或 8 秒后消失；以后在命令面板里随时能查。 |
| 源组件 · HomeScreen（所有状态由这里驱动） | `HomeScreen.dc.html` | 1400×900 | `（独立组件）` |  |

## 图库

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| G01 · 网格（默认） | `G01-Grid.dc.html` | 1400×900 | `GalleryScreen state="grid"` | 按天分组、等高行、宽度按原比例，截图不裁切。日期标题滚动时吸顶。悬停：左上选择框、右上收藏、左下花瓣（几份备份、好不好）、右下「复制」= 复制这张图的链接（当前格式）。常驻角标只在需要注意时出现：⚠ 失效 / ⚠ 可能受限 / 仅 1 份（深色半透明小牌，不用大红块）。单击 → 右侧详情；双击或空格 → 灯箱；方向键移动。右侧刻度条是一块毛玻璃（半透明 + 背景虚化），浮在图片右缘上，图片照常铺满宽度；滚动或鼠标靠近右缘时出现，停止 1.5 秒后淡出。拖动快速跳到年月，悬停出同样毛玻璃的「2026 年 10 月」。 |
| G02 · 列表视图 | `G02-List.dc.html` | 1400×900 | `GalleryScreen state="list"` | 适合找文件名和比时间。列：缩略图 · 文件名 · 图床（花瓣 + 名称）· 尺寸与大小 · 上传时间 · 状态 · 操作。「状态」列平时是空的，只有出问题才写「⚠ 失效」。点表头排序。行高 54，虚拟滚动。 |
| G03 · 筛选生效 | `G03-Filtered.dc.html` | 1400×900 | `GalleryScreen state="filtered"` | 筛选条件显示成可单独移除的小标签，末尾「清除全部」。生效的筛选按钮变成实底并写出取值（「图床 · 微博」）。右上角从「共 12,483 张」变成「找到 4 张」。 |
| G04 · 多选 12 张 | `G04-MultiSelect.dc.html` | 1400×900 | `GalleryScreen state="multiSelect"` | 进入多选：点选择框、Ctrl/⌘ 单击、Shift 连选、Ctrl/⌘ A 全选当前结果。底部浮出操作条。选中的图参考相册的做法：在自己的格子里缩小到 86%，露出浅蓝底，左上角蓝色圆形对勾，隐藏健康角标；不向外扩边，不会压到相邻的图。未选中的图在多选时常驻一个空心圆圈，提示可以点选。复制回执「已复制 12 张」；有跳过时写「已复制 10 张（2 张没有可用链接）」。移除记录先确认，完成后通知带「撤销」。Esc 取消选择。 |
| G05 · 详情 · 一切正常 | `G05-DetailOk.dc.html` | 1400×900 | `GalleryScreen state="detailOk"` | 单击图片打开，宽 340，可关闭（Esc）。从上到下只有用户关心的三件事：这张图长什么样 → 链接（一键复制）→ 存放在哪几个图床。每个图床一行，正常时只写名字和「复制」，不打绿点；复制时使用的那一个写「复制时使用」；失效的写琥珀色「⚠ 图片已不存在」。出问题时顶部一条琥珀色提示 + 「改用京东」。「补充备份到…」列出还没有这张图的图床。 |
| G06 · 详情 · 当前链接失效、有可用备份 | `G06-DetailBroken.dc.html` | 1400×900 | `GalleryScreen state="detailBroken"` | 顶部一条琥珀色提示直接给结论和唯一的主按钮「改用京东」。点了立刻生效，不弹确认；通知「已改用备份」带「撤销」。改完链接块变成京东的地址，提示消失。 |
| G07 · 详情 · 全部失效 | `G07-DetailDead.dc.html` | 1400×900 | `GalleryScreen state="detailDead"` | 所有链接均已失效：说清楚、给下一步（本地有原图可重新上传；文档中的引用用「文档修复」定位）。「移除记录」只放在底部，避免误点。 |
| G08 · 全屏灯箱 · 这次没加载出来 | `G08-Lightbox.dc.html` | 1400×900 | `GalleryScreen state="lightbox"` | 双击或空格打开，从缩略图位置连续放大；Esc 缩回原位。← → 切换，滚轮缩放、拖动平移。当前图床加载失败时顶部提示 + 「换个图床」菜单，各备份带状态，Enter 切到选中的那份。底栏：复制链接、在浏览器打开、收藏、移除记录、信息（I，展开备份区）。 |
| G09 · 一张图都没有 | `G09-Empty.dc.html` | 1400×900 | `GalleryScreen state="empty"` | 页面级空状态，带首页同款背景装饰。「前往快传」回到首页；拖图进来照常上传，不用先点按钮。 |
| G10 · 搜索 / 筛选没有结果 | `G10-NoResults.dc.html` | 1400×900 | `GalleryScreen state="noResults"` | 保留筛选标签，让人看清是哪个条件筛空了。「清除筛选」一键恢复。 |
| G11 · 收藏为空 | `G11-FavEmpty.dc.html` | 1400×900 | `GalleryScreen state="favEmpty"` | 紧凑说明怎么收藏，不放按钮（收藏只能在图片上操作）。 |
| G12 · 冷启动加载（超过 300ms 才出现骨架屏） | `G12-Loading.dc.html` | 1400×900 | `GalleryScreen state="loading"` | 按真实的「日期标题 + 等高行」排骨架；快速拖动刻度条时，未加载的日期组先显示骨架，停下后补齐。缩略图加载失败先自动换其他备份的地址，都失败才显示「图片加载失败」占位。 |
| 源组件 · GalleryScreen（所有状态由这里驱动） | `GalleryScreen.dc.html` | 1400×900 | `（独立组件）` |  |
| G13 · 不同比例图片的显示规则 | `ImageRatios.dc.html` | 1400×860 | `（独立组件）` |  |

## 链接健康

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| L01 · 尚未检测 | `L01-NeverChecked.dc.html` | 1400×900 | `HealthScreen state="neverChecked"` | 尚未检测：状态栏「尚未检测 · 共 12,483 张图片」+「开始检测」。上传日历照样显示今年每天的上传量（没有琥珀色）；三张工具卡：文档修复「添加文件夹…」、补充备份 1,206 张、自动检测「开启」。 |
| L02 · 检测中 | `L02-Checking.dc.html` | 1400×900 | `HealthScreen state="checking"` | 检测中：状态栏转圈 +「1,024 / 3,500 · 等待微博响应」+ 细进度条 +「暂停」。已发现的失效边查边出现在日历（琥珀格）和下面「已发现的失效图片」里。 |
| L03 · 已暂停 | `L03-Paused.dc.html` | 1400×900 | `HealthScreen state="paused"` | 已暂停：状态栏换成暂停符号，进度条变灰，按钮「取消 / 继续」。 |
| L04 · 有失效图片 | `L04-Problems.dc.html` | 1400×900 | `HealthScreen state="problems"` | 主状态。状态栏：琥珀点「21 张图片失效」+ 一句说明，右边「重新检测」「修复 15 张」（全页唯一主按钮，不弹确认，通知带撤销）。日历默认选中最近一个有失效的年份（2023），年份按钮旁的琥珀数字是该年失效张数。下面三张工具卡，再下面「全部失效图片 21 张」——不受日历年份影响，分「可改用备份 / 无可用备份」。 |
| L05 · 行「⋯」菜单 | `L05-RowMenu.dc.html` | 1400×900 | `HealthScreen state="rowMenu"` | 行「⋯」菜单（无备份的图）：重新检测、重新上传原图、在图库中查看、在浏览器打开；「移除失效链接…」会再确认一次。 |
| L06 · 状态栏「⋯」菜单 | `L06-CardMenu.dc.html` | 1400×900 | `HealthScreen state="cardMenu"` | 状态栏「⋯」：仅重新检测失效图片、导出结果、自动检测频率；「清理找不回的图片…」只认「图片已不存在」，写出会清几张。 |
| L07 · 按年份筛选 | `L07-YearFilter.dc.html` | 1400×900 | `HealthScreen state="yearFilter"` | 清单右上三个筛选：原因 / 图床 / 年份。年份菜单只列有失效图片的年份并带张数，可选「与上方日历同步」。 |
| L08 · 点日历上的一天 | `L08-DayFilter.dc.html` | 1400×900 | `HealthScreen state="dayFilter"` | 点日历上的一天：那一格加深色外圈，清单筛到当天（2 张），标题旁出现可移除的「2023年5月22日 ×」标签。 |
| L09 · 单行重试 · 仍然失效 | `L09-RetryStill.dc.html` | 1400×900 | `HealthScreen state="retryStill"` | 重试结果没变化时，按钮位置停 2 秒显示「仍然失效」，然后恢复成「重试」。不弹通知。 |
| L10 · 修复中 | `L10-Fixing.dc.html` | 1400×900 | `HealthScreen state="fixing"` | 修复中：状态栏「正在修复 9 / 15 · 同时更新 3 个文档中的旧链接」+ 进度条；清单每行右侧写状态：已改用京东 / 正在修复… / 等待中。 |
| L11 · 修复完成 | `L11-Fixed.dc.html` | 1400×900 | `HealthScreen state="fixed"` | 修复完成：通知「已修复 15 张图片 · 已更新 3 个文档中的 7 处旧链接」+「撤销」。日历上修好的琥珀格变回蓝色，只剩无备份的 6 张；文档修复卡写「3 个文档已更新」。 |
| L12 · 部分文档未能更新 | `L12-FixPartial.dc.html` | 1400×900 | `HealthScreen state="fixPartial"` | 部分失败：成功的照常报；失败的单独一条红色通知，写原因 + 处理办法 +「重试」。 |
| L13 · 全部正常 | `L13-AllGood.dc.html` | 1400×900 | `HealthScreen state="allGood"` | 全部正常：状态栏只写「全部正常 · 12,483 张图片均可访问」，不加对勾或绿色；没有清单。日历选中今年；工具卡：文档修复 97 个文档、补充备份 1,206 张、自动检测每 7 天。 |
| L14 · 文档修复弹窗 | `L14-RepairDialog.dc.html` | 1400×900 | `HealthScreen state="repairDialog"` | 文档修复卡 →「修复文档…」：上面管理文档文件夹，下面列出需要修复的文档和处数，「修复 4 处」不弹二次确认，修改前自动备份、可撤销。 |
| L15 · 补充备份弹窗 | `L15-BackupDialog.dc.html` | 1400×900 | `HealthScreen state="backupDialog"` | 补充备份卡 →「补充备份…」：只问「复制到哪个图床」（单选；登录过期的变淡并说明），范围固定为「仅有 1 份的图片」。 |
| L16 · 补充备份进行中 | `L16-BackupRunning.dc.html` | 1400×900 | `HealthScreen state="backupRunning"` | 进行中：补充备份卡显示「96 / 1,206」+ 细进度条 +「暂停」，传输中心同步显示；离开页面不影响。 |
| L17 · 补充备份完成 | `L17-BackupDone.dc.html` | 1400×900 | `HealthScreen state="backupDone"` | 完成：补充备份卡「已完成 · 每张图片至少保存在 2 个图床」，按钮消失。 |
| L18 · 没有可用的目标图床 | `L18-BackupNoTarget.dc.html` | 1400×900 | `HealthScreen state="backupNoTarget"` | 只有一个可用图床：补充备份卡说明原因，按钮换成「添加图床」。 |
| 源组件 · HealthScreen（所有状态由这里驱动） | `HealthScreen.dc.html` | 1400×900 | `（独立组件）` |  |

## 图床

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| P01 · 京东（免配置）· 总览 | `P01-Jd.dc.html` | 1400×900 | `HostsScreen host="jd"` | 先想清楚：用户点进图床页想干什么？ ① 看看图床都还正常吗——左栏每个图床带状态点，出问题的自动排在最前面，点开顶部就是修复按钮。 ② 接入一个新图床——左栏标题旁的「＋」，右侧换成图床目录。 ③ 偶尔改一个图床的设置——右侧详情：头部（名称 + 状态标签、说明、检测按钮），右侧一个「启用」按钮 + 检测→ 使用情况 → 设置 → 断开连接。 所以：左栏只放已连接的图床，标题「图床」和「＋」在左栏顶部，分隔线从窗口顶部一直到底；右侧内容限宽居中，从上到下填满。使用情况一行：三个数字 + 近 14 天上传总数 + 柱状图，底边对齐，不再单独占一行说明。 左栏不放任何开关，状态靠「样子」表达： · 已启用的图床正常显示；停用的整行变淡，第二行写「已停用」。 · 排序固定：有问题的 → 已启用的 → 停用的。图床再多，一眼也能分清。 · 想快速切换：鼠标停在某一行，右侧才浮出一个小按钮「启用 / 停用」（P01 里「家里 NAS」就是悬停状态）；也可以右键或按空格。 详情页头部只有一个状态按钮：启用时显示浅蓝「✓ 已启用」，点一下停用；停用时显示蓝色实心「启用」，点一下开启。 正常状态不打任何标记——四个图床都正常时，左栏干干净净；只有出问题的那一行，第二行换成琥珀色「⚠ 登录失效」。详情页同理：正常时不显示状态标签，异常或刚检测完才出现。 |
| P02 · 微博（Cookie 登录 · 链接前缀） | `P02-Weibo.dc.html` | 1400×900 | `HostsScreen host="weibo"` | 异常时把修复入口放在最上面：「重新登录」打开 Cookie 登录小窗，登录后自动填好、自动检测。链接前缀是单选模板：每个模板下面直接预览效果；可添加、恢复默认。 |
| P03 · GitHub（Token · CDN 模板） | `P03-Github.dc.html` | 1400×900 | `HostsScreen host="github"` | 未连接的图床：默认只露必填项（标 *），每项下面一行帮助。「去 GitHub 生成」直接打开带好权限的 Token 页面。CDN 模板同样单选 + 可增删。「测试并连接」= 先测，通过才连上。（从「添加图床」目录里点 GitHub 进入这里。） |
| P04 · Cloudflare R2（对象存储 · 缩略图加速） | `P04-R2.dc.html` | 1400×900 | `HostsScreen host="r2"` | 高级选项（自定义路径、地域）收起，摘要写在按钮旁边。缩略图加速开关写明代价：图片地址会发给第三方。 |
| P05 · WebDAV「家里 NAS」（可多份） | `P05-Nas.dc.html` | 1400×900 | `HostsScreen host="nas"` | 用户自己命名，名字旁铅笔可重命名。局域网 HTTP 地址在字段里标「HTTP · 已允许」，悬停说明只对这个地址生效。可删除；WebDAV 和自定义 S3 都能添加多份。 |
| P06 · 测试连接 · 进行中 | `P06-Testing.dc.html` | 1400×900 | `HostsScreen host="r2" test="testing"` | 按钮原地变「正在检测…」并禁用，左栏同步显示「检测中…」。依次测：凭证 → 写入 → 公开访问。 |
| P07 · 测试连接 · 成功 | `P07-TestOk.dc.html` | 1400×900 | `HostsScreen host="r2" test="ok"` | 结果条写清通过了哪几项。不弹通知（结果已经在页面上）。 |
| P08 · 测试连接 · 失败（说清哪一项错） | `P08-TestFail.dc.html` | 1400×900 | `HostsScreen host="r2" test="fail"` | 失败要指到具体字段：那一格变红、下面写原因，顶部结果条说「其他几项都通过了」+ 下一步。左栏这个图床变成「异常」。 |
| P09 · 敏感字段 · 查看明文 | `P09-SecretRevealed.dc.html` | 1400×900 | `HostsScreen host="r2" secret="revealed"` | 默认密文；点「查看」显示明文，30 秒后自动收回。 |
| P10 · 敏感字段 · 原地修改 | `P10-SecretEditing.dc.html` | 1400×900 | `HostsScreen host="r2" secret="editing"` | 点进密文字段即清空等待粘贴新值（旧值不回显）；离开输入框即保存并自动测试一次；「取消」恢复原值。清空某个敏感字段需要确认。 |
| P11 · 公共图床风险确认 | `P11-RiskDialog.dc.html` | 1400×900 | `HostsScreen host="jd" dialog="risk"` | 第一次把公共图床设为「启用」时弹出，按钮写「我已了解并继续」。确认过一次就不再问。 |
| P12 · 明文 HTTP 域名确认 | `P12-HttpDialog.dc.html` | 1400×900 | `HostsScreen host="nas" dialog="http"` | 填入 http:// 地址时弹出，只对这一个地址生效；以后换地址会再问。 |
| P13 · 添加图床（目录） | `P13-AddMenu.dc.html` | 1400×900 | `HostsScreen host="jd"` | 添加图床（点左栏「＋」）：右侧换成图床目录。 顶部：标题 + 关闭、搜索框、接入方式筛选（全部 / 免配置 / 登录 / Token / 对象存储 / 自建）。 按接入方式分组，三列卡片：图标、名称、需要准备什么（如「AccessKey 与空间名」）。鼠标停留的卡片浅蓝描边并出现「连接 ›」。点卡片进入该图床的连接表单（见 P03）。已连接的不出现；底部提示可以用「S3 兼容存储」接入其他对象存储。 |
| P14 · 800×600 · 第一级：清单 | `P14-NarrowList.dc.html` | 800×600 | `HostsScreen host="jd" narrow="list"` | 窗口窄于约 1000px：侧栏收起，清单占满宽度，顶部是「图床」标题、「＋」和窗口按钮。 |
| P15 · 800×600 · 第二级：详情 | `P15-NarrowDetail.dc.html` | 800×600 | `HostsScreen host="r2" narrow="detail"` | 点进某个图床后整页是详情，左上「‹ 图床」返回（也可按 Esc / Alt ←）。字段改为单列也不会出现横向滚动。 |
| P16 · Cookie 登录窗口（独立小窗）· 准备页 | `CookieWindow.dc.html` | 520×600 | `（独立组件）` | 独立窗口：自绘标题栏「登录 微博」+ 关闭（macOS 用系统红绿灯）。点「开始登录」后下方换成微博自己的网页；登录成功窗口自动关闭，主窗口通知「已登录 微博」。超时提示要指向真实存在的按钮。 |
| 源组件 · HostsScreen（所有状态由这里驱动） | `HostsScreen.dc.html` | 1400×900 | `（独立组件）` |  |

## 设置

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| S01 · 通用 | `S01-General.dc.html` | 1400×900 | `SettingsScreen group="general"` | 每一页同一套结构：页标题 + 一句话说明这页管什么 → 分组小标题 → 白底分组卡片（每行 48 高，左名称+一句说明，右控件）→ 卡片下方灰色脚注说清后果。改动即保存，没有「保存」按钮；保存成功只在改动处短暂显示「已保存」。二级栏顶部是「设置」标题（与图床页一致），不再放第二个搜索框——全局搜索 / 命令面板已能搜到每一项设置。 |
| S02 · 上传与链接 | `S02-Upload.dc.html` | 1400×900 | `SettingsScreen group="upload"` | 默认格式和首页「复制为」是同一个设置。自定义模板：点占位符插入，下方实时预览。压缩方案最多 5 个，单选当前方案；「压缩预览…」打开左右对比弹窗。 |
| S03 · 快捷键 | `S03-Shortcut.dc.html` | 1400×900 | `SettingsScreen group="shortcut"` | 全局快捷键可以整体关掉。点组合键按钮进入录制。应用内快捷键只读列出，macOS 自动显示 ⌘。 |
| S04 · 编辑器与命令行 | `S04-Editor.dc.html` | 1400×900 | `SettingsScreen group="editor"` | 三张卡片同一结构：状态 → 要复制的东西 → 用哪些图床。Obsidian 测试结果四种：连接正常 / 端口被占用 / 不是 PicNexus 服务 / 服务未启动。 |
| S05 · 备份与同步 | `S05-Backup.dc.html` | 1400×900 | `SettingsScreen group="backup"` | 用户只关心两件事：现在安全吗？换电脑能不能恢复？所以只有一张「云同步」卡：顶部状态 + 一个「同步」按钮，下面列出同步了哪些内容；危险的「覆盖云端 / 覆盖本地」收进「⋯」。备份密码、手动导出导入、最近操作各自一组。横幅与内容同宽，不再上宽下窄。 |
| S06 · 数据与隐私 | `S06-Privacy.dc.html` | 1400×900 | `SettingsScreen group="privacy"` | 不能撤销的操作单独成组，标题就写「不能撤销」，按钮用红字 + 省略号（会再确认）。 |
| S07 · 关于 · 发现新版本 | `S07-About.dc.html` | 1400×900 | `SettingsScreen group="about"` | 有新版本时：侧栏「设置」和这里的「关于」都只有一个小圆点，不弹窗。更新卡片直接列出这版改了什么。 |
| S08 · 快捷键 · 录制中 | `S08-Recording.dc.html` | 1400×900 | `SettingsScreen group="shortcut" state="recording"` | 按钮变成「按下新的组合键…」并高亮；Esc 取消，Backspace 清除。 |
| S09 · 快捷键 · 冲突 | `S09-Conflict.dc.html` | 1400×900 | `SettingsScreen group="shortcut" state="conflict"` | 冲突时不保存，红框 + 说清被谁占用和下一步。 |
| S10 · 导出配置 · 建议先设置备份密码 | `S10-ExportWarn.dc.html` | 1400×900 | `SettingsScreen group="backup" state="exportWarn"` | 未设置备份密码时点「导出」弹出；推荐的那个（先设置密码）是主按钮，「直接导出」仍然可选。 |
| S11 · 云同步 · 进行中 | `S11-Syncing.dc.html` | 1400×900 | `SettingsScreen group="backup" state="syncing"` | 按钮原地变「同步中」并禁用；状态行说正在做什么。不弹通知。 |
| S12 · 云同步 · 成功 | `S12-SyncOk.dc.html` | 1400×900 | `SettingsScreen group="backup" state="syncOk"` | 结果写在状态行：已同步 · 上传 3 条 · 下载 5 条（或「已是最新」）。不弹通知。 |
| S13 · 云同步 · 失败 | `S13-SyncFail.dc.html` | 1400×900 | `SettingsScreen group="backup" state="syncFail"` | 原因 + 下一步写在状态行；按钮变「重试」。 |
| S14 · 「覆盖本地」确认框 | `S14-OverwriteLocal.dc.html` | 1400×900 | `SettingsScreen group="backup" state="overwriteLocal"` | 必须确认；写清哪边的数据会丢、不能撤销、什么不受影响。危险按钮写动作「覆盖本地」。 |
| S15 · 云端配置下载后的刷新横幅 | `S15-RefreshBanner.dc.html` | 1400×900 | `SettingsScreen group="backup" state="refreshBanner"` | 常驻横幅，放在页标题下方、与内容同宽；直到刷新为止，不会自己消失，也不弹通知。 |
| S16 · 更新 · 检查中 | `S16-UpChecking.dc.html` | 1400×900 | `SettingsScreen group="about" state="upChecking"` |  |
| S17 · 更新 · 已是最新 | `S17-UpLatest.dc.html` | 1400×900 | `SettingsScreen group="about" state="upLatest"` |  |
| S18 · 更新 · 下载中 | `S18-UpDownloading.dc.html` | 1400×900 | `SettingsScreen group="about" state="upDownloading"` | 下载期间照常使用；离开这一页也会继续。 |
| S19 · 更新 · 正在安装 | `S19-UpInstalling.dc.html` | 1400×900 | `SettingsScreen group="about" state="upInstalling"` | 明说应用会自动关闭再重启。 |
| S20 · 更新 · 已安装，重启完成 | `S20-UpInstalled.dc.html` | 1400×900 | `SettingsScreen group="about" state="upInstalled"` | 重启前会等正在进行的上传传完。 |
| S21 · 更新 · 失败 | `S21-UpFailed.dc.html` | 1400×900 | `SettingsScreen group="about" state="upFailed"` | 中文原因 + 「重试」「手动下载」两个下一步。 |
| 源组件 · SettingsScreen | `SettingsScreen.dc.html` | 1400×900 | `（独立组件）` |  |

## 托盘 · 引导 · 弹窗 · 通知

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| T01 · 托盘 · 菜单 | `T01-TrayMenu.dc.html` | 560×600 | `TrayWindow state="menu"` | 点托盘图标就是一个系统菜单（macOS 规范：菜单栏图标点开是菜单，不是浮窗）。以设置为主：上面两条动作，中间「上传到 / 复制为 / 压缩」三项带当前值，下面三个勾选开关，最后打开 / 设置 / 退出。不放图片和历史。Windows 上「打开 PicNexus」加粗，双击图标直接打开主界面。 |
| T02 · 托盘 · 上传中 | `T02-TrayUploading.dc.html` | 560×600 | `TrayWindow state="uploading"` | 上传中：菜单顶部多一条不可点的状态行（花瓣 + 文件名 + 1 / 3 + 细进度条），菜单栏图标的花瓣按图床进度逐片点亮。传完就复制，状态行消失，结果由系统通知告知。 |
| T03 · 托盘 · 上传到（子菜单） | `T03-TrayHosts.dc.html` | 560×600 | `TrayWindow state="hosts"` | 「上传到」是多选：勾选即生效，菜单不关，方便连选。复制的链接默认取最先完成的那个。微博登录失效时，父项右边一个琥珀小点提示「这里有事」，子项标「登录失效」，点击即打开登录窗口。 |
| T04 · 托盘 · 复制为（子菜单） | `T04-TrayFormat.dc.html` | 560×600 | `TrayWindow state="format"` | 「复制为」是单选，每种格式右边用等宽字写出长什么样，不用解释 Markdown 是什么。选完菜单关闭，下一次上传就按新格式复制。 |
| T06 · 托盘 · 剪贴板里没有图片 | `T06-TrayNoClip.dc.html` | 560×600 | `TrayWindow state="noClip"` | 剪贴板无图片：第一项变灰（Apple 的禁用规范），右侧注明原因。 |
| T07 · 托盘 · 关闭全局快捷键 | `T07-TrayPaused.dc.html` | 560×600 | `TrayWindow state="paused"` | 关闭「全局快捷键」（Windows 规范：后台功能要能停用 / 启用，用勾选表示状态）：菜单里的快捷键提示随之消失，托盘图标整体变淡。 |
| T08 · 托盘 · macOS 菜单栏 | `T08-TrayMacHosts.dc.html` | 560×600 | `TrayWindow state="hosts"` | 同一份菜单在 macOS 上：行高 24、强调色整行高亮、快捷键用 ⇧⌘ 符号，位置贴着菜单栏。结构和文案三个平台完全一致，只换系统外观。 |
| 源组件 · TrayWindow | `TrayWindow.dc.html` | 560×600 | `（独立组件）` |  |
| O01 · 新手引导 1 / 3 · 欢迎 | `O01-Welcome.dc.html` | 1400×900 | `Onboarding step="1"` | 一张图讲清产品：一张图片 → 三个图床，其中一份坏了就改用另一份。只有一个按钮「下一步」，左下「跳过」。 |
| O02 · 新手引导 2 / 3 · 选图床 | `O02-PickHost.dc.html` | 1400×900 | `Onboarding step="2"` | 京东默认勾选，勾选同时视为确认公共图床风险说明（文字就写在下面）。其他图床只列分类，告诉用户以后去哪里连。 |
| O03 · 新手引导 3 / 3 · 怎么传 | `O03-HowTo.dc.html` | 1400×900 | `Onboarding step="3"` | 四种上传方式 + 选默认格式（URL / Markdown）。「开始使用」落到首页；可在 设置 › 关于 里重新打开。 |
| D01 · 启动 · 还原备份配置 | `D01-Restore.dc.html` | 1400×900 | `Dialogs kind="restore"` | 所有弹窗统一一套样式：宽 520、圆角 16、内边距 24/28，左侧 40px 图标块（警告琥珀 / 普通品牌蓝），标题 17px，按钮高 34。命令面板同为圆角 16、同一遮罩与阴影。 阻塞弹窗：不选就进不了应用。主按钮「确认恢复」，左侧低调的「跳过，使用默认配置」。 |
| D02 · 启动 · 还原 · 密码不正确 | `D02-RestoreWrong.dc.html` | 1400×900 | `Dialogs kind="restoreWrong"` | 写清剩余次数；次数用完后改成「跳过，使用默认配置」一个选择，并说明加密文件还在原处。 |
| D03 · 备份密码 · 设置 | `D03-PwSet.dc.html` | 1400×900 | `Dialogs kind="pwSet"` | 强度提示四条：至少 8 位、包含数字、大小写字母、特殊符号；满足前两条即可提交，后两条是建议。两次输入不一致或太弱时「设置」禁用。 |
| D04 · 备份密码 · 修改 | `D04-PwChange.dc.html` | 1400×900 | `Dialogs kind="pwChange"` | 写清新旧密码各管哪些文件。 |
| D05 · 备份密码 · 关闭 | `D05-PwOff.dc.html` | 1400×900 | `Dialogs kind="pwOff"` | 写清后果（新导出是明文）和不变的部分（旧备份仍需原密码）；危险按钮写动作「关闭密码」。 |
| N01 · 通知 · 在真实页面里叠放 | `T05-Toasts.dc.html` | 1400×900 | `（独立组件）` | 右下角，最多叠 3 条，新的在最下面；旧的略淡。成功 / 失败 / 警示 / 带「撤销」四种的单独规格、确认框、三种空状态都在「设计系统 › 反馈与业务组件」里；图库页也有三种空状态的实景（G09–G11）。 |
| 源组件 · Onboarding | `Onboarding.dc.html` | 1400×900 | `（独立组件）` |  |
| 源组件 · Dialogs | `Dialogs.dc.html` | 1400×900 | `（独立组件）` |  |

## 检查 · 窄窗口与深色

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| K01 · 首页 · 800×600 | `K01-HomeSmall.dc.html` | 800×600 | `HomeScreen state="justCopied" size="small"` |  |
| K02 · 图库 · 800×600 | `K02-GallerySmall.dc.html` | 800×600 | `GalleryScreen state="grid" size="small"` |  |
| K03 · 图库详情 · 800×600 · macOS | `K03-GalleryDetailSmall.dc.html` | 800×600 | `GalleryScreen state="detailBroken" size="small"` |  |
| K04 · 链接健康 · 800×600 | `K04-HealthSmall.dc.html` | 800×600 | `HealthScreen state="problems" size="small"` |  |
| K05 · 设置 · 800×600 · Linux | `K05-SettingsSmall.dc.html` | 800×600 | `SettingsScreen group="shortcut" state="default" size="small"` |  |
| K06 · 首页 · 深色 | `K06-HomeDark.dc.html` | 1400×900 | `HomeScreen state="justCopied"` |  |
| K07 · 图库详情 · 深色 · macOS | `K07-GalleryDark.dc.html` | 1400×900 | `GalleryScreen state="detailBroken"` |  |
| K08 · 链接健康 · 深色 | `K08-HealthDark.dc.html` | 1400×900 | `HealthScreen state="problems"` |  |
| K09 · 图床 · 深色 · 测试失败 | `K09-HostsDark.dc.html` | 1400×900 | `HostsScreen host="r2" test="fail"` |  |
| K10 · 设置 · 深色 · macOS | `K10-SettingsDark.dc.html` | 1400×900 | `SettingsScreen group="upload" state="default"` |  |
| K11 · 托盘 · 深色 · macOS | `K11-TrayDark.dc.html` | 560×600 | `TrayWindow state="hosts"` |  |

## 首页方向稿（已被新版替代）（已废弃，仅存档）

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| 首页·快传 · 刚传完一张 | `Round2.dc.html` | 1400×900 | `（独立组件）` |  |
| 首页·快传 · 一次传 30 张（上传中） | `BatchUploading.dc.html` | 1400×900 | `（独立组件）` |  |
| 首页·快传 · 30 张传完（部分失败） | `BatchDone.dc.html` | 1400×900 | `（独立组件）` |  |

## 第一轮 · 三个方向（已否决）（已废弃，仅存档）

| 画板 | 文件 | 尺寸 | 组件 + 参数 | 设计说明 |
|---|---|---|---|---|
| A 安静专业 · 首页·快传 | `Main.dc.html` | 1400×900 | `（独立组件）` | A 安静专业 中性灰阶 + 一个靛蓝强调色，只出现在「进行中」和「已复制」两处。最近上传是一张对齐的清单：链接、复制、图床状态各占一列，一眼能比对很多行，最适合每天传几十张截图的人。 代价：图片只是 56px 小缩略图，认图主要靠文件名；辨识度来自克制而不是个性。深色版最好推导，设计系统成本最低。 |
| B 图片优先 · 首页·快传 | `DirectionB.dc.html` | 1400×900 | `（独立组件）` | B 图片优先 界面退到后面，最新一张占大幅预览、链接完整显示在旁边，能当场确认「传对了图」；图床状态叠在缩略图角上，这套卡片语言可以直接搬进图库。 代价：密度低，一屏只看得到 5 组最近上传，失败原因要挤在卡片里；导航只剩图标，第一次用要靠悬停提示。它的本命是深色画廊，浅色下靠暖灰底把图片托出来。 |
| C 原生 Fluent · 首页·快传 | `DirectionC.dc.html` | 1400×900 | `（独立组件）` | C 原生 Fluent 贴近 Windows 11 系统应用：Mica 侧栏、圆角内容层、页面大标题；三个快捷开关做成右侧的设置卡片，微博登录过期用系统式提示条直接给出下一步。对 Windows 主力用户最像「自己电脑上的软件」。 代价：在 macOS / Linux 上像外来者；而且离「灰底白卡片 + 蓝」只差一步，要靠 Mica 质感和标题层级把它拉开。 |
