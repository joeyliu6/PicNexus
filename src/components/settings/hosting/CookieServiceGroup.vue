<script setup lang="ts">
import HostingCard from '../HostingCard.vue';
import SensitiveField from '../../common/SensitiveField.vue';
import WeiboLinkPrefixSection from './WeiboLinkPrefixSection.vue';
import ZhihuSourceSection from './ZhihuSourceSection.vue';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';
import type { LinkPrefixItem } from '../../../config/types';
import { computed } from 'vue';
import { hasNonEmptyFields } from '../../../utils/validators';
import { extractNamiAuthToken } from '../../../utils/namiAuthToken';
import { useSensitiveDraft } from '../../../composables/settings/useSensitiveDraft';
import { useSecretClearConfirm } from '../../../composables/settings/useSecretClearConfirm';

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
  return hasNonEmptyFields(props.cookieFormData[providerId], ['cookie']);
}

const namiAuthToken = computed(() => extractNamiAuthToken(props.cookieFormData.nami.cookie));

/**
 * Cookie 的按需揭示
 *
 * Cookie 是明文存在 formData 里的（整份 .settings.dat 由 EncryptedStore 统一加密），
 * 所以"揭示"就是读回来，不涉及解密。这里要的是界面契约：存过之后框里是空的、
 * 只挂一个「已保存」芯片，想看内容才点眼睛。
 *
 * 顺带解决一个体感问题：Cookie 动辄上千字符，铺在框里除了占地方没别的用处。
 */
function writeCookie(data: CookieFormData, id: CookieProviderId, value: string): void {
  data[id].cookie = value;
}

const confirmClearSecret = useSecretClearConfirm();

const secrets = useSensitiveDraft({
  hasStored: id => !!props.cookieFormData[id as CookieProviderId]?.cookie,
  reveal: id => Promise.resolve(props.cookieFormData[id as CookieProviderId]?.cookie ?? ''),
  commit: (id, draft) => {
    // draft 为空串 = 清除；Cookie 是明文字段，直接写空即可
    writeCookie(props.cookieFormData, id as CookieProviderId, draft);
    emit('save');
  },
  confirmClear: confirmClearSecret,
});

/** 纳米的 Auth-Token 是从 Cookie 现算出来的展示值，不落库、也没有草稿可提交 */
const revealNamiAuthToken = () => Promise.resolve(namiAuthToken.value);

function helperHint(serviceId: CookieProviderId): string {
  if (serviceId === 'nami') {
    return '纳米上传时会由 Rust 后端启动本机辅助程序 nami-token-fetcher，根据 Cookie/Auth-Token 获取动态上传 headers；不会持久化账号凭据，相关日志会脱敏。';
  }
  return '点击「自动获取」登录即可自动填入 Cookie，无需手动操作。';
}
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
          <label>
            Cookie
            <span v-if="secrets.hasStored(svc.id)" class="saved-chip">
              <i class="pi pi-check" aria-hidden="true"></i>{{ secrets.chipLabel(svc.id) }}
            </span>
          </label>
          <SensitiveField
            v-bind="secrets.bindingsFor(svc.id, '从浏览器开发者工具中复制完整的 Cookie 字符串')"
            multiline
            :rows="4"
            input-class="cookie-field"
          />
          <small class="form-hint">{{ helperHint(svc.id) }}<br>这些服务均为非官方适配，请自行确认平台规则并承担账号与数据风险</small>
        </div>
        <div v-if="svc.id === 'nami' && namiAuthToken" class="form-item span-full">
          <label>Auth-Token（自动提取）</label>
          <SensitiveField
            modelValue=""
            readonly
            autocomplete="off"
            :has-stored-value="true"
            :reveal-stored="revealNamiAuthToken"
          />
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
