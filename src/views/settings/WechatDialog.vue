<script setup lang="ts">
// 公众号二维码（关于 › 帮助与反馈）：设计没画这个弹窗，按统一弹窗样式放一张二维码。图片地址依次换备用的
import { ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';

const open = defineModel<boolean>('open', { default: false });

const QR_URLS = [
  'https://img30.360buyimg.com/imgzone/jfs/t20270426/407340/25/5886/9398/69bfb02cF39ca7cbf/093610210288c390.jpg',
  'https://p.cldisk.com/star4/a0480a62c14623325bc09b36c9bbf224/origin.jpg',
  'https://i0.hdslb.com/bfs/mallup/mall/3y/3y/3y3y2z01013wzwyz102yyz032z2y2x2z.jpg',
];
const index = ref(0);

watch(open, (value) => { if (value) index.value = 0; });

function next(): void {
  if (index.value < QR_URLS.length - 1) index.value += 1;
}
</script>

<template>
  <PnDialog v-model:open="open" title="公众号" eyebrow="设置 › 关于" icon="infoRound">
    <div class="wechat">
      <img class="wechat__qr" :src="QR_URLS[index]" alt="公众号二维码" @error="next" />
      <span class="wechat__desc">微信扫码关注，查看 PicNexus 开发日志与进度。</span>
    </div>
    <template #footer>
      <PnButton variant="primary" size="dialog" @click="open = false">完成</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.wechat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--pn-space-12);
}

.wechat__qr {
  width: var(--pn-size-wechat-qr);
  height: var(--pn-size-wechat-qr);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-paper);
  box-shadow: 0 0 0 1px var(--pn-border);
  object-fit: contain;
}

.wechat__desc { color: var(--pn-text2); }
</style>
