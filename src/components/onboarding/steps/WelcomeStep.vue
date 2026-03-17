<template>
  <div class="onboarding-step welcome-step">
    <div class="step-icon">
      <i class="pi pi-images" />
    </div>
    <h2 class="step-title">欢迎使用 PicNexus</h2>
    <p class="step-desc">
      一次上传，多处备份。PicNexus 支持同时上传到多个图床，确保你的图片永不丢失。
    </p>
    <div class="step-highlights">
      <div class="highlight-item">
        <i class="pi pi-bolt" />
        <span>拖拽即传，开箱即用</span>
      </div>
      <div class="highlight-item">
        <i class="pi pi-cloud" />
        <span>16+ 图床服务支持</span>
      </div>
      <div class="highlight-item">
        <i class="pi pi-shield" />
        <span>配置加密，安全可靠</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-step {
  text-align: center;
}

.step-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

.step-icon .pi {
  font-size: 32px;
  color: #fff;
}

.step-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-main);
  margin: 0 0 12px;
}

.step-desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0 0 24px;
  max-width: 380px;
  margin-left: auto;
  margin-right: auto;
}

.step-highlights {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  max-width: 280px;
  margin: 0 auto;
}

.highlight-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-main);
}

.highlight-item .pi {
  font-size: 16px;
  color: var(--primary);
}
</style>
