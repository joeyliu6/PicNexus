<script setup lang="ts">
/**
 * 托盘菜单组件
 * 自定义样式的系统托盘右键菜单
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

// 不使用入场动画，直接显示内容

// 菜单项定义
interface MenuItem {
  id: string;
  label: string;
  icon: string;
  action: string;
  isDanger?: boolean;
  hasDivider?: boolean;
}

// 菜单项配置
const menuItems: MenuItem[] = [
  {
    id: 'settings',
    label: '打开设置',
    icon: 'pi-cog',
    action: 'open_settings'
  },
  {
    id: 'history',
    label: '上传历史',
    icon: 'pi-history',
    action: 'open_history',
    hasDivider: true
  },
  {
    id: 'quit',
    label: '退出',
    icon: 'pi-power-off',
    action: 'quit',
    isDanger: true
  }
];

const hoveredItem = ref<string | null>(null);

/**
 * 处理菜单项点击
 */
async function handleMenuClick(item: MenuItem) {
  try {
    await invoke('handle_tray_menu_action', { action: item.action });
  } catch (error) {
    console.error('[TrayMenu] 执行操作失败:', error);
  }
}

/**
 * 处理键盘事件
 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    getCurrentWindow().close();
  }
}

// 组件挂载
onMounted(() => {
  // 监听 Escape 键关闭菜单
  window.addEventListener('keydown', handleKeydown);
});

// 组件卸载
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="tray-menu-container">
    <div class="tray-menu">
      <template v-for="item in menuItems" :key="item.id">
        <div
          class="menu-item"
          :class="{
            'is-danger': item.isDanger,
            'is-hovered': hoveredItem === item.id
          }"
          @click="handleMenuClick(item)"
          @mouseenter="hoveredItem = item.id"
          @mouseleave="hoveredItem = null"
        >
          <i :class="['pi', item.icon, 'menu-icon']"></i>
          <span class="menu-label">{{ item.label }}</span>
        </div>
        <!-- 分隔线 -->
        <div v-if="item.hasDivider" class="menu-divider"></div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 容器 - 无边距，紧凑显示 */
.tray-menu-container {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

/* 菜单主体 - 无圆角、无阴影、紧凑 */
.tray-menu {
  height: 100%;
  background: var(--bg-card, #1e293b);
  border: 1px solid var(--border-subtle, #334155);
  overflow: hidden;
  padding: 3px;
  box-sizing: border-box;
  box-shadow: none;
}

/* 菜单项 - 紧凑间距 */
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 100ms ease;
  color: var(--text-main, #f8fafc);
  user-select: none;
}

.menu-item:hover,
.menu-item.is-hovered {
  background: var(--hover-overlay, rgba(255, 255, 255, 0.08));
}

.menu-item:active {
  background: rgba(59, 130, 246, 0.15);
  transform: scale(0.98);
}

/* 危险操作样式（退出） */
.menu-item.is-danger:hover,
.menu-item.is-danger.is-hovered {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.menu-item.is-danger:hover .menu-icon,
.menu-item.is-danger.is-hovered .menu-icon {
  color: #ef4444;
}

/* 图标 - 小尺寸 */
.menu-icon {
  font-size: 0.8rem;
  width: 14px;
  text-align: center;
  opacity: 0.75;
  transition: all 100ms ease;
  color: var(--text-muted, #94a3b8);
}

.menu-item:hover .menu-icon,
.menu-item.is-hovered .menu-icon {
  opacity: 1;
  color: var(--text-main, #f8fafc);
}

/* 标签 - 小字体 */
.menu-label {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

/* 分隔线 - 紧凑间距 */
.menu-divider {
  height: 1px;
  background: var(--border-subtle, #334155);
  margin: 3px 6px;
}
</style>
