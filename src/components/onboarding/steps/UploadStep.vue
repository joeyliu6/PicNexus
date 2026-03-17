<template>
  <div class="onboarding-step upload-step">
    <div class="step-icon">
      <i class="pi pi-upload" />
    </div>
    <h2 class="step-title">拖拽即上传</h2>
    <p class="step-desc">
      将图片拖入窗口即可上传，京东图床已默认启用，无需任何配置。
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
}

.upload-methods {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.method-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 16px 20px;
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  min-width: 110px;
}

.method-card .pi {
  font-size: 22px;
  color: var(--primary);
}

.method-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-main);
}

.method-hint {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
