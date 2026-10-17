// 修复（交接说明第 4 节规则 8、8.3「修复的语义」）：把「复制时使用」切到可访问的备份，并替换文档文件夹里的旧链接。
// 「修复 N 张」、行内「改用 X」、文档弹窗「修复 N 处」走同一条路：不弹确认，通知带「撤销」；
// 写不成的文档另起一条红色通知，「重试」只重写没写成的那几个。

import { computed } from 'vue';
import { historyDB } from '@/services/database';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import { useToast } from '@/composables/useToast';
import { joinCjk as cat } from '@/utils/cjkSpacing';
import { formatCount } from '@/utils/formatters';
import { createLogger } from '@/utils/logger';
import { stripKnownPrefixes } from '@/utils/mdParser';
import { buildDocIndex, planDocWrites, type DocIndex } from './docIndex';
import { restoreDocs, writeDocs, type FailedDoc, type WrittenDoc } from './docFiles';
import { useDocFolders } from './useDocFolders';
import { repairState, useLinkHealth } from './useLinkHealth';

const log = createLogger('HealthRepair');

/** 「文档中的旧链接未更新 · 添加文档文件夹…」只提示一次（本机） */
const DOC_FOLDER_HINT_KEY = 'picnexus-hint-doc-folders';

/** 一次修复：撤销要还原的两样东西 */
interface RepairRecord {
  switched: Array<{ id: string; from: string; to: string }>;
  written: WrittenDoc[];
}

export type RepairKind = 'all' | 'row' | 'docs';

function hintShown(): boolean {
  try { return localStorage.getItem(DOC_FOLDER_HINT_KEY) === '1'; } catch { return false; }
}
function markHintShown(): void {
  try { localStorage.setItem(DOC_FOLDER_HINT_KEY, '1'); } catch { /* 隐私模式等：下次再提示一次也无妨 */ }
}

export function useHealthRepair() {
  const toast = useToast();
  const health = useLinkHealth();
  const docFolders = useDocFolders();

  const index = computed<DocIndex>(() =>
    buildDocIndex(docFolders.scannedFolders.value, health.images.value, (url) => stripKnownPrefixes(url, health.config.value)));

  const urlOf = (imageId: string, host: string) =>
    health.images.value.find((i) => i.id === imageId)?.copies.find((c) => c.host === host)?.row.url;

  function syncRows(changes: Array<{ id: string; host: string }>): void {
    if (changes.length === 0) return;
    health.linkCheck.setPrimaryServices(new Map(changes.map((c) => [c.id, c.host])));
    void emitHistoryUpdated(changes.map((c) => c.id)).catch((error) => log.warn('history-updated 事件发送失败', error));
  }

  function reportDocFailures(record: RepairRecord, failed: FailedDoc[]): void {
    if (failed.length === 0) return;
    const desc = failed.length === 1 ? failed[0].message : `${failed[0].message}（另有 ${failed.length - 1} 个）`;
    toast.withAction('error', `${formatCount(failed.length)} 个文档未能更新`, desc, {
      label: '重试',
      run: () => { void rewrite(record, failed); },
    });
  }

  /** 「重试」：只重写上次没写成的文档；写成的并进同一次修复，撤销时一起还原 */
  async function rewrite(record: RepairRecord, failed: FailedDoc[]): Promise<void> {
    const outcome = await writeDocs(failed.map((f) => f.write));
    record.written.push(...outcome.written);
    if (outcome.written.length) {
      const places = outcome.written.reduce((n, w) => n + w.places, 0);
      toast.success(`已更新 ${formatCount(outcome.written.length)} 个文档`, `共替换 ${formatCount(places)} 处旧链接`);
      void docFolders.scan();
    }
    reportDocFailures(record, outcome.failed);
  }

  async function undo(record: RepairRecord): Promise<void> {
    const restored = await restoreDocs(record.written);
    const back: Array<{ id: string; host: string }> = [];
    let switchFailed = 0;
    for (const s of record.switched) {
      try {
        await historyDB.switchPrimaryService(s.id, s.from);
        back.push({ id: s.id, host: s.from });
      } catch (error) {
        switchFailed++;
        log.warn(`撤销改用失败: ${s.id}`, error);
      }
    }
    syncRows(back);
    repairState.fixedThisSession = Math.max(0, repairState.fixedThisSession - back.length);
    if (record.written.length) void docFolders.scan();
    if (restored.modified.length) {
      const name = restored.modified[0].split(/[/\\]/).pop();
      toast.error(`${formatCount(restored.modified.length)} 个文档未还原`, `${name} 在修复后被修改过，已保留现在的内容`);
    }
    if (restored.failed.length) toast.error(`${formatCount(restored.failed.length)} 个文档未能还原`, restored.failed[0].message);
    if (switchFailed) toast.error(`${formatCount(switchFailed)} 张图片未能改回`, '请稍后在图库详情中手动改用');
  }

  function announce(kind: RepairKind, record: RepairRecord, docsConfigured: boolean): void {
    const places = record.written.reduce((n, w) => n + w.places, 0);
    const docsLine = `已更新 ${formatCount(record.written.length)} 个文档中的 ${formatCount(places)} 处旧链接`;
    let title: string;
    let desc: string;
    if (record.switched.length === 0) {
      title = `已更新 ${formatCount(record.written.length)} 个文档`;
      desc = `共替换 ${formatCount(places)} 处旧链接`;
    } else if (kind === 'row') {
      const name = health.hostName(record.switched[0].to);
      title = cat('已改用', name);
      desc = record.written.length ? docsLine : cat('复制的链接将来自', name);
    } else {
      title = `已修复 ${formatCount(record.switched.length)} 张图片`;
      desc = record.written.length ? docsLine : '复制的链接已改用备份';
    }
    toast.withAction('success', title, desc, { label: '撤销', run: () => { void undo(record); } }, { countdown: true });

    if (!docsConfigured && record.switched.length && !hintShown()) {
      markHintShown();
      toast.withAction('info', '文档中的旧链接未更新', '添加文档文件夹后，修复时一并替换', {
        label: '添加文档文件夹…',
        run: () => { void docFolders.add(); },
      });
    }
  }

  /**
   * 修复这几张图：失效且能修的切到改用的那份；文档里引用它们失效那份的地方换成新链接。
   * 同一时间只跑一个修复。
   */
  async function repair(ids: readonly string[], kind: RepairKind = 'all'): Promise<void> {
    if (repairState.running) return;
    const idSet = new Set(ids);
    const toSwitch = health.images.value.filter((i) => idSet.has(i.id) && i.state === 'fixable' && i.fixTo);
    const writes = planDocWrites(index.value, health.images.value, urlOf, idSet);
    if (toSwitch.length === 0 && writes.length === 0) return;

    repairState.running = true;
    repairState.total = toSwitch.length || writes.length;
    repairState.done = 0;
    repairState.docCount = writes.length;
    repairState.rows = new Map(toSwitch.map((i) => [i.id, { phase: 'waiting', to: i.fixTo! }]));
    const record: RepairRecord = { switched: [], written: [] };
    const failedSwitches: string[] = [];
    try {
      for (const image of toSwitch) {
        repairState.rows.set(image.id, { phase: 'fixing', to: image.fixTo! });
        try {
          await historyDB.switchPrimaryService(image.id, image.fixTo!);
          record.switched.push({ id: image.id, from: image.copyHost, to: image.fixTo! });
          repairState.rows.set(image.id, { phase: 'done', to: image.fixTo! });
        } catch (error) {
          log.warn(`改用备份失败: ${image.id}`, error);
          failedSwitches.push(error instanceof Error ? error.message : String(error));
          repairState.rows.set(image.id, { phase: 'failed', to: image.fixTo! });
        }
        repairState.done++;
      }
      syncRows(record.switched.map((s) => ({ id: s.id, host: s.to })));
      const outcome = await writeDocs(writes);
      record.written.push(...outcome.written);
      if (toSwitch.length === 0) repairState.done = repairState.total;
      repairState.fixedThisSession += record.switched.length;

      if (record.switched.length || record.written.length) announce(kind, record, (health.config.value.linkHealth?.docFolders.length ?? 0) > 0);
      reportDocFailures(record, outcome.failed);
      if (failedSwitches.length) toast.error(`${formatCount(failedSwitches.length)} 张图片未能修复`, '记录已变化，请重新检测后重试');
      if (record.written.length) void docFolders.scan();
    } finally {
      repairState.running = false;
      repairState.rows = new Map();
    }
  }

  return { index, repair };
}
