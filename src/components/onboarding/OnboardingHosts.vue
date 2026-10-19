<script setup lang="ts">
// 引导 2 / 3 · 选图床（O02）：免配置的京东、七鱼两张勾选卡，勾选即视为确认公共图床风险（说明写在下面）；
// 其他图床只写一行「可稍后在「图床」页添加」。勾选只改本地选择，「开始使用」时一次写进配置。
import HostIcon from '@/components/biz/HostIcon.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { STARTER_HOSTS, laterHostCount, type StarterHostId } from './onboardingModel';

defineProps<{ hosts: Record<StarterHostId, boolean> }>();
defineEmits<{ toggle: [id: StarterHostId, on: boolean] }>();

const laterCount = laterHostCount();
</script>

<template>
  <div class="hosts">
    <div class="hosts__head">
      <h2 class="hosts__title">选择图床</h2>
      <span class="hosts__desc">以下图床无需账号，勾选即可使用。建议全部勾选，互为备份。</span>
    </div>

    <div class="hosts__grid">
      <button
        v-for="host in STARTER_HOSTS"
        :key="host.id"
        type="button"
        role="checkbox"
        :aria-checked="hosts[host.id]"
        class="hosts__card"
        :class="{ 'hosts__card--on': hosts[host.id] }"
        @click="$emit('toggle', host.id, !hosts[host.id])"
      >
        <span class="hosts__plate"><HostIcon :host="host.id" :size="24" /></span>
        <span class="hosts__text">
          <span class="hosts__name">{{ host.name }}</span>
          <span class="hosts__sub">{{ host.desc }}</span>
        </span>
        <span class="hosts__box" aria-hidden="true">
          <PnIcon v-if="hosts[host.id]" name="check" :size="12" :stroke="3.5" />
        </span>
      </button>
    </div>

    <span class="hosts__risk">勾选即表示你已了解：这类图床是非官方接入，可能违反平台规则或随时失效，风险由你自行承担。</span>

    <div class="hosts__later">
      <PnIcon name="hosts" :size="16" :stroke="1.7" class="hosts__later-icon" />
      <span>微博、GitHub、Cloudflare R2、WebDAV 等 {{ laterCount }} 种图床，可稍后在「图床」页添加。</span>
    </div>
  </div>
</template>

<style scoped>
.hosts {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-onboarding-gap);
  padding: var(--pn-space-onboarding-page);
}

.hosts__head { display: flex; flex-direction: column; gap: var(--pn-space-6); }

.hosts__title {
  margin: 0;
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-onboarding-title);
}

.hosts__desc { color: var(--pn-text2); }

.hosts__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--pn-space-12);
}

.hosts__card {
  display: flex;
  align-items: center;
  gap: var(--pn-space-onboarding-card-gap);
  height: var(--pn-size-onboarding-card);
  box-sizing: border-box;
  padding: 0 var(--pn-space-onboarding-card-x);
  border: 0;
  border-radius: var(--pn-radius-xl);
  background: var(--pn-subtle);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.hosts__card--on { background: var(--pn-brand-soft); box-shadow: inset 0 0 0 var(--pn-space-2) var(--pn-brand); }

.hosts__plate {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-onboarding-plate);
  height: var(--pn-size-onboarding-plate);
  border-radius: var(--pn-radius-onboarding-plate);
  background: var(--pn-elevated);
  box-shadow: 0 0 0 var(--pn-space-1) var(--pn-hairline);
  color: var(--pn-text2);
}

.hosts__text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.hosts__name { font-weight: var(--pn-weight-semibold); }
.hosts__sub { font-size: var(--pn-text-footnote); line-height: var(--pn-leading-footnote); color: var(--pn-text2); }

.hosts__box {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-onboarding-check);
  height: var(--pn-size-onboarding-check);
  box-sizing: border-box;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-elevated);
  box-shadow: inset 0 0 0 var(--pn-space-1) var(--pn-check-border);
  color: var(--pn-on-fill);
}

.hosts__card--on .hosts__box { background: var(--pn-brand); box-shadow: none; }

.hosts__risk { font-size: var(--pn-text-footnote); line-height: var(--pn-leading-footnote); color: var(--pn-text3); }

.hosts__later {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  margin-top: auto;
  margin-bottom: var(--pn-space-8);
  padding: var(--pn-space-onboarding-panel);
  border-radius: var(--pn-radius-onboarding-note);
  background: var(--pn-subtle);
  color: var(--pn-text2);
}

.hosts__later-icon { flex: none; color: var(--pn-text3); }
</style>
