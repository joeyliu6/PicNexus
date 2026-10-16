// 传输中心（HomeScreen.dc.html H14，交接说明 8.1）：标题栏传输图标打开；上传 / 补充备份 / 链接检测分组，
// 没有的组不出现；盖在内容上方不挤压布局。完成的任务保留到手动清除或退出应用。
// 补充备份与链接检测两组在链接健康页按新设计重写、它们的进度成为应用级状态后接上。

import { computed, reactive, ref } from 'vue';
import { useUploadController } from '@/composables/upload/useUploadController';
import { hostViews, itemPhase, sessionCounts } from '@/composables/upload/uploadSessions';

const open = ref(false);
/** 在传输中心里手动「清除」过的已完成上传（不影响首页的「最近上传」） */
const clearedSessionIds = reactive(new Set<string>());

export function useTransferCenter() {
  const upload = useUploadController();

  const uploadRows = computed(() => upload.sessions.map((session) => {
    const items = upload.itemsOf(session);
    const counts = sessionCounts(items);
    const active = !session.finished || counts.uploading + counts.waiting > 0;
    return { session, items, counts, active };
  }).filter((row) => row.items.length > 0));

  const activeUploads = computed(() => uploadRows.value.filter((row) => row.active));
  const finishedUploads = computed(() => uploadRows.value.filter((row) => !row.active && !clearedSessionIds.has(row.session.id)));

  /** 标题栏图标上的数字：还在传的图片张数 */
  const activeCount = computed(() => activeUploads.value.reduce((sum, row) => sum + row.counts.uploading + row.counts.waiting, 0));

  /** 标题栏图标的进度环：进行中的上传整体完成了多少（每张按各图床进度平均） */
  const progress = computed(() => {
    const items = activeUploads.value.flatMap((row) => row.items);
    if (items.length === 0) return 0;
    const sum = items.reduce((acc, item) => {
      if (itemPhase(item) !== 'uploading') return acc + 1;
      const hosts = hostViews(item);
      return acc + hosts.reduce((h, host) => h + (host.state === 'done' ? 1 : host.progress / 100), 0) / Math.max(hosts.length, 1);
    }, 0);
    return sum / items.length;
  });

  return {
    open,
    toggle: () => { open.value = !open.value; },
    close: () => { open.value = false; },
    activeUploads,
    finishedUploads,
    activeCount,
    progress,
    hasAnything: computed(() => activeUploads.value.length > 0 || finishedUploads.value.length > 0),
    clearFinished: () => { finishedUploads.value.forEach((row) => clearedSessionIds.add(row.session.id)); },
  };
}
