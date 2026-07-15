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
| useAnalytics | GA4 P0 生命周期统计 | `src/composables/useAnalytics.ts` |
| useMirrorFallback | 灯箱多图床备份管理（切主图床 / 移除链接 / 重新检测） | `src/composables/history/useMirrorFallback.ts` |

## useAnalytics

`useAnalytics` 通过一次性的本机 HTTP 隔离 WebView 加载 Google tag，仅定义 `first_run` 和 `app_start` 两个生命周期事件。事件附带应用版本、操作系统和固定桌面平台标识，不提供通用事件追踪接口，也不在桌面客户端中保存 GA4 API secret。

公开方法为 `initialize()`、`enable()`、`disable()`。`first_run` 在 Google tag 未完成处理时保留到下次启动重试；`app_start` 不跨启动补发，避免把旧启动错误记到新的时间。该流程不阻塞应用挂载。

GA4 后台需要创建事件范围的自定义维度：`app_version`、`os_info`、`app_platform`。成功日志只代表 Google tag 已完成事件命令处理，最终入库仍应通过 DebugView 或报表确认。

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
