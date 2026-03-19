<script setup lang="ts">
import { ref, watch } from 'vue';
import Button from 'primevue/button';

type ViewType = 'upload' | 'history' | 'settings';

const props = defineProps<{
  currentView?: ViewType;
}>();

const emit = defineEmits<{
  navigate: [view: ViewType]
}>();

const activeView = ref<ViewType>(props.currentView ?? 'upload');

watch(() => props.currentView, (v) => {
  if (v) activeView.value = v;
});

const navItems = [
  { id: 'upload' as ViewType, label: '上传', icon: 'pi-cloud-upload', title: '上传' },
  { id: 'history' as ViewType, label: '浏览', icon: 'pi-history', title: '浏览记录' },
  { id: 'settings' as ViewType, label: '设置', icon: 'pi-cog', title: '设置' }
];

const handleNavigate = (view: ViewType) => {
  activeView.value = view;
  emit('navigate', view);
};
</script>

<template>
  <div class="sidebar">
    <Button
      v-for="item in navItems"
      :key="item.id"
      :label="item.label"
      :icon="`pi ${item.icon}`"
      @click="handleNavigate(item.id)"
      :class="{ 'nav-btn-active': activeView === item.id }"
      :title="item.title"
      text
      class="nav-btn"
    />
  </div>
</template>

<style scoped>
.sidebar {
  width: 80px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  gap: 4px;
  flex-shrink: 0;
}

.nav-btn {
  width: 100%;
  height: 70px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  color: var(--text-secondary);
  transition: all 0.2s;
  font-size: 0.75rem;
}

.nav-btn :deep(.p-button-icon) {
  font-size: 1.5rem;
  margin: 0;
}

.nav-btn :deep(.p-button-label) {
  font-size: 0.75rem;
  font-weight: 600;
}

.nav-btn:hover {
  background: var(--primary-alpha-10);
  color: var(--primary);
}

.nav-btn.nav-btn-active {
  background: var(--primary-alpha-15);
  color: var(--primary);
  font-weight: 600;
}

.nav-btn.nav-btn-active:hover {
  background: var(--primary-alpha-20);
}
</style>
