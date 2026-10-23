// 修复：改用响应最快的备份 + 换文档旧链接，不弹确认、通知带撤销；写不成的另起红色通知只重试那几个；撤销两样都还原
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';
import { buildHealthImages } from '@/views/health/healthModel';
import type { DocWrite } from '@/views/health/docIndex';

const m = await vi.hoisted(async () => ({
  switchPrimaryService: vi.fn(),
  writeDocs: vi.fn(),
  restoreDocs: vi.fn(),
  withAction: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  setPrimaryServices: vi.fn(),
  scan: vi.fn(),
  addFolder: vi.fn(),
  emitHistoryUpdated: vi.fn().mockResolvedValue(undefined),
  // 清单的模型读这一份：响应式，模型跟着重算（真的那份检测中最多 300ms 重算一次）
  rows: (await import('vue')).ref<LinkCheckRow[]>([]),
  docFolders: { value: ['D:\\Notes'] as string[] },
  scanned: { value: [] as unknown[] },
}));

vi.mock('@/services/database', () => ({ historyDB: { switchPrimaryService: m.switchPrimaryService } }));
vi.mock('@/events/cacheEvents', () => ({ emitHistoryUpdated: m.emitHistoryUpdated, onCacheEvent: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ withAction: m.withAction, error: m.error, success: m.success, info: vi.fn(), warn: vi.fn() }) }));
vi.mock('@/views/health/docFiles', () => ({ writeDocs: m.writeDocs, restoreDocs: m.restoreDocs }));
vi.mock('@/views/health/useDocFolders', () => ({
  useDocFolders: () => ({ scannedFolders: computed(() => m.scanned.value), scan: m.scan, add: m.addFolder, folders: ref([]) }),
}));
vi.mock('@/views/health/useLinkHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/views/health/useLinkHealth')>();
  const names: Record<string, string> = { weibo: '微博', jd: '京东', r2: 'Cloudflare R2' };
  return {
    ...actual,
    useLinkHealth: () => ({
      images: computed(() => buildHealthImages(m.rows.value)),
      config: computed(() => ({ linkHealth: { docFolders: m.docFolders.value, autoCheck: { enabled: true, intervalDays: 7 } } })),
      hostName: (id: string) => names[id] ?? id,
      linkCheck: { setPrimaryServices: m.setPrimaryServices },
    }),
  };
});

import { useHealthRepair } from '@/views/health/useHealthRepair';
import { repairState } from '@/views/health/useLinkHealth';

const ok = (ms: number): CheckLinkResult => ({ link: '', is_valid: true, error_type: 'success', browser_might_work: false, response_time: ms });
const gone: CheckLinkResult = { link: '', is_valid: false, error_type: 'http_4xx', status_code: 404, browser_might_work: false };
const row = (id: string, host: string, result: CheckLinkResult | undefined, isPrimary = false): LinkCheckRow => ({
  historyId: id, serviceId: host, url: `https://${host}.example/${id}.png`, rawUrl: `https://${host}.example/${id}.png`,
  fileName: `${id}.png`, uploadedAt: 1, isPrimary, checkResult: result, checkedAt: 1,
});

function scannedDoc(urls: string[]) {
  m.scanned.value = [{ folder: 'D:\\Notes', docs: [{ filePath: 'D:\\Notes\\README.md', fileName: 'README.md', links: urls.map((url, i) => ({ url, lineNumber: i + 1 })) }] }];
}

/** 模型里换上改用的那份（「复制时使用」那一行换成新的图床） */
function applySwitch(changes: ReadonlyMap<string, string>): void {
  m.rows.value = m.rows.value.map((r) => (changes.has(r.historyId) ? { ...r, isPrimary: r.serviceId === changes.get(r.historyId) } : r));
}

/** 最后一条带动作的通知，点它的按钮 */
function lastAction(label: string): () => void {
  const call = [...m.withAction.mock.calls].reverse().find((c) => c[3].label === label);
  return call![3].run;
}

describe('useHealthRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    repairState.fixedThisSession = 0;
    m.docFolders.value = ['D:\\Notes'];
    m.rows.value = [
      row('a', 'weibo', gone, true), row('a', 'jd', ok(800)), row('a', 'r2', ok(100)),
      row('b', 'weibo', gone, true), row('b', 'jd', ok(50)),
    ];
    scannedDoc(['https://weibo.example/a.png', 'https://weibo.example/a.png', 'https://weibo.example/b.png']);
    m.switchPrimaryService.mockResolvedValue(undefined);
    // 改用之后模型立刻跟上（真的那份有时晚 300ms，见「等清单跟上」那条）
    m.setPrimaryServices.mockImplementation((changes: Map<string, string>) => applySwitch(changes));
    m.writeDocs.mockImplementation(async (writes: DocWrite[]) => ({
      written: writes.map((w) => ({ path: w.path, backup: 'bak', content: 'new', places: w.places })),
      failed: [],
    }));
    m.restoreDocs.mockResolvedValue({ restored: ['D:\\Notes\\README.md'], modified: [], failed: [] });
  });

  it('修复 N 张：逐张改用响应最快的那份，文档里的旧链接一起换，通知带撤销', async () => {
    await useHealthRepair().repair(['a', 'b']);

    expect(m.switchPrimaryService.mock.calls).toEqual([['a', 'r2'], ['b', 'jd']]);
    expect(m.setPrimaryServices).toHaveBeenCalledWith(new Map([['a', 'r2'], ['b', 'jd']]));
    const [writes] = m.writeDocs.mock.calls[0] as [DocWrite[]];
    expect([...writes[0].replacements]).toEqual([
      ['https://weibo.example/a.png', 'https://r2.example/a.png'],
      ['https://weibo.example/b.png', 'https://jd.example/b.png'],
    ]);
    expect(m.withAction).toHaveBeenCalledWith('success', '已修复 2 张图片', '已更新 1 个文档中的 3 处旧链接', expect.objectContaining({ label: '撤销' }), expect.objectContaining({ countdown: true }));
    expect(repairState.fixedThisSession).toBe(2);
    expect(repairState.running).toBe(false);
    // 文档修复卡写「1 个文档已更新 · 共替换 3 处旧链接，可撤销」，撤销通知消失后回到平常
    expect(repairState.lastDocs).toEqual({ docs: 1, places: 3 });
    m.withAction.mock.calls[0][4].onExpire();
    expect(repairState.lastDocs).toBeNull();
  });

  // 检测中清单的模型最多 300ms 才重算一次：修复中的状态清早了，那一行会先闪回「改用 X」再被拿掉
  it('改好的行一直写「已改用 X」，等清单换上新的那份才收起修复中的状态', async () => {
    let lagging: Map<string, string> | undefined;
    m.setPrimaryServices.mockImplementation((changes: Map<string, string>) => { lagging = changes; });

    const repairing = useHealthRepair().repair(['b'], 'row');
    await vi.waitFor(() => expect(lagging).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(repairState.running).toBe(true);
    expect(repairState.rows.get('b')?.phase).toBe('done');

    applySwitch(lagging!);
    await repairing;
    expect(repairState.running).toBe(false);
    expect(repairState.rows.size).toBe(0);
  });

  it('行内改用：通知写「已改用 X」；没有文档引用时写复制的链接来自哪里', async () => {
    m.scanned.value = [];
    await useHealthRepair().repair(['b'], 'row');
    expect(m.withAction).toHaveBeenCalledWith('success', '已改用京东', '复制的链接将来自京东', expect.anything(), expect.objectContaining({ countdown: true }));
  });

  it('文档写不成：红色通知写原因，「重试」只重写那几个，写成的并进同一次撤销', async () => {
    m.writeDocs.mockImplementationOnce(async (writes: DocWrite[]) => ({
      written: [],
      failed: [{ path: writes[0].path, name: 'README.md', message: 'README.md 被其他程序占用，请关闭后重试', write: writes[0] }],
    }));
    await useHealthRepair().repair(['a', 'b']);
    expect(m.withAction).toHaveBeenCalledWith('error', '1 个文档未能更新', 'README.md 被其他程序占用，请关闭后重试', expect.objectContaining({ label: '重试' }));

    const undo = lastAction('撤销');
    lastAction('重试')();
    await vi.waitFor(() => expect(m.writeDocs).toHaveBeenCalledTimes(2));
    expect((m.writeDocs.mock.calls[1][0] as DocWrite[]).map((w) => w.path)).toEqual(['D:\\Notes\\README.md']);

    await vi.waitFor(() => expect(m.success).toHaveBeenCalled());
    undo();
    await vi.waitFor(() => expect(m.restoreDocs).toHaveBeenCalled());
    expect(m.restoreDocs.mock.calls[0][0]).toHaveLength(1);
  });

  it('撤销：文档按备份还原、复制时使用改回原来那份；修复后被改过的文档不还原并说明', async () => {
    m.restoreDocs.mockResolvedValueOnce({ restored: [], modified: ['D:\\Notes\\README.md'], failed: [] });
    await useHealthRepair().repair(['a']);
    m.switchPrimaryService.mockClear();

    lastAction('撤销')();
    await vi.waitFor(() => expect(m.switchPrimaryService).toHaveBeenCalledWith('a', 'weibo'));
    expect(m.error).toHaveBeenCalledWith('1 个文档未还原', 'README.md 在修复后被修改过，已保留现在的内容');
    expect(repairState.fixedThisSession).toBe(0);
  });

  it('没有文档文件夹：只切换复制链接；第一次另起一条通知引导添加文件夹，只出现一次', async () => {
    m.docFolders.value = [];
    m.scanned.value = [];
    const repair = useHealthRepair();
    await repair.repair(['a']);
    expect(m.withAction).toHaveBeenCalledWith('success', '已修复 1 张图片', '复制的链接已改用备份', expect.anything(), expect.objectContaining({ countdown: true }));
    expect(m.withAction).toHaveBeenCalledWith('info', '文档中的旧链接未更新', expect.any(String), expect.objectContaining({ label: '添加文档文件夹…' }));

    m.withAction.mockClear();
    await repair.repair(['b']);
    expect(m.withAction.mock.calls.map((c) => c[1])).toEqual(['已修复 1 张图片']);
  });

  it('同一时间只跑一个修复', async () => {
    let release!: () => void;
    m.switchPrimaryService.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const repair = useHealthRepair();
    const first = repair.repair(['a']);
    await repair.repair(['b']);
    release();
    await first;
    expect(m.switchPrimaryService.mock.calls.map((c) => c[0])).toEqual(['a']);
  });

  it('改用的那份在修复前被别处删了：这一张记为失败，其余照常', async () => {
    m.switchPrimaryService.mockRejectedValueOnce(new Error('目标镜像不可用或未成功上传: r2'));
    await useHealthRepair().repair(['a', 'b']);
    expect(m.withAction.mock.calls[0][1]).toBe('已修复 1 张图片');
    expect(m.error).toHaveBeenCalledWith('1 张图片未能修复', '记录已变化，请重新检测后重试');
  });
});
