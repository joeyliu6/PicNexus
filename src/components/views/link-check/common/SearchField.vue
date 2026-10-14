<script setup lang="ts">
/**
 * 维护页列表的搜索框：放大镜 + 输入 + 有字时出现的清除按钮
 */
defineProps<{
  placeholder: string;
}>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="search-field">
    <i class="pi pi-search search-field-icon" aria-hidden="true"></i>
    <input
      v-model="model"
      type="text"
      class="search-field-input"
      :placeholder="placeholder"
      :aria-label="placeholder"
    />
    <button
      v-show="model"
      type="button"
      class="search-field-clear"
      aria-label="清除搜索"
      @click="model = ''"
    >
      <i class="pi pi-times" aria-hidden="true"></i>
    </button>
  </div>
</template>

<style scoped>
.search-field {
  display: flex;
  align-items: center;
  flex: 0 1 240px;
  min-width: 140px;
  height: 30px;
  padding: 0 var(--space-xs) 0 var(--space-sm-md);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: var(--bg-input);
  transition: border-color var(--duration-fast);
}

.search-field:focus-within {
  border-color: var(--primary);
}

.search-field-icon {
  margin-right: var(--space-xs-sm);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.search-field:focus-within .search-field-icon {
  color: var(--primary);
}

.search-field-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-sm);
}

.search-field-input::placeholder {
  color: var(--text-tertiary);
}

.search-field-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
  cursor: pointer;
}

.search-field-clear:hover {
  background: var(--hover-overlay);
  color: var(--text-main);
}
</style>
