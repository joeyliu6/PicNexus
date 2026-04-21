<template>
  <div class="login-container">
    <!-- 主内容区 -->
    <div class="content-area">
      <div class="dialog-body">
        <!-- 图标 -->
        <div class="icon-container">
          <i class="pi pi-shield"></i>
        </div>

        <!-- 标题与描述 -->
        <h2 class="dialog-title">准备登录 {{ provider.name }}</h2>
        <p class="dialog-desc">
          点击下方按钮将在本窗口加载 {{ provider.name }} 登录页面。登录成功后自动获取
          Cookie 以便进行图片上传。
        </p>

        <!-- 安全提示 -->
        <div class="security-tip">
          <div class="tip-header">
            <i class="pi pi-info-circle"></i>
            <span>安全提示</span>
          </div>
          <p class="tip-text">
            PicNexus 仅获取必要 Cookie，绝不保存您的账号密码。
          </p>
        </div>

        <!-- 操作按钮 -->
        <div class="actions">
          <Button
            label="开始登录"
            icon="pi pi-sign-in"
            class="btn-primary"
            @click="$emit('startLogin')"
          />
          <Button
            label="取消"
            outlined
            class="btn-cancel"
            @click="$emit('close')"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import Button from 'primevue/button';
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
.login-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-app);
  color: var(--text-main);
  user-select: none;
  overflow: hidden;
}

/* 主内容区 */
.content-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xl) var(--space-xl);
  overflow-y: auto;
}

.dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 340px;
}

/* 图标 */
.icon-container {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 1.5px solid var(--border-subtle);
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-lg-xl);
}

.icon-container i {
  font-size: var(--text-2xl);
  color: var(--primary);
}

/* 标题 */
.dialog-title {
  font-size: var(--text-lg-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-main);
  margin: 0 0 var(--space-sm-md);
  text-align: center;
}

.dialog-desc {
  font-size: var(--text-sm);
  color: var(--text-muted);
  line-height: 1.7;
  text-align: center;
  margin: 0 0 var(--space-lg-xl);
}

/* 安全提示 */
.security-tip {
  width: 100%;
  background: var(--primary-alpha-6);
  border: 1px solid var(--primary-alpha-15);
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-md-lg);
  margin-bottom: var(--space-xl);
}

.tip-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  margin-bottom: var(--space-xs-sm);
}

.tip-header i {
  font-size: var(--text-sm);
  color: var(--primary);
}

.tip-header span {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--primary);
}

.tip-text {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

/* 按钮 */
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm-md);
  width: 100%;
}

:deep(.btn-primary.p-button) {
  width: 100%;
  height: 40px;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  justify-content: center;
}

:deep(.btn-cancel.p-button) {
  width: 100%;
  height: 38px;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  justify-content: center;
  border-color: var(--border-subtle);
  color: var(--text-muted);
}

:deep(.btn-cancel.p-button:hover) {
  border-color: var(--text-muted);
  background: var(--hover-overlay-subtle);
}

</style>
