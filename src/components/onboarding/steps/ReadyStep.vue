<template>
  <div class="onboarding-step ready-step">
    <div class="step-icon">
      <i class="pi pi-check" />
    </div>
    <h2 class="step-title">准备就绪</h2>
    <p class="step-desc">
      你已经了解了 PicNexus 的核心功能，现在就开始上传吧！
    </p>
    <div class="tip-list">
      <div class="tip-item">
        <i class="pi pi-history" />
        <div class="tip-content">
          <span class="tip-label">历史记录</span>
          <span class="tip-hint">侧边栏可查看所有上传记录</span>
        </div>
      </div>
      <div class="tip-item">
        <i class="pi pi-link" />
        <div class="tip-content">
          <span class="tip-label">链接格式</span>
          <span class="tip-hint">支持 URL、Markdown、HTML 等格式</span>
        </div>
      </div>
      <div class="tip-item">
        <i class="pi pi-cog" />
        <div class="tip-content">
          <span class="tip-label">更多设置</span>
          <span class="tip-hint">主题、备份同步、应用行为等</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ready-step {
  text-align: center;
}

.step-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: #22c55e;
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
}

.tip-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
}

.tip-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
}

.tip-item > .pi {
  font-size: 18px;
  color: var(--primary);
  flex-shrink: 0;
}

.tip-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tip-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-main);
}

.tip-hint {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
