<script setup lang="ts">
// 文档修复 idle 态的「历史库」元信息
// 有数据：纯陈述家底 — 历史库：N 张图片 · M 个图床
// 无数据：警示提醒 — 尚未收录过图片，先去"上传"页传几张再来修复
// 不承诺修复成功率（需扫描后才能确定）

import { ref, onMounted, onActivated } from 'vue';
import { historyDB } from '../../../../services/HistoryDatabase';
import { createLogger } from '../../../../utils/logger';

const log = createLogger('RescueLibraryCard');

const loading = ref(true);
const totalImages = ref(0);
const distinctServices = ref(0);

async function load() {
  try {
    const s = await historyDB.getSummary();
    totalImages.value = s.totalImages;
    distinctServices.value = s.distinctServices;
  } catch (err) {
    log.error('加载图库总览失败', err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
onActivated(load);
</script>

<template>
  <div v-if="loading" class="library-placeholder" aria-hidden="true" />

  <div v-else-if="totalImages > 0" class="library-meta">
    <span class="library-meta__label">历史库</span>
    <span class="library-meta__item">
      <span class="library-meta__value">{{ totalImages.toLocaleString() }}</span>
      <span class="library-meta__unit">张图片</span>
    </span>
    <span class="library-meta__dot">·</span>
    <span class="library-meta__item">
      <span class="library-meta__value">{{ distinctServices }}</span>
      <span class="library-meta__unit">个图床</span>
    </span>
  </div>

  <div v-else class="library-empty" role="status">
    <i class="pi pi-exclamation-triangle library-empty__icon" />
    <span class="library-empty__text">
      尚未收录过图片，先去"上传"页传几张再来修复
    </span>
  </div>
</template>

<style scoped>
.library-placeholder {
  /* 与 .library-meta 实际占位一致：font-size(xs) × leading-normal */
  height: calc(var(--text-xs) * var(--leading-normal));
}

.library-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  min-width: 0;
}

.library-meta__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
}

.library-meta__value {
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.library-meta__unit {
  color: var(--text-muted);
}

.library-meta__dot {
  color: var(--text-disabled);
  user-select: none;
}

.library-empty {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  font-size: var(--text-xs);
  color: var(--warning);
  min-width: 0;
}

.library-empty__icon {
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.library-empty__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
