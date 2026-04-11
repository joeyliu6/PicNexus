<script setup lang="ts">
import { computed } from 'vue';
import type { EditorServerConfig, ServerServiceType, ServiceType } from '../../config/types';
import { useServiceHealth } from '../../composables/useServiceHealth';
import TyporaCard from './external-editor/TyporaCard.vue';
import ObsidianCard from './external-editor/ObsidianCard.vue';

interface Props {
  editorServer: EditorServerConfig;
  executablePath?: string;
  embedded?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:editorServer': [config: EditorServerConfig];
  'save': [];
  'navigateHosting': [];
}>();

const editorServerModel = computed<EditorServerConfig>({
  get: () => props.editorServer,
  set: (v) => emit('update:editorServer', v),
});

const SERVICE_LABEL_MAP: Record<ServerServiceType, string> = {
  jd: '京东图床',
  qiyu: '七鱼图床',
  github: 'GitHub',
  smms: 'SM.MS',
  imgur: 'Imgur',
  r2: 'Cloudflare R2',
  tencent: '腾讯云 COS',
  aliyun: '阿里云 OSS',
  qiniu: '七牛云',
  upyun: '又拍云',
  weibo: '微博',
  bilibili: '哔哩哔哩',
  zhihu: '知乎',
  nowcoder: '牛客',
  chaoxing: '超星',
  nami: '纳米图床',
  custom_s3: '自定义 S3',
};

const CLI_UNSUPPORTED_SERVICES: Set<ServerServiceType> = new Set(['qiyu', 'nami']);

const ALL_SERVICES: Array<{ value: ServerServiceType; label: string }> = [
  { value: 'jd', label: '京东图床' },
  { value: 'qiyu', label: '七鱼图床' },
  { value: 'r2', label: 'Cloudflare R2' },
  { value: 'tencent', label: '腾讯云 COS' },
  { value: 'aliyun', label: '阿里云 OSS' },
  { value: 'qiniu', label: '七牛云' },
  { value: 'upyun', label: '又拍云' },
  { value: 'github', label: 'GitHub' },
  { value: 'smms', label: 'SM.MS' },
  { value: 'imgur', label: 'Imgur' },
  { value: 'weibo', label: '微博' },
  { value: 'bilibili', label: '哔哩哔哩' },
  { value: 'zhihu', label: '知乎' },
  { value: 'nowcoder', label: '牛客' },
  { value: 'chaoxing', label: '超星' },
  { value: 'nami', label: '纳米图床' },
];

const { healthStatusMap, healthTooltipMap } = useServiceHealth();

const configuredServices = computed(() =>
  ALL_SERVICES
    .filter((svc) => {
      const status = healthStatusMap.value[svc.value as ServiceType];
      return status && status !== 'unconfigured';
    })
    .sort((a, b) => {
      const aVerified = healthStatusMap.value[a.value as ServiceType] === 'verified';
      const bVerified = healthStatusMap.value[b.value as ServiceType] === 'verified';
      return aVerified === bVerified ? 0 : aVerified ? -1 : 1;
    }),
);

function getServiceLabel(service: ServerServiceType): string {
  return SERVICE_LABEL_MAP[service] || service;
}

const summaryText = computed(() => {
  const typoraService = props.editorServer.typoraService;
  const obsidianService = props.editorServer.obsidianService;
  const typoraText = props.editorServer.typoraEnabled
    ? `Typora → ${typoraService ? getServiceLabel(typoraService) : '未选择'}`
    : 'Typora 关闭';
  const obsidianText = props.editorServer.enabled
    ? `Obsidian → ${obsidianService ? getServiceLabel(obsidianService) : '未选择'} (${props.editorServer.port})`
    : 'Obsidian 关闭';
  return `${typoraText} · ${obsidianText}`;
});
</script>

<template>
  <div class="editor-panel">
    <div v-if="!embedded" class="section-header">
      <h2>外部编辑器集成</h2>
      <p class="section-desc">连接 Typora、Obsidian 等笔记软件，实现粘贴图片自动上传到图床。</p>
    </div>

    <div v-if="!embedded" class="panel-summary">
      <i class="pi pi-link" />
      <span>{{ summaryText }}</span>
    </div>

    <TyporaCard
      v-model:editorServer="editorServerModel"
      :executablePath="executablePath"
      :configuredServices="configuredServices"
      :healthStatusMap="(healthStatusMap as Record<string, string>)"
      :healthTooltipMap="(healthTooltipMap as Record<string, string>)"
      :cliUnsupportedServices="CLI_UNSUPPORTED_SERVICES"
      :serviceLabelMap="SERVICE_LABEL_MAP"
      @navigateHosting="emit('navigateHosting')"
    />

    <ObsidianCard
      v-model:editorServer="editorServerModel"
      :configuredServices="configuredServices"
      :healthStatusMap="(healthStatusMap as Record<string, string>)"
      :healthTooltipMap="(healthTooltipMap as Record<string, string>)"
      :cliUnsupportedServices="CLI_UNSUPPORTED_SERVICES"
      :serviceLabelMap="SERVICE_LABEL_MAP"
      @navigateHosting="emit('navigateHosting')"
    />
  </div>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

.editor-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
</style>
