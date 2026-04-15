<script setup lang="ts">
/**
 * Hero 空状态组件
 * 用于首次使用引导、需要强调行动号召的空状态
 *
 * 用法：
 *   <HeroEmptyState
 *     icon="pi pi-shield"
 *     title="检查你的图片链接"
 *     description="扫描全部上传历史，发现失效和异常链接"
 *     metaText="共 1,234 个链接待检测"
 *   >
 *     <button @click="handleStart">开始全面检测</button>
 *   </HeroEmptyState>
 */
defineProps<{
  /** PrimeVue 图标 class，如 'pi pi-shield' */
  icon?: string
  /** 主标题 */
  title?: string
  /** 副标题/描述 */
  description?: string
  /** 底部元信息文字 */
  metaText?: string
}>()
</script>

<template>
  <div class="hero-empty">
    <div v-if="icon" class="hero-empty__icon-wrap">
      <i :class="icon" class="hero-empty__icon" />
    </div>
    <h3 v-if="title" class="hero-empty__title">{{ title }}</h3>
    <p v-if="description" class="hero-empty__desc">{{ description }}</p>
    <!-- CTA 按钮等自定义内容 -->
    <slot />
    <span v-if="metaText" class="hero-empty__meta">{{ metaText }}</span>
  </div>
</template>

<style scoped>
.hero-empty {
  display: flex;
  flex-direction: column;
  place-items: center;
  gap: var(--space-sm-md);
  flex: 1;
  padding: var(--space-3xl) 0;
}

.hero-empty__icon-wrap {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-xl);
  background: var(--primary-alpha-10);
  margin-bottom: var(--space-sm);
}

.hero-empty__icon {
  font-size: var(--text-2xl);
  color: var(--primary);
}

.hero-empty__title {
  font-size: var(--text-lg-xl);
  font-weight: var(--weight-bold);
  color: var(--text-main);
  margin: 0;
}

.hero-empty__desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
}

.hero-empty__meta {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-top: var(--space-2xs);
}
</style>