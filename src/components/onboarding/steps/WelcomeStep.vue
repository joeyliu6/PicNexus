<template>
  <div class="onboarding-step welcome-step">
    <h2 class="step-title">欢迎使用 PicNexus</h2>
    <p class="step-desc">
      简单、专业、安全的多图床上传工具
    </p>
    <div class="step-highlights">
      <div class="highlight-item">
        <div class="highlight-icon">
          <i class="pi pi-bolt" />
        </div>
        <span>极速上传</span>
      </div>
      <div class="highlight-item">
        <div class="highlight-icon">
          <i class="pi pi-cloud" />
        </div>
        <span>多图床支持</span>
      </div>
      <div class="highlight-item">
        <div class="highlight-icon">
          <i class="pi pi-shield" />
        </div>
        <span>安全加密</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-step {
  text-align: center;
}

.step-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--text-main);
  margin: 0 0 8px;
}

.step-desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0 0 28px;
  max-width: 380px;
  margin-left: auto;
  margin-right: auto;
}

.step-highlights {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.highlight-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 12px;
  border-radius: 12px;
  background: var(--bg-input);
  border: none;
  text-align: center;
}

.highlight-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--primary-alpha-15);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.highlight-icon .pi {
  font-size: 22px;
}

.highlight-item span {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}
</style>
