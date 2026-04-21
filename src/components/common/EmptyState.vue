<script setup lang="ts">
/**
 * 通用空状态组件
 * 统一项目中所有空列表/空数据/筛选无结果的展示
 *
 * 用法：
 *   <EmptyState icon="pi pi-star" title="暂无收藏" description="点击图片右上角的 ★ 开始收藏" />
 *   <EmptyState icon="pi pi-search" title="未找到结果">
 *     <button @click="reset">重置筛选</button>
 *   </EmptyState>
 *
 * 自定义图标位（用于替换默认 <i> 图标，例如三点动画）：
 *   <EmptyState title="正在检测"><template #icon><MyDots /></template></EmptyState>
 */
defineProps<{
  /** PrimeVue 图标 class，如 'pi pi-star' */
  icon?: string
  /** 主标题 */
  title?: string
  /** 副标题/描述 */
  description?: string
}>()
</script>

<template>
  <div class="empty-state">
    <slot name="icon">
      <i v-if="icon" :class="icon" class="empty-state__icon" />
    </slot>
    <p v-if="title" class="empty-state__title">{{ title }}</p>
    <p v-if="description" class="empty-state__desc">{{ description }}</p>
    <!-- 操作按钮等自定义内容 -->
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-2xl);
  color: var(--text-muted);
}

.empty-state__icon {
  font-size: var(--text-4xl);
  color: var(--text-disabled);
  opacity: 0.5;
}

.empty-state__title {
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  margin: 0;
}

.empty-state__desc {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  margin: 0;
  text-align: center;
}
</style>
