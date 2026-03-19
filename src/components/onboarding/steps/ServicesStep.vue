<template>
  <div class="onboarding-step services-step">
    <div class="step-icon">
      <i class="pi pi-server" />
    </div>
    <h2 class="step-title">配置更多图床</h2>
    <p class="step-desc">
      除了开箱即用的图床，你还可以在设置中配置更多图床服务。
    </p>
    <div class="service-groups">
      <div class="service-group">
        <div class="group-header">
          <span class="group-badge ready">开箱即用</span>
        </div>
        <div class="group-items">京东、七鱼、牛客</div>
      </div>
      <div class="service-group">
        <div class="group-header">
          <span class="group-badge cookie">Cookie 登录</span>
        </div>
        <div class="group-items">微博、知乎、B站、纳米、超星</div>
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
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.group-badge.cookie {
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
}

.group-badge.token {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.group-badge.cloud {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
}

.group-items {
  font-size: 13px;
  color: var(--text-main);
}
</style>
