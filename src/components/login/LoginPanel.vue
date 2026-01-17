<template>
  <div class="login-container">
    <!-- 自定义窗口标题栏（可拖拽） -->
    <div class="window-header" data-tauri-drag-region>
      <div class="header-title">
        <i class="pi pi-lock"></i>
        <span>{{ provider.name }}登录授权</span>
      </div>
    </div>

    <div class="content-area">
      <Card class="login-card" :pt="{ body: { class: 'p-0' }, content: { class: 'p-0' } }">
        <template #content>
          <div class="card-inner">
            <!-- 状态图标 -->
            <div class="status-icon-wrapper">
              <i class="pi pi-user-edit animate-pulse"></i>
            </div>

            <!-- 文本提示 -->
            <div class="text-section">
              <h2 class="title">准备登录{{ provider.name }}</h2>
              <p class="description">
                点击下方按钮将在本窗口加载{{ provider.name }}登录页面。<br>
                登录成功后，页面会自动检测并获取Cookie。
              </p>
            </div>

            <!-- 提示消息 -->
            <Message severity="info" :closable="false" class="custom-message">
              <template #icon>
                <i class="pi pi-info-circle"></i>
              </template>
              <span class="message-text">我们仅获取必要的 Cookie 用于上传，不会保存您的密码。</span>
            </Message>

            <!-- 操作按钮组 -->
            <div class="actions">
              <Button
                label="🚀 开始登录"
                icon="pi pi-sign-in"
                severity="primary"
                class="action-button"
                @click="$emit('startLogin')"
              />
              <Button
                label="取消"
                icon="pi pi-times"
                outlined
                severity="danger"
                class="action-button"
                @click="$emit('close')"
              />
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- 底部状态栏 -->
    <div class="status-bar">
      <span class="status-text">PicNexus 安全上下文</span>
      <div class="secure-indicator">
        <div class="dot"></div>
        <span>已加密</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import Message from 'primevue/message';
import type { CookieProvider } from '@/config/cookieProviders';

defineProps<{
  provider: CookieProvider;
}>();

defineEmits<{
  startLogin: [];
  close: [];
}>();
</script>

<style scoped>
/* === 全局布局 === */
.login-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--bg-app);
  color: var(--text-main);
  user-select: none;
  overflow: hidden;
}

/* === 窗口标题栏 === */
.window-header {
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: var(--bg-titlebar);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.header-title {
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-main);
  opacity: 0.9;
}

.header-title i {
  font-size: 0.9rem;
}

/* === 内容区域 === */
.content-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  overflow-y: auto;
}

.card-inner {
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* === PrimeVue Card 深度定制 === */
:deep(.login-card.p-card) {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  width: 100%;
  max-width: 380px;
}

/* === 状态图标 === */
.status-icon-wrapper {
  background: var(--bg-app);
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  border: 2px solid var(--border-subtle);
  transition: all 0.3s ease;
}

.status-icon-wrapper i {
  font-size: 2.5rem;
  color: var(--primary);
}

.status-icon-wrapper:hover {
  border-color: var(--primary);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
}

/* === 文本区域 === */
.text-section {
  text-align: center;
  margin-bottom: 24px;
  width: 100%;
}

.title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 0 0 12px 0;
  line-height: 1.3;
}

.description {
  font-size: 0.875rem;
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0;
}

/* === 自定义 Message 组件 === */
.custom-message {
  width: 100%;
  margin-bottom: 24px;
}

:deep(.custom-message.p-message) {
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 8px;
  padding: 12px 16px;
}

:deep(.custom-message .p-message-content) {
  display: flex;
  align-items: center;
  gap: 10px;
}

:deep(.custom-message .pi-info-circle) {
  color: var(--primary);
  font-size: 1rem;
}

.message-text {
  font-size: 0.8125rem;
  color: var(--text-main);
  line-height: 1.5;
}

/* === 操作按钮组 === */
.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.action-button {
  width: 100%;
}

:deep(.action-button.p-button) {
  height: 40px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

:deep(.action-button.p-button:hover) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

:deep(.action-button.p-button:active) {
  transform: translateY(0);
}

/* === 底部状态栏 === */
.status-bar {
  height: 32px;
  background: var(--bg-titlebar);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  flex-shrink: 0;
}

.status-text {
  font-size: 0.6875rem;
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.secure-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.6875rem;
  color: var(--text-muted);
  font-weight: 500;
}

.dot {
  width: 6px;
  height: 6px;
  background-color: var(--success);
  border-radius: 50%;
  animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* === 动画效果 === */
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.2);
  }
}

/* === 响应式优化 === */
@media (max-height: 700px) {
  .content-area {
    padding: 24px 20px;
  }

  .card-inner {
    padding: 24px 20px;
  }

  .status-icon-wrapper {
    width: 64px;
    height: 64px;
    margin-bottom: 20px;
  }

  .status-icon-wrapper i {
    font-size: 2rem;
  }

  .title {
    font-size: 1.125rem;
  }
}
</style>
