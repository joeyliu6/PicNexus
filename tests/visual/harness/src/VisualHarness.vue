<script setup lang="ts">
import { computed, ref } from 'vue';
import UploadDropZone from '@/components/views/upload/UploadDropZone.vue';
import CompressPopoverMenu from '@/components/views/upload/CompressPopoverMenu.vue';
import QueueCard from '@/components/upload/QueueCard.vue';
import DashboardStrip from '@/components/views/history/DashboardStrip.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import CheckFilterBar from '@/components/views/linkcheck/history-check/CheckFilterBar.vue';
import CheckLinkList from '@/components/views/linkcheck/history-check/CheckLinkList.vue';
import CheckBottomBar from '@/components/views/linkcheck/history-check/CheckBottomBar.vue';
import GeneralSettingsPanel from '@/components/settings/GeneralSettingsPanel.vue';
import ServiceEnableSection from '@/components/settings/hosting/ServiceEnableSection.vue';
import type { QueueItem, ServiceProgress } from '@/uploadQueue';
import type { CheckLinkResult, LinkCheckRow, StatusFilter, BatchCheckProgress } from '@/types/linkCheck';
import type { CheckStatsResult } from '@/composables/link-check/useCheckStats';
import type { MoreMenuItem } from '@/composables/link-check/useCheckStrategy';
import type { CompressionPreset, ServiceType, ThemeMode } from '@/config/types';
import { DEFAULT_CONFIG } from '@/config/types';
import type { ServiceHealthStatus } from '@/types/serviceHealth';
import type { ServiceCheckSession } from '@/types/serviceCheck';

type VisualPage = 'upload' | 'history' | 'link-check' | 'settings';
type VisualState = string;

const params = new URLSearchParams(window.location.search);
const page = (params.get('page') || 'upload') as VisualPage;
const state = (params.get('state') || 'empty') as VisualState;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = state === 'dark-theme' || prefersDark;
const rootClass = isDark ? 'dark-theme' : 'light-theme';

document.documentElement.classList.toggle('dark-theme', isDark);
document.documentElement.classList.toggle('light-theme', !isDark);

const image = (seed: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#60a5fa"/><stop offset="0.55" stop-color="#22c55e"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><circle cx="486" cy="104" r="70" fill="rgba(255,255,255,.35)"/><path d="M0 330 150 190l92 78 86-112 312 174v90H0z" fill="rgba(15,23,42,.38)"/><text x="36" y="62" fill="white" font-family="Arial" font-size="30" font-weight="700">${seed}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const presets: CompressionPreset[] = [
  { id: 'default', name: 'Default', quality: 80, outputFormat: 'original', maxLongSide: 0, scalePercent: 100, skipIfSmallerKB: 2048, stripExif: true },
  { id: 'web', name: 'Web', quality: 72, outputFormat: 'webp', maxLongSide: 2200, scalePercent: 100, skipIfSmallerKB: 512, stripExif: true },
  { id: 'archive', name: 'Archive', quality: 92, outputFormat: 'jpeg', maxLongSide: 0, scalePercent: 100, skipIfSmallerKB: 0, stripExif: false },
];

const activePreset = presets[1];
const config = structuredClone(DEFAULT_CONFIG);

function progress(serviceId: string, status: string, pct: number, link?: string, error?: string): ServiceProgress {
  return { serviceId, status, progress: pct, link, error };
}

function queueItem(kind: 'uploading' | 'failed' | 'success', index = 1): QueueItem {
  const enabledServices = ['jd', 'weibo', 'r2'];
  const suffix = `${kind}-${index}`;
  const serviceProgress = {
    jd: progress('jd', kind === 'uploading' ? '68%' : '完成', kind === 'uploading' ? 68 : 100, `https://img.example/${suffix}/jd.jpg`),
    weibo: progress('weibo', kind === 'failed' ? '失败' : kind === 'uploading' ? '上传中...' : '完成', kind === 'failed' ? 0 : kind === 'uploading' ? 42 : 100, kind === 'failed' ? undefined : `https://img.example/${suffix}/weibo.jpg`, kind === 'failed' ? 'HTTP 403' : undefined),
    r2: progress('r2', kind === 'uploading' ? '等待中...' : '完成', kind === 'uploading' ? 0 : 100, `https://img.example/${suffix}/r2.jpg`),
  };
  return {
    id: `queue-${suffix}`,
    fileName: `${suffix}.jpg`,
    filePath: `/visual/${suffix}.jpg`,
    enabledServices,
    serviceProgress,
    status: kind === 'failed' ? 'error' : kind,
    errorMessage: kind === 'failed' ? 'One target rejected the upload' : undefined,
    primaryUrl: kind === 'uploading' ? undefined : `https://img.example/${suffix}/jd.jpg`,
    thumbUrl: image(suffix),
    retryCount: kind === 'failed' ? 1 : 0,
    maxRetries: 3,
    isRetrying: false,
  };
}

const uploadItems = computed(() => {
  if (state === 'uploading') return [queueItem('uploading')];
  if (state === 'failed') return [queueItem('failed')];
  if (state === 'success') return [queueItem('success', 1), queueItem('success', 2)];
  return [];
});

function result(kind: 'valid' | 'invalid' | 'timeout' | 'suspicious'): CheckLinkResult {
  if (kind === 'valid') return { link: '', is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false, response_time: 108 };
  if (kind === 'timeout') return { link: '', is_valid: false, error_type: 'timeout', error: 'Timeout', browser_might_work: false, response_time: 10000 };
  if (kind === 'suspicious') return { link: '', is_valid: false, status_code: 403, error_type: 'suspicious', error: 'Browser may work', browser_might_work: true, response_time: 840 };
  return { link: '', is_valid: false, status_code: 404, error_type: 'http_4xx', error: 'Not found', browser_might_work: false, response_time: 280 };
}

function row(idx: number, serviceId: string, kind?: 'valid' | 'invalid' | 'timeout' | 'suspicious'): LinkCheckRow {
  return {
    historyId: `history-${idx}`,
    serviceId,
    url: `https://img.example/${idx}/${serviceId}.jpg`,
    rawUrl: `https://img.example/${idx}/${serviceId}.jpg`,
    fileName: `gallery-shot-${idx.toString().padStart(2, '0')}.jpg`,
    checkResult: kind ? result(kind) : undefined,
  };
}

const linkRows = computed<LinkCheckRow[]>(() => {
  if (state === 'empty' || state === 'skeleton') return [];
  const rows = [
    row(1, 'jd', 'valid'),
    row(2, 'weibo', 'invalid'),
    row(3, 'r2', 'timeout'),
    row(4, 'github', 'suspicious'),
    row(5, 'smms'),
    row(6, 'zhihu', 'valid'),
    row(7, 'nami', 'invalid'),
    row(8, 'qiyu'),
  ];
  if (state === 'running' || state === 'paused') {
    rows[4].recheckLoading = true;
    rows[5].recentlyCompletedAt = Date.now();
  }
  return rows;
});

function statsFor(rows: LinkCheckRow[]): CheckStatsResult {
  let valid = 0;
  let invalid = 0;
  let timeout = 0;
  let suspicious = 0;
  let unchecked = 0;
  for (const item of rows) {
    const check = item.checkResult;
    if (!check) unchecked += 1;
    else if (check.is_valid) valid += 1;
    else if (check.error_type === 'timeout') timeout += 1;
    else if (check.error_type === 'suspicious' || check.browser_might_work) suspicious += 1;
    else invalid += 1;
  }
  return { total: rows.length, valid, invalid, timeout, suspicious, unchecked, checked: rows.length - unchecked, problems: invalid + timeout + suspicious };
}

const linkStats = computed(() => statsFor(linkRows.value));
const serviceList = computed(() => Array.from(new Set(linkRows.value.map((item) => item.serviceId))).map((id) => ({ id, count: linkRows.value.filter((item) => item.serviceId === id).length })));
const selectedIds = computed(() => state === 'bulk-select' ? new Set(['history-2|weibo', 'history-3|r2', 'history-4|github']) : new Set<string>());
const statusFilter = ref<StatusFilter>(state === 'empty' ? null : 'all');
const selectedServiceId = ref<string | null>(null);
const showServiceMenu = ref(false);
const searchInput = ref(state === 'mixed-results' ? 'gallery' : '');
const searchQuery = ref('');
const searchFocused = ref(false);
const currentPage = ref(1);
const pageInput = ref('1');
const showOverflowMenu = ref(false);
const progressValue = computed<BatchCheckProgress | null>(() => (state === 'running' || state === 'paused') ? { checked: 5, total: 8, current_url: 'https://img.example/5/jd.jpg' } : null);
const moreItems: MoreMenuItem[] = [
  { kind: 'export', label: 'Export', icon: 'pi-download', count: 8 },
  { kind: 'recheck', label: 'Recheck', icon: 'pi-refresh', count: 8 },
  { kind: 'copy', label: 'Copy links', icon: 'pi-copy', count: 8 },
  { kind: 'delete', label: 'Delete', icon: 'pi-trash', count: 8, danger: true },
];

const statusDotColor = (item: LinkCheckRow) => {
  const check = item.recheckResult ?? item.checkResult;
  if (!check) return 'var(--text-tertiary)';
  if (check.is_valid) return 'var(--success)';
  if (check.error_type === 'timeout') return 'var(--warning)';
  if (check.error_type === 'suspicious' || check.browser_might_work) return 'var(--pending)';
  return 'var(--error)';
};
const errorBadgeClass = (item: LinkCheckRow) => {
  const check = item.recheckResult ?? item.checkResult;
  if (!check) return 'error-badge--unchecked';
  if (check.is_valid) return 'error-badge--success';
  if (check.error_type === 'timeout') return 'error-badge--warning';
  if (check.error_type === 'suspicious' || check.browser_might_work) return 'error-badge--suspicious';
  return 'error-badge--error';
};
const errorLabel = (item: LinkCheckRow) => {
  const check = item.recheckResult ?? item.checkResult;
  if (!check) return '-';
  if (check.is_valid) return '200';
  if (check.status_code) return String(check.status_code);
  if (check.error_type === 'timeout') return 'TO';
  return 'ERR';
};
const recheckLabel = (check: CheckLinkResult) => check.is_valid ? 'OK' : 'ERR';

const historyMode = ref<'table' | 'timeline' | 'favorites'>('table');
const historyFilter = ref<ServiceType | 'all'>('all');
const historyServices = [{ id: 'jd', count: 18 }, { id: 'weibo', count: 12 }, { id: 'r2', count: 9 }];
const historyRows = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1,
  fileName: `trip-album-${index + 1}.jpg`,
  service: index % 3 === 0 ? 'JD' : index % 3 === 1 ? 'Weibo' : 'R2',
  size: `${(1.2 + index / 3).toFixed(1)} MB`,
  thumb: image(`H${index + 1}`),
}));

const themeMode = ref<ThemeMode>(isDark ? 'dark' : 'light');
const healthMap = computed<Record<string, ServiceHealthStatus>>(() => ({
  jd: state === 'error' ? 'error' : 'verified',
  qiyu: state === 'connection-testing' ? 'pending' : 'verified',
  weibo: state === 'error' ? 'error' : 'pending',
  r2: 'verified',
  github: 'pending',
  smms: 'unconfigured',
  zhihu: 'unconfigured',
  nami: 'unconfigured',
  bilibili: 'unconfigured',
  chaoxing: 'unconfigured',
  nowcoder: 'unconfigured',
  tencent: 'unconfigured',
  aliyun: 'unconfigured',
  qiniu: 'unconfigured',
  upyun: 'unconfigured',
  imgur: 'unconfigured',
}));
const tooltipMap = Object.fromEntries(Object.keys(healthMap.value).map((id) => [id, null])) as Record<string, string | null>;
const serviceNames = Object.fromEntries(Object.keys(healthMap.value).map((id) => [id, id.toUpperCase()]));
const testingConnections = computed(() => state === 'connection-testing' ? { jd: true, qiyu: true } : {});
const serviceSession = computed<ServiceCheckSession | null>(() => {
  if (state !== 'connection-testing') return null;
  return {
    mode: 'batch',
    startedAt: Date.now(),
    targetIds: ['jd', 'qiyu', 'weibo', 'r2'],
    refreshingIds: ['jd', 'qiyu'],
    runningIds: ['qiyu'],
    completedIds: ['jd'],
    baselineStatuses: healthMap.value,
    resultStatuses: { jd: 'verified' },
    summarySkeletonStatuses: ['verified', 'error', 'pending', 'unconfigured'],
    summarySnapshot: {
      verified: '2 checked',
      error: '1 failed',
      pending: '1 pending',
      unconfigured: '4 unconfigured',
      counts: { verified: 2, error: 1, pending: 1, unconfigured: 4 },
    },
  };
});
</script>

<template>
  <div :class="['visual-shell', rootClass]" data-visual-root data-visual-ready="true">
    <aside class="visual-sidebar">
      <div class="visual-logo">PN</div>
      <div class="visual-nav" :class="{ active: page === 'upload' }"><i class="pi pi-cloud-upload"></i><span>Upload</span></div>
      <div class="visual-nav" :class="{ active: page === 'history' }"><i class="pi pi-images"></i><span>History</span></div>
      <div class="visual-nav" :class="{ active: page === 'link-check' }"><i class="pi pi-wrench"></i><span>Links</span></div>
      <div class="visual-nav" :class="{ active: page === 'settings' }"><i class="pi pi-cog"></i><span>Settings</span></div>
    </aside>

    <main class="visual-main">
      <section v-if="page === 'upload'" class="visual-page visual-upload">
        <UploadDropZone
          :is-dragging="state === 'uploading'"
          :is-pasting="state === 'uploading'"
          :is-downloading="false"
          :compression-enabled="state !== 'empty'"
          :active-preset="activePreset"
          :presets="presets"
        />
        <div v-if="state === 'compression-menu'" class="visual-popover">
          <CompressPopoverMenu :presets="presets" :active-preset="activePreset" compression-enabled />
        </div>
        <div class="visual-card">
          <div class="visual-section-head">
            <h3>Upload queue</h3>
            <span v-if="uploadItems.length">{{ uploadItems.length }} items</span>
          </div>
          <EmptyState v-if="uploadItems.length === 0" icon="pi pi-inbox" title="No upload queue" description="The queue starts empty in the web visual harness." />
          <QueueCard v-for="item in uploadItems" v-else :key="item.id" :item="item" :config="config" />
        </div>
      </section>

      <section v-else-if="page === 'history'" class="visual-page visual-history">
        <DashboardStrip v-model:view-mode="historyMode" v-model:filter="historyFilter" :total-count="state === 'empty' ? 0 : 39" :service-counts="historyServices" />
        <div v-if="state === 'empty'" class="visual-history-empty">
          <EmptyState icon="pi pi-table" title="No history records" description="Uploaded images will appear here." />
        </div>
        <div v-else class="visual-history-grid">
          <article v-for="item in historyRows" :key="item.id" class="history-row-card" :class="{ selected: state === 'bulk-select' && item.id <= 3 }">
            <img :src="item.thumb" alt="" />
            <div>
              <strong>{{ item.fileName }}</strong>
              <span>{{ item.service }} · {{ item.size }}</span>
            </div>
            <i class="pi" :class="state === 'bulk-select' && item.id <= 3 ? 'pi-check-circle' : 'pi-copy'"></i>
          </article>
        </div>
        <div v-if="state === 'bulk-select'" class="visual-floating-bar">
          <span>3 selected</span><button>Copy</button><button>Export</button><button class="danger">Delete</button>
        </div>
        <div v-if="state === 'lightbox'" class="visual-lightbox">
          <img :src="image('Lightbox')" alt="" />
          <div class="visual-lightbox-bar">
            <strong>trip-album-1.jpg</strong><span>JD · Weibo · R2</span>
            <button><i class="pi pi-copy"></i></button><button><i class="pi pi-star"></i></button>
          </div>
        </div>
      </section>

      <section v-else-if="page === 'link-check'" class="visual-page visual-linkcheck">
        <div class="visual-tabs"><span class="active">Link check</span><span>Markdown repair</span><span>Batch migrate</span></div>
        <div v-if="state === 'skeleton'" class="monitor-panel monitor-panel--skeleton">
          <div class="sk-filterbar"><div class="sk-chip"></div><div class="sk-chip wide"></div><div class="sk-chip"></div><div class="sk-searchbox"></div></div>
          <div class="sk-link-list"><div v-for="i in 12" :key="i" class="sk-link-row"><div class="sk-dot"></div><div class="sk-line"></div><div class="sk-line small"></div><div class="sk-circle"></div></div></div>
        </div>
        <template v-else>
          <CheckFilterBar
            v-model:status-filter="statusFilter"
            v-model:selected-service-id="selectedServiceId"
            v-model:show-service-menu="showServiceMenu"
            v-model:search-input="searchInput"
            v-model:search-query="searchQuery"
            v-model:search-focused="searchFocused"
            :stats="linkStats"
            :service-list="serviceList"
            :is-loading="false"
            :is-checking="state === 'running' || state === 'paused'"
            :is-phase2-loading="false"
            :phase2-duration="500"
          />
          <CheckLinkList
            :visible-rows="linkRows"
            :filtered-rows="linkRows"
            :stats="linkStats"
            :status-filter="statusFilter"
            :is-loading="false"
            :is-checking="state === 'running' || state === 'paused'"
            :is-action-locked="false"
            :suppress-list-motion="true"
            :selected-ids="selectedIds"
            :status-dot-color="statusDotColor"
            :error-badge-class="errorBadgeClass"
            :error-label="errorLabel"
            :error-tooltip="() => 'Visual fixture'"
            :recheck-label="recheckLabel"
          />
          <CheckBottomBar
            v-model:current-page="currentPage"
            v-model:page-input="pageInput"
            v-model:show-overflow-menu="showOverflowMenu"
            :is-checking="state === 'running' || state === 'paused'"
            :is-paused="state === 'paused'"
            :state-pill="state === 'paused' ? { tone: 'paused', icon: 'pi pi-pause', label: 'Paused', progressPercent: 63, progressLabel: '5 / 8' } : state === 'running' ? { tone: 'running', label: 'Checking', progressPercent: 63, progressLabel: '5 / 8' } : null"
            :is-action-locked="false"
            progress-source="monitor"
            :has-selection="state === 'bulk-select'"
            :selected-count="selectedIds.size"
            :is-all-selected="false"
            :total-pages="2"
            :bottom-summary="`${linkRows.length} links`"
            :is-loading="false"
            :stats="linkStats"
            smart-check-label="Recheck problems"
            smart-check-tooltip="Recheck the current visual fixture"
            :more-menu-items="moreItems"
            more-menu-scope-label="Current filter"
          />
        </template>
      </section>

      <section v-else class="visual-page visual-settings">
        <div class="settings-layout visual-settings-layout">
          <div class="settings-sidebar">
            <div class="sidebar-title">Settings</div>
            <button class="nav-item active"><i class="pi pi-cog"></i><span>General</span></button>
            <button class="nav-item"><i class="pi pi-images"></i><span>Hosting</span></button>
            <button class="nav-item"><i class="pi pi-database"></i><span>Backup</span></button>
          </div>
          <div class="settings-content">
            <div v-if="state === 'default' || state === 'dark-theme'" class="settings-section">
              <GeneralSettingsPanel
                :current-theme="themeMode"
                :auto-start="false"
                :minimize-to-tray-on-start="false"
                close-to-tray
                analytics-enabled
                :is-clearing-cache="false"
                link-default-format="markdown"
                link-custom-template="{url}"
                link-auto-copy
                global-shortcut-enabled
                shortcut-upload-clipboard="Ctrl+Shift+V"
                shortcut-upload-from-file="Ctrl+Shift+U"
                @update:current-theme="themeMode = $event"
              />
            </div>
            <div v-else class="settings-section">
              <div class="section-header">
                <h2>Hosting status</h2>
                <p class="section-desc">Visual fixture for service connection status.</p>
              </div>
              <div v-if="state === 'error'" class="visual-error-banner"><i class="pi pi-exclamation-triangle"></i><span>Connection failed for Weibo and JD. Check tokens or cookies before uploading.</span></div>
              <ServiceEnableSection
                :health-status-map="healthMap"
                :health-tooltip-map="tooltipMap"
                :is-batch-testing="state === 'connection-testing'"
                :batch-test-progress="state === 'connection-testing' ? { current: 2, total: 4, currentService: 'qiyu' } : null"
                :service-check-session="serviceSession"
                :refreshing-service-ids="state === 'connection-testing' ? new Set(['jd', 'qiyu']) : new Set()"
                :testing-connections="testingConnections"
                :is-checking-jd="state === 'connection-testing'"
                :is-checking-qiyu="state === 'connection-testing'"
                :available-services="['jd', 'qiyu', 'weibo', 'r2', 'github']"
                :service-names="serviceNames"
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
