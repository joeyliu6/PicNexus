<script setup lang="ts">
// 文档修复：为一张失效图片换替换来源的弹层（整张列表共用一个实例）
import { computed, ref, shallowRef } from 'vue';
import Popover from 'primevue/popover';
import type PopoverType from 'primevue/popover';
import type { MdImageLinkWithFile } from '@/composables/md-rescue/shared';
import { getServiceDisplayName } from '@/constants/serviceNames';
import ServiceLogo from '@/components/common/ServiceLogo.vue';

const props = defineProps<{
  /** 有可用备份、还没修的图片总数（「应用到全部」按钮上的数字） */
  rescuableCount: number;
}>();

const emit = defineEmits<{
  (e: 'select', link: MdImageLinkWithFile, url: string): void;
  (e: 'prefer', serviceId: string): void;
}>();

const popoverRef = ref<InstanceType<typeof PopoverType> | null>(null);
const link = shallowRef<MdImageLinkWithFile | null>(null);

const options = computed(() => {
  const valid = link.value?.backupLinks?.filter((b) => b.checkResult?.is_valid) ?? [];
  const fastest = valid.reduce<number | null>((min, b) => {
    const t = b.checkResult?.response_time;
    return t === undefined ? min : min === null ? t : Math.min(min, t);
  }, null);
  return valid.map((b) => ({
    url: b.url,
    serviceId: b.serviceId,
    name: getServiceDisplayName(b.serviceId),
    isFastest: valid.length > 1 && fastest !== null && b.checkResult?.response_time === fastest,
  }));
});

const selected = computed(() => options.value.find((o) => o.url === link.value?.selectedBackup) ?? options.value[0]);

function open(event: Event, target: MdImageLinkWithFile): void {
  link.value = target;
  popoverRef.value?.show(event);
}

function choose(url: string): void {
  if (link.value) emit('select', link.value, url);
  popoverRef.value?.hide();
}

function preferSelected(): void {
  if (selected.value) emit('prefer', selected.value.serviceId);
  popoverRef.value?.hide();
}

defineExpose({ open });
</script>

<template>
  <Popover ref="popoverRef">
    <div class="chooser" role="listbox" aria-label="选择替换来源">
      <div class="chooser-title">用哪个图床的备份替换</div>
      <button
        v-for="o in options"
        :key="o.url"
        type="button"
        class="chooser-item"
        :class="{ 'is-selected': o.url === selected?.url }"
        role="option"
        :aria-selected="o.url === selected?.url"
        @click="choose(o.url)"
      >
        <ServiceLogo :service-id="o.serviceId" class="chooser-logo" />
        <span class="chooser-name">{{ o.name }}</span>
        <span v-if="o.isFastest" class="chooser-tag">最快</span>
        <i class="pi pi-check chooser-check" aria-hidden="true"></i>
      </button>
      <template v-if="selected && props.rescuableCount > 1">
        <div class="chooser-divider" role="separator"></div>
        <button type="button" class="chooser-apply" @click="preferSelected">
          <i class="pi pi-star" aria-hidden="true"></i>
          以后优先用「{{ selected.name }}」，应用到全部
        </button>
      </template>
    </div>
  </Popover>
</template>

<style scoped>
.chooser {
  display: flex;
  flex-direction: column;
  min-width: 220px;
  max-width: 300px;
  padding: var(--space-2xs);
}

.chooser-title {
  padding: var(--space-xs) var(--space-sm) var(--space-xs-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.chooser-item,
.chooser-apply {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  min-height: 32px;
  padding: 0 var(--space-sm);
  border: none;
  border-radius: var(--radius-sm-md);
  background: transparent;
  color: var(--text-main);
  font-family: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-micro);
}

.chooser-item:hover,
.chooser-apply:hover {
  background: var(--hover-overlay);
}

.chooser-logo {
  width: 16px;
  height: 16px;
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.chooser-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chooser-tag {
  padding: 0 var(--space-xs);
  border-radius: var(--radius-xs-sm);
  background: var(--success-alpha-10);
  color: var(--success);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
}

.chooser-check {
  font-size: var(--text-xs);
  color: var(--primary);
  visibility: hidden;
}

.chooser-item.is-selected .chooser-check {
  visibility: visible;
}

.chooser-item.is-selected .chooser-name {
  color: var(--primary);
  font-weight: var(--weight-medium);
}

.chooser-divider {
  height: 1px;
  margin: var(--space-xs) var(--space-sm);
  background: var(--border-subtle);
}

.chooser-apply {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.chooser-apply .pi {
  font-size: var(--text-xs);
  color: var(--warning);
}
</style>
