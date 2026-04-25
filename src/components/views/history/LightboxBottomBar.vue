<script setup lang="ts">
/**
 * 灯箱底栏 — 文件信息 + 一组操作按钮
 *
 * 链接按钮（pi-link）：多图床备份场景下的统一入口
 * - 单图床：直接复制主图链接（保持小白友好，不弹菜单）
 * - 多图床：弹出 LightboxMirrorMenu，承载复制/切主图床/移除链接/重新检测
 * - 主图床失效时按钮右上角保留红点警示
 */
import { ref, computed, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import type { HistoryItem } from '../../../config/types';
import { formatTime, formatFileSize } from '../../../composables/history/useLightboxInfo';
import type { MirrorInfo } from '../../../composables/history/useMirrorFallback';
import LightboxMirrorMenu from './LightboxMirrorMenu.vue';

const props = withDefaults(defineProps<{
  item: HistoryItem;
  displayFileName: string;
  successfulServicesText: string;
  successfulServices?: string[];
  isItemFavorited: boolean;
  copySuccess?: boolean;
  mirrors?: MirrorInfo[];
  isPrimaryBroken?: boolean;
  allMirrorsBroken?: boolean;
  checkingServices?: Set<string>;
}>(), {
  successfulServices: () => [],
  copySuccess: false,
  mirrors: () => [],
  isPrimaryBroken: false,
  allMirrorsBroken: false,
  checkingServices: () => new Set<string>(),
});

const emit = defineEmits<{
  (e: 'copy-link'): void;
  (e: 'copy-service-link', serviceId: string): void;
  (e: 'open-browser'): void;
  (e: 'delete'): void;
  (e: 'toggle-favorite'): void;
  (e: 'switch-primary', serviceId: string): void;
  (e: 'remove-mirror', serviceId: string): void;
  (e: 'check-mirror', serviceId: string): void;
}>();

const hasMultipleServices = computed(() => props.successfulServices.length > 1);
const mirrorMenuVisible = ref(false);
const copyBtnRef = ref<HTMLElement | null>(null);

const copyTooltip = computed(() =>
  hasMultipleServices.value ? '复制 · 管理图床' : '复制链接'
);

function handleCopyClick() {
  if (hasMultipleServices.value) {
    mirrorMenuVisible.value = !mirrorMenuVisible.value;
  } else {
    emit('copy-link');
  }
}

function handleCopyMirror(serviceId: string) {
  emit('copy-service-link', serviceId);
  mirrorMenuVisible.value = false;
}

function handleSwitchPrimary(serviceId: string) {
  emit('switch-primary', serviceId);
  mirrorMenuVisible.value = false;
}

function handleRemoveMirror(serviceId: string) {
  // 带二次确认：菜单保持打开，等业务层完成后自然刷新数据
  emit('remove-mirror', serviceId);
}

function handleCheckMirror(serviceId: string) {
  // 重新检测不关菜单——用户还想看新的 chip 状态
  emit('check-mirror', serviceId);
}

onClickOutside(copyBtnRef, () => { mirrorMenuVisible.value = false; });

// 切换图片时关闭菜单
watch(() => props.item.id, () => {
  mirrorMenuVisible.value = false;
});
</script>

<template>
  <div class="lightbox-bottom" @click.stop>
    <div class="lightbox-info-cell cell-filename">
      <span class="cell-value filename-value" v-tooltip.top="item.localFileName">{{ displayFileName }}</span>
      <span class="cell-label">文件名</span>
    </div>
    <div class="lightbox-divider"></div>
    <div class="lightbox-info-cell cell-time">
      <span class="cell-value">{{ formatTime(item.timestamp) }}</span>
      <span class="cell-label">上传时间</span>
    </div>
    <div class="lightbox-divider"></div>
    <div class="lightbox-info-cell cell-size">
      <span class="cell-value">{{ formatFileSize(item.fileSize ?? 0) }}</span>
      <span class="cell-label">文件大小</span>
    </div>
    <div class="lightbox-divider"></div>
    <div
      class="lightbox-info-cell cell-source"
      v-tooltip.top="successfulServicesText"
    >
      <span class="cell-value source-value">{{ successfulServicesText }}</span>
      <span class="cell-label">已传图床</span>
    </div>
    <div class="lightbox-actions">
      <button
        class="action-btn"
        :class="{ 'action-btn-favorited': isItemFavorited }"
        @click="emit('toggle-favorite')"
        v-tooltip.top="isItemFavorited ? '取消收藏' : '收藏'"
      >
        <i :class="isItemFavorited ? 'pi pi-star-fill' : 'pi pi-star'"></i>
      </button>
      <div class="copy-btn-wrapper" ref="copyBtnRef" @keydown.escape="mirrorMenuVisible = false">
        <button
          class="action-btn"
          :class="{
            'action-btn-success': copySuccess,
            'action-btn-alert': isPrimaryBroken && !copySuccess,
          }"
          @click="handleCopyClick"
          v-tooltip.top="copyTooltip"
        >
          <i :class="copySuccess ? 'pi pi-check' : 'pi pi-link'"></i>
          <span
            v-if="isPrimaryBroken && !copySuccess"
            class="action-btn-dot"
            aria-hidden="true"
          ></span>
        </button>
        <Transition name="t-slide-up">
          <div v-if="mirrorMenuVisible" class="mirror-menu-popup">
            <LightboxMirrorMenu
              :mirrors="mirrors"
              :is-primary-broken="isPrimaryBroken"
              :all-mirrors-broken="allMirrorsBroken"
              :checking-services="checkingServices"
              @copy-mirror="handleCopyMirror"
              @switch-primary="handleSwitchPrimary"
              @remove-mirror="handleRemoveMirror"
              @check-mirror="handleCheckMirror"
            />
          </div>
        </Transition>
      </div>
      <button class="action-btn" @click="emit('open-browser')" v-tooltip.top="'在浏览器打开'">
        <i class="pi pi-external-link"></i>
      </button>
      <button class="action-btn action-btn-danger" @click="emit('delete')" v-tooltip.top="'删除记录'">
        <i class="pi pi-trash"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.lightbox-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 3;
  height: 64px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- Lightbox 遮罩背景含 rgb 色值 */
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(40px) saturate(180%);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- box-shadow 含 rgb 色值 */
  box-shadow: 0 -1px 0 0 rgb(255 255 255 / 10%);
  display: flex;
  align-items: center;
  padding: 0 var(--space-xl);
  cursor: default;
}

.lightbox-info-cell {
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-lg);
  gap: var(--space-2xs);
  min-width: 0;
  flex-shrink: 0;
}

.cell-filename {
  flex: 5;
  flex-shrink: 1;
  padding-left: 0;
}

.cell-time {
  flex: 2;
}

.cell-size {
  flex: 1;
}

.cell-source {
  flex: 1.5;
  flex-shrink: 1;
}

.cell-value {
  color: var(--text-main);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- text-shadow 含 rgb 色值 */
  text-shadow: 0 1px 3px rgb(0 0 0 / 50%);
}

.source-value,
.filename-value {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  letter-spacing: 0.02em;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- text-shadow 含 rgb 色值 */
  text-shadow: 0 1px 2px rgb(0 0 0 / 40%);
}

.lightbox-divider {
  width: 1px;
  height: 28px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.lightbox-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
  padding-left: var(--space-lg);
}

.action-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--hover-overlay-subtle);
  color: var(--text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) ease;
}

.action-btn:hover {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.action-btn-favorited {
  color: var(--warning) !important;
}

.action-btn-favorited:hover {
  background: var(--warning-alpha-15) !important;
}

.action-btn-danger {
  color: var(--error);
}

.action-btn-danger:hover {
  background: var(--error-soft);
  color: var(--error);
}

.action-btn-success {
  color: var(--success) !important;
}

.action-btn-alert {
  color: var(--warning);
}

.action-btn-alert:hover {
  background: var(--warning-alpha-15);
  color: var(--warning);
}

/* 主图失效的红点徽标：落在按钮右上角，尺寸 8×8 */
.action-btn-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--warning);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 暗色灯箱按钮上的描边对比，固定配色 */
  box-shadow: 0 0 0 2px rgb(0 0 0 / 55%);
  pointer-events: none;
}

.copy-btn-wrapper {
  position: relative;
}

/* 镜像菜单弹层：右对齐按钮，避免宽菜单溢出视口右缘 */
.mirror-menu-popup {
  position: absolute;
  bottom: calc(100% + var(--space-sm));
  right: 0;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 灯箱暗色环境弹出菜单背景 */
  background: rgb(30 30 36 / 95%);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- box-shadow 含 rgb */
  box-shadow: 0 4px 24px rgb(0 0 0 / 40%);
  padding: var(--space-sm);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 灯箱内局部弹层，高于底栏(z:3)但无对应全局 token */
  z-index: 5;
}

/* 浅色模式：灯箱始终保持暗色风格 */
:root.light-theme .lightbox-bottom {
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-tertiary: #64748b;
  --hover-overlay: rgb(255 255 255 / 8%);
  --hover-overlay-subtle: rgb(255 255 255 / 4%);
  --border-subtle: #334155;
  --error: #ef4444;
  --error-soft: rgb(239 68 68 / 15%);
}
</style>
