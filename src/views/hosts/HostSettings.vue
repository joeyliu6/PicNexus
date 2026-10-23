<script setup lang="ts">
// 图床详情的设置区（HostsScreen.dc.html 按图床类型分块）：免配置说明；Cookie 字段 +「重新登录…」+ 微博链接前缀 / 知乎参数；
// Token 与对象存储的表单；「高级选项」收起（摘要写在按钮旁）；R2 缩略图加速、WebDAV 防覆盖的开关写明代价。
// 已连接的图床逐项即存（父组件保存后自动测试）；连接表单里只改草稿。
import { computed, ref } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import {
  DEFAULT_CONFIG, DEFAULT_GITHUB_CDN_LIST, cloneDefaultPrefixes, isWebDAVId,
  type GithubCdnConfig, type LinkPrefixConfig, type UserConfig,
} from '@/config/types';
import { useUndoToast } from '@/composables/useUndoToast';
import { secureStorage } from '@/security/crypto';
import { isIpv4Address, isLoopbackHost, isPrivateOrReservedHost, normalizeHost } from '@/security/networkPolicy';
import { applyPrefixTemplate } from '@/utils/linkPrefixTemplate';
import { advancedSummary, type HostDescriptor } from './hostCatalog';
import { findWebdav, hostRecord } from './hostConfig';
import HostFields from './HostFields.vue';
import HostTemplateList, { type TemplateItem } from './HostTemplateList.vue';
import type { HostTestState } from './hostTestText';
import { removeTemplate, restoreTemplate } from './templateEdits';
import { useHosts } from './useHosts';

const props = defineProps<{
  hostId: string;
  descriptor: HostDescriptor;
  values: Record<string, string>;
  /** draft = 连接表单（未连接） */
  draft: boolean;
  test: HostTestState;
  narrow: boolean;
  /** Cookie 字段旁放「重新登录…」（已连接、且登录没过期时；过期时详情顶上已有这个按钮） */
  loginAction?: boolean;
}>();

const emit = defineEmits<{ commit: [key: string, value: string]; login: [] }>();

const hosts = useHosts();
const config = hosts.config;
const undo = useUndoToast();
const showAdvanced = ref(false);

const invalidField = computed(() => (props.test.phase === 'fail' && !props.test.edited ? props.test.field : undefined));
const invalidReason = computed(() => (props.test.phase === 'fail' ? props.test.reason : undefined));
const basicFields = computed(() => props.descriptor.fields.filter((f) => !f.advanced));
const advancedFields = computed(() => props.descriptor.fields.filter((f) => f.advanced));
const hasAdvanced = computed(() => advancedFields.value.length > 0 || props.descriptor.kind === 'webdav');
// 测试指到的字段收在高级选项里时自动展开，免得红框藏起来；改过那一格后也保持展开，免得边改边收起
const failedField = computed(() => (props.test.phase === 'fail' ? props.test.field : undefined));
const advancedOpen = computed(() => showAdvanced.value || advancedFields.value.some((f) => f.key === failedField.value));

/** 写成 IP 的局域网 / 本机地址：后端不用确认直接放行 */
function isLanLiteral(value: string): boolean {
  try {
    const { hostname } = new URL(value.trim());
    const host = normalizeHost(hostname);
    return isLoopbackHost(host) || ((isIpv4Address(host) || host.includes(':')) && isPrivateOrReservedHost(host));
  } catch {
    return false;
  }
}

/**
 * 「HTTP · 已允许」只标后端真会放行的明文地址。WebDAV：写成 IP 的局域网地址、P12 确认过的、
 * 已连接且最近一次没测失败的（连上前测过）；没确认的主机名不标。对象存储：确认过的公开域名。
 */
const httpAllowed = computed(() => {
  const set = new Set<string>();
  const record = props.draft ? props.values : hostRecord(config.value, props.hostId) as Record<string, string>;
  const isHttp = (v: unknown): v is string => typeof v === 'string' && /^http:\/\//i.test(v.trim());
  if (props.descriptor.kind === 'webdav') {
    const confirmed = String(record.lanHttpConfirmed) === 'true' || (!props.draft && props.test.phase !== 'fail');
    for (const key of ['url', 'publicDomain']) {
      const value = props.values[key];
      if (isHttp(value) && (confirmed || isLanLiteral(value))) set.add(key);
    }
  } else if (isHttp(props.values.publicDomain) && record.httpDomainConfirmedFor) {
    set.add('publicDomain');
  }
  return set;
});

/** 敏感字段按需取明文：草稿直接给；已连接的读配置（WebDAV 密码解密） */
async function reveal(key: string): Promise<string> {
  if (props.draft) return props.values[key] ?? '';
  if (isWebDAVId(props.hostId) && key === 'passwordEncrypted') {
    return secureStorage.decrypt(findWebdav(config.value, props.hostId)?.passwordEncrypted ?? '');
  }
  return String(hostRecord(config.value, props.hostId)[key] ?? '');
}

// ---- 微博链接前缀（「不加前缀」= enabled false，其余是 prefixList 的各项） ----
const SAMPLE_WEIBO = 'https://wx3.sinaimg.cn/large/006a8Yn2ly1hq3n2a.jpg';
const prefixConfig = computed<LinkPrefixConfig>(() => config.value.linkPrefixConfig ?? DEFAULT_CONFIG.linkPrefixConfig!);
const defaultPrefixNames = new Set(cloneDefaultPrefixes().map((p) => p.name));
const prefixItems = computed<TemplateItem[]>(() => [
  { name: '不加前缀', template: '{url}', preview: `效果：${SAMPLE_WEIBO}` },
  ...prefixConfig.value.prefixList.map((p, i) => ({
    name: i === 0 && defaultPrefixNames.has(p.name) ? `${p.name}（默认）` : p.name,
    template: p.template,
    preview: `效果：${applyPrefixTemplate(p.template, SAMPLE_WEIBO)}`,
    removable: !defaultPrefixNames.has(p.name),
  })),
]);
const prefixSelected = computed(() => (prefixConfig.value.enabled ? prefixConfig.value.selectedIndex + 1 : 0));

function savePrefix(next: Partial<LinkPrefixConfig>): void {
  void hosts.saveSetting((c) => ({ ...c, linkPrefixConfig: { ...(c.linkPrefixConfig ?? DEFAULT_CONFIG.linkPrefixConfig!), ...next } }));
}

function selectPrefix(index: number): void {
  savePrefix(index === 0 ? { enabled: false } : { enabled: true, selectedIndex: index - 1 });
}

/** 删除与「恢复默认」不弹确认，通知带撤销（交接说明第 4 节）；第 0 行是「不加前缀」，列表里的下标要减 1 */
async function removePrefix(index: number): Promise<void> {
  const at = index - 1;
  const before = prefixConfig.value;
  const item = before.prefixList[at];
  if (!item) return;
  const wasChosen = before.enabled && before.selectedIndex === at;
  const removed = removeTemplate(before.prefixList, before.selectedIndex, at);
  savePrefix({ prefixList: removed.list, selectedIndex: removed.selected });
  if (await undo.show(`已删除模板「${item.name}」`)) return;
  const back = restoreTemplate(prefixConfig.value.prefixList, prefixConfig.value.selectedIndex, item, at, wasChosen);
  savePrefix({ prefixList: back.list, selectedIndex: back.selected, ...(wasChosen ? { enabled: true } : {}) });
}

async function restorePrefixes(): Promise<void> {
  const before = { ...prefixConfig.value, prefixList: [...prefixConfig.value.prefixList] };
  savePrefix({ prefixList: cloneDefaultPrefixes(), selectedIndex: 0, enabled: true });
  if (!(await undo.show('已恢复默认链接前缀'))) savePrefix(before);
}

// ---- GitHub 加速（「原始地址」= cdnConfig.enabled false） ----
const RAW_TEMPLATE = 'https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}';
const cdnConfig = computed<GithubCdnConfig>(() => (config.value.services?.github as { cdnConfig?: GithubCdnConfig } | undefined)?.cdnConfig
  ?? { enabled: true, selectedIndex: 0, cdnList: DEFAULT_GITHUB_CDN_LIST });
const defaultCdnNames = new Set(DEFAULT_GITHUB_CDN_LIST.map((c) => c.name));
const cdnItems = computed<TemplateItem[]>(() => [
  ...cdnConfig.value.cdnList.map((c, i) => ({
    name: i === 0 && defaultCdnNames.has(c.name) ? `${c.name}（默认）` : c.name,
    template: c.template.replace('{domain}', c.url.replace(/\/$/, '')),
    removable: !defaultCdnNames.has(c.name),
  })),
  { name: '原始地址', template: RAW_TEMPLATE },
]);
const cdnSelected = computed(() => (cdnConfig.value.enabled ? cdnConfig.value.selectedIndex : cdnConfig.value.cdnList.length));

function saveCdn(next: Partial<GithubCdnConfig>): void {
  void hosts.saveSetting((c: UserConfig) => {
    const github = { ...(c.services?.github ?? {}) } as Record<string, unknown>;
    github.cdnConfig = { ...cdnConfig.value, ...next };
    return { ...c, services: { ...c.services, github } as unknown as UserConfig['services'] };
  });
}

async function removeCdn(index: number): Promise<void> {
  const before = cdnConfig.value;
  const item = before.cdnList[index];
  if (!item) return;
  const wasChosen = before.enabled && before.selectedIndex === index;
  const removed = removeTemplate(before.cdnList, before.selectedIndex, index);
  saveCdn({ cdnList: removed.list, selectedIndex: removed.selected });
  if (await undo.show(`已删除 CDN「${item.name}」`)) return;
  const back = restoreTemplate(cdnConfig.value.cdnList, cdnConfig.value.selectedIndex, item, index, wasChosen);
  saveCdn({ cdnList: back.list, selectedIndex: back.selected, ...(wasChosen ? { enabled: true } : {}) });
}

async function restoreCdns(): Promise<void> {
  const before = { ...cdnConfig.value, cdnList: [...cdnConfig.value.cdnList] };
  saveCdn({ enabled: true, selectedIndex: 0, cdnList: DEFAULT_GITHUB_CDN_LIST });
  if (!(await undo.show('已恢复默认 CDN'))) saveCdn(before);
}

function addCdn(item: { name: string; template: string }): void {
  // 用户填整条地址模板：拆成 url（域名）+ {domain} 模板，与上传器拼链接的方式一致
  let origin = '';
  try { origin = new URL(item.template.replace(/\{[a-zA-Z]+\}/g, 'x')).origin; } catch { return; }
  const list = [...cdnConfig.value.cdnList, { name: item.name, url: origin, template: `{domain}${item.template.slice(origin.length)}` }];
  saveCdn({ cdnList: list, enabled: true, selectedIndex: list.length - 1 });
}

// ---- 开关 ----
const r2Thumb = computed(() => (config.value.services?.r2 as { thumbnailProxyEnabled?: boolean } | undefined)?.thumbnailProxyEnabled !== false);
const uniqueName = computed(() => findWebdav(config.value, props.hostId)?.uniqueFileName !== false);
const zhihu = computed(() => (config.value.services?.zhihu ?? {}) as { sourceParamEnabled?: boolean; sourceParamValue?: string });

function setService(id: string, patch: Record<string, unknown>): void {
  void hosts.saveSetting((c) => ({ ...c, services: { ...c.services, [id]: { ...((c.services as Record<string, object> | undefined)?.[id] ?? {}), ...patch } } as UserConfig['services'] }));
}

function setUniqueName(value: boolean): void {
  void hosts.saveSetting((c) => ({ ...c, webdav_profiles: (c.webdav_profiles ?? []).map((p) => (`webdav:${p.id}` === props.hostId ? { ...p, uniqueFileName: value } : p)) }));
}
</script>

<template>
  <div class="host-settings">
    <!-- 免配置 -->
    <div v-if="descriptor.kind === 'builtin'" class="host-settings__box">
      <span class="host-settings__box-title">免配置，开箱即用</span>
      <span class="host-settings__muted">无需账号。此为非官方适配的公共图床，可能随时失效，建议同时上传到自有存储（如 Cloudflare R2）作为备份。</span>
    </div>

    <!-- Cookie：字段（点进去即可粘贴）+「重新登录…」（打开官方登录页，登录后自动填入） -->
    <template v-else-if="descriptor.kind === 'cookie'">
      <HostFields
        :fields="descriptor.fields"
        :values="values"
        :invalid-field="invalidField"
        :invalid-reason="invalidReason"
        :reveal="reveal"
        :narrow="true"
        :id-prefix="`host-${descriptor.id}`"
        @commit="(k, v) => emit('commit', k, v)"
      >
        <template v-if="loginAction" #aside>
          <PnButton variant="secondary" @click="emit('login')">重新登录…</PnButton>
        </template>
      </HostFields>
      <HostTemplateList
        v-if="descriptor.id === 'weibo'"
        title="链接前缀"
        note="微博启用了防盗链，外站引用需经代理才能显示"
        :items="prefixItems"
        :selected="prefixSelected"
        add-label="添加模板"
        variables="{url} {path} {url_encoded}"
        template-placeholder="https://img-proxy.example.com/{path}"
        @select="selectPrefix"
        @add="(item) => savePrefix({ prefixList: [...prefixConfig.prefixList, item], enabled: true, selectedIndex: prefixConfig.prefixList.length })"
        @remove="removePrefix"
        @restore="restorePrefixes"
      />
      <div v-if="descriptor.id === 'zhihu' && !draft" class="host-settings__box host-settings__box--row">
        <div class="host-settings__switch-text">
          <span class="host-settings__box-title">让知乎图片正常显示</span>
          <span class="host-settings__muted">在链接后自动补一个参数，避免外链 403</span>
        </div>
        <PnSwitch :model-value="zhihu.sourceParamEnabled !== false" label="让知乎图片正常显示" @update:model-value="(v: boolean) => setService('zhihu', { sourceParamEnabled: v })" />
      </div>
    </template>

    <!-- Token / 对象存储 / 自建 -->
    <template v-else>
      <HostFields
        ref="fieldsRef"
        :fields="basicFields"
        :values="values"
        :invalid-field="invalidField"
        :invalid-reason="invalidReason"
        :http-allowed="httpAllowed"
        :reveal="reveal"
        :narrow="narrow"
        :id-prefix="`host-${descriptor.id}`"
        @commit="(k, v) => emit('commit', k, v)"
      />
      <HostTemplateList
        v-if="descriptor.id === 'github'"
        title="加速"
        note="GitHub 原始地址在国内访问较慢，建议使用 CDN"
        :items="cdnItems"
        :selected="cdnSelected"
        add-label="添加 CDN"
        template-placeholder="https://cdn.example.com/gh/{owner}/{repo}@{branch}/{path}"
        @select="(i) => saveCdn(i === cdnConfig.cdnList.length ? { enabled: false } : { enabled: true, selectedIndex: i })"
        @add="addCdn"
        @remove="removeCdn"
        @restore="restoreCdns"
      />
      <template v-if="hasAdvanced">
        <button type="button" class="host-settings__advanced" :aria-expanded="advancedOpen" @click="showAdvanced = !advancedOpen">
          高级选项<span class="host-settings__summary">· {{ descriptor.kind === 'webdav' ? '链接模板、防止图片互相覆盖' : advancedSummary(descriptor) }}</span>
          <PnIcon :name="advancedOpen ? 'chevronDown' : 'chevronRight'" :size="12" :stroke="1.8" />
        </button>
        <template v-if="advancedOpen">
          <HostFields
            v-if="advancedFields.length"
            :fields="advancedFields"
            :values="values"
            :invalid-field="invalidField"
            :invalid-reason="invalidReason"
            :http-allowed="httpAllowed"
            :reveal="reveal"
            :narrow="narrow"
            :id-prefix="`host-${descriptor.id}-adv`"
            @commit="(k, v) => emit('commit', k, v)"
          />
          <div v-if="descriptor.kind === 'webdav' && !draft" class="host-settings__box host-settings__box--row">
            <div class="host-settings__switch-text">
              <span class="host-settings__box-title">防止图片互相覆盖</span>
              <span class="host-settings__muted">上传时自动重命名，image.png 会存成 image_20260818_a3f9.png；关闭后同名图片会覆盖旧图且无法找回。</span>
            </div>
            <PnSwitch :model-value="uniqueName" label="防止图片互相覆盖" @update:model-value="setUniqueName" />
          </div>
        </template>
      </template>
      <div v-if="descriptor.id === 'r2' && !draft" class="host-settings__box host-settings__box--row">
        <div class="host-settings__switch-text">
          <span class="host-settings__box-title">使用第三方服务加速缩略图</span>
          <span class="host-settings__muted">图库缩略图由 wsrv.nl 生成，加载更快、更省流量；图片地址会发送至该服务。</span>
        </div>
        <PnSwitch :model-value="r2Thumb" label="使用第三方服务加速缩略图" @update:model-value="(v: boolean) => setService('r2', { thumbnailProxyEnabled: v })" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.host-settings {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-16);
}

.host-settings__box {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
  padding: var(--pn-space-host-box);
  border-radius: var(--pn-radius-host-head-icon);
  box-shadow: 0 0 0 1px var(--pn-border);
}

.host-settings__box--row {
  flex-direction: row;
  align-items: center;
  gap: var(--pn-space-16);
}

.host-settings__switch-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-2);
  min-width: 0;
}

.host-settings__box-title { font-weight: var(--pn-weight-semibold); }
.host-settings__muted { color: var(--pn-text2); }

.host-settings__advanced {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--pn-space-4);
  height: var(--pn-size-button-sm);
  margin-left: calc(var(--pn-space-8) * -1);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.host-settings__advanced:hover { background: var(--pn-ghost-hover); }
.host-settings__advanced:active { background: var(--pn-ghost-press); }
.host-settings__summary { color: var(--pn-text3); }
</style>
