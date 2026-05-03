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
| useAnalytics | 分析统计 | `src/composables/useAnalytics.ts` |
| useMirrorFallback | 灯箱多图床备份管理（切主图床 / 移除链接 / 重新检测） | `src/composables/history/useMirrorFallback.ts` |

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
