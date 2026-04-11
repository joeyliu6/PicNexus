<script setup lang="ts">
/**
 * CheckBottomBar — 链接监控面板的底部栏
 * 极简进度条 + 分页 + 批量操作栏 + 常规底栏（导出 / 智能检测按钮组 / 取消）
 * 从 HistoryCheckPanel.vue 抽出
 */
import Skeleton from 'primevue/skeleton';
import type { CheckStatsResult } from '../../../../composables/link-check/useCheckStats';

interface DropdownItem {
  label: string;
  desc: string;
  icon: string;
  action: () => void;
}

defineProps<{
  isChecking: boolean;
  progressSource: 'monitor' | 'rescue' | null;
  progressPercent: number;
  progressTooltip: string;
  hasSelection: boolean;
  selectedCount: number;
  isAllSelected: boolean;
  totalPages: number;
  bottomSummary: string;
  isLoading: boolean;
  stats: CheckStatsResult;
  smartCheckLabel: string;
  smartCheckTooltip: string;
  showDropdownArrow: boolean;
  dropdownItems: DropdownItem[];
}>();

const emit = defineEmits<{
  (e: 'toggle-select-all'): void;
  (e: 'clear-selection'): void;
  (e: 'recheck-batch'): void;
  (e: 'delete-batch'): void;
  (e: 'export-csv'): void;
  (e: 'smart-check'): void;
  (e: 'cancel-check'): void;
  (e: 'page-input', event: Event): void;
}>();

const currentPage = defineModel<number>('currentPage', { required: true });
const pageInput = defineModel<string>('pageInput', { required: true });
const progressHover = defineModel<boolean>('progressHover', { required: true });
const showCheckMenu = defineModel<boolean>('showCheckMenu', { required: true });
</script>

<template>
  <div class="bottom">
    <!-- 极简进度条（仅在监控自身检测时显示，防止被文档修复串扰） -->
    <div
      v-if="isChecking && progressSource !== 'rescue'"
      class="progress-bar"
      role="progressbar"
      :aria-valuenow="progressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="progressTooltip"
      @mouseenter="progressHover = true"
      @mouseleave="progressHover = false"
    >
      <Transition name="fade">
        <div v-if="progressHover" class="progress-tooltip">{{ progressTooltip }}</div>
      </Transition>
      <div class="progress-bar-inner">
        <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
    </div>
    <div class="bottom-main">
      <!-- 选中模式：底栏左侧保留分页，右侧显示批量操作 -->
      <template v-if="hasSelection && !isChecking">
        <div class="pagination">
          <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage--">
            <i class="pi pi-chevron-left"></i>
          </button>
          <span class="page-info">
            <input
              class="page-input" type="text"
              v-model="pageInput"
              @keydown.enter="emit('page-input', $event)"
              @blur="emit('page-input', $event)"
              @focus="($event.target as HTMLInputElement).select()"
            />
            / {{ totalPages }}
          </span>
          <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">
            <i class="pi pi-chevron-right"></i>
          </button>
        </div>
        <div class="batch-bottom-right">
          <span class="batch-count">已选 {{ selectedCount }} 条记录</span>
          <button class="btn-ghost btn-sm" @click="emit('toggle-select-all')">
            {{ isAllSelected ? '取消全选' : '全选' }}
          </button>
          <button class="btn-ghost btn-sm" @click="emit('clear-selection')">取消选择</button>
          <button class="btn-primary btn-sm" @click="emit('recheck-batch')" :disabled="isChecking">
            <i class="pi pi-refresh"></i> 重新检测
          </button>
          <button class="btn-danger btn-sm" @click="emit('delete-batch')" :disabled="isChecking">
            <i class="pi pi-trash"></i> 删除选中
          </button>
        </div>
      </template>

      <!-- 正常模式 -->
      <template v-else>
        <div class="pagination">
          <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage--">
            <i class="pi pi-chevron-left"></i>
          </button>
          <span class="page-info">
            <input
              class="page-input" type="text"
              v-model="pageInput"
              @keydown.enter="emit('page-input', $event)"
              @blur="emit('page-input', $event)"
              @focus="($event.target as HTMLInputElement).select()"
            />
            / {{ totalPages }}
          </span>
          <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">
            <i class="pi pi-chevron-right"></i>
          </button>
        </div>
        <span class="page-summary">
          <template v-if="isLoading && stats.total === 0">
            <Skeleton width="64px" height="14px" border-radius="4px" />
          </template>
          <template v-else>{{ bottomSummary }}</template>
        </span>
        <div class="bottom-actions" @click.stop>
          <button v-tooltip.top="'导出检测结果为 CSV 文件'" class="btn-ghost" @click="emit('export-csv')">
            <i class="pi pi-download"></i> 导出
          </button>
          <span class="action-divider"></span>
          <div v-if="!isChecking" class="check-btn-group" :class="{ 'has-dropdown': showDropdownArrow }">
            <button v-tooltip.top="smartCheckTooltip" class="btn-primary" @click="emit('smart-check')">
              <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10" style="flex-shrink:0;display:block"><path d="M3 2l10 6-10 6V2z"/></svg> {{ smartCheckLabel }}
            </button>
            <button
              v-if="showDropdownArrow"
              class="btn-primary check-toggle"
              @click="showCheckMenu = !showCheckMenu"
            >
              <i class="pi pi-chevron-down" style="font-size: var(--text-2xs)"></i>
            </button>
            <Transition name="dropdown">
              <div v-if="showCheckMenu && showDropdownArrow" class="check-dropdown">
                <div
                  v-for="(item, idx) in dropdownItems" :key="idx"
                  class="check-dropdown-item"
                  @click="item.action()"
                >
                  <div class="dropdown-text">
                    <span class="dropdown-label">{{ item.label }}</span>
                    <span class="dropdown-desc">{{ item.desc }}</span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
          <button v-else class="btn-danger" @click="emit('cancel-check')">
            <i class="pi pi-stop"></i> 取消
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ===== 底部操作按钮 ===== */
.bottom-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.action-divider {
  width: 1px; height: 16px; background: var(--border-subtle); flex-shrink: 0;
}

/* ===== 按钮 ===== */
.btn-ghost, .btn-primary, .btn-danger {
  display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px;
  border-radius: 7px; font-size: var(--text-xs); font-weight: 500; cursor: pointer;
  white-space: nowrap; transition: background var(--duration-fast), opacity var(--duration-fast); border: none;
}
.btn-ghost i, .btn-primary i, .btn-danger i { font-size: var(--text-2xs-xs); }
.btn-ghost { background: var(--bg-input); color: var(--text-muted); }
.btn-ghost:hover { background: var(--hover-overlay); color: var(--text-main); }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { opacity: 0.9; }
.btn-danger { background: var(--error-alpha-15); color: var(--error); border: 1px solid transparent; }
.btn-danger:hover { background: var(--error-alpha-8); border-color: var(--error-alpha-15); box-shadow: none; }

.check-btn-group { display: flex; position: relative; }
.check-btn-group.has-dropdown .btn-primary:first-child { border-radius: 7px 0 0 7px; }
.check-toggle { border-radius: 0 7px 7px 0; padding: 0 7px; border-left: 1px solid var(--primary-alpha-15); }

.check-dropdown {
  position: absolute; bottom: calc(100% + 6px); right: 0; min-width: 220px;
  background: var(--bg-card); border-radius: 10px; padding: 4px 0;
  box-shadow: var(--shadow-float); z-index: var(--z-dropdown, 100);
  border: 1px solid var(--border-subtle); overflow: hidden;
}

.check-dropdown-item {
  display: flex; flex-direction: row; align-items: center; gap: 8px;
  padding: 7px 14px; cursor: pointer; transition: background var(--duration-micro);
}
.check-dropdown-item:not(:last-child) { border-bottom: 1px solid var(--border-subtle); }
.check-dropdown-item:hover { background: var(--hover-overlay-subtle); }
.dropdown-text { display: flex; flex-direction: column; gap: 2px; }
.dropdown-label { font-size: var(--text-sm); font-weight: 500; color: var(--text-main); }
.dropdown-desc { font-size: var(--text-2xs-xs); color: var(--text-tertiary); }

/* ===== 极简进度条 ===== */
.progress-bar {
  width: 100%; flex-shrink: 0; cursor: default;
  padding: 5px 0; position: relative;
}

.progress-tooltip {
  position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  padding: 4px 10px; border-radius: 6px; white-space: nowrap;
  font-size: var(--text-2xs-xs); color: var(--text-main); font-variant-numeric: tabular-nums;
  background: var(--bg-card); box-shadow: var(--shadow-float);
  border: 1px solid var(--border-subtle); pointer-events: none;
}
.fade-enter-active { transition: opacity var(--duration-fast); }
.fade-leave-active { transition: opacity var(--duration-micro); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.progress-bar-inner {
  width: 100%; height: 3px; background: var(--bg-input);
  border-radius: 1.5px; overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--primary-light, #60a5fa));
  transition: width var(--duration-slower) var(--ease-standard);
  position: relative; overflow: hidden;
}

.progress-bar-fill::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 40%), transparent);
  animation: k-sweep 1.5s ease-in-out infinite;
}

/* 底栏批量操作模式 */
.batch-bottom-right { display: flex; align-items: center; gap: 8px; }
.batch-count { font-size: var(--text-xs); color: var(--text-muted); font-weight: 500; }

/* 下拉动画（复用 settings-shared 定义） */
.dropdown-enter-active, .dropdown-leave-active { transition: all var(--duration-normal) ease; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(8px); }

/* ===== 底部 ===== */
.bottom { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; padding-right: 24px; }

.bottom-main {
  display: flex; align-items: center; justify-content: space-between;
}
.page-summary { font-size: var(--text-xs); color: var(--text-tertiary); white-space: nowrap; }
.pagination { display: flex; align-items: center; gap: 4px; margin-right: 10px; }

.page-btn {
  display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: none; border-radius: 5px; background: var(--bg-input); color: var(--text-muted);
  cursor: pointer; transition: background var(--duration-micro), color var(--duration-micro); font-size: var(--text-xs);
}
.page-btn:hover:not(:disabled) { background: var(--primary-alpha-8); color: var(--primary); }
.page-btn:disabled { opacity: 0.3; cursor: default; }

.page-info {
  font-size: var(--text-xs); color: var(--text-muted);
  display: inline-flex; align-items: center; gap: 4px; margin: 0 4px;
}

.page-input {
  width: 32px; height: 22px; text-align: center; border: 1px solid var(--border-subtle);
  border-radius: 4px; background: var(--bg-input); color: var(--text-main); font-size: var(--text-xs);
  outline: none;
}
.page-input::placeholder { color: var(--text-main); opacity: 0.6; }
.page-input:focus { border-color: var(--primary); }
</style>
