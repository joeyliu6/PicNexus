<script setup lang="ts">
import { ref, computed } from 'vue';
import Button from 'primevue/button';
import RadioButton from 'primevue/radiobutton';
import Dialog from 'primevue/dialog';
import { getServiceDisplayName } from '../../../constants/serviceNames';
import { smartTruncateUrl } from '../../../utils/mdParser';
import type { MdImageLinkWithFile, RepairStrategy } from '../../../composables/useMdRescue';

const props = defineProps<{
  visible: boolean;
  availableBackupServices: string[];
  rescuableCount: number;
  rescuableLinks: MdImageLinkWithFile[];
  initialPreference: string[];
}>();

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
  (e: 'confirm', strategy: RepairStrategy, preference: string[]): void;
}>();

const repairStrategyType = ref<'priority' | 'fastest' | 'manual'>('priority');
const showManualSection = ref(false);
const tempPreference = ref<string[]>([]);
const manualSelections = ref(new Map<string, string>());

const MANUAL_LIST_LIMIT = 50;
const showAllManualLinks = ref(false);

const visibleManualLinks = computed(() => {
  const all = props.rescuableLinks;
  if (showAllManualLinks.value || all.length <= MANUAL_LIST_LIMIT) return all;
  return all.slice(0, MANUAL_LIST_LIMIT);
});

/** 弹窗打开时初始化状态 */
function onShow() {
  tempPreference.value = props.initialPreference.length > 0
    ? [...props.initialPreference]
    : [...props.availableBackupServices];

  const hasExistingSelection = props.rescuableLinks.some((link) =>
    Boolean(link.selectedBackup && link.backupLinks?.some((b) =>
      b.checkResult?.is_valid && b.url === link.selectedBackup,
    )),
  );

  manualSelections.value = new Map();
  for (const link of props.rescuableLinks) {
    const validBackups = link.backupLinks?.filter((b) => b.checkResult?.is_valid);
    if (validBackups && validBackups.length > 0) {
      const selected = link.selectedBackup && validBackups.some((b) => b.url === link.selectedBackup)
        ? link.selectedBackup
        : validBackups[0].url;
      manualSelections.value.set(link.url, selected);
    }
  }
  repairStrategyType.value = hasExistingSelection ? 'manual' : 'priority';
  showManualSection.value = hasExistingSelection;
  showAllManualLinks.value = false;
}

function moveServiceUp(i: number) {
  if (i === 0) return;
  const arr = [...tempPreference.value];
  [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  tempPreference.value = arr;
}

function confirm() {
  let strategy: RepairStrategy;
  switch (repairStrategyType.value) {
    case 'priority':
      strategy = { type: 'priority', order: tempPreference.value };
      break;
    case 'fastest':
      strategy = { type: 'fastest' };
      break;
    case 'manual':
      strategy = { type: 'manual', selections: manualSelections.value };
      break;
  }
  emit('confirm', strategy, [...tempPreference.value]);
  emit('update:visible', false);
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="链接修复策略"
    :style="{ width: 'var(--dialog-width-lg)' }"
    :draggable="false"
    :closable="true"
    @update:visible="emit('update:visible', $event)"
    @show="onShow"
  >
    <div class="repair-dialog-body">
      <p class="repair-dialog-desc">选择如何为失效图片分配备用链接：</p>

      <!-- 策略 1: 指定图床优先 -->
      <div class="repair-strategy-option" :class="{ active: repairStrategyType === 'priority' }" @click="repairStrategyType = 'priority'">
        <RadioButton v-model="repairStrategyType" value="priority" />
        <div class="repair-strategy-content">
          <span class="repair-strategy-label">指定图床优先</span>
          <span class="repair-strategy-desc">按优先级顺序选择第一个可用链接，点击药丸可调整顺序</span>
          <div v-if="repairStrategyType === 'priority'" class="repair-pref-pills">
            <template v-for="(serviceId, i) in tempPreference" :key="serviceId">
              <i v-if="i > 0" class="pi pi-ellipsis-v pill-grip" />
              <button
                class="pill-pref-item"
                :class="{ 'pill-pref-item--first': i === 0 }"
                @click.stop="moveServiceUp(i)"
              >{{ i + 1 }} · {{ getServiceDisplayName(serviceId) }}</button>
            </template>
          </div>
        </div>
      </div>

      <!-- 策略 2: 响应最快 -->
      <div class="repair-strategy-option" :class="{ active: repairStrategyType === 'fastest' }" @click="repairStrategyType = 'fastest'">
        <RadioButton v-model="repairStrategyType" value="fastest" />
        <div class="repair-strategy-content">
          <span class="repair-strategy-label">响应最快</span>
          <span class="repair-strategy-desc">自动选择延迟最低的可用备用链接</span>
        </div>
      </div>

      <!-- 策略 3: 逐张手动选择 -->
      <div class="repair-strategy-option repair-strategy-manual" :class="{ active: repairStrategyType === 'manual' }">
        <div class="repair-strategy-manual-header" @click="repairStrategyType = 'manual'; showManualSection = true">
          <RadioButton v-model="repairStrategyType" value="manual" />
          <div class="repair-strategy-content">
            <span class="repair-strategy-label">逐张手动选择</span>
            <span class="repair-strategy-desc">为每张图片单独指定备用链接</span>
          </div>
          <i class="pi" :class="showManualSection && repairStrategyType === 'manual' ? 'pi-chevron-up' : 'pi-chevron-down'" @click.stop="showManualSection = !showManualSection" />
        </div>
        <div v-if="repairStrategyType === 'manual' && showManualSection" class="repair-manual-list">
          <div v-for="link in visibleManualLinks" :key="link.url" class="repair-manual-item">
            <div class="repair-manual-url">
              <i class="pi pi-image" />
              <span>{{ smartTruncateUrl(link.url, 40) }}</span>
              <span class="repair-manual-file">{{ link.sourceFileName }}</span>
            </div>
            <div class="repair-manual-options">
              <label
                v-for="b in link.backupLinks!.filter(b => b.checkResult?.is_valid)"
                :key="b.url"
                class="repair-manual-radio"
                :class="{ selected: manualSelections.get(link.url) === b.url }"
              >
                <input
                  type="radio"
                  :name="'manual-' + link.url"
                  :value="b.url"
                  :checked="manualSelections.get(link.url) === b.url"
                  @change="manualSelections.set(link.url, b.url)"
                />
                <span class="backup-chip">{{ getServiceDisplayName(b.serviceId) }}</span>
                <span v-if="b.checkResult?.response_time" class="repair-manual-latency">{{ b.checkResult.response_time }}ms</span>
              </label>
            </div>
          </div>
          <button
            v-if="!showAllManualLinks && rescuableLinks.length > MANUAL_LIST_LIMIT"
            class="repair-manual-show-all"
            @click="showAllManualLinks = true"
          >
            显示全部 {{ rescuableLinks.length }} 条（当前仅显示前 {{ MANUAL_LIST_LIMIT }} 条）
          </button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="repair-dialog-footer">
        <Button label="取消" severity="secondary" outlined @click="emit('update:visible', false)" />
        <Button :label="`开始修复（${rescuableCount} 张）`" icon="pi pi-wrench" @click="confirm" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
.repair-dialog-body {
  display: flex; flex-direction: column; gap: var(--space-md);
}

.repair-dialog-desc {
  font-size: var(--text-sm); color: var(--text-muted); margin: 0;
}

.repair-strategy-option {
  display: flex; align-items: flex-start; gap: var(--space-sm-md);
  padding: var(--space-md) var(--space-md-lg); border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  cursor: pointer; transition: background var(--duration-fast), border-color var(--duration-fast);
}
.repair-strategy-option:hover { background: var(--hover-overlay-subtle); }

.repair-strategy-option.active {
  border-color: var(--primary-alpha-30);
  background: var(--primary-alpha-5);
}

.repair-strategy-content {
  display: flex; flex-direction: column; gap: var(--space-xs); flex: 1; min-width: 0;
}

.repair-strategy-label {
  font-size: var(--text-sm); font-weight: var(--weight-semibold); color: var(--text-main);
}

.repair-strategy-desc {
  font-size: var(--text-xs); color: var(--text-tertiary);
}

.repair-pref-pills {
  display: flex; flex-wrap: wrap; gap: var(--space-xs-sm); margin-top: var(--space-sm);
}

.pill-pref-item {
  display: inline-flex; align-items: center; height: 28px; padding: 0 var(--space-sm-md);
  border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: var(--weight-medium); white-space: nowrap;
  cursor: pointer; border: 1px solid var(--border-subtle);
  background: var(--bg-input); color: var(--text-muted); font-family: inherit;
  transition: background var(--duration-fast), border-color var(--duration-fast);
}

.pill-pref-item:hover {
  background: var(--primary-alpha-8); border-color: var(--primary-alpha-30); color: var(--primary);
}

.pill-pref-item--first {
  background: var(--primary-alpha-10); border-color: var(--primary-alpha-30);
  color: var(--primary); font-weight: var(--weight-semibold);
}

.pill-grip {
  font-size: var(--text-2xs); color: var(--text-tertiary); opacity: 0.5; flex-shrink: 0;
}
.repair-strategy-manual { flex-direction: column; gap: 0; }

.repair-strategy-manual-header {
  display: flex; align-items: flex-start; gap: var(--space-sm-md); cursor: pointer; width: 100%;
}

.repair-strategy-manual-header > .pi {
  margin-left: auto; margin-top: var(--space-xs); font-size: var(--text-xs); color: var(--text-tertiary);
}

.repair-manual-list {
  display: flex; flex-direction: column; gap: var(--space-sm);
  margin-top: var(--space-sm-md); padding-top: var(--space-sm-md); border-top: 1px solid var(--border-subtle);
  max-height: 280px; overflow-y: auto;
}

.repair-manual-item {
  display: flex; flex-direction: column; gap: var(--space-xs-sm);
  padding: var(--space-sm) var(--space-sm-md); border-radius: var(--radius-md); background: var(--bg-input);
}

.repair-manual-url {
  display: flex; align-items: center; gap: var(--space-xs-sm);
  font-size: var(--text-xs); color: var(--text-muted);
}
.repair-manual-url i { font-size: var(--text-xs); color: var(--text-tertiary); }

.repair-manual-url span {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.repair-manual-file {
  font-family: inherit !important;
  margin-left: auto; flex-shrink: 0;
  color: var(--text-tertiary);
}

.repair-manual-options {
  display: flex; flex-wrap: wrap; gap: var(--space-xs-sm); padding-left: var(--space-lg-xl);
}

.repair-manual-radio {
  display: inline-flex; align-items: center; gap: var(--space-xs); cursor: pointer;
}
.repair-manual-radio input { display: none; }

.repair-manual-radio.selected .backup-chip {
  background: var(--primary-alpha-10); color: var(--primary);
  border-color: var(--primary-alpha-30);
}

.repair-manual-latency {
  font-size: var(--text-2xs); color: var(--text-tertiary);
}

.repair-manual-show-all {
  width: 100%; padding: var(--space-sm) 0; border: 1px dashed var(--border-subtle); border-radius: var(--radius-sm-md);
  background: transparent; color: var(--primary); font-size: var(--text-xs); font-weight: var(--weight-medium);
  cursor: pointer; font-family: inherit;
  transition: background var(--duration-fast), border-color var(--duration-fast);
}
.repair-manual-show-all:hover { background: var(--primary-alpha-5); border-color: var(--primary-alpha-30); }

.repair-dialog-footer {
  display: flex; justify-content: flex-end; gap: var(--space-sm);
}
</style>
