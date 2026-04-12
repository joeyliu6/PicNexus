<script setup lang="ts">
import { ref } from 'vue';
import Dialog from 'primevue/dialog';

const visible = defineModel<boolean>('visible', { required: true });

const qrUrls = [
  'https://img30.360buyimg.com/imgzone/jfs/t20270426/407340/25/5886/9398/69bfb02cF39ca7cbf/093610210288c390.jpg',
  'https://p.cldisk.com/star4/a0480a62c14623325bc09b36c9bbf224/origin.jpg',
  'https://i0.hdslb.com/bfs/mallup/mall/3y/3y/3y3y2z01013wzwyz102yyz032z2y2x2z.jpg',
];
const qrUrlIndex = ref(0);

function onQrError() {
  if (qrUrlIndex.value < qrUrls.length - 1) {
    qrUrlIndex.value++;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :style="{ width: 'var(--dialog-width-sm)' }"
    :draggable="false"
    :closable="true"
    :pt="{ root: { class: 'wechat-qr-dialog' } }"
  >
    <template #header>
      <div class="wechat-dialog-header">
        <div class="wechat-header-icon-wrap">
          <i class="pi pi-qrcode" />
        </div>
        <span class="wechat-header-title">公众号</span>
      </div>
    </template>

    <div class="wechat-dialog-body">
      <div class="wechat-qr-frame">
        <img
          class="wechat-qr-img"
          :src="qrUrls[qrUrlIndex]"
          alt="公众号二维码"
          @error="onQrError"
        />
      </div>
      <div class="wechat-badge">
        <i class="pi pi-comments" />
        微信公众号
      </div>
      <p class="wechat-dialog-desc">扫码关注，查看 PicNexus 开发日志与进度。</p>
    </div>
  </Dialog>
</template>

<style scoped>
:global(.wechat-qr-dialog) {
  border-radius: var(--radius-xl) !important;
  overflow: hidden;
}

:global(.wechat-qr-dialog .p-dialog-header) {
  border-bottom: none !important;
  padding-bottom: var(--space-md) !important;
}

:global(.wechat-qr-dialog .p-dialog-content) {
  padding-top: var(--space-sm) !important;
}

.wechat-dialog-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
}

.wechat-header-icon-wrap {
  width: 28px;
  height: 28px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 7px 无对应 radius token，介于 sm-md(6) 与 md(8) 之间 */
  border-radius: 7px;
  background: var(--primary-alpha-10);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wechat-header-icon-wrap i {
  font-size: var(--text-base);
  color: var(--primary);
}

.wechat-header-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.wechat-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-sm) 0;
}

.wechat-qr-frame {
  padding: var(--space-lg);
  background: var(--wechat-qr-bg);
  border-radius: var(--radius-lg);
  box-shadow: 0 2px 12px var(--wechat-qr-shadow);
  border: 1px solid var(--wechat-qr-border);
}

.wechat-qr-img {
  width: 180px;
  height: 180px;
  display: block;
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.wechat-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border-radius: var(--radius-2xl);
  background: var(--wechat-green);
  color: var(--wechat-green-text);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.wechat-badge i {
  font-size: var(--text-xs);
}

.wechat-dialog-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-align: center;
  line-height: 1.7;
  margin: 0;
}
</style>
