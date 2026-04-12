<script setup lang="ts">
import { computed, ref } from 'vue';
import Divider from 'primevue/divider';
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../../composables/useToast';
import AppInfoCard from './about-update/AppInfoCard.vue';
import UpdateCard from './about-update/UpdateCard.vue';
import WechatQrDialog from './about-update/WechatQrDialog.vue';

interface Props {
  appVersion: string;
  autoUpdateEnabled: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:autoUpdateEnabled': [value: boolean];
  'reopenOnboarding': [];
  'save': [];
}>();

const toast = useToast();

const autoUpdateEnabledModel = computed({
  get: () => props.autoUpdateEnabled,
  set: (v) => emit('update:autoUpdateEnabled', v),
});

const showWechatQR = ref(false);

function openExternal(url: string) {
  open(url);
}

async function openLogDir() {
  try {
    await invoke('open_log_dir');
  } catch {
    toast.error('打开失败', '无法打开日志目录');
  }
}
</script>

<template>
  <div class="about-update-panel">
    <div class="section-header">
      <h2>关于与更新</h2>
      <p class="section-desc">查看应用信息、检查更新和相关资源链接。</p>
    </div>

    <!-- 应用信息 -->
    <div class="form-group">
      <label class="group-label">应用信息</label>
      <AppInfoCard :app-version="appVersion" />
    </div>

    <Divider />

    <!-- 软件更新 -->
    <div class="form-group">
      <label class="group-label">软件更新</label>
      <UpdateCard
        v-model:autoUpdateEnabled="autoUpdateEnabledModel"
        @save="emit('save')"
      />
    </div>

    <Divider />

    <!-- 相关链接 -->
    <div class="form-group">
      <label class="group-label">相关链接</label>
      <div class="links-grid">
        <button class="link-card" @click="openExternal('https://github.com/joeyliu6/PicNexus')">
          <div class="link-card-icon">
            <i class="pi pi-github" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">GitHub 仓库</span>
            <span class="link-card-desc">查看源码和版本发布</span>
          </div>
        </button>
        <button class="link-card" @click="openExternal('https://github.com/joeyliu6/PicNexus/issues')">
          <div class="link-card-icon">
            <i class="pi pi-comment" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">问题反馈</span>
            <span class="link-card-desc">报告问题或提出建议</span>
          </div>
        </button>
        <button class="link-card" @click="openExternal('https://github.com/joeyliu6/PicNexus/releases')">
          <div class="link-card-icon">
            <i class="pi pi-list" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">更新日志</span>
            <span class="link-card-desc">查看历史版本变更</span>
          </div>
        </button>
        <button class="link-card" @click="emit('reopenOnboarding')">
          <div class="link-card-icon">
            <i class="pi pi-compass" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">重新引导</span>
            <span class="link-card-desc">重新查看新手引导</span>
          </div>
        </button>
        <button class="link-card" @click="openLogDir">
          <div class="link-card-icon">
            <i class="pi pi-file" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">日志目录</span>
            <span class="link-card-desc">查看运行日志，排查问题</span>
          </div>
        </button>
        <button class="link-card" @click="showWechatQR = true">
          <div class="link-card-icon">
            <i class="pi pi-qrcode" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">公众号</span>
            <span class="link-card-desc">查看开发日志与进度</span>
          </div>
        </button>
      </div>
    </div>
  </div>

  <WechatQrDialog v-model:visible="showWechatQR" />
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

/* 链接网格 */
.links-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-md);
}

.link-card {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-lg);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-normal);
  text-align: left;
}

.link-card:hover {
  border-color: var(--primary);
  background: var(--primary-alpha-8);
}

.link-card-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--primary-alpha-10);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.link-card-icon i {
  font-size: var(--text-lg);
  color: var(--primary);
}

.link-card:hover .link-card-icon {
  background: var(--primary-alpha-15);
}

.link-card-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.link-card-title {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.link-card-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
