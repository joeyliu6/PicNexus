<template>
  <div class="onboarding-step welcome-step">
    <h2 class="step-title">欢迎使用 PicNexus</h2>
    <p class="step-desc">
      多图床并行上传工具
    </p>
    <div class="step-highlights">
      <div class="highlight-item">
        <div class="highlight-icon">
          <i class="pi pi-clone" />
        </div>
        <span>多图床并行</span>
      </div>
      <div class="highlight-item">
        <div class="highlight-icon">
          <i class="pi pi-link" />
        </div>
        <span>多格式输出</span>
      </div>
      <div class="highlight-item">
        <div class="highlight-icon">
          <i class="pi pi-check-circle" />
        </div>
        <span>开箱即用</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-step {
  text-align: center;
}

.step-title {
  font-size: var(--text-2xl);
  font-weight: var(--weight-bold);
  color: var(--text-main);
  margin: 0 0 8px;
}

.step-desc {
  font-size: var(--text-base);
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
  font-size: var(--text-2xl);
}

.highlight-item span {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-main);
}
</style>
