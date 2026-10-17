// 链接健康的页面状态（单例，交接说明 8.3）：接检测引擎（useLinkCheck）的数据与检测 / 暂停 / 继续 / 取消，
// 推出健康模型、页面处在哪种状态、检测进度那句话；单行「重试」。修复与撤销在 useHealthRepair。

import { computed, reactive, type ComputedRef } from 'vue';
import { refThrottled } from '@vueuse/core';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { useConfigManager } from '@/composables/useConfig';
import { useLinkCheckManager } from '@/composables/link-check/useLinkCheck';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import { createLogger } from '@/utils/logger';
import { buildHealthImages, deadImages, isDead, summarize, type HealthImage, type HealthSummary } from './healthModel';

const log = createLogger('LinkHealth');

/** 状态栏的几种状态（HealthScreen.dc.html） */
export type HealthPageState = 'loading' | 'never' | 'checking' | 'paused' | 'fixing' | 'problems' | 'good';

/** 检测中模型最多每 300ms 重算一次：几万条结果边查边进来，逐条重算会拖慢界面 */
const CHECKING_REBUILD_MS = 300;
/** 单行重试结果没变：按钮位置停 2 秒「仍然失效」 */
const STILL_DEAD_MS = 2000;

/** 修复进行中由 useHealthRepair 写入；放在这里是为了页面状态能一处推出来 */
export const repairState = reactive({
  running: false,
  total: 0,
  done: 0,
  /** 同时更新几个文档中的旧链接 */
  docCount: 0,
  /** 每张图：等待中 / 正在修复… / 已改用 X */
  rows: new Map<string, { phase: 'waiting' | 'fixing' | 'done' | 'failed'; to: string }>(),
  /** 本次会话修好了几张（L11「15 张已修复」） */
  fixedThisSession: 0,
});

const retrying = reactive(new Set<string>());
const stillDead = reactive(new Set<string>());

export interface CheckProgressView {
  checked: number;
  total: number;
  /** 本轮还没查完的链接里最多的那个图床 */
  waitingHost: string | null;
}

let singleton: ReturnType<typeof create> | null = null;

function create() {
  const linkCheck = useLinkCheckManager();
  const { config, loadConfig } = useConfigManager();

  const hostName = (id: string) => getServiceDisplayName(id, config.value);
  /** 按钮里放得下的名字：「改用 R2」（96px 一列放不下「Cloudflare R2」） */
  const shortHostName = (id: string) => {
    const full = hostName(id);
    return full.length > 8 && full.includes(' ') ? full.split(' ').pop()! : full;
  };

  const rows = refThrottled(linkCheck.checkRows, CHECKING_REBUILD_MS, true, true);
  const running = computed(() => linkCheck.isChecking.value && linkCheck.progressSource.value === 'monitor');
  const images: ComputedRef<HealthImage[]> = computed(() =>
    buildHealthImages(rows.value, running.value ? linkCheck.activeRun.value ?? undefined : undefined));
  const summary: ComputedRef<HealthSummary> = computed(() => summarize(images.value));
  const dead = computed(() => deadImages(images.value));

  const state = computed<HealthPageState>(() => {
    if (running.value) return linkCheck.isPaused.value ? 'paused' : 'checking';
    if (repairState.running) return 'fixing';
    if (!linkCheck.loaded.value) return 'loading';
    if (!summary.value.everChecked) return 'never';
    return summary.value.dead > 0 ? 'problems' : 'good';
  });

  const progress = computed<CheckProgressView>(() => {
    const p = linkCheck.progress.value;
    const run = linkCheck.activeRun.value;
    let waitingHost: string | null = null;
    if (run) {
      const left = new Map<string, number>();
      for (const row of rows.value) {
        if (!run.keys.has(`${row.historyId}::${row.serviceId}`) || (row.checkedAt ?? 0) >= run.startedAt) continue;
        left.set(row.serviceId, (left.get(row.serviceId) ?? 0) + 1);
      }
      let most = 0;
      for (const [host, n] of left) if (n > most) { most = n; waitingHost = host; }
    }
    return { checked: p?.checked ?? 0, total: p?.total ?? run?.keys.size ?? 0, waitingHost };
  });

  async function ensureLoaded(): Promise<void> {
    await loadConfig();
    linkCheck.onViewActivated();
    await linkCheck.loadHistoryRows();
  }

  /** 「开始检测 / 重新检测」：全部；「仅重新检测 N 张失效图片」：只查这几张 */
  async function check(only?: 'dead'): Promise<void> {
    if (only === 'dead') {
      const ids = dead.value.map((image) => image.id);
      if (ids.length) await linkCheck.checkSubset({ historyIds: ids });
      return;
    }
    await linkCheck.checkAllHistoryLinks();
  }

  /**
   * 单行「重试」/「重新检测这张」：这张图的每一份各查一次（不占全局「检测中」）。
   * 复制时使用的那份结果没变化：按钮位置停 2 秒「仍然失效」，不弹通知（L09）。
   */
  async function retry(id: string): Promise<void> {
    const image = images.value.find((i) => i.id === id);
    if (!image || retrying.has(id)) return;
    const before = image.copies[0]?.status;
    retrying.add(id);
    try {
      await Promise.all(image.copies.map((copy) => linkCheck.recheckSingle(copy.row)));
      await emitHistoryUpdated([id]).catch((error) => log.warn('history-updated 事件发送失败', error));
    } finally {
      retrying.delete(id);
    }
    const after = linkCheck.checkRows.value.find((r) => r.historyId === id && r.serviceId === image.copyHost)?.checkResult;
    const now = images.value.find((i) => i.id === id);
    if (now && before && isDead(before) && now.copies[0]?.status === before && after) {
      stillDead.add(id);
      setTimeout(() => stillDead.delete(id), STILL_DEAD_MS);
    }
  }

  return {
    linkCheck,
    config,
    hostName,
    shortHostName,
    images,
    summary,
    dead,
    state,
    progress,
    retrying,
    stillDead,
    ensureLoaded,
    check,
    retry,
    pause: () => linkCheck.pauseCheck(),
    resume: () => linkCheck.resumeCheck(),
    cancel: () => linkCheck.cancelCheck(),
  };
}

export function useLinkHealth() {
  singleton ??= create();
  return singleton;
}

/** 测试用：丢掉单例 */
export function __resetLinkHealthForTests(): void {
  singleton = null;
  retrying.clear();
  stillDead.clear();
  repairState.running = false;
  repairState.rows.clear();
  repairState.fixedThisSession = 0;
}
