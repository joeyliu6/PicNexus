<template>
  <div class="onboarding-step upload-step">
    <h2 class="step-title">上传图片</h2>
    <p class="step-desc">
      支持三种上传方式，京东图床已默认启用。上传后自动生成 URL、Markdown、HTML 等格式链接。
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
  display: flex;
  gap: var(--space-md);
  justify-content: center;
}

.method-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-lg) var(--space-lg-xl);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  border: none;
  min-width: 110px;
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
</style>
