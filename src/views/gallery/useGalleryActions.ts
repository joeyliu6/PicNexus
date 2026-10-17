// 图库里几处共用的操作（格子、详情、多选操作条、灯箱、列表）：复制、改用备份、补充备份、重新检测、移除记录、收藏。
// 通知照 Patterns.dc.html 与交接说明：批量操作才报数量；能撤销的不弹确认、通知带「撤销」（第 4 节）；
// 界面本身已经画出结果的不再弹通知（单张补充备份成功后详情里就多了一行）。

import { ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { MultiServiceUploader } from '@/core/MultiServiceUploader';
import { UPLOAD_CONCURRENCY } from '@/core/uploadConcurrency';
import { useHistoryManager } from '@/composables/history/useHistory';
import { useLinkCheckManager } from '@/composables/link-check/useLinkCheck';
import { migrateOneItem } from '@/composables/batch-migrate/migrateCore';
import { notifyMigrationPersisted } from '@/composables/batch-migrate/historyRefresh';
import { getDefaultMigrateSource } from '@/composables/batch-migrate/sourceSelection';
import { useConfigManager } from '@/composables/useConfig';
import { useCopyLink, type CopyLinkItem } from '@/composables/useCopyLink';
import { useToast } from '@/composables/useToast';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import type { MigrateItemStatus, MigrateStats } from '@/types/batchMigrate';
import { formatCount } from '@/utils/formatters';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import { createLogger } from '@/utils/logger';
import { describeUploadFailure } from '@/utils/uploadFailureMessage';
import { linkHealth } from './detailHosts';

const log = createLogger('GalleryActions');

export interface BackupOutcome {
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
}

export function useGalleryActions() {
  const toast = useToast();
  const { copyLinks } = useCopyLink();
  const historyManager = useHistoryManager();
  const { loadConfig } = useConfigManager();
  const linkCheck = useLinkCheckManager();

  const hostName = async (hostId: string) => getServiceDisplayName(hostId, await loadConfig());

  /**
   * 选中这些图「复制时使用」的链接（按选中顺序）；hostId 给定时改取这个图床上的那一份。
   * 确认失效的那份不复制（CopyMulti：失效的置灰、不能点），算进「没有可用链接」。
   */
  async function linksOf(ids: readonly string[], hostId?: string): Promise<CopyLinkItem[]> {
    const details = await historyManager.detailCache.getDetails([...ids]);
    return details.flatMap((detail) => {
      if (!detail) return [];
      const serviceId = hostId ?? detail.primaryService;
      const url = detail.results.find((r) => r.serviceId === serviceId && r.status === 'success')?.result?.url
        ?? (hostId ? undefined : detail.generatedLink);
      if (!url || linkHealth(detail.linkCheckStatus, serviceId) === 'dead') return [];
      return [{ url, fileName: detail.localFileName, serviceId }];
    });
  }

  /** 批量复制：「已复制 12 张」；有跳过写「已复制 10 张（2 张没有可用链接）」（交接说明 8.2） */
  async function copyMany(ids: readonly string[], format: LinkFormat, hostId?: string): Promise<void> {
    if (ids.length === 0) return;
    const items = await linksOf(ids, hostId);
    if (items.length === 0) {
      toast.warn('没有可复制的链接', hostId ? `选中的图片都不在${await hostName(hostId)}上` : '选中的图片都没有可用链接');
      return;
    }
    const result = await copyLinks(items, { format, showSuccessToast: false });
    if (!result.ok) return;
    const skipped = ids.length - items.length;
    const title = skipped ? `已复制 ${formatCount(items.length)} 张（${formatCount(skipped)} 张没有可用链接）` : `已复制 ${formatCount(items.length)} 张`;
    toast.success(title, `${FORMAT_NAMES[format]} 格式，每行一个`);
  }

  /** 「改用」之后的通知：立即生效、不弹确认，「撤销」改回去（交接说明规则 3） */
  async function announceSwitch(toHostId: string, undo: () => void): Promise<void> {
    toast.withAction('success', '已改用备份', `复制的链接将来自${await hostName(toHostId)}`, { label: '撤销', run: undo }, { countdown: true });
  }

  /**
   * 补充备份到某个图床：从现有的好链接下载，再传到目标图床（与链接健康的「补充备份」同一套）。
   * quiet = 单张、结果已经画在详情里：成功不弹通知，失败照样说原因。
   */
  async function backupTo(ids: readonly string[], hostId: string, options: { quiet?: boolean } = {}): Promise<BackupOutcome> {
    const outcome: BackupOutcome = { succeeded: [], failed: [] };
    const details = (await historyManager.detailCache.getDetails([...ids])).filter((d): d is HistoryItem => d !== null);
    const config = await loadConfig();
    const uploader = new MultiServiceUploader();
    const stats = ref<MigrateStats>({ startTime: Date.now(), elapsedMs: 0, processedCount: 0, totalCount: details.length, totalBytes: 0 });
    const never = ref(false);

    const queue = [...details];
    async function worker(): Promise<void> {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const status: MigrateItemStatus = {
          historyId: item.id,
          fileName: item.localFileName,
          status: 'pending',
          serviceResults: { [hostId]: 'pending' },
          existingServiceIds: item.results.filter((r) => r.status === 'success').map((r) => r.serviceId),
          sourceServiceId: getDefaultMigrateSource(item)?.serviceId,
        };
        try {
          await migrateOneItem(item, status, [hostId], config, uploader, never, never, stats);
        } catch (error) {
          status.status = 'failed';
          status.error = error instanceof Error ? error.message : String(error);
        }
        if (status.status === 'success') outcome.succeeded.push(item.id);
        else if (status.status === 'failed') outcome.failed.push({ id: item.id, reason: status.error ?? '' });
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker));
    // 按批广播一次：时间轴收到一次就整体重查（见 historyRefresh.ts）
    await notifyMigrationPersisted(outcome.succeeded);

    const name = await hostName(hostId);
    if (outcome.failed.length) {
      const { reason, advice } = describeUploadFailure(hostId, outcome.failed[0].reason);
      const title = ids.length === 1 ? `补充备份到${name}失败` : `${formatCount(outcome.failed.length)} 张未能备份到${name}`;
      toast.error(title, `${reason}，${advice}`);
    } else if (!options.quiet && outcome.succeeded.length) {
      toast.success(`已补充备份 ${formatCount(outcome.succeeded.length)} 张`, `备份到${name}`);
    }
    log.info(`补充备份到 ${hostId}：成功 ${outcome.succeeded.length}，失败 ${outcome.failed.length}`);
    return outcome;
  }

  /**
   * 重新检测这些图在各图床上的链接（与链接健康同一个检测器，结果写回记录）。
   * 检测器只写库不广播：这里点名广播一次，格子角标与详情才会换成新结论。
   * 查出失效是需要留意的状态：琥珀；全部正常才是成功。
   */
  async function recheck(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await linkCheck.loadHistoryRows();
    const result = await linkCheck.checkSubset({ historyIds: [...ids] });
    if (!result) return;
    await emitHistoryUpdated([...ids]).catch((error) => log.warn('history-updated 事件发送失败', error));
    const title = `已重新检测 ${formatCount(ids.length)} 张`;
    if (result.invalid) toast.warn(title, `${formatCount(result.invalid)} 条链接失效`);
    else toast.success(title, '均正常');
  }

  /** 移除记录：不弹确认，通知带「撤销」，撤销时原样放回（图床上的图片不动） */
  async function removeRecords(ids: readonly string[], fileName?: string): Promise<boolean> {
    const removed = await historyManager.removeRecords([...ids]);
    if (removed.length === 0) return false;
    const title = removed.length === 1 ? '已移除记录' : `已移除 ${formatCount(removed.length)} 条记录`;
    const desc = removed.length === 1 ? (fileName ?? removed[0].localFileName) : '图床上的图片不受影响';
    toast.withAction('success', title, desc, { label: '撤销', run: () => { void historyManager.restoreRecords(removed); } }, { countdown: true });
    return true;
  }

  /** 收藏 / 取消收藏这些图 */
  async function setFavorite(ids: readonly string[], favorited: boolean): Promise<void> {
    await historyManager.batchSetFavorite([...ids], favorited);
  }

  return { copyMany, announceSwitch, backupTo, recheck, removeRecords, setFavorite };
}
