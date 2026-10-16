<script setup lang="ts">
// 没有可用的图床（HomeScreen.dc.html H02）：点「启用京东图床」→ 公共图床风险确认 → 加入上传组合；
// 「连接其他图床」去图床页。这时拖入图片，遮罩写「先启用一个图床」，不上传。
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import PnButton from '@/components/pn/PnButton.vue';

defineEmits<{ enableJd: []; connect: [] }>();
</script>

<template>
  <section class="no-host" aria-label="尚未启用图床">
    <PetalGlyph :states="['empty', 'empty', 'empty', 'empty']" :size="56" />
    <div class="no-host__title">尚未启用图床</div>
    <div class="no-host__desc">上传需要至少一个图床。京东免配置，可直接启用；建议另接一个自有存储作为备份。</div>
    <div class="no-host__buttons">
      <PnButton variant="primary" class="no-host__button" @click="$emit('enableJd')">启用京东图床（免配置）</PnButton>
      <PnButton variant="secondary" class="no-host__button" @click="$emit('connect')">连接其他图床</PnButton>
    </div>
    <span class="no-host__note">京东为公共图床，启用前需确认风险说明</span>
  </section>
</template>

<style scoped>
.no-host {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--pn-space-12);
  margin-top: var(--pn-space-home-no-host-top);
  padding: var(--pn-space-no-host-y) var(--pn-space-no-host-x);
  border-radius: var(--pn-radius-panel);
  background: var(--pn-subtle);
  text-align: center;
}

.no-host__title {
  margin-top: var(--pn-space-8);
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-title);
}

.no-host__desc { max-width: var(--pn-size-no-host-text); color: var(--pn-text2); }
.no-host__buttons { display: flex; gap: var(--pn-space-8); margin-top: var(--pn-space-sidebar-x); }
.no-host__button { height: var(--pn-size-button-xl); padding: 0 var(--pn-space-16); border-radius: var(--pn-radius-rail-item); }
.no-host__note { margin-top: var(--pn-space-4); font-size: var(--pn-text-footnote); color: var(--pn-text3); }
</style>
