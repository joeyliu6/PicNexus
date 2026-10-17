<script setup lang="ts">
// 添加图床（P13）：标题 + 关闭、搜索框、接入方式筛选；按接入方式分组、三列卡片（窄窗口两列）；
// 悬停的卡片浅蓝描边并出现「连接 ›」；已连接的不出现；底部提示用「S3 兼容存储」接入其他对象存储。
import { computed, ref } from 'vue';
import HostIcon from '@/components/biz/HostIcon.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnSegmented from '@/components/pn/PnSegmented.vue';
import { CATALOG_FILTERS, type CatalogFilter } from './hostCatalog';
import { buildCatalog } from './hostList';

const props = defineProps<{
  addedIds: ReadonlySet<string>;
  narrow: boolean;
  /** 一个已添加的都没有时不给「关闭」（没有可回去的详情） */
  closable: boolean;
}>();

const emit = defineEmits<{ pick: [descriptorId: string]; close: [] }>();

const query = ref('');
const filter = ref<CatalogFilter>('all');
const groups = computed(() => buildCatalog(props.addedIds, query.value, filter.value));
</script>

<template>
  <div class="host-catalog">
    <div class="host-catalog__head">
      <div class="host-catalog__titles">
        <h2 class="host-catalog__title">添加图床</h2>
        <span class="host-catalog__sub">选一个开始连接，完成后会出现在左侧清单</span>
      </div>
      <button v-if="closable" type="button" class="host-catalog__close" aria-label="关闭" @click="emit('close')">
        <PnIcon name="close" :size="13" :stroke="2" />
      </button>
    </div>
    <div class="host-catalog__tools" :class="{ 'host-catalog__tools--narrow': narrow }">
      <label class="host-catalog__search">
        <PnIcon name="search" :size="14" :stroke="1.8" />
        <input v-model="query" class="host-catalog__search-input" type="search" placeholder="搜索图床名称" aria-label="搜索图床名称" spellcheck="false">
      </label>
      <PnSegmented v-model="filter" :segments="CATALOG_FILTERS" label="接入方式" />
    </div>
    <section v-for="group in groups" :key="group.title" class="host-catalog__group">
      <div class="host-catalog__group-head">
        <span class="host-catalog__group-title">{{ group.title }}</span>
        <span class="host-catalog__group-note">{{ group.note }}</span>
      </div>
      <div class="host-catalog__grid" :class="{ 'host-catalog__grid--narrow': narrow }">
        <button v-for="item in group.items" :key="item.id" type="button" class="host-catalog__card" @click="emit('pick', item.id)">
          <span class="host-catalog__plate"><HostIcon :host="item.id" :name="item.name" :size="20" /></span>
          <span class="host-catalog__text">
            <span class="host-catalog__name">{{ item.name }}</span>
            <span class="host-catalog__card-sub">{{ item.sub }}</span>
          </span>
          <span class="host-catalog__go">连接 ›</span>
        </button>
      </div>
    </section>
    <p v-if="groups.length === 0" class="host-catalog__empty">没有符合条件的图床</p>
    <div class="host-catalog__hint">
      <PnIcon name="infoRound" :size="14" :stroke="1.8" />
      <span>没找到想要的？多数对象存储都支持 S3 协议，可以用「S3 兼容存储」接入。</span>
    </div>
  </div>
</template>

<style scoped>
.host-catalog {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-host-gap);
}

.host-catalog__head {
  display: flex;
  align-items: flex-start;
  gap: var(--pn-space-12);
  padding-top: var(--pn-space-2);
}

.host-catalog__titles {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-2);
}

.host-catalog__title {
  margin: 0;
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-title);
}

.host-catalog__sub { color: var(--pn-text2); }

.host-catalog__close {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-icon-button);
  height: var(--pn-size-icon-button);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  cursor: pointer;
}

.host-catalog__close:hover { background: var(--pn-host-row-hover); }

.host-catalog__tools {
  display: flex;
  align-items: center;
  gap: var(--pn-space-host-section);
}

.host-catalog__tools--narrow {
  flex-direction: column;
  align-items: stretch;
}

/* 竖排时 flex: 1 的基准是 0，会把搜索框压扁 */
.host-catalog__tools--narrow .host-catalog__search { flex: none; }

.host-catalog__search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-catalog-search);
  box-sizing: border-box;
  padding: 0 var(--pn-space-12);
  border-radius: var(--pn-radius-catalog-search);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-border-strong);
  color: var(--pn-text3);
}

.host-catalog__search:focus-within { box-shadow: inset 0 0 0 1px var(--pn-brand), 0 0 0 var(--pn-ring-soft-width) var(--pn-ring-soft); }

.host-catalog__search-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  outline: none;
}

.host-catalog__search-input::placeholder { color: var(--pn-text3); opacity: 1; }
.host-catalog__search-input::-webkit-search-cancel-button { display: none; }

.host-catalog__group {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-host-section);
}

.host-catalog__group-head {
  display: flex;
  align-items: baseline;
  gap: var(--pn-space-8);
}

.host-catalog__group-title { font-weight: var(--pn-weight-semibold); }

.host-catalog__group-note {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.host-catalog__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--pn-space-host-section);
}

.host-catalog__grid--narrow { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.host-catalog__card {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  height: var(--pn-size-catalog-card);
  box-sizing: border-box;
  padding: var(--pn-space-catalog-card);
  border: 0;
  border-radius: var(--pn-radius-host-head-icon);
  background: var(--pn-subtle);
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.host-catalog__card:hover,
.host-catalog__card:focus-visible {
  background: var(--pn-brand-soft);
  box-shadow: inset 0 0 0 var(--pn-size-catalog-ring) var(--pn-brand);
}

.host-catalog__plate {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-catalog-plate);
  height: var(--pn-size-catalog-plate);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-canvas);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.host-catalog__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-host-text-gap);
  min-width: 0;
}

.host-catalog__name,
.host-catalog__card-sub {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.host-catalog__name { font-weight: var(--pn-weight-semibold); }

.host-catalog__card-sub {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.host-catalog__go {
  display: none;
  flex: none;
  color: var(--pn-brand-text);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
}

.host-catalog__card:hover .host-catalog__go,
.host-catalog__card:focus-visible .host-catalog__go { display: block; }

.host-catalog__empty {
  margin: 0;
  color: var(--pn-text2);
}

.host-catalog__hint {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  padding: var(--pn-space-catalog-hint);
  border-radius: var(--pn-radius-host-head-icon);
  box-shadow: inset 0 0 0 1px var(--pn-border);
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
}

.host-catalog__hint > :first-child { flex: none; color: var(--pn-text3); }
</style>
