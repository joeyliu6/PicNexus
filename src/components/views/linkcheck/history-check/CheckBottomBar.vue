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
  (e: 'export-csv-selected'): void;
  (e: 'smart-check'): void;
  (e: 'cancel-check'): void;
  (e: 'page-input', event: Event): void;
}>();

const currentPage = defineModel<number>('currentPage', { required: true });
const pageInput = defineModel<string>('pageInput', { required: true });
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
    >
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
          <button class="btn-ghost btn-sm" @click="emit('export-csv-selected')">
            <i class="pi pi-download"></i> 导出选中
          </button>
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
        <template v-if="!isChecking">
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
        </template>
        <span v-else class="check-progress-text">{{ progressTooltip }}</span>
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
/* 底栏容器 .bottom-actions 与按钮基类 .btn-primary/.btn-ghost/.btn-danger
   已集中定义在 src/styles/bottom-bar-buttons.css，此处仅保留本组件专属规则 */

.action-divider {
  width: 1px; height: 16px; background: var(--border-subtle); flex-shrink: 0;
}

/* 智能检测连体按钮（主按钮 + 下拉箭头） */
.check-btn-group { display: flex; position: relative; }

.bottom-actions .check-btn-group.has-dropdown .btn-primary:first-child {
  border-radius: var(--radius-sm-md) 0 0 var(--radius-sm-md);
}

.bottom-actions .check-toggle {
  border-radius: 0 var(--radius-sm-md) var(--radius-sm-md) 0;
  padding: 0 var(--space-xs-sm);
  border-left: 1px solid var(--primary-alpha-15);
}

.check-dropdown {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- calc 内 6px 为偏移量 */
  position: absolute; bottom: calc(100% + 6px); right: 0; min-width: 220px;
  background: var(--bg-card); border-radius: var(--radius-lg); padding: var(--space-xs) 0;
  box-shadow: var(--shadow-float); z-index: var(--z-dropdown, 100);
  border: 1px solid var(--border-subtle); overflow: hidden;
}

.check-dropdown-item {
  display: flex; flex-direction: row; align-items: center; gap: var(--space-sm);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 7px 无精确 spacing token */
  padding: 7px var(--space-md-lg); cursor: pointer; transition: background var(--duration-micro);
}
.check-dropdown-item:not(:last-child) { border-bottom: 1px solid var(--border-subtle); }
.check-dropdown-item:hover { background: var(--hover-overlay-subtle); }
.dropdown-text { display: flex; flex-direction: column; gap: var(--space-2xs); }
.dropdown-label { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text-main); }
.dropdown-desc { font-size: var(--text-xs); color: var(--text-tertiary); }

/* ===== 极简进度条 ===== */
.progress-bar {
  width: 100%; flex-shrink: 0; cursor: default;
  padding: var(--space-xs) 0; position: relative;
}

.progress-bar-inner {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 3px 为进度条高度，无 spacing token */
  width: 100%; height: 3px; background: var(--bg-input);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px 为进度条圆角，无 radius token */
  border-radius: 1.5px; overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- fallback 颜色 #60a5fa 用于 --primary-light 未定义时 */
  background: linear-gradient(90deg, var(--primary), var(--primary-light, #60a5fa));
  transition: width var(--duration-slower) var(--ease-standard);
  position: relative; overflow: hidden;
}

.progress-bar-fill::after {
  content: '';
  position: absolute; inset: 0;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 光泽动画中的白色半透明无语义变量 */
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 40%), transparent);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5s 为扫光动画周期，无 duration token */
  animation: k-sweep 1.5s ease-in-out infinite;
}

/* 底栏批量操作模式 */
.batch-bottom-right { display: flex; align-items: center; gap: var(--space-sm); }
.batch-count { font-size: var(--text-xs); color: var(--text-muted); font-weight: var(--weight-medium); }

/* 下拉动画（复用 settings-shared 定义） */
.dropdown-enter-active, .dropdown-leave-active { transition: all var(--duration-normal) ease; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(var(--space-sm)); }

/* ===== 底部 ===== */
.bottom { display: flex; flex-direction: column; gap: var(--space-sm); flex-shrink: 0; padding-right: var(--space-xl); }

.bottom-main {
  display: flex; align-items: center; justify-content: space-between;
}
.page-summary { font-size: var(--text-xs); color: var(--text-tertiary); white-space: nowrap; }

.check-progress-text {
  font-size: var(--text-xs); color: var(--text-tertiary); white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pagination { display: flex; align-items: center; gap: var(--space-xs); margin-right: var(--space-sm-md); }

.page-btn {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 26px 为按钮固定尺寸，无 spacing token */
  display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 5px 无精确 radius token */
  border: none; border-radius: 5px; background: var(--bg-input); color: var(--text-muted);
  cursor: pointer; transition: background var(--duration-micro), color var(--duration-micro); font-size: var(--text-xs);
}
.page-btn:hover:not(:disabled) { background: var(--primary-alpha-8); color: var(--primary); }
.page-btn:disabled { opacity: 0.3; cursor: default; }

.page-info {
  font-size: var(--text-xs); color: var(--text-muted);
  display: inline-flex; align-items: center; gap: var(--space-xs); margin: 0 var(--space-xs);
}

.page-input {
  width: 32px; height: 22px; text-align: center; border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-main); font-size: var(--text-xs);
  outline: none;
}
.page-input::placeholder { color: var(--text-main); opacity: 0.6; }
.page-input:focus { border-color: var(--primary); }
</style>
