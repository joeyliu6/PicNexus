<script setup lang="ts">
// 图床详情（HostsScreen.dc.html、P01–P12）：头部 → 结果条 → 使用情况 → 设置 → 断开连接。
// 同一个组件也画连接表单（未连接的图床，P03）：没有状态按钮、使用情况与断开连接，底部是「测试并连接」/「连接」/「登录…」。
// Cookie 图床有问题时把「重新登录…」放在设置区最上面（P02）。测试结果不弹通知（页面上已经写着）。
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { isCustomS3Id, isWebDAVId } from '@/config/types';
import { joinCjk } from '@/utils/cjkSpacing';
import { describeHost } from './hostCatalog';
import { readHostValues } from './hostConfig';
import HostHeader, { type HostPill } from './HostHeader.vue';
import HostSettings from './HostSettings.vue';
import { failSummary, okDetail } from './hostTestText';
import HostUsage from './HostUsage.vue';
import { useHostUsage } from './useHostUsage';
import { useHosts } from './useHosts';

const props = defineProps<{
  hostId: string;
  /** 连接表单：草稿 */
  draft: boolean;
  narrow: boolean;
}>();

const hosts = useHosts();
const router = useRouter();

const descriptor = computed(() => describeHost(props.hostId)!);
const row = computed(() => hosts.rows.value.find((r) => r.id === props.hostId) ?? null);
const name = computed(() => (props.draft ? hosts.draft.value?.name ?? '' : hosts.hostName(props.hostId)));
const values = computed(() => (props.draft ? hosts.draft.value?.values ?? {} : readHostValues(hosts.config.value, props.hostId)));
const test = computed(() => hosts.tester.stateOf(props.hostId));
const testing = computed(() => test.value.phase === 'testing');
const multi = computed(() => isWebDAVId(props.hostId) || isCustomS3Id(props.hostId));

const { usage } = useHostUsage(computed(() => (props.draft ? null : props.hostId)));

const pill = computed<HostPill | null>(() => {
  if (props.draft) return { text: '未连接', tone: 'off' };
  if (test.value.phase === 'ok') return { text: `正常 · ${test.value.ms}ms`, tone: 'ok' };
  if (test.value.phase === 'fail') return { text: row.value?.problem ?? '连接异常', tone: 'bad' };
  if (test.value.phase !== 'testing' && row.value?.problem) return { text: row.value.problem, tone: 'bad' };
  return null;
});

const fail = computed(() => (test.value.phase === 'fail' ? failSummary(descriptor.value, test.value) : null));
const okText = computed(() => (test.value.phase === 'ok' ? okDetail(descriptor.value, test.value.steps) : ''));

/** Cookie 图床出了问题：「重新登录…」放最上面 */
const loginExpired = computed(() => !props.draft && descriptor.value.kind === 'cookie' && !!row.value?.problem);

function commit(key: string, value: string): void {
  if (props.draft) hosts.setDraftValue(key, value);
  else void hosts.saveField(props.hostId, key, value);
}

function runTest(): void {
  void hosts.test(props.hostId, props.draft ? values.value : undefined);
}

function showDead(): void {
  void router.push({ path: '/health', query: { host: props.hostId } });
}

/** Cookie 图床手动粘贴了 Cookie：按钮不再开登录窗，直接测这份 Cookie */
const cookiePasted = computed(() => descriptor.value.kind === 'cookie' && !!values.value.cookie);

const connectLabel = computed(() => {
  if (descriptor.value.kind === 'builtin') return '连接';
  if (descriptor.value.kind === 'cookie' && !cookiePasted.value) return '登录…';
  return '测试并连接';
});

const connectNote = computed(() => {
  if (cookiePasted.value) return '';
  if (descriptor.value.kind === 'cookie') return joinCjk('将在新窗口打开', name.value, '官方登录页，登录后自动填入');
  return descriptor.value.connectNote ?? (descriptor.value.steps.includes('write') ? '将写入并删除一个测试文件' : '');
});

function connect(): void {
  if (descriptor.value.kind === 'cookie' && !cookiePasted.value) void hosts.login(props.hostId);
  else void hosts.connect();
}

const disconnectLabel = computed(() => (multi.value ? `删除这份 ${descriptor.value.catalogName}` : '断开连接'));
const disconnectNote = computed(() => (multi.value
  ? (descriptor.value.kind === 'webdav' ? '可添加多个 WebDAV，如 NAS 与坚果云' : '可添加多个 S3 兼容存储')
  : '已传的图片和链接不受影响'));
</script>

<template>
  <div class="host-detail">
    <HostHeader
      :host-id="hostId"
      :name="name"
      :intro="descriptor.intro"
      :renamable="multi"
      :pill="pill"
      :connected="!draft"
      :enabled="row?.enabled ?? false"
      :test-label="descriptor.testLabel"
      :testing="testing"
      @toggle="hosts.toggleEnabled(hostId)"
      @test="runTest"
      @rename="(n) => (draft && hosts.draft.value ? (hosts.draft.value.name = n) : hosts.rename(hostId, n))"
    />

    <div v-if="test.phase === 'ok'" class="host-detail__result host-detail__result--ok" role="status">
      <PnIcon name="check" :size="14" :stroke="2.4" />服务可用 · {{ test.ms }}ms<span v-if="okText" class="host-detail__result-more">· {{ okText }}</span>
    </div>
    <div v-else-if="fail" class="host-detail__result host-detail__result--fail" role="alert">
      <PnIcon name="failRound" :size="14" :stroke="2" class="host-detail__fail-icon" />
      <b class="host-detail__fail-title">{{ fail.title }}</b><span v-if="fail.detail" class="host-detail__result-more">{{ fail.detail }}</span>
    </div>

    <HostUsage v-if="!draft" :usage="usage" @show-dead="showDead" />

    <div v-if="loginExpired" class="host-detail__expired">
      <div class="host-detail__expired-text">
        <span class="host-detail__expired-title">登录已过期</span>
        <span class="host-detail__muted">{{ joinCjk('重新登录前无法上传到', name, '。登录后可补传未完成的图片。') }}</span>
      </div>
      <!-- 一页一个主按钮：停用时头部的「启用」是主按钮，这里退为次要按钮 -->
      <PnButton :variant="row?.enabled ? 'primary' : 'secondary'" @click="hosts.login(hostId)">重新登录…</PnButton>
    </div>

    <HostSettings
      :host-id="hostId"
      :descriptor="descriptor"
      :values="values"
      :draft="draft"
      :test="test"
      :narrow="narrow"
      @commit="commit"
    />

    <div v-if="draft" class="host-detail__connect">
      <PnButton variant="primary" :loading="testing" @click="connect">{{ testing ? '正在检测…' : connectLabel }}</PnButton>
      <span v-if="connectNote" class="host-detail__note">{{ connectNote }}</span>
    </div>
    <div v-else class="host-detail__footer">
      <button type="button" class="host-detail__disconnect" @click="hosts.disconnect(hostId)">{{ disconnectLabel }}</button>
      <span class="host-detail__note">{{ disconnectNote }}</span>
    </div>
  </div>
</template>

<style scoped>
.host-detail {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-host-gap);
}

.host-detail__result {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  padding: var(--pn-space-host-result);
  border-radius: var(--pn-radius-lg);
}

.host-detail__result--ok {
  background: var(--pn-success-soft);
  color: var(--pn-success);
  font-weight: var(--pn-weight-medium);
}

.host-detail__result--fail {
  background: var(--pn-danger-soft);
  color: var(--pn-text1);
}

.host-detail__fail-icon { flex: none; color: var(--pn-danger); }

.host-detail__fail-title {
  color: var(--pn-danger);
  font-weight: var(--pn-weight-semibold);
}

.host-detail__result-more {
  color: var(--pn-text2);
  font-weight: var(--pn-weight-regular);
}

.host-detail__expired {
  display: flex;
  align-items: center;
  gap: var(--pn-space-host-head-gap);
  padding: var(--pn-space-host-box);
  border-radius: var(--pn-radius-host-head-icon);
  background: var(--pn-warning-soft);
}

.host-detail__expired-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.host-detail__expired-title { font-weight: var(--pn-weight-semibold); }
.host-detail__muted { color: var(--pn-text2); }

.host-detail__connect {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  padding-top: var(--pn-space-4);
}

.host-detail__footer {
  display: flex;
  align-items: center;
  gap: var(--pn-space-host-section);
  padding-top: var(--pn-space-6);
}

.host-detail__disconnect {
  height: var(--pn-size-button-sm);
  margin-left: calc(var(--pn-space-8) * -1);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-danger);
  font: inherit;
  cursor: pointer;
}

.host-detail__disconnect:hover { background: var(--pn-danger-soft); }

.host-detail__note {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}
</style>
