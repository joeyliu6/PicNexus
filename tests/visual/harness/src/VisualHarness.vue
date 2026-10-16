<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref } from 'vue';
import Skeleton from 'primevue/skeleton';
import DashboardStrip from '@/components/views/history/DashboardStrip.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ReloadBanner from '@/components/common/ReloadBanner.vue';
import FavoritePhotoItem from '@/components/views/favorites/FavoritePhotoItem.vue';
import TimelinePhotoGrid from '@/components/views/timeline/TimelinePhotoGrid.vue';
import TimelineIndicator from '@/components/views/timeline/TimelineIndicator.vue';
import TimelineSkeleton from '@/components/views/timeline/TimelineSkeleton.vue';
import MdRescueInline from '@/components/views/link-check/MdRescueInline.vue';
import MigrateSelectPhase from '@/components/views/link-check/migrate/MigrateSelectPhase.vue';
import MigrateProgressPhase from '@/components/views/link-check/migrate/MigrateProgressPhase.vue';
import { MIGRATE_KEY } from '@/components/views/link-check/migrate/keys';
import HistoryCheckPanel from '@/components/views/link-check/HistoryCheckPanel.vue';
import LinkCheckSkeleton from '@/components/views/link-check/history-check/LinkCheckSkeleton.vue';
import GeneralSettingsPanel from '@/components/settings/GeneralSettingsPanel.vue';
import ServiceEnableSection from '@/components/settings/hosting/ServiceEnableSection.vue';
import DataItemCard from '@/components/settings/backup-sync/DataItemCard.vue';
import WebDAVConfigCollapsible from '@/components/settings/backup-sync/WebDAVConfigCollapsible.vue';
import BackupPasswordDialog from '@/components/dialogs/BackupPasswordDialog.vue';
import WechatQrDialog from '@/components/settings/about-update/WechatQrDialog.vue';
import OnboardingDialog from '@/components/onboarding/OnboardingDialog.vue';
import PnConfirmHost from '@/components/pn/PnConfirmHost.vue';
import { useConfirm } from '@/composables/useConfirm';
import { useOnboarding } from '@/composables/useOnboarding';
import { applyMarkdownRepairFixture, createMigrateContext } from './linkFeatureFixtures';
import type { CheckLinkResult, LinkCheckRow, BatchCheckProgress } from '@/types/linkCheck';
import type { HistoryItem, ProfileSyncRecord, ServiceType, ThemeMode, WebDAVConfig } from '@/config/types';
import type { ServiceHealthStatus } from '@/types/serviceHealth';
import type { ServiceCheckSession } from '@/types/serviceCheck';
import type { LinkFormat } from '@/utils/linkFormatter';
import type { ImageMeta } from '@/types/image-meta';
import type { PhotoGroup } from '@/composables/timeline/types';
import type { SkeletonLayoutResult } from '@/utils/justifiedLayout';

type VisualPage = 'history' | 'favorites' | 'timeline' | 'backup-sync' | 'link-check' | 'markdown-repair' | 'batch-migrate' | 'settings' | 'dialogs';
type VisualState = string;

const params = new URLSearchParams(window.location.search);
const page = (params.get('page') || 'history') as VisualPage;
const state = (params.get('state') || 'empty') as VisualState;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = state === 'dark-theme' || prefersDark;
const rootClass = isDark ? 'dark-theme' : 'light-theme';
const isLinkFeaturePage = computed(() => page === 'link-check' || page === 'markdown-repair' || page === 'batch-migrate');
const isSettingsPage = computed(() => page === 'settings' || page === 'backup-sync');

document.documentElement.classList.toggle('dark-theme', isDark);
document.documentElement.classList.toggle('light-theme', !isDark);
document.documentElement.dataset.theme = isDark ? 'dark' : 'light';

const migrateContext = createMigrateContext(state);
provide(MIGRATE_KEY, migrateContext);

if (page === 'markdown-repair') {
  applyMarkdownRepairFixture(state);
}

/* ---- dialogs 页：集中覆盖不隶属于任何业务页面的独立弹窗 ---- */
const showWechatQrDialog = ref(page === 'dialogs' && state === 'wechat-qr');
const isOnboardingState = computed(() => page === 'dialogs' && state.startsWith('onboarding'));

/* OnboardingDialog 的显隐是 useOnboarding 的模块级状态，只能用它自己的 API 驱动 */
const onboardingStepIndex: Record<string, number> = {
  'onboarding-welcome': 0,
  'onboarding-upload': 1,
  'onboarding-services': 2,
};
if (page === 'dialogs' && state in onboardingStepIndex) {
  const onboarding = useOnboarding();
  onboarding.reopen();
  for (let i = 0; i < onboardingStepIndex[state]; i++) onboarding.nextStep();
}

const image = (seed: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#60a5fa"/><stop offset="0.55" stop-color="#22c55e"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><circle cx="486" cy="104" r="70" fill="rgba(255,255,255,.35)"/><path d="M0 330 150 190l92 78 86-112 312 174v90H0z" fill="rgba(15,23,42,.38)"/><text x="36" y="62" fill="white" font-family="Arial" font-size="30" font-weight="700">${seed}</text></svg>`;
  // Why base64:收藏页 / 时间轴的缩略图会过 safeImageUrl 安全闸，
  // 它只放行 base64 形式的 data:image URL（防止百分号编码里夹带脚本），
  // URL-encoded 形式会被拦成空白卡片。
  return `data:image/svg+xml;base64,${btoa(svg)}`;
};

function result(kind: 'valid' | 'invalid' | 'timeout' | 'hotlink'): CheckLinkResult {
  if (kind === 'valid') return { link: '', is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false, response_time: 108 };
  if (kind === 'timeout') return { link: '', is_valid: false, error_type: 'timeout', error: 'Timeout', browser_might_work: false, response_time: 10000 };
  if (kind === 'hotlink') return { link: '', is_valid: false, status_code: 403, error_type: 'http_4xx', error: 'Forbidden', browser_might_work: true, response_time: 840 };
  return { link: '', is_valid: false, status_code: 404, error_type: 'http_4xx', error: 'Not found', browser_might_work: false, response_time: 280 };
}

/** 三天前检查过：结论卡写「3天前检查」 */
const CHECKED_AT = Date.now() - 3 * 86_400_000;

function row(idx: number, serviceId: string, kind?: 'valid' | 'invalid' | 'timeout' | 'hotlink', primary = false): LinkCheckRow {
  return {
    historyId: `history-${idx}`,
    serviceId,
    url: `https://img.example/${idx}/${serviceId}.jpg`,
    rawUrl: `https://img.example/${idx}/${serviceId}.jpg`,
    fileName: `gallery-shot-${idx.toString().padStart(2, '0')}.jpg`,
    isPrimary: primary,
    checkResult: kind ? result(kind) : undefined,
    checkedAt: kind ? CHECKED_AT : undefined,
  };
}

/**
 * 八张图覆盖每一类：能改用备份 / 打不开（超时）/ 找不回（404）/ 受限（防盗链）/ 备份失效 / 正常 / 没检查
 */
function mixedLinkRows(): LinkCheckRow[] {
  return [
    row(1, 'jd', 'valid', true),
    row(2, 'weibo', 'invalid', true),
    row(2, 'jd', 'valid'),
    row(3, 'r2', 'timeout', true),
    row(4, 'github', 'hotlink', true),
    row(5, 'smms', undefined, true),
    row(6, 'zhihu', 'valid', true),
    row(6, 'weibo', 'invalid'),
    row(7, 'nami', 'invalid', true),
    row(8, 'qiyu', undefined, true),
  ];
}

const linkRows = computed<LinkCheckRow[]>(() => {
  if (state === 'empty' || state === 'skeleton') return [];
  if (state === 'never-checked') return mixedLinkRows().map((r) => ({ ...r, checkResult: undefined, checkedAt: undefined }));
  if (state === 'all-clear') {
    return [
      row(1, 'jd', 'valid', true),
      row(1, 'weibo', 'valid'),
      row(2, 'r2', 'valid', true),
      row(2, 'jd', 'valid'),
      row(3, 'github', 'valid', true),
    ];
  }
  const rows = mixedLinkRows();
  if (state === 'recheck-result') {
    rows[3].recheckLoading = true;
    rows[1].recheckResult = result('valid');
  }
  return rows;
});

const progressValue = computed<BatchCheckProgress | null>(() => (state === 'running' || state === 'paused') ? { checked: 5, total: 10, current_url: 'https://img.example/5/smms.jpg' } : null);

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
const timelineItemWidth = 176;
const timelineGap = 4;
const timelineColumns = 5;
const timelineHeaderHeight = 36;
const timelineRowHeight = 156;
const timelineGroupGap = 28;
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
  totalHeight: 560,
  groups: [
    { id: 'skeleton-april', headerY: 0 },
    { id: 'skeleton-march', headerY: 280 },
  ],
  items: Array.from({ length: 14 }, (_, index) => {
    const groupOffset = index < 7 ? timelineHeaderHeight : 280 + timelineHeaderHeight;
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

const passwordDialogStates = [
  'password-dialog',
  'password-set-dialog',
  'password-change-dialog',
  'password-disable-dialog',
  'restore-password-error',
];
const showBackupPasswordDialog = ref(passwordDialogStates.includes(state));
const backupPasswordDialogRef = ref<InstanceType<typeof BackupPasswordDialog>>();
const backupPasswordDialogMode = computed<'set' | 'change' | 'disable' | 'restore'>(() => {
  if (state === 'password-set-dialog') return 'set';
  if (state === 'password-change-dialog') return 'change';
  if (state === 'password-disable-dialog') return 'disable';
  return 'restore';
});
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
    useConfirm().showConfirm({
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
const testingConnections = computed((): Record<string, boolean> => state === 'connection-testing' ? { jd: true, qiyu: true } : {});
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
      <div class="visual-nav"><i class="pi pi-cloud-upload"></i><span>Upload</span></div>
      <div class="visual-nav" :class="{ active: page === 'history' || page === 'favorites' || page === 'timeline' }"><i class="pi pi-images"></i><span>History</span></div>
      <div class="visual-nav" :class="{ active: isLinkFeaturePage }"><i class="pi pi-wrench"></i><span>Links</span></div>
      <div class="visual-nav" :class="{ active: isSettingsPage }"><i class="pi pi-cog"></i><span>Settings</span></div>
    </aside>

    <main class="visual-main">
      <section v-if="page === 'history'" class="visual-page visual-history">
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
          <i class="pi pi-check-circle"></i>
          <span>3</span>
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
          <i class="pi pi-check-circle"></i>
          <span>4</span>
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
          <i class="pi pi-check-circle"></i>
          <span>4</span>
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
        :class="{ 'visual-linkcheck--native': true }"
      >
        <div class="visual-tabs">
          <span :class="{ active: page === 'link-check' }">链接检测</span>
          <span :class="{ active: page === 'markdown-repair' }">文档修复</span>
          <span :class="{ active: page === 'batch-migrate' }">补充备份</span>
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
        <div v-else class="visual-native-body">
          <LinkCheckSkeleton v-if="state === 'skeleton'" />
          <HistoryCheckPanel
            v-else
            :check-rows="linkRows"
            :is-checking="state === 'running' || state === 'paused'"
            :is-paused="state === 'paused'"
            :is-loading="false"
            :load-error="null"
            :is-phase2-loading="state === 'phase2-loading'"
            :progress="progressValue"
            progress-source="monitor"
            :is-action-locked="false"
          />
        </div>
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
                  <span class="visual-security-status-inactive"><span>●</span>未设置</span>
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
                :public-service-risk-accepted="false"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- 独立弹窗集中覆盖页：守住"全项目弹窗外壳统一"这条线 -->
      <section v-else-if="page === 'dialogs'" class="visual-page visual-dialogs">
        <div class="visual-dialogs-backdrop">Dialog visual fixtures</div>

        <WechatQrDialog v-model:visible="showWechatQrDialog" />
        <OnboardingDialog v-if="isOnboardingState" />
      </section>
    </main>
    <PnConfirmHost />
  </div>
</template>
