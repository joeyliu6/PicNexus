<template>
  <div class="onboarding-step services-step">
    <h2 class="step-title">支持的图床</h2>
    <p class="step-desc">
      在设置中按需开启，支持并行上传到多个图床。
    </p>
    <div class="service-groups">
      <div class="service-group">
        <div class="group-header">
          <span class="group-badge ready">开箱即用</span>
        </div>
        <div class="group-items">京东、七鱼</div>
      </div>
      <div class="service-group">
        <div class="group-header">
          <span class="group-badge cookie">Cookie 登录</span>
        </div>
        <div class="group-items">微博、知乎、B站、纳米、超星、牛客</div>
      </div>
      <div class="service-group">
        <div class="group-header">
          <span class="group-badge token">Token 配置</span>
        </div>
        <div class="group-items">SM.MS、GitHub、Imgur</div>
      </div>
      <div class="service-group">
        <div class="group-header">
          <span class="group-badge cloud">云存储</span>
        </div>
        <div class="group-items">R2、阿里云、腾讯云、七牛、又拍</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.services-step {
  text-align: center;
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
  margin: 0 0 20px;
}

.service-groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}

.service-group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--bg-input);
  border: none;
}

.group-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
  min-width: 72px;
  text-align: center;
}

.group-badge.ready {
  background: var(--success-alpha-15);
  color: var(--success);
}

.group-badge.cookie {
  background: var(--warning-alpha-15);
  color: var(--warning);
}

.group-badge.token {
  background: var(--primary-alpha-15);
  color: var(--primary);
}

.group-badge.cloud {
  background: var(--pending-alpha-15);
  color: var(--pending);
}

.group-items {
  font-size: 13px;
  color: var(--text-main);
}
</style>
