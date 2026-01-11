<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { ContextMenuItem } from '../types';

const props = defineProps<{
  /** 菜单项 */
  items: ContextMenuItem[];
  /** 是否显示 */
  visible: boolean;
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const menuRef = ref<HTMLElement | null>(null);

// 关闭菜单
const closeMenu = () => {
  emit('update:visible', false);
};

// 处理菜单项点击
const handleItemClick = (item: ContextMenuItem) => {
  if (item.disabled) return;
  item.action();
  closeMenu();
};

// 点击外部关闭
const handleClickOutside = (e: MouseEvent) => {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    closeMenu();
  }
};

// 按 ESC 关闭
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeMenu();
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="visible"
        ref="menuRef"
        class="context-menu"
        :style="{ left: `${x}px`, top: `${y}px` }"
      >
        <template v-for="item in items" :key="item.id">
          <div v-if="item.separator" class="menu-separator"></div>
          <button
            v-else
            class="menu-item"
            :class="{ disabled: item.disabled, danger: item.danger }"
            @click="handleItemClick(item)"
            :disabled="item.disabled"
          >
            <i :class="`pi ${item.icon}`" class="menu-icon"></i>
            <span class="menu-label">{{ item.label }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  min-width: 160px;
  padding: 6px 0;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: var(--shadow-float);
  z-index: 1000;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s;
  text-align: left;
}

.menu-item:hover {
  background: rgba(59, 130, 246, 0.1);
}

.menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.menu-item.disabled:hover {
  background: none;
}

.menu-item.danger {
  color: var(--error);
}

.menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.menu-icon {
  font-size: 0.9rem;
  width: 16px;
}

.menu-label {
  flex: 1;
}

.menu-separator {
  height: 1px;
  margin: 6px 12px;
  background: var(--border-subtle);
}

/* 动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
