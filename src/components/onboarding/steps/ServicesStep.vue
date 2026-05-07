<template>
  <div class="onboarding-step services-step">
    <h2 class="step-title">支持的图床</h2>
    <p class="step-desc">
      京东、七鱼可开箱使用，其他图床按需配置。
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
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  color: var(--text-main);
  margin: 0 0 var(--space-md);
}

.step-desc {
  font-size: var(--text-base);
  color: var(--text-muted);
  line-height: 1.6;
  margin: 0 0 var(--space-lg-xl);
}

.service-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm-md);
  text-align: left;
}

.service-group {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  padding: var(--space-sm-md) var(--space-md-lg);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  border: none;
}

.group-header {
  flex: 0 0 88px;
  display: flex;
  justify-content: flex-start;
}

.group-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-sm-md);
  white-space: nowrap;
  width: 88px;
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
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-main);
  text-align: left;
}
</style>
