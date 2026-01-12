<script setup lang="ts">
/**
 * 开箱即用图床统一设置面板
 * 整合 JD、Qiyu 的配置界面
 * 使用标签页切换，带可用性检测功能
 */
import { ref, computed } from 'vue';
import Tag from 'primevue/tag';

const props = defineProps<{
  jdAvailable: boolean;
  qiyuAvailable: boolean;
  isCheckingJd: boolean;
  isCheckingQiyu: boolean;
}>();

const emit = defineEmits<{
  check: [providerId: string];
}>();

// 服务商类型定义
type ProviderId = 'jd' | 'qiyu';

interface Provider {
  id: ProviderId;
  name: string;
  description: string;
}

// 服务商定义
const PROVIDERS: Provider[] = [
  { id: 'jd', name: '京东', description: '京东云存储，开箱即用，无需配置' },
  { id: 'qiyu', name: '七鱼', description: '网易七鱼客服系统 NOS 对象存储，Token 自动获取' },
];

// 当前选择的服务商
const selectedProvider = ref<ProviderId>('jd');

// 当前服务商信息
const currentProviderInfo = computed(() => {
  return PROVIDERS.find(p => p.id === selectedProvider.value)!;
});

// 当前服务商是否可用
const isCurrentAvailable = computed(() => {
  return selectedProvider.value === 'jd' ? props.jdAvailable : props.qiyuAvailable;
});

// 当前服务商是否正在检测
const isCurrentChecking = computed(() => {
  return selectedProvider.value === 'jd' ? props.isCheckingJd : props.isCheckingQiyu;
});

// 检测可用性
const handleCheck = () => {
  emit('check', selectedProvider.value);
};

// 获取服务商可用状态
const getProviderAvailable = (providerId: ProviderId): boolean => {
  return providerId === 'jd' ? props.jdAvailable : props.qiyuAvailable;
};
</script>

<template>
  <div class="hosting-panel">
    <!-- 服务商标签页切换 -->
    <div class="provider-tabs">
      <button
        v-for="provider in PROVIDERS"
        :key="provider.id"
        class="provider-tab"
        :class="{ active: selectedProvider === provider.id }"
        @click="selectedProvider = provider.id"
      >
        <span
          class="provider-indicator"
          :class="{ configured: getProviderAvailable(provider.id) }"
        ></span>
        <span>{{ provider.name }}</span>
      </button>
    </div>

    <!-- 当前服务商配置表单 -->
    <div class="provider-form">
      <!-- 服务名称 -->
      <div class="section-header">
        <h2>{{ currentProviderInfo.name }}</h2>
      </div>

      <!-- 可用性状态卡片 -->
      <div class="status-card" :class="{ available: isCurrentAvailable, unavailable: !isCurrentAvailable }">
        <div class="status-icon">
          <i v-if="isCurrentChecking" class="pi pi-spin pi-spinner"></i>
          <i v-else-if="isCurrentAvailable" class="pi pi-check-circle"></i>
          <i v-else class="pi pi-times-circle"></i>
        </div>
        <div class="status-content">
          <div class="status-title">
            <span v-if="isCurrentChecking">正在检测...</span>
            <span v-else-if="isCurrentAvailable">服务可用</span>
            <span v-else>服务不可用</span>
          </div>
          <div class="status-desc">
            <template v-if="selectedProvider === 'jd'">
              <span v-if="isCurrentAvailable">京东图床无需任何配置，可以直接使用</span>
              <span v-else>京东图床当前不可用，请稍后重试</span>
            </template>
            <template v-else>
              <span v-if="isCurrentAvailable">七鱼图床 Token 已自动获取，可以直接使用</span>
              <span v-else>七鱼图床需要通过 Chrome/Edge 浏览器自动获取 Token</span>
            </template>
          </div>
        </div>
        <Tag
          :value="isCurrentChecking ? '检测中...' : (isCurrentAvailable ? '可用' : '不可用')"
          :severity="isCurrentChecking ? 'info' : (isCurrentAvailable ? 'success' : 'danger')"
          class="status-tag clickable"
          @click="handleCheck"
          v-tooltip.top="'点击检测可用性'"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.hosting-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

/* 服务商标签页 */
.provider-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px;
  background: var(--hover-overlay-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.provider-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.provider-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.provider-tab.active {
  background: var(--bg-primary);
  color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 配置状态指示器 */
.provider-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: background 0.2s ease;
}

.provider-indicator.configured {
  background: var(--success);
}

/* 表单区域 */
.provider-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header h2 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.section-desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

/* 状态卡片 */
.status-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.status-card.available {
  border-color: var(--success);
  background: rgba(34, 197, 94, 0.05);
}

.status-card.unavailable {
  border-color: var(--danger);
  background: rgba(239, 68, 68, 0.05);
}

.status-icon {
  flex-shrink: 0;
}

.status-icon i {
  font-size: 2rem;
}

.status-card.available .status-icon i {
  color: var(--success);
}

.status-card.unavailable .status-icon i {
  color: var(--danger);
}

.status-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.status-desc {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.status-tag {
  flex-shrink: 0;
}

/* 可点击的状态标签 */
.status-tag.clickable {
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.status-tag.clickable:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.status-tag.clickable:active {
  transform: scale(0.98);
}
</style>
