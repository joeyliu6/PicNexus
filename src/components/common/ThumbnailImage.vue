<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  srcs: string[];
  alt?: string;
  imageClass?: string;
}>();

const currentSrcIndex = ref(0);
const currentSrc = ref('');
const isError = ref(false);
const isLoading = ref(true);

const loadImage = () => {
  isLoading.value = true;
  if (props.srcs && props.srcs.length > 0 && currentSrcIndex.value < props.srcs.length) {
    currentSrc.value = props.srcs[currentSrcIndex.value];
    isError.value = false;
  } else {
    isError.value = true;
    currentSrc.value = '';
    isLoading.value = false;
  }
};

const handleError = () => {
  // 尝试下一个 URL
  currentSrcIndex.value++;
  if (currentSrcIndex.value < props.srcs.length) {
    loadImage();
  } else {
    isError.value = true;
    isLoading.value = false;
  }
};

const handleLoad = () => {
  isLoading.value = false;
};

// 监听源列表变化
watch(() => props.srcs, () => {
  currentSrcIndex.value = 0;
  loadImage();
}, { immediate: true, deep: true });

</script>

<template>
  <div class="thumbnail-wrapper">
    <!-- 加载中显示骨架屏 -->
    <div v-if="isLoading && !isError" class="thumbnail-skeleton"></div>
    
    <!-- 加载成功显示图片 -->
    <img
      v-if="!isError && currentSrc"
      :src="currentSrc"
      :alt="alt"
      :class="imageClass"
      class="thumbnail-img"
      referrerpolicy="no-referrer"
      @error="handleError"
      @load="handleLoad"
    />
    
    <!-- 占位符：错误或无可用源时显示 -->
    <div v-if="isError" class="thumbnail-placeholder">
      <slot name="placeholder">
        <i class="pi pi-image placeholder-icon"></i>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.thumbnail-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumbnail-skeleton {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, 
    var(--bg-input, #f3f4f6) 25%, 
    var(--bg-card, #fff) 50%, 
    var(--bg-input, #f3f4f6) 75%
  );
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}

.thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-input, #f3f4f6);
  color: var(--text-muted, #9ca3af);
}

.placeholder-icon {
  font-size: var(--text-2xl);
  opacity: 0.5;
}
</style>
