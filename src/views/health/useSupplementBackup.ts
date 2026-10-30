// 补充备份（交接说明第 4 节规则 8、8.3）：范围固定为「仅有 1 份的图片」，只选目标图床；在后台进行，
// 进度显示在本页工具卡与传输中心，离开页面不影响。每张走 migrateOneItem（从能用的那份下载 → 传到目标），同时 3 张。
// 应用级单例：状态放模块级。

import { computed, reactive, ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { MultiServiceUploader } from '@/core/MultiServiceUploader';
import { migrateOneItem } from '@/composables/batch-migrate/migrateCore';
import { notifyMigrationPersisted } from '@/composables/batch-migrate/historyRefresh';
import { getBackupSourceIds } from '@/composables/batch-migrate/sourceSelection';
import { useConfigManager } from '@/composables/useConfig';
import { useToast } from '@/composables/useToast';
import { historyDB } from '@/services/database';
import type { MigrateItemStatus, MigrateStats } from '@/types/batchMigrate';
import { joinCjk as cat } from '@/utils/cjkSpacing';
import { formatCount } from '@/utils/formatters';
import { createLogger } from '@/utils/logger';
import { describeUploadFailure } from '@/utils/uploadFailureMessage';

const log = createLogger('SupplementBackup');

/** 同时备份几张 */
const CONCURRENCY = 3;
/** 开始前估计：每张约 0.9 秒（设计稿 1,206 张 ≈ 18 分钟） */
export const BACKUP_SECONDS_PER_IMAGE = 0.9;
/** 每传成功这么多张广播一次（图库等视图重查一次，不逐张刷） */
const NOTIFY_EVERY = 20;

type BackupPhase = 'idle' | 'running' | 'paused' | 'done';

const state = reactive({
  phase: 'idle' as BackupPhase,
  target: '',
  total: 0,
  /** 已处理（成功 + 失败 + 跳过） */
  processed: 0,
  succeeded: [] as string[],
  failed: [] as Array<{ id: string; reason: string }>,
  startedAt: 0,
  /** 暂停期间不计时：剩余时间按真正在跑的时长算 */
  activeMs: 0,
});

const cancelled = ref(false);
const paused = ref(false);
let resumeWaiters: Array<() => void> = [];
let runningSince = 0;

function waitWhilePaused(): Promise<void> {
  if (!paused.value) return Promise.resolve();
  return new Promise((resolve) => resumeWaiters.push(resolve));
}

export function useSupplementBackup() {
  const toast = useToast();
  const { loadConfig } = useConfigManager();

  const hostName = (id: string) => getServiceDisplayName(id, undefined);

  /** 剩余秒数（按已用速度；还没完成一张时按每张 0.9 秒） */
  const remainingSeconds = computed(() => {
    const left = state.total - state.processed;
    if (left <= 0) return 0;
    const elapsed = state.activeMs + (state.phase === 'running' ? Date.now() - runningSince : 0);
    const perImage = state.processed > 0 ? elapsed / 1000 / state.processed : BACKUP_SECONDS_PER_IMAGE;
    return left * perImage;
  });

  async function finish(): Promise<void> {
    state.activeMs += Date.now() - runningSince;
    if (cancelled.value) {
      state.phase = 'idle';
      return;
    }
    state.phase = 'done';
    if (state.failed.length) {
      const { reason, advice } = describeUploadFailure(state.target, state.failed[0].reason);
      toast.error(cat(`${formatCount(state.failed.length)} 张未能备份到`, hostName(state.target)), `${reason}，${advice}`);
    }
    log.info(`补充备份到 ${state.target}：成功 ${state.succeeded.length}，失败 ${state.failed.length}`);
  }

  /** 开始：ids 在点「开始备份」这一刻定下；目标图床上已有的自动跳过 */
  async function start(target: string, ids: readonly string[]): Promise<void> {
    if (state.phase === 'running' || state.phase === 'paused' || ids.length === 0) return;
    Object.assign(state, { phase: 'running', target, total: ids.length, processed: 0, succeeded: [], failed: [], startedAt: Date.now(), activeMs: 0 });
    cancelled.value = false;
    paused.value = false;
    runningSince = Date.now();

    const config = await loadConfig();
    const uploader = new MultiServiceUploader();
    const stats = ref<MigrateStats>({ startTime: Date.now(), elapsedMs: 0, processedCount: 0, totalCount: ids.length, totalBytes: 0 });
    const queue = [...ids];
    const unsent: string[] = [];
    const flush = () => { void notifyMigrationPersisted(unsent.splice(0)); };

    async function worker(): Promise<void> {
      for (;;) {
        await waitWhilePaused();
        if (cancelled.value) return;
        const id = queue.shift();
        if (!id) return;
        const item: HistoryItem | null = await historyDB.getById(id).catch(() => null);
        if (!item) {
          state.processed++;
          continue;
        }
        const status: MigrateItemStatus = {
          historyId: item.id,
          fileName: item.localFileName,
          status: 'pending',
          serviceResults: { [target]: 'pending' },
          existingServiceIds: item.results.filter((r) => r.status === 'success').map((r) => r.serviceId),
          preferredSourceServiceIds: getBackupSourceIds(item),
        };
        try {
          await migrateOneItem(item, status, [target], config, uploader, cancelled, paused, stats);
        } catch (error) {
          status.status = 'failed';
          status.error = error instanceof Error ? error.message : String(error);
        }
        // 暂停时正在下载的那张退回 pending：放回队首，继续时重来
        if (status.status === 'pending') {
          queue.unshift(id);
          continue;
        }
        state.processed++;
        if (status.status === 'success') {
          state.succeeded.push(id);
          unsent.push(id);
          if (unsent.length >= NOTIFY_EVERY) flush();
        } else if (status.status === 'failed') {
          state.failed.push({ id, reason: status.error ?? '' });
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    } finally {
      // 最后一批先广播完再收尾：页面收尾时按新记录重读「仅 1 份」
      await notifyMigrationPersisted(unsent.splice(0));
      await finish();
    }
  }

  function pause(): void {
    if (state.phase !== 'running') return;
    paused.value = true;
    state.phase = 'paused';
    state.activeMs += Date.now() - runningSince;
  }

  function resume(): void {
    if (state.phase !== 'paused') return;
    paused.value = false;
    state.phase = 'running';
    runningSince = Date.now();
    resumeWaiters.splice(0).forEach((resolve) => resolve());
  }

  /** 停止（传输中心）：没开始的不再做，已备份的留着 */
  function stop(): void {
    if (state.phase !== 'running' && state.phase !== 'paused') return;
    cancelled.value = true;
    if (paused.value) {
      paused.value = false;
      runningSince = Date.now();
      resumeWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  /** 卡片「重试」：只重传失败的 */
  function retryFailed(): Promise<void> {
    const ids = state.failed.map((f) => f.id);
    const target = state.target;
    state.phase = 'idle';
    return start(target, ids);
  }

  /** 已完成的这一条在传输中心「清除」后，卡片回到平常的样子 */
  function clearFinished(): void {
    if (state.phase === 'done') state.phase = 'idle';
  }

  return { state, remainingSeconds, start, pause, resume, stop, retryFailed, clearFinished };
}

/** 测试用 */
export function __resetSupplementBackupForTests(): void {
  Object.assign(state, { phase: 'idle', target: '', total: 0, processed: 0, succeeded: [], failed: [], startedAt: 0, activeMs: 0 });
  cancelled.value = false;
  paused.value = false;
  resumeWaiters = [];
}
