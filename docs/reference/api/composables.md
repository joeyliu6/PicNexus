# Composables API

> 完整 API 签名请直接阅读源文件，以下为导航索引。

---

## 索引

| Composable | 职责 | 源文件 |
|------------|------|--------|
| useConfig | 配置加载/保存/连接测试 | `src/composables/useConfig.ts` |
| useHistory | 历史记录的统计（总数 / 收藏 / 各图床计数 / 年月）、收藏切换、导出、移除记录（`removeRecords`，返回删掉的完整记录）与撤销（`restoreRecords`） | `src/composables/history/useHistory.ts` |
| useUpload | 上传流程编排 | `src/composables/upload/useUpload.ts` |
| useUploadController | 首页、托盘、全局快捷键共用的上传入口（单例）：上传会话、「上传到」图床列表、复制格式与固定图床、压缩、重试。`pickAndUpload({ showHint })` 只在首页按钮选文件时出「更快的方法」提示；`setFormat(format, { recopy })` 托盘传 `recopy: false`，只改格式不动剪贴板；`applyConfigPatch(patch)` 在最新配置上一次改好几处并重算「上传到」（新手引导用） | `src/composables/upload/useUploadController.ts` |
| useRecentUploads | 首页「最近上传」与命令面板用的最近 8 张，监听 `history-updated` 刷新；`reserve(n)` 让它多读本次会话已在首页显示的 n 张，「更早」不会被一大批新图挤空 | `src/composables/history/useRecentUploads.ts` |
| useCookieLogin | Cookie 登录小窗：登录成功后保存 Cookie 并回调（上传中「重新登录…」也走这里） | `src/composables/useCookieLogin.ts` |
| useOnboarding | 新手引导状态（单例）：启动时没完成过引导就弹（`checkAndShow`），设置 › 关于重新打开（`reopen`）；第几步、勾了哪些免配置图床与格式；`finish` 一次写入并返回是否成功，`skip` 只记已完成。步骤规则在 `src/components/onboarding/onboardingModel.ts` | `src/composables/useOnboarding.ts` |
| usePublicRiskConfirm | 第一次启用公共图床前的风险确认（交接说明第 9 节文案） | `src/composables/usePublicRiskConfirm.ts` |
| useConfirmedHttpHosts | 已确认可走明文 HTTP 的图床域名，交给每个 `ThumbnailImage` | `src/composables/image/useConfirmedHttpHosts.ts` |
| useThumbCache | 缩略图缓存管理 | `src/composables/image/useThumbCache.ts` |
| useToast | Toast 通知；主窗口不在屏（隐藏到托盘 / 最小化）时普通通知改发系统通知，带动作的（撤销 / 重试）仍留在应用内 | `src/composables/useToast.ts` |
| `appPresence.ts`（模块） | 主窗口在不在屏：`installAppPresence()` 装在外壳里，焦点 / 尺寸变化与 Rust 的 `main-window-presence-changed` 时重判；前端自己 `show()` / `hide()` 后调 `refreshAppPresence()`；`notifySystem(title, body)` 发系统通知 | `src/composables/appPresence.ts` |
| `installTray`（模块） | 托盘原生菜单与图标（应用级常驻）：从上传控制器推出菜单（`trayMenuModel` / `trayProgress` 纯函数），点了交给控制器或设置页保存入口 | `src/tray/` |
| useTheme | 主题切换 | `src/composables/useTheme.ts` |
| useSettingsConfig | 设置页读写配置的唯一入口：`patch(rowId, mutate)` 读磁盘最新配置、只改这一项、排队保存，成功在那一行闪「已保存」，失败通知并回到磁盘值（从不写图床配置） | `src/views/settings/useSettingsConfig.ts` |
| useSettingsEffects | 要先改系统的设置项：开机自启、关闭到托盘（先改系统、成功才写配置、失败回滚）、统计开关、主题、恢复默认设置 | `src/views/settings/settingsEffects.ts` |
| useShortcutRecorder | 快捷键录制：录制期间暂停全局快捷键、拦住应用内快捷键，判冲突（本应用 / 应用内 / 其他程序占用） | `src/views/settings/useShortcutRecorder.ts` |
| useEditorCards | 编辑器与命令行三张卡：Typora / Obsidian 选图床、端口、探测本机服务、命令行加入 PATH | `src/views/settings/useEditorCards.ts` |
| useCloudSync | 云同步卡状态机（应用级单例）：同步（先配置后记录）、用本机覆盖云端、用云端覆盖本机、加密内容先用本机密钥解再问密码、刷新横幅 `needsReload` | `src/views/settings/useCloudSync.ts` |
| `ConfigSync.ts`（模块） | 配置的 `syncConfig`（拉取合并 → 加密上传）/ `pushConfig` / `pullConfig`；无备份密码时联网前拒绝；`mergeCloudConfig` 留本机同步连接与文档文件夹 | `src/composables/backup-sync/ConfigSync.ts` |
| `HistorySync.ts`（模块） | 上传记录的 `syncHistory`（合并去重后回传）/ `pushHistory`；`describeHistorySync` 生成最近操作里的说法 | `src/composables/backup-sync/HistorySync.ts` |
| `backupFiles.ts` / `backupPassword.ts`（模块） | 手动备份：认出文件是配置还是记录、导出 / 导入；设置 / 修改 / 关闭备份密码 | `src/composables/backup-sync/` |
| `backupSyncUtils.ts`（模块） | WebDAV 建连与远程路径推导（解密密文密码就在这里）；导出 `getWebDAVClientAndPath` / `writeSyncLog` / `extractErrorCode` / `isWebDAVNotFoundError` | `src/composables/backup-sync/backupSyncUtils.ts` |
| useClipboardImage | 剪贴板图片处理：`pasteAndUpload` 有图片传图片，文字是一条图片链接就下载再上传；`clipboardHasUploadable()` 用同一个口径判断有没有东西可传（托盘第一项据此变灰） | `src/composables/upload/useClipboardImage.ts` |
| useConfirm | 确认对话框 | `src/composables/useConfirm.ts` |
| useKeepScroll | 一直开着的页面（KeepAlive）切走再回来停在原处：滚动时记下位置，这一页重新显示时放回去（换了一个元素就作废）。在页面自己的 `onActivated` 之前调用，切回来要去别处时页面自己再滚。图库不用，它按看到的那一张恢复 | `src/composables/useKeepScroll.ts` |
| useQueueState | 上传队列状态 | `src/composables/upload/useQueueState.ts` |
| useVirtualTimeline | 图库网格的虚拟滚动（按天分组的等高行布局）；格子按算出布局的那份分组画（`layoutGroups`），换一份结果用 `showFromTop`（新布局与回到顶部同一帧） | `src/composables/timeline/useVirtualTimeline.ts` |
| useTimelineDayPagination | 图库网格按天读记录：按天统计 + 第一屏那几天（`firstScreenDays`）读好再一起换上，换筛选时读好之前 `isSwitching`、分组仍是旧的；之后按可见天补读；记录有变化（`reloadAll`）时变了的已读天与第一屏新出现的天读好再换上 | `src/composables/timeline/useTimelineDayPagination.ts` |
| useTimelineJump | 图库刻度条跳到某年某月（只给年份时跳这一年最新的月）；跳转中再来的请求只留最后一个，落地后接着跳 | `src/composables/timeline/useTimelineJump.ts` |
| useTimelineLightbox | 图库网格里打开的灯箱：按天翻页（日内快翻 + 跨日按需加载，打开前先把那一天读进来）；当前图与 ±1 预热都过 `safeImageUrl` | `src/composables/timeline/useTimelineLightbox.ts` |
| useListLightbox / useGalleryLightbox | 列表里打开的灯箱按列表眼前的顺序翻页（「3 / 21」是第几行）；`useGalleryLightbox` 按打开的地方在网格（按天 / 失效两组）/ 列表之间选一份，灯箱组件只认它 | `src/views/gallery/` |
| useDeadSections | 图库「状态」只勾「失效」时的两组（有可用备份 / 无可用备份），一次读全；`isDeadOnly` 判断是否进入这种排法 | `src/views/gallery/useDeadSections.ts` |
| useImagePreload | 图库滚动预热下一屏；只预热候选链里第一条通过 `safeImageUrl` 的地址 | `src/composables/timeline/useImagePreload.ts` |
| usePhotoSwipeBridge | PhotoSwipe 灯箱的打开 / 关闭 / 换图，`pswpEl` 供自绘 UI Teleport；`blockKeys` 返回 true 时按键不归灯箱（灯箱里的菜单开着）；长图（高宽比超过 2.5）按窗口宽度从顶部显示、滚轮上下滚动 | `src/composables/history/usePhotoSwipeBridge.ts` |
| useHistoryViewState | 图库多选：Ctrl·⌘ 单击 / Shift 连选；`selectMany(ids)` 只加不减（全选当前结果用 `historyDB.getIdsByFilter` 查出的全部 id） | `src/composables/history/useHistoryViewState.ts` |
| useGalleryGrid / useGalleryList / useGalleryActions | 图库页的网格数据、列表分页、批量与单张操作（复制、补充备份、重新检测、移除记录、改用备份的通知）；列表换筛选 / 排序、记录有变化时读好再整份换上（`isSwitching` / `total`，组件用 `ensureVisible` 告诉它屏幕上是哪几行） | `src/views/gallery/` |
| useLinkCheckManager | 链接检测引擎（单例）：一次读完全部检测行（`loadHistoryRows`，`force` 不管 5 分钟缓存）、全量 / 子集检测、暂停 / 继续 / 取消、单条重检、`activeRun`（本轮覆盖哪些链接、何时开始） | `src/composables/link-check/useLinkCheck.ts` |
| useLinkHealth | 链接健康页状态（单例）：健康模型、页面处在哪种状态、检测进度那句话、单行重试（「仍然失效」） | `src/views/health/useLinkHealth.ts` |
| useHealthRepair | 修复（改用最快的可访问备份 + 换文档旧链接）、撤销、写不成的文档只重试那几个；文档索引 | `src/views/health/useHealthRepair.ts` |
| useDocFolders | 文档文件夹：增删记进配置、每次扫描前申请访问权限、逐个扫描 | `src/views/health/useDocFolders.ts` |
| useSupplementBackup | 补充备份（应用级）：范围在开始时定下，同时 3 张，暂停 / 继续 / 停止，进度给工具卡与传输中心 | `src/views/health/useSupplementBackup.ts` |
| useHealthRowActions | 清单行与状态栏「⋯」里的动作：重新上传原图、移除失效链接、清理找不回的图片、在图库中查看、导出结果 | `src/views/health/useHealthRowActions.ts` |
| `healthModel.ts` / `healthCalendar.ts` / `docIndex.ts`（模块） | 纯函数：每张图的状态与原因、改用哪一份、清单分组；一年的日历格子与年份胶囊；文档链接索引与修复计划 | `src/views/health/` |
| `autoCheck.ts` / `healthBadge.ts`（模块） | 自动检测（到期判定、外壳里装定时器）；侧栏「链接健康」琥珀点的失效张数 | `src/views/health/` |
| useHosts | 图床页状态（单例）：选中项 / 目录 / 连接草稿、逐项即存并自动测试、测试并连接、移除带撤销、P11 / P12 确认；保存失败红色通知 | `src/views/hosts/useHosts.ts` |
| useHostTest | 测试连接（按接入方式：Cookie / Token / GitHub / 对象存储走 `probe_s3_storage` / WebDAV 走 `test_webdav_storage`）；结果只留本次会话，已连接的写健康状态 | `src/views/hosts/useHostTest.ts` |
| `hostCatalog.ts` / `hostList.ts` / `hostConfig.ts` / `hostTestText.ts`（模块） | 纯函数：图床目录与字段描述；左栏排序、问题短标签、目录分组；配置读写、连接 / 移除 / 撤销快照、旧版单份自定义 S3 迁移；测试结果的说法 | `src/views/hosts/` |
| editorSync | 编辑器服务（Typora / Obsidian / CLI）的凭证同步：启动时与每次配置变化从配置拼出凭证下发，排队执行 | `src/composables/settings/editorSync.ts` |
| `externalUploads.ts`（模块） | 命令行 / Typora / 编辑器服务传的图收进历史记录：`installExternalUploads()` 装在外壳里，启动、窗口拿到焦点、`external-uploads://recorded` 时调 `drainExternalUploads()`；`resolveServiceId` 把 `webdav` / `custom_s3` 按编辑器设置补成完整编号 | `src/composables/history/externalUploads.ts` |
| useAnalytics | GA4 P0 生命周期统计 + 在线心跳 | `src/composables/useAnalytics.ts` |
| useMirrorFallback | 图库详情的备份管理（改用这一份 / 移除这条链接 / 单条重新检测）；`switchPrimary` 返回是否真的换了（已是这一份、写库失败都是 false） | `src/composables/history/useMirrorFallback.ts` |
| `imageDisplay.ts`（模块） | 不同比例图片怎么占格、怎么画（G13）：`displayKind` / `layoutRatio` / `displayTag`、`imageFormat` / `mayBeTransparent` / `isAnimatedFormat`、灯箱用的 `isLongRatio` | `src/utils/imageDisplay.ts` |
| `formatCount` | 张数、条数的千分位（「12,483」） | `src/utils/formatters.ts` |
| PreviewFrame（组件） | 预览框：固定尺寸、图片完整显示且不放大，空白处铺这张图的模糊放大版；透明格式衬棋盘格。衬底用 `ThumbnailImage` 的 `loaded` 事件报回的那个地址，不多发请求 | `src/components/biz/PreviewFrame.vue` |

## useAnalytics

`useAnalytics` 通过一次性的本机 HTTP 隔离 WebView 加载 Google tag，定义 `first_run` 和 `app_start` 两个生命周期事件。事件附带应用版本、操作系统和固定桌面平台标识，不提供通用事件追踪接口。

公开方法为 `initialize()`、`enable()`、`disable()`。`first_run` 在 Google tag 未完成处理时保留到下次启动重试；`app_start` 不跨启动补发，避免把旧启动错误记到新的时间。该流程不阻塞应用挂载。开发版（`import.meta.env.DEV`）在读完统计开关后直接返回 `false`：不发生命周期事件、不起心跳、不改 `analytics_data`，正式版首次运行时照常发 `first_run`。

### 在线心跳

第三个事件 `heartbeat` 走的通道与上面两个完全不同：定时器位于 Rust 侧（`src-tauri/src/analytics/heartbeat.rs`），每 25 分钟经 Measurement Protocol 直接 POST，不经过 WebView，用于让「此刻有多少人在运行」出现在 GA4 实时面板（该面板统计的是过去 30 分钟内有活动的用户，25 分钟间隔留了 5 分钟余量）。

定时器不放在前端，是因为应用关窗后缩托盘继续运行，而托盘挂机正是「正在运行」最典型的状态；此时本 WebView 处于隐藏态，其 JS 定时器会被节流甚至冻结。`enable()` / `disable()` 会同步启停心跳。

心跳需要 GA4 的 Measurement Protocol API secret，经编译期环境变量 `PICNEXUS_GA_API_SECRET` 注入，不写入源码（仓库公开），发布构建由 CI secret 提供。未注入时 `analytics_start_heartbeat` 返回 `disabled` 并打一条 warn 日志，其余统计不受影响。**该密钥最终存在于发布的二进制里、可被提取**——它只能向本属性写入事件，读不到任何数据，最坏后果是统计被灌入垃圾数据。

GA4 判定「活跃用户」只看事件上有没有 `engagement_time_msec` 参数，不看数值大小，因此心跳固定填 1000 的占位值：填成真实心跳间隔会让「平均互动时长」报表变成精确却无意义的数字（挂在托盘里不等于用户在互动）。

GA4 后台需要创建事件范围的自定义维度：`app_version`、`os_info`、`app_platform`。成功日志只代表 Google tag 已完成事件命令处理，最终入库仍应通过 DebugView 或报表确认。Measurement Protocol 端点对任何请求（包括密钥错误）都返回 204，心跳的「已发送」日志同样不代表数据已入库。

验收生产构建时可在启动进程前临时设置 `PICNEXUS_ANALYTICS_DEBUG=1`，使本次进程的两个生命周期事件进入 DebugView。正常启动不带该变量，也不会发送 `debug_mode`；这不是持久化用户设置。

## 通用模式

Composables 使用单例模式共享状态（详见任意源文件的实现）。

```vue
<script setup lang="ts">
import { useConfig, useHistoryManager, useUpload } from '@/composables';

const { config } = useConfig();
const { totalCount, favoriteSet } = useHistoryManager();
const { isUploading } = useUpload();
</script>
```

## 相关文档

- [前端架构](../architecture/frontend.md)
- [流程图](../../flows/)
