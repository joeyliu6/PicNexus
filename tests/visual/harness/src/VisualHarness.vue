<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref } from 'vue';
import ConfirmDialog from 'primevue/confirmdialog';
import Skeleton from 'primevue/skeleton';
import { useConfirm as usePrimeConfirm } from 'primevue/useconfirm';
import UploadDropZone from '@/components/views/upload/UploadDropZone.vue';
import CompressPopoverMenu from '@/components/views/upload/CompressPopoverMenu.vue';
import ServiceSelector from '@/components/views/upload/ServiceSelector.vue';
import QueueCard from '@/components/upload/QueueCard.vue';
import DashboardStrip from '@/components/views/history/DashboardStrip.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ReloadBanner from '@/components/common/ReloadBanner.vue';
import FavoritePhotoItem from '@/components/views/favorites/FavoritePhotoItem.vue';
import TimelinePhotoGrid from '@/components/views/timeline/TimelinePhotoGrid.vue';
import TimelineIndicator from '@/components/views/timeline/TimelineIndicator.vue';
import TimelineSkeleton from '@/components/views/timeline/TimelineSkeleton.vue';
import MdRescueInline from '@/components/views/linkcheck/MdRescueInline.vue';
import MigrateSelectPhase from '@/components/views/linkcheck/migrate/MigrateSelectPhase.vue';
import MigrateProgressPhase from '@/components/views/linkcheck/migrate/MigrateProgressPhase.vue';
import { MIGRATE_KEY } from '@/components/views/linkcheck/migrate/keys';
import CheckFilterBar from '@/components/views/linkcheck/history-check/CheckFilterBar.vue';
import CheckLinkList from '@/components/views/linkcheck/history-check/CheckLinkList.vue';
import CheckBottomBar from '@/components/views/linkcheck/history-check/CheckBottomBar.vue';
import GeneralSettingsPanel from '@/components/settings/GeneralSettingsPanel.vue';
import ServiceEnableSection from '@/components/settings/hosting/ServiceEnableSection.vue';
import DataItemCard from '@/components/settings/backup/DataItemCard.vue';
import WebDAVConfigCollapsible from '@/components/settings/backup/WebDAVConfigCollapsible.vue';
import BackupPasswordDialog from '@/components/dialogs/BackupPasswordDialog.vue';
import { applyMarkdownRepairFixture, createMigrateContext } from './linkFeatureFixtures';
import type { QueueItem, ServiceProgress } from '@/uploadQueue';
import type { CheckLinkResult, LinkCheckRow, StatusFilter, BatchCheckProgress } from '@/types/linkCheck';
import type { CheckStatsResult } from '@/composables/link-check/useCheckStats';
import type { MoreMenuItem } from '@/composables/link-check/useCheckStrategy';
import type { CompressionPreset, HistoryItem, ProfileSyncRecord, ServiceType, ThemeMode, WebDAVConfig } from '@/config/types';
import { DEFAULT_CONFIG } from '@/config/types';
import type { ServiceHealthStatus } from '@/types/serviceHealth';
import type { ServiceCheckSession } from '@/types/serviceCheck';
import type { LinkFormat } from '@/utils/linkFormatter';
import type { ImageMeta } from '@/types/image-meta';
import type { PhotoGroup } from '@/composables/timeline/types';
import type { SkeletonLayoutResult } from '@/utils/justifiedLayout';

type VisualPage = 'upload' | 'history' | 'favorites' | 'timeline' | 'backup-sync' | 'link-check' | 'markdown-repair' | 'batch-migrate' | 'settings';
type VisualState = string;

const params = new URLSearchParams(window.location.search);
const page = (params.get('page') || 'upload') as VisualPage;
const state = (params.get('state') || 'empty') as VisualState;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = state === 'dark-theme' || prefersDark;
const rootClass = isDark ? 'dark-theme' : 'light-theme';
const isLinkFeaturePage = computed(() => page === 'link-check' || page === 'markdown-repair' || page === 'batch-migrate');
const isSettingsPage = computed(() => page === 'settings' || page === 'backup-sync');

document.documentElement.classList.toggle('dark-theme', isDark);
document.documentElement.classList.toggle('light-theme', !isDark);

const migrateContext = createMigrateContext(state);
provide(MIGRATE_KEY, migrateContext);
const visualConfirm = usePrimeConfirm();

if (page === 'markdown-repair') {
  applyMarkdownRepairFixture(state);
}

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
const uploadServiceLabels: Record<string, string> = {
  jd: '京东',
  weibo: '微博',
  qiyu: '七鱼',
  zhihu: '知乎',
  r2: 'Cloudflare R2',
  github: 'GitHub',
};
const selectedUploadServices = new Set(['jd', 'weibo', 'r2']);
const uploadHealthMap: Record<string, ServiceHealthStatus> = {
  jd: 'verified',
  weibo: 'pending',
  qiyu: 'error',
  zhihu: 'verified',
  r2: 'verified',
  github: 'pending',
};
const uploadHealthTooltipMap: Record<string, string> = {
  jd: '连接正常',
  weibo: '等待检测 Cookie',
  qiyu: '内置图床暂不可用',
  zhihu: '连接正常',
  r2: '连接正常',
  github: '等待检测 Token',
};
const uploadPublicServices = computed(() => state === 'no-services' ? [] : ['jd', 'weibo', 'qiyu', 'zhihu']);
const uploadPrivateServices = computed(() => state === 'no-services' ? [] : ['r2', 'github']);
const isUploadServiceSelected = (serviceId: string) => selectedUploadServices.has(serviceId);

function progress(serviceId: string, status: string, pct: number, link?: string, error?: string): ServiceProgress {
  return { serviceId, status, progress: pct, link, error };
}

function queueItem(kind: 'uploading' | 'failed' | 'success', index = 1): QueueItem {
  const enabledServices = ['jd', 'weibo', 'r2'];
  const suffix = `${kind}-${index}`;
  const link = (serviceId: string) => `https://img.example/${suffix}/${serviceId}.jpg`;
  const serviceProgress = {
    jd: progress('jd', kind === 'uploading' ? '68%' : '完成', kind === 'uploading' ? 68 : 100, kind === 'uploading' ? undefined : link('jd')),
    weibo: progress('weibo', kind === 'failed' ? '失败' : kind === 'uploading' ? '上传中...' : '完成', kind === 'failed' ? 0 : kind === 'uploading' ? 42 : 100, kind === 'failed' || kind === 'uploading' ? undefined : link('weibo'), kind === 'failed' ? 'HTTP 403' : undefined),
    r2: progress('r2', kind === 'uploading' ? '等待中...' : '完成', kind === 'uploading' ? 0 : 100, kind === 'uploading' ? undefined : link('r2')),
  };
  return {
    id: `queue-${suffix}`,
    fileName: `${suffix}.jpg`,
    filePath: `/visual/${suffix}.jpg`,
    enabledServices,
    serviceProgress,
    status: kind === 'failed' ? 'error' : kind,
    errorMessage: kind === 'failed' ? 'One target rejected the upload' : undefined,
    primaryUrl: kind === 'uploading' ? undefined : link('jd'),
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
    rows[5].recentlyCompletedAt = Date.now() - 500;
  }
  if (state === 'phase2-loading') {
    rows[4].recentlyCompletedAt = Date.now() - 250;
  }
  if (state === 'recheck-result') {
    rows[1].recheckResult = result('valid');
    rows[2].recheckResult = result('timeout');
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
const showServiceMenu = ref(state === 'service-menu');
const searchInput = ref(state === 'mixed-results' ? 'gallery' : '');
const searchQuery = ref('');
const searchFocused = ref(false);
const currentPage = ref(1);
const pageInput = ref('1');
const showOverflowMenu = ref(state === 'overflow-menu');
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

const historyMode = ref<'table' | 'timeline' | 'favorites'>(
  page === 'timeline' ? 'timeline' : page === 'favorites' ? 'favorites' : 'table'
);
const historyFilter = ref<ServiceType | 'all'>('all');
const historyServices = [{ id: 'jd', count: 18 }, { id: 'weibo', count: 12 }, { id: 'r2', count: 9 }];
const historyRows = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1,
  fileName: `trip-album-${index + 1}.jpg`,
  service: index % 3 === 0 ? 'JD' : index % 3 === 1 ? 'Weibo' : 'R2',
  size: `${(1.2 + index / 3).toFixed(1)} MB`,
  thumb: image(`H${index + 1}`),
}));

const isCompactViewport = window.innerWidth <= 700;
const serviceOrder: ServiceType[] = ['jd', 'weibo', 'r2', 'github'];

function visualMeta(prefix: string, index: number, overrides: Partial<ImageMeta> = {}): ImageMeta {
  const service = overrides.primaryService ?? serviceOrder[index % serviceOrder.length];
  return {
    id: `${prefix}-${index + 1}`,
    timestamp: Date.UTC(2026, 3, 28, 9, 0) - index * 3_600_000,
    localFileName: `${prefix}-shot-${String(index + 1).padStart(2, '0')}.jpg`,
    aspectRatio: [1.35, 0.82, 1, 1.7, 0.68, 1.18][index % 6],
    primaryService: service,
    primaryUrl: image(`${prefix.toUpperCase()}${index + 1}`),
    mirrorServices: [
      { serviceId: service, url: image(`${prefix.toUpperCase()}${index + 1}`) },
      { serviceId: service === 'r2' ? 'jd' : 'r2', url: image(`${prefix.toUpperCase()}${index + 1}B`) },
    ],
    isFavorited: true,
    ...overrides,
  };
}

const isFavoriteInitialLoading = computed(() => state === 'initial-loading');
const isFavoriteNoResults = computed(() => state === 'no-results');
const favoriteCount = computed(() => {
  if (state === 'empty' || isFavoriteInitialLoading.value || isFavoriteNoResults.value) return 0;
  if (state === 'scroll-middle') return 44;
  if (state === 'loading-more') return 24;
  if (state === 'mixed-services') return 20;
  return 12;
});
const favoriteTotalCount = computed(() => {
  if (isFavoriteNoResults.value || state === 'empty') return 0;
  if (state === 'loading-more') return 48;
  if (state === 'scroll-middle') return 86;
  return favoriteCount.value;
});
const favoriteHasLoadMore = computed(() => state === 'loading-more');
const favoriteMetas = computed<ImageMeta[]>(() => Array.from({ length: favoriteCount.value }, (_, index) => {
  if (state !== 'mixed-services') return visualMeta('fav', index);
  const service = serviceOrder[index % serviceOrder.length];
  const mirror = service === 'github' ? 'r2' : 'github';
  return visualMeta('fav', index, {
    primaryService: service,
    primaryUrl: image(`${service.toUpperCase()} F${index + 1}`),
    mirrorServices: [
      { serviceId: service, url: image(`${service.toUpperCase()} primary`) },
      { serviceId: mirror, url: image(`${mirror.toUpperCase()} mirror`) },
    ],
  });
}));
const favoriteSelectedIds = computed(() => (
  state === 'bulk-select' ? new Set(['fav-1', 'fav-2', 'fav-3', 'fav-4']) : new Set<string>()
));
const favoriteImageStates = computed<Record<string, 'loaded' | 'failed'>>(() => Object.fromEntries(
  favoriteMetas.value.map((meta, index) => [
    meta.id,
    (state === 'image-fallback' && (index === 2 || index === 7))
      || (state === 'mixed-services' && (index === 5 || index === 13))
      ? 'failed'
      : 'loaded',
  ])
));
const favoriteThumbnailUrls = (meta: ImageMeta) => meta.mirrorServices?.map(service => service.url) ?? [meta.primaryUrl];

const timelineMetas = Array.from({ length: 16 }, (_, index) => visualMeta('timeline', index, {
  isFavorited: index % 3 === 0,
  timestamp: Date.UTC(2026, 3, 28 - Math.floor(index / 5), 12, 0) - index * 1_800_000,
}));
const timelineGroups = computed<PhotoGroup[]>(() => [
  {
    id: '2026-3-28',
    label: '2026年4月28日',
    year: 2026,
    month: 3,
    day: 28,
    date: new Date('2026-04-28T00:00:00Z'),
    items: timelineMetas.slice(0, 8),
  },
  {
    id: '2026-2-16',
    label: '2026年3月16日',
    year: 2026,
    month: 2,
    day: 16,
    date: new Date('2026-03-16T00:00:00Z'),
    items: timelineMetas.slice(8),
  },
]);
const timelineItemWidth = isCompactViewport ? 100 : 176;
const timelineGap = 4;
const timelineColumns = isCompactViewport ? 3 : 5;
const timelineHeaderHeight = 36;
const timelineRowHeight = isCompactViewport ? 118 : 156;
const timelineGroupGap = isCompactViewport ? 22 : 28;
const timelineSecondGroupY = timelineHeaderHeight + timelineRowHeight * 2 + timelineGap * 2 + timelineGroupGap;
const timelineTotalHeight = timelineSecondGroupY + timelineHeaderHeight + timelineRowHeight * 2 + timelineGroupGap + 120;
const timelineVisibleHeaders = computed(() => [
  { groupId: '2026-3-28', label: '2026年4月28日', y: 0, height: timelineHeaderHeight },
  { groupId: '2026-2-16', label: '2026年3月16日', y: timelineSecondGroupY, height: timelineHeaderHeight },
]);
const timelineVisibleItems = computed(() => timelineGroups.value.flatMap((group, groupIndex) => {
  const groupStartY = groupIndex === 0 ? timelineHeaderHeight : timelineSecondGroupY + timelineHeaderHeight;
  return group.items.map((meta, index) => {
    const column = index % timelineColumns;
    const rowIndex = Math.floor(index / timelineColumns);
    const height = Math.round(timelineItemWidth / meta.aspectRatio);
    return {
      meta,
      groupId: group.id,
      x: column * (timelineItemWidth + timelineGap),
      y: groupStartY + rowIndex * (timelineRowHeight + timelineGap),
      width: timelineItemWidth,
      height: Math.min(height, timelineRowHeight),
    };
  });
}));
const timelineSkeletonLayout = computed<SkeletonLayoutResult>(() => ({
  totalHeight: isCompactViewport ? 620 : 560,
  groups: [
    { id: 'skeleton-april', headerY: 0 },
    { id: 'skeleton-march', headerY: isCompactViewport ? 310 : 280 },
  ],
  items: Array.from({ length: 14 }, (_, index) => {
    const groupOffset = index < 7 ? timelineHeaderHeight : (isCompactViewport ? 310 : 280) + timelineHeaderHeight;
    const localIndex = index < 7 ? index : index - 7;
    const column = localIndex % timelineColumns;
    const rowIndex = Math.floor(localIndex / timelineColumns);
    return {
      x: column * (timelineItemWidth + timelineGap),
      y: groupOffset + rowIndex * (timelineRowHeight + timelineGap),
      width: timelineItemWidth,
      height: timelineRowHeight - (localIndex % 3) * 18,
    };
  }),
}));
const timelineTotalCount = computed(() => state === 'favorites-only-empty' ? 0 : 16);
const timelineVisibleItemsForState = computed(() => (
  state === 'fast-scroll' ? [] : timelineVisibleItems.value
));
const timelineFastModeItems = computed(() => timelineVisibleItems.value.slice(0, 14).map((item, index) => ({
  x: item.x,
  y: item.y,
  width: item.width,
  height: Math.max(72, item.height - (index % 4) * 14),
})));
const timelineDisplayMode = computed<'fast' | 'normal'>(() => state === 'fast-scroll' ? 'fast' : 'normal');
const timelineHasSelection = computed(() => state === 'bulk-select');
const timelineSelectedIds = computed(() => (
  state === 'bulk-select'
    ? new Set(['timeline-1', 'timeline-2', 'timeline-5', 'timeline-9'])
    : new Set<string>()
));
const timelineFailedIds = computed(() => state === 'image-fallback' ? new Set(['timeline-3', 'timeline-10']) : new Set<string>());
const timelineLoadedIds = computed(() => {
  if (state === 'fast-scroll') return new Set<string>();
  return new Set(timelineMetas.filter(meta => !timelineFailedIds.value.has(meta.id)).map(meta => meta.id));
});
const timelineFavoriteIds = new Set(timelineMetas.filter(meta => meta.isFavorited).map(meta => meta.id));
const timelineHoverDetails = new Map<string, HistoryItem>();
const timelineThumbnailUrls = (meta: ImageMeta) => meta.mirrorServices?.map(service => service.url) ?? [meta.primaryUrl];
const timelinePeriods = [
  { year: 2026, month: 3, count: 42, minTimestamp: Date.UTC(2026, 3, 1), maxTimestamp: Date.UTC(2026, 3, 28) },
  { year: 2026, month: 2, count: 28, minTimestamp: Date.UTC(2026, 2, 1), maxTimestamp: Date.UTC(2026, 2, 16) },
  { year: 2025, month: 10, count: 19, minTimestamp: Date.UTC(2025, 10, 1), maxTimestamp: Date.UTC(2025, 10, 24) },
  { year: 2024, month: 6, count: 12, minTimestamp: Date.UTC(2024, 6, 4), maxTimestamp: Date.UTC(2024, 6, 30) },
];
const timelineLoadedMonths = computed(() => new Set(state === 'month-jump-skeleton'
  ? ['2026-3']
  : ['2026-3', '2026-2', '2025-10', '2024-6']));
const timelineMonthLayoutPositions = computed(() => new Map([
  ['2026-3', { start: 0, end: 0.32 }],
  ['2026-2', { start: 0.32, end: 0.58 }],
  ['2025-10', { start: 0.58, end: 0.78 }],
  ['2024-6', { start: 0.78, end: 1 }],
]));
const timelineLightboxItem: HistoryItem = {
  id: 'timeline-4',
  timestamp: Date.UTC(2026, 3, 28, 8, 40),
  localFileName: 'timeline-shot-04.jpg',
  primaryService: 'r2',
  results: [
    { serviceId: 'r2', status: 'success', result: { serviceId: 'r2', fileKey: 'timeline/lightbox-r2.jpg', url: image('TLB-R2') } },
    { serviceId: 'jd', status: 'success', result: { serviceId: 'jd', fileKey: 'timeline/lightbox-jd.jpg', url: image('TLB-JD') } },
  ],
  generatedLink: image('TLB-R2'),
  aspectRatio: 1.7,
  isFavorited: true,
};

const showBackupPasswordDialog = ref(['password-dialog', 'password-set-dialog', 'restore-password-error'].includes(state));
const backupPasswordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();
const backupPasswordDialogMode = computed<'set' | 'restore'>(() => state === 'password-set-dialog' ? 'set' : 'restore');
const connectedWebDAVProfile = {
  id: 'visual-nas',
  name: 'Studio NAS',
  url: 'https://dav.example.local',
  username: 'picnexus',
  password: 'fixture-only',
  remotePath: '/PicNexus/',
  connectionStatus: 'success' as const,
  lastTestedAt: Date.now() - 3_600_000,
};
const connectedWebDAV: WebDAVConfig = {
  activeId: 'visual-nas',
  profiles: [connectedWebDAVProfile],
};
const unavailableWebDAV: WebDAVConfig = {
  activeId: 'visual-nas',
  profiles: [{
    ...connectedWebDAVProfile,
    connectionStatus: 'failed',
    lastError: '连接超时，WebDAV 服务器不可用',
  }],
};
const backupWebDAVConfig = computed<WebDAVConfig>(() => state === 'webdav-unavailable' ? unavailableWebDAV : connectedWebDAV);
const backupWebDAVTesting = computed(() => state === 'cloud-syncing' || state === 'webdav-testing');
const backupCloudEnabled = computed(() => backupWebDAVConfig.value.profiles[0]?.connectionStatus === 'success');
const backupCloudHint = computed(() => backupCloudEnabled.value ? '' : '连接失败，请重新验证');
const backupSyncStatus = computed(() => {
  if (['local-success', 'cloud-syncing', 'download-needs-refresh'].includes(state)) {
    return { lastSync: new Date(Date.now() - 12 * 60_000).toISOString(), result: 'success' as const };
  }
  if (state === 'error') {
    return {
      lastSync: new Date(Date.now() - 2 * 60_000).toISOString(),
      result: 'failed' as const,
      error: 'WebDAV 返回 401，用户名或密码不正确',
    };
  }
  return { lastSync: null, result: null };
});
const backupOtherProfiles: ProfileSyncRecord[] = [{
  providerName: 'Laptop WebDAV',
  configLastSync: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  configSyncResult: 'success',
  historyLastSync: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  historySyncResult: 'success',
}];
const backupLocalLoading = computed(() => ({ export: state === 'local-backing-up', import: false }));
const backupCloudLoading = computed(() => ({
  sync: state === 'cloud-syncing',
  forceUpload: false,
  forceDownload: false,
}));
const backupLogRows = computed(() => {
  if (state === 'operation-history-empty') return [];
  if (state === 'error') return [
    { icon: 'pi-exclamation-circle', tone: 'error', title: '双向同步配置', meta: '刚刚 · Studio NAS', detail: 'WebDAV 返回 401' },
    { icon: 'pi-clock', tone: 'muted', title: '导出历史到本地', meta: '18 分钟前', detail: '245 条记录' },
  ];
  if (state === 'local-success') return [
    { icon: 'pi-check', tone: 'success', title: '导出配置到本地', meta: '刚刚', detail: 'settings.backup.json' },
    { icon: 'pi-check', tone: 'success', title: '导出历史到本地', meta: '刚刚', detail: '245 条记录' },
  ];
  if (state === 'cloud-syncing') return [
    { icon: 'pi-spin pi-spinner', tone: 'primary', title: '双向同步记录', meta: '进行中 · Studio NAS', detail: '正在合并云端记录' },
    { icon: 'pi-check', tone: 'success', title: '上传配置到云端', meta: '12 分钟前', detail: '完成' },
  ];
  return [
    { icon: 'pi-check', tone: 'success', title: '上传配置到云端', meta: '12 分钟前 · Studio NAS', detail: '完成' },
    { icon: 'pi-check', tone: 'success', title: '双向同步记录', meta: '1 小时前 · Studio NAS', detail: '245 条记录' },
  ];
});

onMounted(async () => {
  if (state === 'restore-password-error') {
    await nextTick();
    backupPasswordDialogRef.value?.onPasswordFailed();
  }

  if (state === 'overwrite-confirm-dialog') {
    await nextTick();
    visualConfirm.require({
      header: '覆盖本地数据',
      message: '本地现有的所有记录将被删除，替换为云端数据。此操作不可撤销。',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: '覆盖',
      rejectLabel: '取消',
      acceptClass: 'p-button-danger',
    });
  }
});

const themeMode = ref<ThemeMode>(isDark ? 'dark' : 'light');
const settingsLinkFormat = computed<LinkFormat>(() => state === 'custom-template' ? 'custom' : 'markdown');
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
      <div class="visual-nav" :class="{ active: page === 'history' || page === 'favorites' || page === 'timeline' }"><i class="pi pi-images"></i><span>History</span></div>
      <div class="visual-nav" :class="{ active: isLinkFeaturePage }"><i class="pi pi-wrench"></i><span>Links</span></div>
      <div class="visual-nav" :class="{ active: isSettingsPage }"><i class="pi pi-cog"></i><span>Settings</span></div>
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
        <ServiceSelector
          :public-services="uploadPublicServices"
          :private-services="uploadPrivateServices"
          :service-labels="uploadServiceLabels"
          :is-service-selected="isUploadServiceSelected"
          :service-health-map="uploadHealthMap"
          :service-health-tooltip-map="uploadHealthTooltipMap"
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

      <section v-else-if="page === 'favorites'" class="visual-page visual-history visual-favorites">
        <DashboardStrip v-model:view-mode="historyMode" v-model:filter="historyFilter" :total-count="favoriteTotalCount" :service-counts="historyServices" />
        <div v-if="isFavoriteNoResults" class="visual-filter-summary">
          <span><i class="pi pi-search"></i> query: mountain raw</span>
          <span><i class="pi pi-filter"></i> service: R2</span>
        </div>
        <div v-if="isFavoriteInitialLoading" class="visual-favorites-scroll">
          <div class="visual-favorites-grid">
            <div v-for="i in 18" :key="i" class="visual-favorites-skeleton-cell">
              <Skeleton width="100%" height="100%" border-radius="8px" />
            </div>
          </div>
        </div>
        <div v-else-if="state === 'empty' || isFavoriteNoResults" class="visual-history-empty">
          <EmptyState
            icon="pi pi-star"
            :title="isFavoriteNoResults ? 'No matching favorites' : '暂无收藏'"
            :description="isFavoriteNoResults ? 'The current search and service filter returned no favorite images.' : '点击图片右上角的 ★ 开始收藏'"
          />
        </div>
        <div v-else class="visual-favorites-scroll">
          <div class="visual-favorites-grid">
            <FavoritePhotoItem
              v-for="meta in favoriteMetas"
              :key="meta.id"
              :meta="meta"
              :thumbnail-urls="favoriteThumbnailUrls(meta)"
              :image-state="favoriteImageStates[meta.id]"
              :selected="favoriteSelectedIds.has(meta.id)"
              @click="() => {}"
              @toggle-select="() => {}"
              @toggle-favorite="() => {}"
              @image-state-change="() => {}"
            />
          </div>
          <div v-if="state === 'image-fallback'" class="visual-state-note visual-state-note--warning">
            <i class="pi pi-image"></i>
            <span>2 thumbnails fell back to the failed-image placeholder.</span>
          </div>
          <div v-if="state === 'mixed-services'" class="visual-state-note">
            <i class="pi pi-server"></i>
            <span>JD, Weibo, R2, and GitHub mirrors are mixed in one favorites grid.</span>
          </div>
          <div v-if="favoriteHasLoadMore" class="visual-load-more-sentinel">
            <i class="pi pi-spin pi-spinner"></i>
            <span>Loading more favorites: {{ favoriteMetas.length }} / {{ favoriteTotalCount }}</span>
          </div>
        </div>
        <div v-if="state === 'bulk-select'" class="visual-floating-bar">
          <span>4 selected</span><button>Copy</button><button>Export</button><button class="danger">Delete</button>
        </div>
        <div v-if="state === 'lightbox'" class="visual-lightbox">
          <img :src="image('Favorite lightbox')" alt="" />
          <div class="visual-lightbox-bar">
            <strong>fav-shot-01.jpg</strong><span>收藏 · JD · R2 mirror</span>
            <button><i class="pi pi-copy"></i></button><button><i class="pi pi-star-fill"></i></button>
          </div>
        </div>
      </section>

      <section v-else-if="page === 'timeline'" class="visual-page visual-history visual-timeline">
        <DashboardStrip v-model:view-mode="historyMode" v-model:filter="historyFilter" :total-count="timelineTotalCount" :service-counts="historyServices" />
        <div v-if="state === 'empty' || state === 'favorites-only-empty'" class="visual-history-empty">
          <EmptyState
            :icon="state === 'favorites-only-empty' ? 'pi pi-star' : 'pi pi-images'"
            :title="state === 'favorites-only-empty' ? '暂无收藏' : '暂无上传记录'"
            :description="state === 'favorites-only-empty' ? 'Favorites-only timeline has no matching images.' : '上传图片后，历史记录将在这里显示'"
          />
        </div>
        <div v-else-if="state === 'loading'" class="visual-timeline-scroll">
          <TimelineSkeleton :layout="timelineSkeletonLayout" />
        </div>
        <div v-else class="visual-timeline-scroll">
          <TimelinePhotoGrid
            :groups="timelineGroups"
            :visible-items="timelineVisibleItemsForState"
            :visible-skeleton-slots="[]"
            :visible-headers="timelineVisibleHeaders"
            :fast-mode-items="timelineFastModeItems"
            :total-height="timelineTotalHeight"
            :display-mode="timelineDisplayMode"
            :selected-ids="timelineSelectedIds"
            :favorite-ids="timelineFavoriteIds"
            :has-selection="timelineHasSelection"
            :loaded-images="timelineLoadedIds"
            :failed-images="timelineFailedIds"
            :hover-details-map="timelineHoverDetails"
            :get-thumbnail-urls="timelineThumbnailUrls"
            @item-click="() => {}"
            @item-toggle-select="() => {}"
            @item-toggle-favorite="() => {}"
            @item-hover="() => {}"
            @image-load="() => {}"
            @image-error="() => {}"
          />
          <div v-if="state === 'scroll-restored'" class="visual-timeline-restore-chip">
            <i class="pi pi-history"></i><span>Restored to the middle of the timeline</span>
          </div>
          <div class="visual-timeline-end-spacer"></div>
          <div v-if="state === 'fast-scroll'" class="visual-timeline-restore-chip">
            <i class="pi pi-bolt"></i><span>Fast scroll mode is showing placeholders</span>
          </div>
          <div v-if="state === 'month-jump-skeleton'" class="visual-timeline-jump-overlay">
            <TimelineSkeleton :layout="timelineSkeletonLayout" />
          </div>
          <div v-if="state === 'indicator-visible'" class="visual-timeline-indicator-shell">
            <TimelineIndicator
              :periods="timelinePeriods"
              :scroll-progress="0.38"
              :visible-ratio="0.22"
              :total-height="timelineTotalHeight"
              :loaded-months="timelineLoadedMonths"
              :month-layout-positions="timelineMonthLayoutPositions"
              @drag-scroll="() => {}"
              @jump-to-period="() => {}"
              @jump-to-year="() => {}"
            />
          </div>
          <div v-if="state === 'layout-calculating'" class="visual-layout-indicator">
            <i class="pi pi-spin pi-spinner"></i>
          </div>
        </div>
        <div v-if="state === 'bulk-select'" class="visual-floating-bar">
          <span>4 selected</span><button>Copy</button><button>Export</button><button class="danger">Delete</button>
        </div>
        <div v-if="state === 'lightbox'" class="visual-lightbox">
          <img :src="timelineLightboxItem.generatedLink" alt="" />
          <div class="visual-lightbox-bar">
            <strong>{{ timelineLightboxItem.localFileName }}</strong><span>R2 · JD mirror</span>
            <button><i class="pi pi-copy"></i></button><button><i class="pi pi-star-fill"></i></button>
          </div>
        </div>
      </section>

      <section
        v-else-if="isLinkFeaturePage"
        class="visual-page visual-linkcheck"
        :class="{ 'visual-linkcheck--native': page !== 'link-check' }"
      >
        <div class="visual-tabs">
          <span :class="{ active: page === 'link-check' }">Link check</span>
          <span :class="{ active: page === 'markdown-repair' }">Markdown repair</span>
          <span :class="{ active: page === 'batch-migrate' }">Batch migrate</span>
        </div>
        <div v-if="page === 'markdown-repair'" class="visual-native-body">
          <MdRescueInline />
        </div>
        <div v-else-if="page === 'batch-migrate'" class="visual-migrate-panel">
          <MigrateSelectPhase
            v-if="migrateContext.phase.value === 'configuring'"
            @start="migrateContext.startMigrate"
          />
          <MigrateProgressPhase v-else />
        </div>
        <div v-else-if="state === 'skeleton'" class="monitor-panel monitor-panel--skeleton">
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
            :is-phase2-loading="state === 'phase2-loading'"
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

      <section v-else-if="page === 'backup-sync'" class="visual-page visual-settings visual-backup-sync">
        <div class="settings-layout visual-settings-layout">
          <div class="settings-sidebar">
            <div class="sidebar-title">Settings</div>
            <button class="nav-item"><i class="pi pi-cog"></i><span>General</span></button>
            <button class="nav-item"><i class="pi pi-images"></i><span>Hosting</span></button>
            <button class="nav-item active"><i class="pi pi-database"></i><span>Backup</span></button>
          </div>
          <div class="settings-content">
            <div class="settings-section visual-backup-section">
              <div class="section-header">
                <h2>备份与同步</h2>
                <p class="section-desc">管理你的设置和上传记录，支持多设备同步</p>
              </div>

              <div v-if="state === 'local-success'" class="visual-success-banner">
                <i class="pi pi-check-circle"></i>
                <span>本地备份已完成，配置和上传记录已写入 fixture 路径。</span>
              </div>
              <div v-if="state === 'error'" class="visual-error-banner">
                <i class="pi pi-exclamation-triangle"></i>
                <span>同步失败：WebDAV 返回 401，用户名或密码不正确。</span>
              </div>
              <ReloadBanner
                :visible="state === 'download-needs-refresh'"
                message="Cloud backup was downloaded locally. Refresh to apply the restored settings."
                @reload="() => {}"
              />

              <div class="form-group">
                <label class="group-label">备份密码</label>
                <div class="visual-password-card">
                  <span class="security-status-inactive"><i class="pi pi-exclamation-circle"></i> 未设置</span>
                  <button class="visual-outline-button"><i class="pi pi-lock"></i><span>设置密码</span></button>
                </div>
              </div>

              <div class="visual-divider"></div>

              <div class="form-group">
                <label class="group-label">WebDAV 连接</label>
                <WebDAVConfigCollapsible
                  :model-value="backupWebDAVConfig"
                  :testing="backupWebDAVTesting"
                  @update:model-value="() => {}"
                  @save="() => {}"
                  @test="() => {}"
                />
              </div>

              <div class="visual-divider"></div>

              <div class="form-group">
                <label class="group-label">数据管理</label>
                <div class="data-section">
                  <div class="data-section-header">
                    <span class="data-section-title">配置文件</span>
                    <span class="data-section-desc">你的图床账号和设置</span>
                  </div>
                  <DataItemCard
                    type="config"
                    :sync-status="backupSyncStatus"
                    :is-cloud-enabled="backupCloudEnabled"
                    :cloud-hint="backupCloudHint"
                    provider-name="Studio NAS"
                    :other-profiles="backupOtherProfiles"
                    :local-loading="backupLocalLoading"
                    :cloud-loading="backupCloudLoading"
                    @export-local="() => {}"
                    @import-local="() => {}"
                    @sync-cloud="() => {}"
                    @force-upload="() => {}"
                    @force-download="() => {}"
                  />
                </div>
                <div class="data-section">
                  <div class="data-section-header">
                    <span class="data-section-title">上传记录</span>
                    <span class="data-section-desc">所有已上传的图片链接</span>
                  </div>
                  <DataItemCard
                    type="history"
                    :sync-status="backupSyncStatus"
                    :is-cloud-enabled="backupCloudEnabled"
                    :cloud-hint="backupCloudHint"
                    provider-name="Studio NAS"
                    :other-profiles="backupOtherProfiles"
                    :local-loading="backupLocalLoading"
                    :cloud-loading="backupCloudLoading"
                    @export-local="() => {}"
                    @import-local="() => {}"
                    @sync-cloud="() => {}"
                    @force-upload="() => {}"
                    @force-download="() => {}"
                  />
                </div>
                <div class="data-section">
                  <div class="data-section-header">
                    <span class="data-section-title">操作历史</span>
                    <span class="data-section-desc">备份、导入导出等操作记录</span>
                  </div>
                  <div class="visual-sync-log">
                    <div v-if="backupLogRows.length === 0" class="visual-sync-log-empty">
                      <i class="pi pi-inbox"></i>
                      <span>No backup operations yet</span>
                    </div>
                    <template v-else>
                      <div v-for="row in backupLogRows" :key="row.title + row.meta" class="visual-sync-log-row" :class="`tone-${row.tone}`">
                        <i :class="['pi', row.icon]"></i>
                        <div>
                          <strong>{{ row.title }}</strong>
                          <span>{{ row.meta }} · {{ row.detail }}</span>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </div>

              <BackupPasswordDialog
                ref="backupPasswordDialogRef"
                v-model="showBackupPasswordDialog"
                :mode="backupPasswordDialogMode"
                @confirm="() => {}"
                @skip="() => {}"
                @cancel="() => {}"
              />
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="page === 'settings'" class="visual-page visual-settings">
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
                :link-default-format="settingsLinkFormat"
                link-custom-template="![{filename}]({url}?w={width}&h={height})"
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
    <ConfirmDialog />
  </div>
</template>
