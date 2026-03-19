<script setup lang="ts">
/**
 * 通用复制链接按钮
 * 单击：使用默认格式复制
 * 右键：弹出格式选择菜单
 */
import { ref, computed } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { LINK_FORMAT_OPTIONS, type LinkFormat } from '../../utils/linkFormatter';
import { useCopyLink, type CopyLinkItem } from '../../composables/useCopyLink';
import { useConfigManager } from '../../composables/useConfig';

const props = withDefaults(defineProps<{
  item: CopyLinkItem;
  icon?: string;
  size?: 'small' | 'normal';
  showFormatLabel?: boolean;
}>(), {
  icon: 'pi pi-copy',
  size: 'small',
  showFormatLabel: false,
});

const { copyLink } = useCopyLink();
const configManager = useConfigManager();

const menuVisible = ref(false);
const menuRef = ref<HTMLElement | null>(null);

const formatOptions = computed(() => {
  const hasCustomTemplate = !!configManager.config.value.linkOutput?.customTemplate;
  return LINK_FORMAT_OPTIONS.filter(opt => {
    if (opt.format === 'custom') return hasCustomTemplate;
    return true;
  });
});

onClickOutside(menuRef, () => {
  menuVisible.value = false;
});

async function handleClick() {
  await copyLink(props.item);
}

function handleContextMenu(event: MouseEvent) {
  event.preventDefault();
  menuVisible.value = !menuVisible.value;
}

async function handleFormatCopy(format: LinkFormat) {
  menuVisible.value = false;
  await copyLink(props.item, { format });
}
</script>

<template>
  <div class="copy-btn-wrapper" ref="menuRef">
    <button
      class="copy-btn"
      :class="[size]"
      title="复制链接（右键选格式）"
      @click="handleClick"
      @contextmenu="handleContextMenu"
    >
      <i :class="icon"></i>
    </button>

    <Transition name="copy-menu">
      <div v-if="menuVisible" class="copy-format-menu">
        <button
          v-for="opt in formatOptions"
          :key="opt.format"
          class="format-item"
          @click="handleFormatCopy(opt.format)"
        >
          <i :class="'pi ' + opt.icon"></i>
          <span>{{ opt.label }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.copy-btn-wrapper {
  position: relative;
  display: inline-flex;
}

.copy-btn {
  background: none;
  border: none;
  color: var(--success);
  cursor: pointer;
  padding: 3px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.6;
}

.copy-btn:hover {
  background: var(--success-soft);
  opacity: 1;
}

.copy-btn.small i {
  font-size: 12px;
}

.copy-btn.normal i {
  font-size: 14px;
}

.copy-format-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  box-shadow: var(--shadow-float);
  padding: 4px;
  min-width: 120px;
  z-index: 1001;
}

.format-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.format-item:hover {
  background: var(--hover-overlay);
  color: var(--primary);
}

.format-item i {
  font-size: 13px;
  color: var(--text-secondary);
  width: 14px;
  text-align: center;
}

.format-item:hover i {
  color: var(--primary);
}

.copy-menu-enter-active,
.copy-menu-leave-active {
  transition: all 0.15s ease;
}

.copy-menu-enter-from,
.copy-menu-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}
</style>
