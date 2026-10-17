// 清单行「⋯」与状态栏「⋯」里会动记录的几件事（HealthScreen.dc.html L05 / L06）：
// 重新上传原图…（通知带撤销）、移除失效链接…（执行前再确认，提醒文档中可能仍有引用）、
// 清理找不回的图片…（只认「图片已不存在」，确认后移除，通知带撤销）、在图库中查看、在浏览器打开、导出结果。

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'vue-router';
import type { HistoryItem } from '@/config/types';
import { MultiServiceUploader } from '@/core/MultiServiceUploader';
import { useHistoryManager } from '@/composables/history/useHistory';
import { exportCsv } from '@/composables/link-check/linkCheckPersistence';
import { applyConfiguredUrlWithConfig } from '@/composables/useCopyLink';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { useUploadController } from '@/composables/upload/useUploadController';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import { openUserExternalUrl } from '@/security/shellOpen';
import { historyDB } from '@/services/database';
import { requestLocate } from '@/shell/galleryLocate';
import { recomputeLinkCheckSummary } from '@/types/linkCheckSummary';
import { joinCjk as cat } from '@/utils/cjkSpacing';
import { formatCount } from '@/utils/formatters';
import { createLogger } from '@/utils/logger';
import { describeUploadFailure } from '@/utils/uploadFailureMessage';
import { exportTextFile } from '@/utils/userFiles';
import { planImageRewrite, type DocIndex } from './docIndex';
import { restoreDocs, writeDocs } from './docFiles';
import { isDead, type HealthImage } from './healthModel';
import { useDocFolders } from './useDocFolders';
import { useLinkHealth } from './useLinkHealth';

const log = createLogger('HealthRowActions');

const IMAGE_FILTERS = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'tif', 'tiff'] }];

export function useHealthRowActions(index: () => DocIndex) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const router = useRouter();
  const health = useLinkHealth();
  const docFolders = useDocFolders();
  const historyManager = useHistoryManager();
  const upload = useUploadController();

  const find = (id: string) => health.images.value.find((i) => i.id === id);

  /** 记录变了：检测行重读（「仅 1 份」、失效清单都跟着变） */
  async function refresh(ids: string[]): Promise<void> {
    await emitHistoryUpdated(ids).catch((error) => log.warn('history-updated 事件发送失败', error));
    await health.ensureLoaded({ force: true });
  }

  /**
   * 重新上传原图…：选一张本地图片，传到这张图原来所在、现在仍可用的图床（都不可用时传到「上传到」勾选的图床），
   * 新链接替换失效的那几份并设为复制时使用，文档里的旧链接一并换掉。通知带撤销（记录与文档都还原）。
   */
  async function reupload(id: string): Promise<void> {
    const image = find(id);
    if (!image) return;
    const picked = await openDialog({ multiple: false, filters: IMAGE_FILTERS });
    const path = typeof picked === 'string' ? picked : null;
    if (!path) return;

    const usable = upload.hosts.value.filter((h) => !h.warning);
    const deadHosts = new Set(image.copies.filter((c) => isDead(c.status)).map((c) => c.host));
    let targets = usable.filter((h) => deadHosts.has(h.id)).map((h) => h.id);
    if (targets.length === 0) targets = usable.filter((h) => h.selected).map((h) => h.id);
    if (targets.length === 0) {
      toast.error('没有可用的图床', '请先在图床页启用一个图床');
      return;
    }

    const before = await historyDB.getById(id);
    if (!before) return;
    const config = upload.config.value;
    const uploader = new MultiServiceUploader();
    const settled = await Promise.allSettled(targets.map(async (host) => ({ host, result: await uploader.retryUpload(path, host, config) })));
    const done = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    if (done.length === 0) {
      const reason = settled[0].status === 'rejected' ? String(settled[0].reason) : '';
      const { reason: why, advice } = describeUploadFailure(targets[0], reason);
      toast.error(cat('未能重新上传', image.name), `${why}，${advice}`);
      return;
    }

    const replaced = new Set(done.map((d) => d.host));
    const results: HistoryItem['results'] = [
      ...before.results.filter((r) => !replaced.has(r.serviceId)),
      ...done.map(({ host, result }) => ({ serviceId: host, result, status: 'success' as const })),
    ];
    const linkCheckStatus = before.linkCheckStatus ? { ...before.linkCheckStatus } : undefined;
    if (linkCheckStatus) for (const host of replaced) delete linkCheckStatus[host];
    const primary = done.find((d) => d.host === before.primaryService) ?? done[0];
    await historyDB.update(id, {
      results,
      linkCheckStatus,
      linkCheckSummary: recomputeLinkCheckSummary(results, linkCheckStatus, before.linkCheckSummary),
      primaryService: primary.host,
      generatedLink: primary.result.url,
    });

    const newUrl = applyConfiguredUrlWithConfig(primary.result.url, primary.host, config);
    const outcome = await writeDocs(planImageRewrite(index(), id, deadHosts, newUrl));
    await refresh([id]);
    if (outcome.written.length) void docFolders.scan();

    const places = outcome.written.reduce((n, w) => n + w.places, 0);
    const desc = outcome.written.length
      ? `已更新 ${formatCount(outcome.written.length)} 个文档中的 ${formatCount(places)} 处旧链接`
      : cat('复制的链接将来自', health.hostName(primary.host));
    toast.withAction('success', cat('已重新上传', image.name), desc, {
      label: '撤销',
      run: () => {
        void (async () => {
          await restoreDocs(outcome.written);
          await historyDB.update(id, {
            results: before.results,
            linkCheckStatus: before.linkCheckStatus,
            linkCheckSummary: before.linkCheckSummary,
            primaryService: before.primaryService,
            generatedLink: before.generatedLink,
          });
          await refresh([id]);
          if (outcome.written.length) void docFolders.scan();
        })();
      },
    }, { countdown: true });
    if (outcome.failed.length) toast.error(`${formatCount(outcome.failed.length)} 个文档未能更新`, outcome.failed[0].message);
  }

  /** 移除失效链接…：只移除失效的那几份；文档里还引用着就在确认框里说清，删了文档修复就换不了 */
  async function removeDead(id: string, docs: number | null): Promise<void> {
    const image = find(id);
    if (!image) return;
    const dead = image.copies.filter((c) => isDead(c.status));
    if (dead.length === 0) return;
    const whole = dead.length === image.copies.length;
    const docsLine = docs ? `它在 ${formatCount(docs)} 个文档中仍有引用，移除后「文档修复」无法替换这些旧链接。` : '';
    if (whole) {
      // 每一份都失效：整条记录移除，与「清理找不回的图片」、图库「移除记录」一样可以撤销（原样放回）
      const ok = await confirm(`「${image.name}」的每一份链接都已失效，移除后这条记录一并删除。${docsLine}图床上的文件不受影响，可在通知里撤销。`, {
        header: '移除失效链接？',
        acceptLabel: '移除',
        acceptClass: 'p-button-danger',
      });
      if (!ok) return;
      const removed = await historyManager.removeRecords([id]);
      if (removed.length === 0) return;
      await health.ensureLoaded({ force: true });
      toast.withAction('success', '已移除记录', image.name, {
        label: '撤销',
        run: () => { void historyManager.restoreRecords(removed).then(() => health.ensureLoaded({ force: true })); },
      }, { countdown: true });
      return;
    }
    const lines = [`将移除「${image.name}」失效的 ${dead.length} 个链接。`, docsLine, '图床上的文件不受影响，移除后无法撤销。'];
    const report = await historyManager.bulkDeleteHistoryResults(
      dead.map((c) => ({ historyId: id, serviceId: c.host })),
      { header: '移除失效链接？', message: lines.filter(Boolean).join(''), acceptLabel: '移除' },
    );
    if (report) await health.ensureLoaded({ force: true });
  }

  /** 清理找不回的图片…：只含每一份都是「图片已不存在」的图；确认后移除记录，通知带撤销（原样放回） */
  async function cleanLost(images: readonly HealthImage[]): Promise<void> {
    const ids = images.filter((i) => i.lostForGood).map((i) => i.id);
    if (ids.length === 0) return;
    const n = formatCount(ids.length);
    const ok = await confirm(`这 ${n} 张图片在每个图床上都已不存在。将从记录中移除，图床不受影响；可在通知里撤销。`, {
      header: `清理 ${n} 张找不回的图片？`,
      acceptLabel: `清理 ${n} 张`,
      acceptClass: 'p-button-danger',
    });
    if (!ok) return;
    const removed = await historyManager.removeRecords(ids);
    if (removed.length === 0) return;
    await health.ensureLoaded({ force: true });
    toast.withAction('success', `已清理 ${formatCount(removed.length)} 张图片`, '图床上的图片不受影响', {
      label: '撤销',
      run: () => { void historyManager.restoreRecords(removed).then(() => health.ensureLoaded({ force: true })); },
    }, { countdown: true });
  }

  function locate(id: string): void {
    const image = find(id);
    if (!image) return;
    requestLocate(id, image.uploadedAt);
    void router.push('/gallery');
  }

  async function openInBrowser(id: string): Promise<void> {
    const url = find(id)?.copies[0]?.row.url;
    if (!url) return;
    try {
      await openUserExternalUrl(url);
    } catch (error) {
      log.warn('打开链接失败', error);
      toast.error('无法打开链接', '链接格式不受支持');
    }
  }

  async function openDoc(path: string): Promise<void> {
    try {
      await invoke('open_path', { path });
    } catch (error) {
      log.warn('打开文档失败', error);
      toast.error('无法打开文档', '文件可能已被移动或删除');
    }
  }

  async function exportResults(): Promise<void> {
    const rows = health.linkCheck.checkRows.value;
    if (rows.length === 0) return;
    const path = await exportTextFile(`link-check-${Date.now()}.csv`, [{ name: 'CSV', extensions: ['csv'] }], exportCsv(rows));
    if (path) toast.success('已导出检测结果', path);
  }

  return { reupload, removeDead, cleanLost, locate, openInBrowser, openDoc, exportResults };
}
