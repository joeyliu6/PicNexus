<script setup lang="ts">
import { ref } from 'vue';
import appIconUrl from '../../../assets/icons/app-icon.png';

interface Props {
  appVersion: string;
}

const props = defineProps<Props>();

const versionCopied = ref(false);
async function copyVersion() {
  try {
    await navigator.clipboard.writeText(props.appVersion);
    versionCopied.value = true;
    setTimeout(() => { versionCopied.value = false; }, 2000);
  } catch {
    // 剪贴板权限被拒绝时静默失败
  }
}
</script>

<template>
  <div class="app-info-card">
    <img :src="appIconUrl" alt="PicNexus" class="app-info-icon" />
    <div class="app-info-content">
      <div class="app-name-row">
        <span class="app-name">PicNexus</span>
        <span class="app-tagline">多图床上传工具</span>
      </div>
      <div class="app-version">
        版本 {{ appVersion }}
        <button class="copy-version-btn" v-tooltip.top="'复制版本号'" @click="copyVersion">
          <i :class="versionCopied ? 'pi pi-check' : 'pi pi-copy'" />
        </button>
      </div>
      <div class="app-keywords">16+ 图床 · 自定义压缩 · 云端同步 · 编辑器集成 · 剪贴板上传</div>
    </div>
  </div>
</template>

<style scoped>
.app-info-card {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.app-info-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  flex-shrink: 0;
  object-fit: contain;
}

.app-info-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.app-name {
  font-size: var(--text-lg-xl);
  font-weight: 700;
  color: var(--text-primary);
}

.app-tagline {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.app-version {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-base);
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.copy-version-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-muted);
  transition: color var(--duration-fast), background var(--duration-fast);
}

.copy-version-btn:hover {
  color: var(--primary);
  background: var(--primary-alpha-10);
}

.copy-version-btn i {
  font-size: var(--text-xs);
}

.app-keywords {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 8px;
  line-height: 1.6;
}
</style>
