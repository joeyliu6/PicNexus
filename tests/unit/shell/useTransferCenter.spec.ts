// 传输中心：补充备份、链接检测各是一组（H14）；标题栏数字把它们各算一项；检测结束记一条「已完成」
import { describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, ref, shallowRef } from 'vue';

const m = vi.hoisted(() => ({
  linkCheck: null as null | Record<string, unknown>,
  backup: null as null | { state: { phase: string; processed: number; total: number }; clearFinished: () => void },
}));

vi.mock('@/composables/upload/useUploadController', () => ({ useUploadController: () => ({ sessions: [], itemsOf: () => [] }) }));
vi.mock('@/composables/link-check/useLinkCheck', () => ({ useLinkCheckManager: () => m.linkCheck }));
vi.mock('@/views/health/useSupplementBackup', () => ({ useSupplementBackup: () => m.backup }));

async function fresh() {
  vi.resetModules();
  return (await import('@/shell/useTransferCenter')).useTransferCenter();
}

describe('useTransferCenter', () => {
  it('补充备份与链接检测进行中：各算一项，进度环取平均', async () => {
    m.linkCheck = { isChecking: ref(true), activeRun: shallowRef({ keys: new Set(['a', 'b']), startedAt: 0 }), progress: ref({ checked: 1, total: 2, current_url: '' }) };
    m.backup = { state: reactive({ phase: 'running', processed: 0, total: 4 }), clearFinished: vi.fn() };
    const transfer = await fresh();
    expect(transfer.backupActive.value).toBe(true);
    expect(transfer.checkActive.value).toBe(true);
    expect(transfer.activeCount.value).toBe(2);
    expect(transfer.progress.value).toBeCloseTo(0.25);
    expect(transfer.hasAnything.value).toBe(true);
  });

  it('检测结束记一条「链接检测 · N 个链接」，清除后不再显示；补充备份完成的那条一起清掉', async () => {
    const activeRun = shallowRef<{ keys: Set<string>; startedAt: number } | null>(null);
    const progress = ref<{ checked: number; total: number; current_url: string } | null>(null);
    m.linkCheck = { isChecking: ref(false), activeRun, progress };
    m.backup = { state: reactive({ phase: 'done', processed: 4, total: 4 }), clearFinished: vi.fn() };
    const transfer = await fresh();
    activeRun.value = { keys: new Set(['a', 'b', 'c']), startedAt: 0 };
    await nextTick();
    progress.value = { checked: 3, total: 3, current_url: '' };
    activeRun.value = null;
    await nextTick();
    expect(transfer.finishedChecks).toEqual([{ id: 1, links: 3, cancelled: false }]);

    // 中途取消：记实际查完的数，并标成取消
    activeRun.value = { keys: new Set(['a', 'b', 'c', 'd']), startedAt: 1 };
    await nextTick();
    progress.value = { checked: 1, total: 4, current_url: '' };
    activeRun.value = null;
    await nextTick();
    expect(transfer.finishedChecks[1]).toEqual({ id: 2, links: 1, cancelled: true });
    expect(transfer.hasFinished.value).toBe(true);
    transfer.clearFinished();
    expect(transfer.finishedChecks).toEqual([]);
    expect(m.backup.clearFinished).toHaveBeenCalled();
  });

  it('任务都结束、传输中心还开着时进度环是空的（真机走查：取消检测后留着一小段蓝弧）', async () => {
    const isChecking = ref(true);
    const activeRun = shallowRef<{ keys: Set<string>; startedAt: number } | null>({ keys: new Set(['a', 'b']), startedAt: 0 });
    m.linkCheck = { isChecking, activeRun, progress: ref({ checked: 0, total: 2, current_url: '' }) };
    m.backup = { state: reactive({ phase: 'idle', processed: 0, total: 0 }), clearFinished: vi.fn() };
    const transfer = await fresh();
    // 刚开始：至少露 5%
    expect(transfer.ringDash.value).toBe(`${0.05 * 37.7} 37.7`);
    isChecking.value = false;
    activeRun.value = null;
    await nextTick();
    expect(transfer.activeCount.value).toBe(0);
    expect(transfer.ringDash.value).toBe('0 37.7');
  });
});
