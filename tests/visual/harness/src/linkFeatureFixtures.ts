import { computed, ref } from 'vue';
import type { MigrateContext } from '@/components/views/linkcheck/migrate/keys';
import type {
  MigrateFailureDetail,
  MigrateFailureRecord,
  MigrateItemStatus,
  MigratePhase,
  MigrateResult,
  MigrateStats,
  MigrateTargetService,
} from '@/types/batchMigrate';
import type { CheckLinkResult } from '@/types/linkCheck';
import {
  phase as rescuePhase,
  mode as rescueMode,
  filePath as rescueFilePath,
  folderPath as rescueFolderPath,
  mdFiles as rescueMdFiles,
  fileContent as rescueFileContent,
  imageLinks as rescueImageLinks,
  isAnalyzing as rescueIsAnalyzing,
  isCollecting as rescueIsCollecting,
  collectProgress as rescueCollectProgress,
  isReplacing as rescueIsReplacing,
  excludedUrls as rescueExcludedUrls,
  includeSubfolders as rescueIncludeSubfolders,
  includeCodeBlocks as rescueIncludeCodeBlocks,
  fixingProgress as rescueFixingProgress,
  repairReceipt as rescueRepairReceipt,
  healedFiles as rescueHealedFiles,
  hostPreference as rescueHostPreference,
  scanStage as rescueScanStage,
  readyFiles as rescueReadyFiles,
  scanProgress as rescueScanProgress,
  isCancelled as rescueIsCancelled,
  skippedDirs as rescueSkippedDirs,
  setCheckStartTime,
  setCollectCancelled,
  setUrlIndex,
  type MdImageLinkWithFile,
} from '@/composables/md-rescue/shared';

type BatchMigrateVisualState =
  | 'source-selection'
  | 'target-selection'
  | 'migrating'
  | 'paused'
  | 'partial-failed'
  | 'skipped-success-mixed'
  | 'complete';

type MarkdownRepairVisualState =
  | 'empty'
  | 'scanning'
  | 'bad-link-groups'
  | 'repair-confirm-dialog'
  | 'fixing'
  | 'complete'
  | 'partial-failed';

function migrateTargets(state: string): MigrateTargetService[] {
  const targetSelected = state !== 'source-selection';
  return [
    { serviceId: 'r2', displayName: 'Cloudflare R2', isConfigured: true, pendingCount: 286, checked: targetSelected },
    { serviceId: 'github', displayName: 'GitHub', isConfigured: true, pendingCount: 184, checked: state === 'target-selection' || state === 'migrating' || state === 'paused' },
    { serviceId: 'smms', displayName: 'SM.MS', isConfigured: true, pendingCount: 91, checked: false },
    { serviceId: 'qiniu', displayName: 'Qiniu', isConfigured: true, pendingCount: 58, checked: false },
    { serviceId: 'upyun', displayName: 'Upyun', isConfigured: false, pendingCount: 0, checked: false },
  ];
}

function migrateStatus(
  index: number,
  status: MigrateItemStatus['status'],
  overrides: Partial<MigrateItemStatus> = {},
): MigrateItemStatus {
  const id = `migrate-${index}`;
  const source = index % 2 === 0 ? 'weibo' : 'jd';
  const baseResults: MigrateItemStatus['serviceResults'] = { r2: 'pending', github: 'pending' };
  const serviceResults = status === 'success'
    ? { r2: 'success', github: index % 2 === 0 ? 'success' : 'pending' }
    : status === 'failed'
      ? { r2: 'failed', github: 'pending' }
      : status === 'skipped'
        ? { r2: 'pending', github: 'pending' }
        : baseResults;

  return {
    historyId: id,
    fileName: `migration-fixture-${String(index).padStart(2, '0')}.jpg`,
    sourceUrl: `https://img.example/migrate/${id}.jpg`,
    status,
    serviceResults,
    existingServiceIds: status === 'skipped' ? ['jd', 'r2'] : [source],
    ...overrides,
  };
}

function runningMigrateItems(paused: boolean): MigrateItemStatus[] {
  return [
    migrateStatus(1, 'success', { serviceResults: { r2: 'success', github: 'success' } }),
    migrateStatus(2, 'uploading', { serviceResults: { r2: 'success', github: 'pending' } }),
    migrateStatus(3, paused ? 'pending' : 'downloading'),
    migrateStatus(4, 'converting', { convertedFormat: 'jpeg' }),
    migrateStatus(5, 'failed', {
      errorType: 'upload',
      error: 'R2 rejected the object',
      failureDetails: [{ serviceId: 'r2', message: 'HTTP 503 from storage edge' }],
      serviceResults: { r2: 'failed', github: 'pending' },
    }),
    migrateStatus(6, 'pending'),
    migrateStatus(7, 'skipped', { existingServiceIds: ['weibo', 'r2'] }),
  ];
}

function doneMigrateItems(state: string): MigrateItemStatus[] {
  if (state === 'complete') {
    return Array.from({ length: 7 }, (_, i) => migrateStatus(i + 1, 'success', {
      serviceResults: { r2: 'success' },
    }));
  }

  if (state === 'skipped-success-mixed') {
    return [
      migrateStatus(1, 'success', { serviceResults: { r2: 'success' } }),
      migrateStatus(2, 'skipped', { existingServiceIds: ['jd', 'r2'] }),
      migrateStatus(3, 'success', { serviceResults: { r2: 'success' } }),
      migrateStatus(4, 'skipped', { existingServiceIds: ['weibo', 'r2'] }),
      migrateStatus(5, 'success', { serviceResults: { r2: 'success' } }),
      migrateStatus(6, 'skipped', { existingServiceIds: ['github', 'r2'] }),
    ];
  }

  return [
    migrateStatus(1, 'failed', {
      errorType: 'upload',
      error: 'R2: HTTP 503; GitHub: rate limited',
      failureDetails: [
        { serviceId: 'r2', message: 'HTTP 503 from storage edge' },
        { serviceId: 'github', message: 'API rate limit exceeded' },
      ],
      serviceResults: { r2: 'failed', github: 'failed' },
    }),
    migrateStatus(2, 'success', { serviceResults: { r2: 'success', github: 'failed' } }),
    migrateStatus(3, 'success', { serviceResults: { r2: 'success', github: 'success' } }),
    migrateStatus(4, 'skipped', { existingServiceIds: ['jd', 'r2'] }),
    migrateStatus(5, 'failed', {
      errorType: 'download',
      error: 'Source image timed out',
      failureDetails: [{ message: 'Timeout while downloading source image' }],
      serviceResults: { r2: 'pending', github: 'pending' },
    }),
    migrateStatus(6, 'success', { serviceResults: { r2: 'success', github: 'success' } }),
  ];
}

function failureRecord(item: MigrateItemStatus): MigrateFailureRecord {
  const fallbackDetail: MigrateFailureDetail = { message: item.error ?? 'Migration failed' };
  return {
    historyId: item.historyId,
    fileName: item.fileName,
    error: item.error ?? 'Migration failed',
    errorType: item.errorType,
    details: item.failureDetails ?? [fallbackDetail],
  };
}

function makeMigrateResult(state: string, items: MigrateItemStatus[]): MigrateResult | null {
  if (state === 'migrating' || state === 'paused') return null;
  const failures = items.filter((item) => item.status === 'failed').map(failureRecord);
  const successCount = items.filter((item) => item.status === 'success').length;
  const skippedCount = items.filter((item) => item.status === 'skipped').length;

  return {
    successCount,
    failedCount: failures.length,
    skippedCount,
    failures,
    partialFailures: state === 'partial-failed'
      ? [{ fileName: 'migration-fixture-02.jpg', failedTargets: ['github'] }]
      : [],
    durationMs: state === 'complete' ? 42_000 : 68_000,
    avgBytesPerSec: state === 'complete' ? 7_800_000 : 4_200_000,
    targetServiceIds: state === 'complete' || state === 'skipped-success-mixed' ? ['r2'] : ['r2', 'github'],
    itemsSnapshot: items,
  };
}

export function createMigrateContext(rawState: string): MigrateContext {
  const state = rawState as BatchMigrateVisualState;
  const phase = ref<MigratePhase>(state === 'source-selection' || state === 'target-selection' ? 'configuring' : state === 'migrating' || state === 'paused' ? 'migrating' : 'done');
  const targetServices = ref(migrateTargets(state));
  const sourceServiceFilter = ref<string[]>(state === 'source-selection' ? [] : ['jd', 'weibo']);
  const allItemStatuses = ref<MigrateItemStatus[]>(state === 'migrating' || state === 'paused' ? runningMigrateItems(state === 'paused') : doneMigrateItems(state));
  const migrateResult = ref<MigrateResult | null>(makeMigrateResult(state, allItemStatuses.value));
  const processed = allItemStatuses.value.filter((item) => ['success', 'failed', 'skipped'].includes(item.status)).length;
  const failed = allItemStatuses.value.filter((item) => item.status === 'failed').length;
  const skipped = allItemStatuses.value.filter((item) => item.status === 'skipped').length;
  const success = allItemStatuses.value.filter((item) => item.status === 'success').length;
  const total = state === 'migrating' || state === 'paused' ? 18 : allItemStatuses.value.length;
  const configuredServices = computed(() => targetServices.value.filter((item) => item.isConfigured));
  const unconfiguredServices = computed(() => targetServices.value.filter((item) => !item.isConfigured));
  const checkedTargets = computed(() => configuredServices.value.filter((item) => item.checked));
  const totalPending = computed(() => checkedTargets.value.reduce((sum, item) => sum + item.pendingCount, 0));
  const migrateStats = ref<MigrateStats>({
    startTime: Date.now() - 28_000,
    elapsedMs: state === 'paused' ? 28_000 : 34_000,
    processedCount: processed,
    totalCount: total,
    totalBytes: 156_000_000,
  });

  return {
    phase,
    isInitialized: ref(true),
    isFilterApplied: ref(true),
    isRefiltering: ref(false),
    maxSuccessCount: ref(1),
    sourceServiceFilter,
    availableSourceServices: ref([
      { id: 'jd', displayName: 'JD', count: 286 },
      { id: 'weibo', displayName: 'Weibo', count: 184 },
      { id: 'zhihu', displayName: 'Zhihu', count: 97 },
      { id: 'github', displayName: 'GitHub', count: 43 },
    ]),
    timestampAfterMs: ref(Date.now() - 1000 * 60 * 60 * 24 * 30),
    configuredServices,
    unconfiguredServices,
    checkedTargets,
    totalPending,
    isAllBackedUp: computed(() => totalPending.value === 0),
    itemStatuses: allItemStatuses,
    allItemStatuses,
    globalProgress: ref({ current: processed, total, percent: Math.round((processed / total) * 100) }),
    migrateResult,
    cumulativeCounts: ref({ success, failed, skipped }),
    retryingIds: ref(new Set<string>(state === 'partial-failed' ? ['migrate-5'] : [])),
    estimatedTimeRemaining: computed(() => state === 'paused' ? 96_000 : state === 'migrating' ? 72_000 : null),
    averageSpeed: computed(() => state === 'paused' ? 3_200_000 : 5_400_000),
    concurrentCount: computed(() => state === 'paused' ? 0 : 3),
    initError: ref(null),
    initConfiguring: async () => {},
    applyFilter: async () => {},
    startMigrate: async () => {},
    cancelMigrate: () => {},
    pauseMigrate: () => {},
    resumeMigrate: () => {},
    isPaused: ref(state === 'paused'),
    isPausing: ref(false),
    isCancelling: ref(false),
    retryFailed: async () => {},
    retrySingleFailed: async () => {},
    resetToConfiguring: async () => {},
    migrateStats,
    healthStatusMap: ref({ r2: 'verified', github: 'pending', smms: 'verified', qiniu: 'verified' }),
    healthTooltipMap: ref({ r2: 'Ready', github: 'Token pending recheck', smms: 'Ready', qiniu: 'Ready' }),
  };
}

function checkResult(kind: 'valid' | 'invalid' | 'timeout' | 'suspicious'): CheckLinkResult {
  if (kind === 'valid') return { link: '', is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false, response_time: 96 };
  if (kind === 'timeout') return { link: '', is_valid: false, error_type: 'timeout', error: 'Timeout', browser_might_work: false, response_time: 10_000 };
  if (kind === 'suspicious') return { link: '', is_valid: false, status_code: 403, error_type: 'suspicious', error: 'Browser may work', browser_might_work: true, response_time: 840 };
  return { link: '', is_valid: false, status_code: 404, error_type: 'http_4xx', error: 'Not found', browser_might_work: false, response_time: 280 };
}

function mdLink(index: number, fileName: string, kind: 'valid' | 'invalid' | 'timeout' | 'suspicious', hasBackup = true): MdImageLinkWithFile {
  const basePath = `C:/visual/docs/${fileName}`;
  const url = `https://img.example/md/${fileName}/${index}.jpg`;
  return {
    originalText: `![fixture-${index}](${url})`,
    url,
    altText: `fixture-${index}`,
    lineNumber: 12 + index * 4,
    syntax: 'markdown',
    context: index % 3 === 0 ? 'table' : 'normal',
    sourceFile: basePath,
    sourceFileName: fileName,
    checkResult: checkResult(kind),
    backupLinks: hasBackup
      ? [
          { serviceId: 'r2', url: `https://img.example/backup/r2/${index}.jpg`, checkResult: checkResult('valid') },
          { serviceId: 'github', url: `https://img.example/backup/github/${index}.jpg`, checkResult: checkResult(index % 2 === 0 ? 'valid' : 'timeout') },
        ]
      : [
          { serviceId: 'r2', url: `https://img.example/backup/r2/${index}.jpg`, checkResult: checkResult('invalid') },
        ],
  };
}

function markdownLinks(state: MarkdownRepairVisualState): MdImageLinkWithFile[] {
  if (state === 'empty' || state === 'scanning') return [];

  const links = [
    mdLink(1, 'launch-notes.md', 'invalid', true),
    mdLink(2, 'launch-notes.md', 'timeout', true),
    mdLink(3, 'api-reference.md', 'invalid', true),
    mdLink(4, 'api-reference.md', 'suspicious', false),
    mdLink(5, 'weekly-report.md', 'valid', true),
    mdLink(6, 'weekly-report.md', 'invalid', state !== 'partial-failed'),
  ];

  if (state === 'complete') {
    return links.map((link) => ({
      ...link,
      selectedBackup: link.backupLinks?.find((backup) => backup.checkResult?.is_valid)?.url,
    }));
  }

  if (state === 'partial-failed') {
    return links.map((link, index) => ({
      ...link,
      selectedBackup: index < 3 ? link.backupLinks?.find((backup) => backup.checkResult?.is_valid)?.url : undefined,
    }));
  }

  return links;
}

export function applyMarkdownRepairFixture(rawState: string): void {
  const state = rawState as MarkdownRepairVisualState;
  const links = markdownLinks(state);
  const ready = new Set(links.map((link) => link.sourceFile));
  const healed = new Set<string>();

  if (state === 'fixing') {
    healed.add('C:/visual/docs/launch-notes.md');
  } else if (state === 'complete') {
    for (const file of ready) healed.add(file);
  } else if (state === 'partial-failed') {
    healed.add('C:/visual/docs/launch-notes.md');
  }

  rescuePhase.value = state === 'empty' ? 'idle' : state === 'fixing' ? 'fixing' : state === 'complete' || state === 'partial-failed' ? 'done' : 'scanning';
  rescueMode.value = state === 'empty' ? null : 'folder';
  rescueFilePath.value = null;
  rescueFolderPath.value = state === 'empty' ? null : 'C:/visual/docs';
  rescueMdFiles.value = state === 'empty' ? [] : ['launch-notes.md', 'api-reference.md', 'weekly-report.md'];
  rescueFileContent.value = null;
  rescueImageLinks.value = links;
  rescueIsAnalyzing.value = state === 'scanning';
  rescueIsCollecting.value = false;
  rescueCollectProgress.value = state === 'scanning'
    ? { scannedFiles: 18, processedFiles: 10, foundLinks: 24, currentFile: 'api-reference.md' }
    : null;
  rescueIsReplacing.value = state === 'fixing';
  rescueExcludedUrls.value = new Set();
  rescueIncludeSubfolders.value = true;
  rescueIncludeCodeBlocks.value = state !== 'empty';
  rescueFixingProgress.value = state === 'fixing' ? { current: 2, total: 5 } : { current: 0, total: 0 };
  rescueRepairReceipt.value = state === 'complete' || state === 'partial-failed'
    ? {
        filesFixed: state === 'complete' ? 3 : 2,
        linksFixed: state === 'complete' ? 5 : 3,
        unrescuableCount: state === 'partial-failed' ? 2 : 0,
        backupPath: 'C:/visual/docs/.picnexus-backup/2026-04-28',
        fileBackupMap: [
          { original: 'C:/visual/docs/launch-notes.md', backup: 'C:/visual/docs/.picnexus-backup/launch-notes.md' },
          { original: 'C:/visual/docs/api-reference.md', backup: 'C:/visual/docs/.picnexus-backup/api-reference.md' },
        ],
      }
    : null;
  rescueHealedFiles.value = healed;
  rescueHostPreference.value = ['r2', 'github'];
  rescueScanStage.value = state === 'scanning' ? 'checking' : 'complete';
  rescueReadyFiles.value = ready;
  rescueScanProgress.value = state === 'scanning' ? { checked: 11, total: 24 } : links.length > 0 ? { checked: links.length, total: links.length } : null;
  rescueIsCancelled.value = false;
  rescueSkippedDirs.value = state === 'partial-failed' ? ['C:/visual/docs/private'] : [];
  setCheckStartTime(Date.now() - 8000);
  setCollectCancelled(false);
  setUrlIndex(null);
}
