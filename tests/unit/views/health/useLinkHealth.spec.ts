// 页面状态由数据推出来：读取中 / 尚未检测 / 检测中 / 已暂停 / 修复中 / 有失效 / 全部正常；检测进度；单行重试「仍然失效」
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';
import type { BatchCheckProgress, CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';

const engine = vi.hoisted(() => ({
  state: null as null | Record<string, unknown>,
}));

vi.mock('@/composables/link-check/useLinkCheck', () => ({ useLinkCheckManager: () => engine.state }));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ config: { value: {} }, loadConfig: async () => ({}) }) }));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: vi.fn().mockResolvedValue(undefined) }));
// 重算节流不影响判断：测试里直接透传
vi.mock('@vueuse/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@vueuse/core')>()), refThrottled: <T>(r: T) => r }));

import { __resetLinkHealthForTests, repairState, useLinkHealth } from '@/views/health/useLinkHealth';

const gone: CheckLinkResult = { link: '', is_valid: false, error_type: 'http_4xx', status_code: 404, browser_might_work: false };
const ok: CheckLinkResult = { link: '', is_valid: true, error_type: 'success', browser_might_work: false };
const row = (id: string, host: string, result?: CheckLinkResult, extra: Partial<LinkCheckRow> = {}): LinkCheckRow => ({
  historyId: id, serviceId: host, url: `https://${host}.example/${id}`, rawUrl: '', fileName: id, uploadedAt: 1, isPrimary: true,
  checkResult: result, checkedAt: result ? 10 : undefined, ...extra,
});

function makeEngine(rows: LinkCheckRow[]) {
  const checkRows = shallowRef(rows);
  engine.state = {
    checkRows,
    isChecking: ref(false),
    isPaused: ref(false),
    activeRun: shallowRef<{ keys: Set<string>; startedAt: number } | null>(null),
    progress: ref<BatchCheckProgress | null>(null),
    loaded: ref(true),
    recheckSingle: vi.fn(),
  };
  return engine.state as {
    checkRows: typeof checkRows; isChecking: { value: boolean }; isPaused: { value: boolean }; progressSource: { value: string | null };
    activeRun: { value: { keys: Set<string>; startedAt: number } | null }; progress: { value: BatchCheckProgress | null };
    loaded: { value: boolean }; recheckSingle: ReturnType<typeof vi.fn>;
  };
}

describe('useLinkHealth', () => {
  beforeEach(() => __resetLinkHealthForTests());

  it('读取中 → 尚未检测 → 有失效 → 全部正常', () => {
    const e = makeEngine([row('a', 'weibo')]);
    e.loaded.value = false;
    const health = useLinkHealth();
    expect(health.state.value).toBe('loading');
    e.loaded.value = true;
    expect(health.state.value).toBe('never');
    e.checkRows.value = [row('a', 'weibo', gone)];
    expect(health.state.value).toBe('problems');
    e.checkRows.value = [row('a', 'weibo', ok)];
    expect(health.state.value).toBe('good');
  });

  it('检测中 / 已暂停 / 修复中优先', () => {
    const e = makeEngine([row('a', 'weibo', gone)]);
    const health = useLinkHealth();
    e.isChecking.value = true;

    expect(health.state.value).toBe('checking');
    e.isPaused.value = true;
    expect(health.state.value).toBe('paused');
    e.isChecking.value = false;
    repairState.running = true;
    expect(health.state.value).toBe('fixing');
  });

  it('检测进度：已查 / 本轮链接数，等待本轮还没查完最多的那个图床；只算这一轮查到的失效', () => {
    const rows = [
      row('a', 'weibo', gone, { checkedAt: 5 }),
      row('b', 'weibo', undefined),
      row('c', 'jd', gone, { checkedAt: 120 }),
    ];
    const e = makeEngine(rows);
    e.isChecking.value = true;

    e.activeRun.value = { keys: new Set(['a::weibo', 'b::weibo', 'c::jd']), startedAt: 100 };
    e.progress.value = { checked: 1, total: 3, current_url: '' };
    const health = useLinkHealth();
    expect(health.progress.value).toEqual({ checked: 1, total: 3, waitingHost: 'weibo' });
    expect(health.summary.value.dead).toBe(1);
  });

  it('单行重试：复制时使用的那份还是失效 → 停 2 秒「仍然失效」', async () => {
    vi.useFakeTimers();
    const e = makeEngine([row('a', 'weibo', gone)]);
    e.recheckSingle.mockImplementation(async () => { e.checkRows.value = [row('a', 'weibo', gone, { checkedAt: 99 })]; });
    const health = useLinkHealth();
    await health.retry('a');
    expect(health.stillDead.has('a')).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(health.stillDead.has('a')).toBe(false);
    vi.useRealTimers();
  });

  it('单行重试修好了：不显示「仍然失效」', async () => {
    const e = makeEngine([row('a', 'weibo', gone)]);
    e.recheckSingle.mockImplementation(async () => { e.checkRows.value = [row('a', 'weibo', ok)]; });
    const health = useLinkHealth();
    await health.retry('a');
    expect(health.stillDead.has('a')).toBe(false);
  });
});
