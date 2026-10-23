<script setup lang="ts">
// Cookie 登录小窗的准备页（CookieWindow.dc.html，P16）：图标、「登录微博」、一句说明、隐私说明、取消 / 开始登录；
// 底部一行「此处将显示微博官方登录页」。点「开始登录」后整页换成网站自己的登录页，登录成功窗口自动关闭。
import HostIcon from '@/components/biz/HostIcon.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import type { CookieProvider } from '@/config/cookieProviders';
import { joinCjk } from '@/utils/cjkSpacing';

defineProps<{
  provider: CookieProvider;
  /** 「开始登录」失败的原因 + 处理办法 */
  error?: string;
}>();

defineEmits<{ startLogin: []; close: [] }>();
</script>

<template>
  <div class="login-panel">
    <div class="login-panel__body">
      <span class="login-panel__icon"><HostIcon :host="provider.serviceId" :name="provider.name" :size="37" /></span>
      <h1 class="login-panel__title">{{ joinCjk('登录', provider.name) }}</h1>
      <p class="login-panel__desc">{{ joinCjk('将在此窗口打开', provider.name, '官方登录页，登录成功后自动关闭。') }}</p>
      <div class="login-panel__note">
        <PnIcon name="shieldCheck" :size="15" :stroke="1.8" class="login-panel__shield" />
        <span>仅读取上传所需的 Cookie，不保存账号与密码。</span>
      </div>
      <div class="login-panel__actions">
        <PnButton variant="secondary" @click="$emit('close')">取消</PnButton>
        <PnButton variant="primary" @click="$emit('startLogin')">开始登录</PnButton>
      </div>
      <p v-if="error" class="login-panel__error" role="alert">{{ error }}</p>
    </div>
    <div class="login-panel__foot">{{ joinCjk('此处将显示', provider.name, '官方登录页') }}</div>
  </div>
</template>

<style scoped>
.login-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--pn-canvas);
  color: var(--pn-text1);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-body);
  line-height: var(--pn-leading-login);
}

.login-panel__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-12);
  padding: 0 var(--pn-space-login-x);
  text-align: center;
}

.login-panel__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-login-icon);
  height: var(--pn-size-login-icon);
  border-radius: var(--pn-radius-xl);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
  color: var(--pn-text2);
}

.login-panel__title {
  margin: var(--pn-space-6) 0 0;
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-title);
}

.login-panel__desc {
  margin: 0;
  color: var(--pn-text2);
}

.login-panel__note {
  display: flex;
  align-items: flex-start;
  gap: var(--pn-space-8);
  margin-top: var(--pn-space-8);
  padding: var(--pn-space-login-note);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  text-align: left;
}

.login-panel__shield {
  flex: none;
  margin-top: var(--pn-space-1);
  color: var(--pn-success);
}

.login-panel__actions {
  display: flex;
  gap: var(--pn-space-8);
  margin-top: var(--pn-space-login-actions);
}

.login-panel__error {
  margin: 0;
  color: var(--pn-danger);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.login-panel__foot {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: var(--pn-size-login-foot);
  border-top: 1px solid var(--pn-border);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}
</style>
