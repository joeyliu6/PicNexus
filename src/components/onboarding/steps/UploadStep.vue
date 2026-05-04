<template>
  <div class="onboarding-step upload-step">
    <h2 class="step-title">上传图片</h2>
    <p class="step-desc">
      支持四种上传方式。
    </p>
    <div class="upload-methods">
      <div class="method-card">
        <i class="pi pi-arrows-alt" />
        <span class="method-label">拖拽文件</span>
        <span class="method-hint">直接拖入窗口</span>
      </div>
      <div class="method-card">
        <i class="pi pi-folder-open" />
        <span class="method-label">点击选择</span>
        <span class="method-hint">浏览本地文件</span>
      </div>
      <div class="method-card">
        <i class="pi pi-clipboard" />
        <span class="method-label">粘贴上传</span>
        <span class="method-hint">Ctrl + V</span>
      </div>
      <div class="method-card">
        <i class="pi pi-link" />
        <span class="method-label">URL 下载</span>
        <span class="method-hint">粘贴图片链接</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-step {
  text-align: center;
}

.step-title {
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  color: var(--text-main);
  margin: 0 0 var(--space-md);
}

.step-desc {
  font-size: var(--text-base);
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0 0 var(--space-xl);
}

.upload-methods {
  display: grid;
  grid-template-columns: repeat(2, minmax(110px, 1fr));
  gap: var(--space-md);
  width: min(100%, 460px);
  margin: 0 auto;
}

.method-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: var(--space-xs-sm);
  height: 100px;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  border: none;
  min-width: 0;
}

.method-card .pi {
  font-size: var(--text-2xl);
  color: var(--primary);
}

.method-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
}

.method-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

@media (width <= 520px) {
  .upload-methods {
    grid-template-columns: 1fr;
  }
}
</style>
