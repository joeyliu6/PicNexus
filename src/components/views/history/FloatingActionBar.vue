<script setup lang="ts">
/**
 * 浮动批量操作栏
 * 用于批量复制、导出、删除等操作
 */
import { ref } from 'vue';
import { onClickOutside } from '@vueuse/core';
import Button from 'primevue/button';

// Props
defineProps<{
  selectedCount: number;
  visible: boolean;
}>();

// Emits
const emit = defineEmits<{
  (e: 'copy', format: 'url' | 'markdown' | 'html' | 'bbcode'): void;
  (e: 'export'): void;
  (e: 'delete'): void;
  (e: 'clear-selection'): void;
}>();

// 复制下拉菜单状态
const copyMenuVisible = ref(false);
const copyDropdownRef = ref<HTMLElement | null>(null);

// 切换复制菜单
const toggleCopyMenu = () => {
  copyMenuVisible.value = !copyMenuVisible.value;
};

// 点击外部关闭菜单
onClickOutside(copyDropdownRef, () => {
  copyMenuVisible.value = false;
});

// 处理复制
const handleCopy = (format: 'url' | 'markdown' | 'html' | 'bbcode') => {
  copyMenuVisible.value = false;
  emit('copy', format);
};
</script>

<template>
  <Transition name="float-bar">
    <div v-if="visible" class="floating-action-bar">
      <div class="fab-content">
        <!-- 选中计数 -->
        <span class="fab-count">
          <i class="pi pi-check-circle"></i>
          {{ selectedCount }}
        </span>

        <div class="fab-divider"></div>

        <!-- 复制链接下拉菜单 -->
        <div class="fab-copy-dropdown" ref="copyDropdownRef">
          <Button
            icon="pi pi-copy"
            text
            size="small"
            class="fab-btn"
            @click.stop="toggleCopyMenu"
            v-tooltip.top="'复制链接'"
          />
          <Transition name="dropdown">
            <div v-if="copyMenuVisible" class="copy-menu">
              <button class="copy-menu-item" @click="handleCopy('url')">
                <i class="pi pi-link"></i><span>URL</span>
              </button>
              <button class="copy-menu-item" @click="handleCopy('markdown')">
                <i class="pi pi-file-edit"></i><span>Markdown</span>
              </button>
              <button class="copy-menu-item" @click="handleCopy('html')">
                <i class="pi pi-code"></i><span>HTML</span>
              </button>
              <button class="copy-menu-item" @click="handleCopy('bbcode')">
                <i class="pi pi-comment"></i><span>BBCode</span>
              </button>
            </div>
          </Transition>
        </div>

        <!-- 导出 -->
        <Button
          icon="pi pi-download"
          text
          size="small"
          class="fab-btn"
          @click="emit('export')"
          v-tooltip.top="'导出'"
        />

        <!-- 删除 -->
        <Button
          icon="pi pi-trash"
          severity="danger"
          text
          size="small"
          class="fab-btn fab-btn-danger"
          @click="emit('delete')"
          v-tooltip.top="'删除'"
        />

        <div class="fab-divider"></div>

        <!-- 取消选择 -->
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          class="fab-close"
          @click="emit('clear-selection')"
          v-tooltip.top="'取消选择'"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* === 浮动操作栏 === */
.floating-action-bar {
  position: fixed;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: rgba(30, 41, 59, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  box-shadow: var(--shadow-float), 0 -1px 0 rgba(255, 255, 255, 0.05) inset;
  padding: 8px 16px;
}

:root.light-theme .floating-action-bar {
  background: rgba(255, 255, 255, 0.95);
  box-shadow: var(--shadow-float), 0 1px 0 rgba(0, 0, 0, 0.03) inset;
}

.fab-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fab-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  padding: 6px 12px;
  background: rgba(59, 130, 246, 0.1);
  border-radius: 12px;
  white-space: nowrap;
}

.fab-count i {
  font-size: 14px;
}

.fab-divider {
  width: 1px;
  height: 24px;
  background: var(--border-subtle);
  margin: 0 4px;
}

.fab-btn {
  font-size: 13px !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
}

.fab-btn-danger:hover {
  color: var(--error) !important;
  background: rgba(239, 68, 68, 0.1) !important;
}

.fab-close {
  width: 32px !important;
  height: 32px !important;
  color: var(--text-secondary) !important;
}

.fab-close:hover {
  color: var(--text-primary) !important;
  background: var(--hover-overlay) !important;
}

/* 浮动栏进入/退出动画 */
.float-bar-enter-active,
.float-bar-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.float-bar-enter-from,
.float-bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

/* === 复制下拉菜单 === */
.fab-copy-dropdown {
  position: relative;
}

.copy-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: var(--shadow-float);
  padding: 6px;
  min-width: 140px;
  z-index: 1001;
}

.copy-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.copy-menu-item:hover {
  background: var(--hover-overlay);
  color: var(--primary);
}

.copy-menu-item i {
  font-size: 14px;
  color: var(--text-secondary);
  width: 16px;
  text-align: center;
}

.copy-menu-item:hover i {
  color: var(--primary);
}

/* 下拉菜单动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* 响应式：窄屏幕隐藏按钮文字 */
@media (max-width: 600px) {
  .fab-btn :deep(.p-button-label) {
    display: none;
  }

  .floating-action-bar {
    padding: 8px 12px;
  }
}
</style>
