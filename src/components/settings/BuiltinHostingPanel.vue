<script setup lang="ts">
/**
 * 开箱即用图床统一设置面板
 * 整合 JD、Qiyu 的配置界面
 * 使用标签页切换，带配置状态指示器
 */
import { ref, computed } from 'vue';

// 服务商类型定义
type ProviderId = 'jd' | 'qiyu';

interface Provider {
  id: ProviderId;
  name: string;
  description: string;
  needsConfig: boolean;
}

// 服务商定义
const PROVIDERS: Provider[] = [
  { id: 'jd', name: '京东', description: '京东云存储，开箱即用，无需配置', needsConfig: false },
  { id: 'qiyu', name: '七鱼', description: '网易七鱼客服系统 NOS 对象存储，Token 自动获取', needsConfig: false },
];

// 当前选择的服务商
const selectedProvider = ref<ProviderId>('jd');

// 当前服务商信息
const currentProviderInfo = computed(() => {
  return PROVIDERS.find(p => p.id === selectedProvider.value)!;
});

// 检查服务商配置是否完整（用于状态指示器）
// 开箱即用的服务始终显示为已配置
const isProviderConfigured = (providerId: ProviderId): boolean => {
  return true; // 开箱即用，始终可用
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
          :class="{ configured: isProviderConfigured(provider.id) }"
        ></span>
        <span>{{ provider.name }}</span>
      </button>
    </div>

    <!-- 当前服务商配置表单 -->
    <div class="provider-form">
      <!-- 服务描述 -->
      <div class="section-header">
        <h2>{{ currentProviderInfo.name }}</h2>
        <p class="section-desc">{{ currentProviderInfo.description }}</p>
      </div>

      <!-- JD 说明 -->
      <div v-if="selectedProvider === 'jd'" class="info-card">
        <i class="pi pi-check-circle"></i>
        <p>京东图床无需任何配置，开箱即用。</p>
        <p class="hint">直接在上传界面选择京东图床即可使用。</p>
      </div>

      <!-- 七鱼说明 -->
      <div v-else-if="selectedProvider === 'qiyu'" class="info-card">
        <i class="pi pi-info-circle"></i>
        <p>七鱼图床通过 Chrome/Edge 浏览器自动获取 Token，无需手动配置。</p>
        <p class="hint">首次使用时应用会自动检测并获取必要的认证信息。</p>
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
  background: var(--bg-secondary);
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

/* 信息卡片 */
.info-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  text-align: center;
}

.info-card i {
  font-size: 3rem;
  color: var(--success);
}

.info-card p {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.9375rem;
  line-height: 1.6;
}

.info-card .hint {
  font-size: 0.875rem;
  color: var(--text-secondary);
}
</style>
