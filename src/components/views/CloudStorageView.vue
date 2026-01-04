<template>
  <div class="cloud-storage-view">
    <h1>云存储管理</h1>
    <p class="text-sm text-gray-500">暂未实现完整界面，请使用现有 R2 管理功能</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { StorageManagerFactory } from '@/services/storage';

const selectedService = ref<string>('r2');
const objects = ref<any[]>([]);
const isLoading = ref(false);

async function loadObjects() {
  isLoading.value = true;
  try {
    const config = { };
    const manager = StorageManagerFactory.create(selectedService.value, config);
    const result = await manager.listObjects({ maxKeys: 100 });
    objects.value = result.objects;
  } catch (error) {
    console.error('加载对象失败:', error);
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  loadObjects();
});
</script>

<style scoped>
.cloud-storage-view {
  padding: 20px;
}
</style>
