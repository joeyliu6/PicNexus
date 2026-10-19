<script setup lang="ts">
// 引导 1 / 3 · 欢迎（O01）：一张图讲清产品——一张图片同时存到三个图床，其中一份失效时改用另一份。
// 背景装饰只用在这一页（交接说明规则 7）；插图是示意，状态词照设计稿（失效 / 改用此副本 / 正常）。
import BgDecor from '@/components/biz/BgDecor.vue';
import HostIcon from '@/components/biz/HostIcon.vue';

const ROWS = [
  { host: 'weibo', name: '微博', status: '失效', tone: 'bad' },
  { host: 'jd', name: '京东', status: '改用此副本', tone: 'pick' },
  { host: 'r2', name: 'Cloudflare R2', status: '正常', tone: 'ok' },
] as const;
</script>

<template>
  <div class="welcome">
    <BgDecor fade-from="0px" fade-to="0px" />

    <div class="welcome__art" aria-hidden="true">
      <div class="welcome__shot">
        <span class="welcome__shot-bar" />
        <span class="welcome__shot-side" />
        <span class="welcome__shot-block" />
        <span class="welcome__shot-accent" />
      </div>
      <svg class="welcome__lines" viewBox="0 0 420 220">
        <line x1="150" y1="109" x2="241.35" y2="68.33" />
        <line x1="150" y1="111" x2="250" y2="111" />
        <line x1="150" y1="113" x2="241.35" y2="153.67" />
      </svg>
      <div class="welcome__rows">
        <div v-for="row in ROWS" :key="row.host" class="welcome__row" :class="`welcome__row--${row.tone}`">
          <span class="welcome__plate"><HostIcon :host="row.host" :size="15" /></span>
          <span class="welcome__name">{{ row.name }}</span>
          <span class="welcome__status">{{ row.status }}</span>
        </div>
      </div>
    </div>

    <h2 class="welcome__title">一张图，多个图床同时备份</h2>
    <p class="welcome__desc">上传时同时保存到多个图床，并自动复制链接。某个图床失效时，可切换到备份链接，并修复文档中的旧链接。</p>
  </div>
</template>

<style scoped>
.welcome {
  position: relative;
  isolation: isolate;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  padding: var(--pn-space-onboarding-page);
  text-align: center;
}

.welcome__art {
  position: relative;
  flex: none;
  width: var(--pn-size-onboarding-art-w);
  height: var(--pn-size-onboarding-art-h);
}

.welcome__shot {
  position: absolute;
  left: var(--pn-space-onboarding-shot-left);
  top: var(--pn-space-onboarding-shot-top);
  width: var(--pn-size-onboarding-shot-w);
  height: var(--pn-size-onboarding-shot-h);
  overflow: hidden;
  border-radius: var(--pn-radius-lg);
  background: var(--pn-onboarding-shot-bg);
  box-shadow: var(--pn-e3);
}

.welcome__shot > span { position: absolute; }
.welcome__shot-bar { inset: 0 0 auto; height: 14%; background: var(--pn-onboarding-shot-bar); }
.welcome__shot-side { top: 14%; bottom: 0; left: 0; width: 22%; background: var(--pn-onboarding-shot-side); }

.welcome__shot-block {
  left: 30%;
  top: 30%;
  width: 60%;
  height: 26%;
  border-radius: var(--pn-radius-onboarding-shot-block);
  background: var(--pn-onboarding-shot-block);
}

.welcome__shot-accent {
  left: 30%;
  top: 64%;
  width: 40%;
  height: 18%;
  border-radius: var(--pn-radius-onboarding-shot-block);
  background: var(--pn-onboarding-shot-accent);
}

.welcome__lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  stroke: var(--pn-border-strong);
  stroke-width: 2;
}

.welcome__rows {
  position: absolute;
  left: var(--pn-space-onboarding-rows-left);
  top: var(--pn-space-onboarding-rows-top);
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
}

.welcome__row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  width: var(--pn-size-onboarding-row-w);
  height: var(--pn-size-onboarding-row-h);
  box-sizing: border-box;
  padding: 0 var(--pn-space-onboarding-row-x);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
  font-size: var(--pn-text-footnote);
}

.welcome__row--bad { background: var(--pn-warning-soft); box-shadow: inset 0 0 0 var(--pn-space-1) var(--pn-warning-fill); }
.welcome__row--pick { background: var(--pn-brand-soft); box-shadow: inset 0 0 0 var(--pn-space-2) var(--pn-brand); }

.welcome__plate {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-onboarding-row-plate);
  height: var(--pn-size-onboarding-row-plate);
  border-radius: var(--pn-radius-sm);
  background: var(--pn-elevated);
  color: var(--pn-text2);
}

.welcome__name { flex: 1; text-align: left; }
.welcome__row--pick .welcome__name { font-weight: var(--pn-weight-medium); }
.welcome__row--bad .welcome__status { color: var(--pn-danger); }
.welcome__row--pick .welcome__status { color: var(--pn-brand-text); font-weight: var(--pn-weight-medium); }
.welcome__row--ok .welcome__status { color: var(--pn-success); }

.welcome__title {
  margin: var(--pn-space-onboarding-gap) 0 0;
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-onboarding-title);
}

.welcome__desc {
  max-width: var(--pn-size-onboarding-text);
  margin: var(--pn-space-onboarding-desc) 0 0;
  color: var(--pn-text2);
}
</style>
