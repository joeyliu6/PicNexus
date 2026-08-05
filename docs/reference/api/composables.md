# Composables API

> 完整 API 签名请直接阅读源文件，以下为导航索引。

---

## 索引

| Composable | 职责 | 源文件 |
|------------|------|--------|
| useConfig | 配置加载/保存/连接测试 | `src/composables/useConfig.ts` |
| useHistory | 历史记录 CRUD + 搜索 | `src/composables/useHistory.ts` |
| useUpload | 上传流程编排 | `src/composables/useUpload.ts` |
| useThumbCache | 缩略图缓存管理 | `src/composables/useThumbCache.ts` |
| useToast | Toast 通知 | `src/composables/useToast.ts` |
| useTheme | 主题切换 | `src/composables/useTheme.ts` |
| useSettingsForm | 设置页表单读写、保存防抖、恢复默认设置 | `src/composables/settings/useSettingsForm.ts` |
| useSettingsReset | 设置页恢复默认设置编排 | `src/composables/settings/useSettingsReset.ts` |
| useWebDAVSync | WebDAV 同步 | `src/composables/useWebDAVSync.ts` |
| useClipboardImage | 剪贴板图片处理 | `src/composables/useClipboardImage.ts` |
| useConfirm | 确认对话框 | `src/composables/useConfirm.ts` |
| useQueueState | 上传队列状态 | `src/composables/useQueueState.ts` |
| useVirtualTimeline | 虚拟滚动时间线 | `src/composables/useVirtualTimeline.ts` |
| useAnalytics | GA4 P0 生命周期统计 + 在线心跳 | `src/composables/useAnalytics.ts` |
| useMirrorFallback | 灯箱多图床备份管理（切主图床 / 移除链接 / 重新检测） | `src/composables/history/useMirrorFallback.ts` |

## useAnalytics

`useAnalytics` 通过一次性的本机 HTTP 隔离 WebView 加载 Google tag，定义 `first_run` 和 `app_start` 两个生命周期事件。事件附带应用版本、操作系统和固定桌面平台标识，不提供通用事件追踪接口。

公开方法为 `initialize()`、`enable()`、`disable()`。`first_run` 在 Google tag 未完成处理时保留到下次启动重试；`app_start` 不跨启动补发，避免把旧启动错误记到新的时间。该流程不阻塞应用挂载。

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
