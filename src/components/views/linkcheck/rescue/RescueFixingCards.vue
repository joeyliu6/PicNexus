<script setup lang="ts">
import { computed } from 'vue';
import type { FileHealth, MdImageLinkWithFile } from '../../../../composables/useMdRescue';
import { smartTruncateUrl } from '../../../../utils/mdParser';

const props = defineProps<{
  fileHealthList: FileHealth[];
  imageLinks: MdImageLinkWithFile[];
  fixingProgress: { current: number; total: number };
}>();

const FIXING_CARD_CONFIG = {
  done: { class: 'fixing-card--done', icon: 'pi-check-circle' },
  active: { class: 'fixing-card--active', icon: 'pi-spin pi-spinner' },
  pending: { class: 'fixing-card--pending', icon: 'pi-clock' },
} as const;

function getFixingCardState(file: FileHealth): 'done' | 'active' | 'pending' {
  if (file.healed) return 'done';
  return fixingFileIsActive(file) ? 'active' : 'pending';
}

function fixingFileIsActive(file: FileHealth): boolean {
  if (file.healed) return false;
  const notHealed = props.fileHealthList.filter((f) => !f.healed && f.rescuableCount > 0);
  return notHealed.length > 0 && notHealed[0].path === file.path;
}

const brokenLinksByFile = computed(() => {
  const map = new Map<string, MdImageLinkWithFile[]>();
  for (const l of props.imageLinks) {
    if (l.checkResult && !l.checkResult.is_valid) {
      const arr = map.get(l.sourceFile);
      if (arr) arr.push(l);
      else map.set(l.sourceFile, [l]);
    }
  }
  return map;
});

function getFileBrokenLinks(filePath: string) {
  return brokenLinksByFile.value.get(filePath) ?? [];
}
</script>

<template>
  <div v-for="file in fileHealthList" :key="file.path" class="fixing-card" :class="FIXING_CARD_CONFIG[getFixingCardState(file)].class">
    <div class="fixing-card-header">
      <i class="pi fixing-card-icon" :class="FIXING_CARD_CONFIG[getFixingCardState(file)].icon" />
      <span class="fixing-card-name">{{ file.name }}</span>
      <span class="fixing-card-status">
        <template v-if="file.healed">{{ file.rescuableCount }}/{{ file.rescuableCount }} 已修复</template>
        <template v-else-if="fixingFileIsActive(file)">修复中…</template>
        <template v-else>等待中</template>
      </span>
    </div>
    <div v-if="fixingFileIsActive(file)" class="fixing-card-body">
      <div v-for="(link, i) in getFileBrokenLinks(file.path)" :key="i" class="fixing-link-row">
        <i class="pi" :class="link.backupLinks?.some(b => b.checkResult?.is_valid) ? 'pi-check-circle fixing-link-ok' : 'pi-spin pi-spinner fixing-link-spin'" />
        <span class="fixing-link-text">{{ smartTruncateUrl(link.url, 40) }} → 替换中…</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fixing-card {
  border-radius: var(--radius-sm-md); border: 1px solid var(--border-subtle);
  overflow: hidden; transition: background var(--duration-normal), border-color var(--duration-normal);
}

.fixing-card--done { background: var(--success-alpha-8); border-color: var(--success-alpha-15); }
.fixing-card--active { background: var(--warning-alpha-8); border-color: var(--warning-alpha-15); }
.fixing-card--pending { background: var(--bg-input); border-color: var(--border-subtle); }

.fixing-card-header {
  display: flex; align-items: center; gap: var(--space-sm-md); padding: var(--space-md) var(--space-md-lg);
}

.fixing-card-icon { font-size: var(--text-lg); flex-shrink: 0; }
.fixing-card--done .fixing-card-icon { color: var(--success); }
.fixing-card--active .fixing-card-icon { color: var(--warning); }
.fixing-card--pending .fixing-card-icon { color: var(--text-tertiary); }

.fixing-card-name {
  flex: 1; font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-main);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.fixing-card--done .fixing-card-name { color: var(--success); }

.fixing-card-status { font-size: var(--text-xs); font-weight: var(--weight-medium); flex-shrink: 0; }
.fixing-card--done .fixing-card-status { color: var(--success); }
.fixing-card--active .fixing-card-status { color: var(--warning); }
.fixing-card--pending .fixing-card-status { color: var(--text-tertiary); }

.fixing-card-body {
  padding: 0 var(--space-md-lg) var(--space-md); display: flex; flex-direction: column; gap: var(--space-xs);
}

.fixing-link-row {
  display: flex; align-items: center; gap: var(--space-sm);
  font-size: var(--text-xs); font-family: var(--font-mono, 'JetBrains Mono', monospace); color: var(--text-muted);
}

.fixing-link-ok { color: var(--success); font-size: var(--text-base); }
.fixing-link-spin { color: var(--warning); font-size: var(--text-base); }

.fixing-link-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
