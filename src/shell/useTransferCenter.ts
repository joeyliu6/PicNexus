// 传输中心（HomeScreen.dc.html H14，交接说明 8.1）：标题栏传输图标打开；上传 / 补充备份 / 链接检测分组，
// 没有的组不出现；盖在内容上方不挤压布局。完成的任务保留到手动清除或退出应用。

import { computed, reactive, ref, watch } from 'vue';
import { useLinkCheckManager } from '@/composables/link-check/useLinkCheck';
import { useUploadController } from '@/composables/upload/useUploadController';
import { hostViews, itemPhase, sessionCounts } from '@/composables/upload/uploadSessions';
import { useSupplementBackup } from '@/views/health/useSupplementBackup';

const open = ref(false);
/** 在传输中心里手动「清除」过的已完成上传（不影响首页的「最近上传」） */
const clearedSessionIds = reactive(new Set<string>());
/** 结束了的链接检测（「链接检测 · N 个链接」）；清除后不再显示 */
const finishedChecks = reactive<Array<{ id: number; links: number }>>([]);
let checkSeq = 0;
let watchingChecks = false;

export function useTransferCenter() {
  const upload = useUploadController();
  const linkCheck = useLinkCheckManager();
  const backup = useSupplementBackup();

  // 检测结束（含取消）记一条「已完成」：本轮覆盖的链接数
  if (!watchingChecks) {
    watchingChecks = true;
    let runLinks = 0;
    watch(linkCheck.activeRun, (run, previous) => {
      if (run) runLinks = run.keys.size;
      else if (previous && runLinks > 0) finishedChecks.push({ id: ++checkSeq, links: runLinks });
    });
  }

  const backupActive = computed(() => backup.state.phase === 'running' || backup.state.phase === 'paused');
  const checkActive = computed(() => linkCheck.isChecking.value && linkCheck.activeRun.value !== null);

  const uploadRows = computed(() => upload.sessions.map((session) => {
    const items = upload.itemsOf(session);
    const counts = sessionCounts(items);
    const active = !session.finished || counts.uploading + counts.waiting > 0;
    return { session, items, counts, active };
  }).filter((row) => row.items.length > 0));

  const activeUploads = computed(() => uploadRows.value.filter((row) => row.active));
  const finishedUploads = computed(() => uploadRows.value.filter((row) => !row.active && !clearedSessionIds.has(row.session.id)));

  /** 标题栏图标上的数字：还在传的图片张数，补充备份、链接检测各算一项 */
  const activeCount = computed(() => activeUploads.value.reduce((sum, row) => sum + row.counts.uploading + row.counts.waiting, 0)
    + (backupActive.value ? 1 : 0) + (checkActive.value ? 1 : 0));

  /** 标题栏图标的进度环：进行中的各项任务完成了多少的平均（上传每张按各图床进度平均） */
  const progress = computed(() => {
    const parts: number[] = [];
    const items = activeUploads.value.flatMap((row) => row.items);
    if (items.length) {
      const sum = items.reduce((acc, item) => {
        if (itemPhase(item) !== 'uploading') return acc + 1;
        const hosts = hostViews(item);
        return acc + hosts.reduce((h, host) => h + (host.state === 'done' ? 1 : host.progress / 100), 0) / Math.max(hosts.length, 1);
      }, 0);
      parts.push(sum / items.length);
    }
    if (backupActive.value && backup.state.total) parts.push(backup.state.processed / backup.state.total);
    const p = linkCheck.progress.value;
    if (checkActive.value) parts.push(p?.total ? p.checked / p.total : 0);
    return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  });

  const backupFinished = computed(() => backup.state.phase === 'done');

  return {
    open,
    toggle: () => { open.value = !open.value; },
    close: () => { open.value = false; },
    activeUploads,
    finishedUploads,
    activeCount,
    progress,
    backupActive,
    checkActive,
    backupFinished,
    finishedChecks,
    hasFinished: computed(() => finishedUploads.value.length > 0 || backupFinished.value || finishedChecks.length > 0),
    hasAnything: computed(() => activeUploads.value.length > 0 || finishedUploads.value.length > 0
      || backupActive.value || checkActive.value || backupFinished.value || finishedChecks.length > 0),
    clearFinished: () => {
      finishedUploads.value.forEach((row) => clearedSessionIds.add(row.session.id));
      finishedChecks.splice(0);
      backup.clearFinished();
    },
  };
}
