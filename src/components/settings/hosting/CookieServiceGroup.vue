<script setup lang="ts">
import Textarea from 'primevue/textarea';
import InputText from 'primevue/inputtext';
import HostingCard from '../HostingCard.vue';
import WeiboLinkPrefixSection from './WeiboLinkPrefixSection.vue';
import ZhihuSourceSection from './ZhihuSourceSection.vue';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import type { LinkPrefixItem } from '../../../config/types';
import { computed } from 'vue';

interface CookieFormData {
  weibo: { cookie: string };
  zhihu: { cookie: string; sourceParamEnabled?: boolean; sourceParamValue?: string };
  nowcoder: { cookie: string };
  nami: { cookie: string };
  bilibili: { cookie: string };
  chaoxing: { cookie: string };
}

type CookieProviderId = keyof CookieFormData;

const COOKIE_SERVICES: Array<{ id: CookieProviderId; name: string; description: string }> = [
  { id: 'weibo', name: '微博', description: '新浪微博图床' },
  { id: 'zhihu', name: '知乎', description: '知乎图床' },
  { id: 'nowcoder', name: '牛客', description: '牛客网图床' },
  { id: 'nami', name: '纳米', description: '纳米图床' },
  { id: 'bilibili', name: 'B站', description: 'Bilibili 图床' },
  { id: 'chaoxing', name: '超星', description: '超星图床' },
];

// NOTE: cookieFormData 通过引用传递，子组件直接修改嵌套属性是有意为之的设计
// 父组件（HostingSettingsPanel）负责监听 save 事件触发持久化
const props = defineProps<{
  cookieFormData: CookieFormData;
  testingConnections: Record<string, boolean>;
  healthStatusMap: Record<string, ServiceHealthStatus>;
  healthTooltipMap: Record<string, string>;
  refreshingServiceIds: Set<string>;
  targetCardId?: string | null;
  linkPrefixEnabled: boolean;
  prefixList: LinkPrefixItem[];
  selectedPrefixIndex: number;
}>();

const emit = defineEmits<{
  save: [];
  testCookie: [providerId: string];
  loginCookie: [providerId: string];
  'update:linkPrefixEnabled': [enabled: boolean];
  'update:selectedPrefixIndex': [index: number];
  addPrefix: [item: LinkPrefixItem];
  updatePrefix: [payload: { index: number; item: LinkPrefixItem }];
  removePrefix: [index: number];
  resetToDefault: [];
}>();

function isCookieConfigured(providerId: CookieProviderId): boolean {
  return !!props.cookieFormData[providerId].cookie?.trim();
}

const namiAuthToken = computed(() => {
  return props.cookieFormData.nami.cookie?.match(/auth-token=([^;]+)/)?.[1] || '';
});
</script>

<template>
  <!-- eslint-disable vue/no-mutating-props -- 见 script 顶部 NOTE：cookieFormData 通过引用传递是有意为之的设计，父组件 HostingSettingsPanel 通过 save 事件持久化 -->
  <div class="provider-grid">
    <HostingCard
      v-for="svc in COOKIE_SERVICES"
      :key="svc.id"
      :id="svc.id"
      :force-expand="targetCardId === svc.id"
      :name="svc.name"
      :description="svc.description"
      :isConfigured="isCookieConfigured(svc.id)"
      :health-status="healthStatusMap[svc.id]"
      :health-tooltip="healthTooltipMap[svc.id]"
      :isTesting="testingConnections[svc.id]"
      :is-refreshing="refreshingServiceIds.has(svc.id)"
      :showLoginButton="true"
      @test="emit('testCookie', $event)"
      @login="emit('loginCookie', $event)"
    >
      <form class="form-grid" @submit.prevent>
        <div class="form-item span-full">
          <label>Cookie</label>
          <Textarea v-model="cookieFormData[svc.id].cookie" @blur="emit('save')" rows="4" class="w-full cookie-field" placeholder="从浏览器开发者工具中复制完整的 Cookie 字符串" />
          <small class="form-hint">点击「自动获取」登录即可自动填入 Cookie，无需手动操作<br>如需手动填写，可在浏览器中登录后通过开发者工具（F12 → Network）复制 Cookie</small>
        </div>
        <div v-if="svc.id === 'nami' && namiAuthToken" class="form-item span-full">
          <label>Auth-Token（自动提取）</label>
          <InputText :modelValue="namiAuthToken" readonly class="w-full" disabled />
        </div>
      </form>
      <template #extra>
        <WeiboLinkPrefixSection
          v-if="svc.id === 'weibo'"
          :link-prefix-enabled="linkPrefixEnabled"
          :prefix-list="prefixList"
          :selected-prefix-index="selectedPrefixIndex"
          @update:link-prefix-enabled="emit('update:linkPrefixEnabled', $event)"
          @update:selected-prefix-index="emit('update:selectedPrefixIndex', $event)"
          @save="emit('save')"
          @add-prefix="emit('addPrefix', $event)"
          @update-prefix="emit('updatePrefix', $event)"
          @remove-prefix="emit('removePrefix', $event)"
          @reset-to-default="emit('resetToDefault')"
        />
        <ZhihuSourceSection
          v-else-if="svc.id === 'zhihu'"
          :enabled="cookieFormData.zhihu.sourceParamEnabled ?? true"
          :value="cookieFormData.zhihu.sourceParamValue ?? ''"
          @update:enabled="(v: boolean) => { cookieFormData.zhihu.sourceParamEnabled = v; }"
          @update:value="(v: string) => { cookieFormData.zhihu.sourceParamValue = v; }"
          @save="emit('save')"
        />
      </template>
    </HostingCard>
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');

.cookie-field {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.5;
  word-break: break-all;
}
</style>
