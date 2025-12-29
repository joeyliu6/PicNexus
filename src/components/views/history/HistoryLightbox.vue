<script setup lang="ts">
/**
 * 历史记录图片查看器（Lightbox）
 * 谷歌相册风格的图片预览组件
 */
import { computed } from 'vue';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import type { HistoryItem, ServiceType } from '../../../config/types';
import { getActivePrefix } from '../../../config/types';
import { useToast } from '../../../composables/useToast';
import { useConfigManager } from '../../../composables/useConfig';

// Props
const props = defineProps<{
  visible: boolean;
  item: HistoryItem | null;
}>();

// Emits
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'delete', item: HistoryItem): void;
}>();

const toast = useToast();
const configManager = useConfigManager();

// 日期格式化器
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

// 格式化时间
const formatTime = (timestamp: number) => dateFormatter.format(new Date(timestamp));

// 获取服务名称
const getServiceName = (serviceId: ServiceType): string => {
  const serviceNames: Record<ServiceType, string> = {
    weibo: '微博',
    r2: 'R2',
    tcl: 'TCL',
    jd: '京东',
    nowcoder: '牛客',
    qiyu: '七鱼',
    zhihu: '知乎',
    nami: '纳米'
  };
  return serviceNames[serviceId] || serviceId;
};

// 获取所有成功上传的图床
const getSuccessfulServices = (item: HistoryItem): ServiceType[] => {
  return item.results
    .filter(r => r.status === 'success')
    .map(r => r.serviceId);
};

// 获取大图 URL
const getLargeImageUrl = (item: HistoryItem): string => {
  const result = item.results.find(r =>
    r.serviceId === item.primaryService && r.status === 'success'
  );

  if (!result?.result?.url) return '';

  // 微博图床：使用 large 尺寸
  if (result.serviceId === 'weibo' && result.result.fileKey) {
    let largeUrl = `https://tvax1.sinaimg.cn/large/${result.result.fileKey}.jpg`;

    const activePrefix = getActivePrefix(configManager.config.value);
    if (activePrefix) {
      largeUrl = `${activePrefix}${largeUrl}`;
    }

    return largeUrl;
  }

  return result.result.url;
};

// 计算属性：大图 URL
const lightboxImage = computed(() => {
  if (!props.item) return '';
  return getLargeImageUrl(props.item);
});

// 复制链接
const handleCopyLink = async () => {
  if (!props.item) return;

  try {
    if (!props.item.generatedLink) {
      toast.warn('无可用链接', '该项目没有可用的链接');
      return;
    }

    let finalLink = props.item.generatedLink;
    if (props.item.primaryService === 'weibo') {
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        finalLink = `${activePrefix}${props.item.generatedLink}`;
      }
    }

    await writeText(finalLink);
    toast.success('已复制', '链接已复制到剪贴板', 1500);
  } catch (error) {
    console.error('[Lightbox] 复制链接失败:', error);
    toast.error('复制失败', String(error));
  }
};

// 在浏览器中打开
const openInBrowser = async () => {
  if (!props.item) return;

  try {
    if (!props.item.generatedLink) {
      toast.warn('无可用链接', '该项目没有可用的链接');
      return;
    }

    let finalLink = props.item.generatedLink;
    if (props.item.primaryService === 'weibo') {
      const activePrefix = getActivePrefix(configManager.config.value);
      if (activePrefix) {
        finalLink = `${activePrefix}${props.item.generatedLink}`;
      }
    }

    const { open } = await import('@tauri-apps/plugin-shell');
    await open(finalLink);
  } catch (error) {
    console.error('[Lightbox] 打开链接失败:', error);
    toast.error('打开失败', String(error));
  }
};

// 删除项目
const handleDelete = () => {
  if (props.item) {
    emit('delete', props.item);
  }
};

// 关闭 Lightbox
const closeLightbox = () => {
  emit('update:visible', false);
};
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    :dismissableMask="true"
    :showHeader="false"
    class="lightbox-dialog"
    :style="{ width: 'auto', maxWidth: '90vw', background: 'transparent', boxShadow: 'none', border: 'none' }"
    :contentStyle="{ padding: 0, background: 'transparent' }"
  >
    <div class="lightbox-container" @click="closeLightbox">
      <!-- 主图片 -->
      <img :src="lightboxImage" class="lightbox-img" @click.stop />

      <!-- 底部信息栏（谷歌相册风格） -->
      <div class="lightbox-bottom-bar" @click.stop>
        <!-- 左侧：图片信息 -->
        <div class="lightbox-info-section">
          <span class="lightbox-filename">{{ item?.localFileName }}</span>
          <div class="lightbox-meta">
            <span class="lightbox-time" v-if="item">
              <i class="pi pi-calendar"></i>
              {{ formatTime(item.timestamp) }}
            </span>
            <span class="lightbox-services" v-if="item">
              <i class="pi pi-cloud-upload"></i>
              {{ getSuccessfulServices(item).map(s => getServiceName(s)).join('、') }}
            </span>
          </div>
        </div>

        <!-- 右侧：操作按钮 -->
        <div class="lightbox-actions" v-if="item">
          <Button
            icon="pi pi-copy"
            text
            rounded
            class="lightbox-action-btn"
            @click="handleCopyLink"
            v-tooltip.top="'复制链接'"
          />
          <Button
            icon="pi pi-external-link"
            text
            rounded
            class="lightbox-action-btn"
            @click="openInBrowser"
            v-tooltip.top="'在浏览器打开'"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            class="lightbox-action-btn lightbox-action-danger"
            @click="handleDelete"
            v-tooltip.top="'删除'"
          />
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
/* === Lightbox 图片查看器（谷歌相册风格）=== */
:deep(.lightbox-dialog .p-dialog-mask) {
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(10px);
}

:deep(.lightbox-dialog .p-dialog) {
  background: transparent;
  border: none;
  box-shadow: none;
}

:deep(.lightbox-dialog .p-dialog-content) {
  padding: 0;
  background: transparent;
}

.lightbox-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  cursor: pointer;
}

.lightbox-img {
  max-width: 100%;
  max-height: 75vh;
  border-radius: 8px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  cursor: default;
}

/* 底部信息栏（谷歌相册风格） */
.lightbox-bottom-bar {
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: white;
  padding: 12px 20px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  cursor: default;
  min-width: 400px;
  max-width: 90vw;
}

.lightbox-info-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.lightbox-filename {
  font-size: 14px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lightbox-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.lightbox-time,
.lightbox-services {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  display: flex;
  align-items: center;
  gap: 6px;
}

.lightbox-time i,
.lightbox-services i {
  font-size: 12px;
  opacity: 0.8;
}

.lightbox-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.lightbox-action-btn {
  color: white !important;
  width: 36px !important;
  height: 36px !important;
}

.lightbox-action-btn:hover {
  background: rgba(255, 255, 255, 0.15) !important;
}

.lightbox-action-danger:hover {
  background: rgba(239, 68, 68, 0.2) !important;
  color: #fca5a5 !important;
}
</style>
