import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue';
import { IMAGE_PAGE_SIZE, useImageList } from '@/composables/link-check/useImageList';
import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';
import { createCheckLinkResult, createLinkCheckRow } from '../../factories/linkCheckFactory';

const ok = () => createCheckLinkResult({ is_valid: true });
const gone = () => createCheckLinkResult({ is_valid: false, error_type: 'http_4xx', status_code: 404 });

function img(historyId: string, primary: CheckLinkResult | undefined, backup?: CheckLinkResult | 'none', extra: Partial<LinkCheckRow> = {}): LinkCheckRow[] {
  const rows = [createLinkCheckRow({ historyId, serviceId: 'weibo', isPrimary: true, checkResult: primary, fileName: `${historyId}.jpg`, ...extra })];
  if (backup !== 'none') rows.push(createLinkCheckRow({ historyId, serviceId: 'jd', checkResult: backup, fileName: `${historyId}.jpg` }));
  return rows;
}

let scope: EffectScope;

function setup(rows: LinkCheckRow[], checking = false) {
  const checkRows = shallowRef(rows);
  const isChecking = ref(checking);
  scope = effectScope();
  const list = scope.run(() => useImageList({ checkRows, isChecking }))!;
  return { list, checkRows, isChecking };
}

const ids = (entries: { historyId: string }[]) => entries.map((e) => e.historyId);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { scope?.stop(); vi.useRealTimers(); });

describe('useImageList', () => {
  it('默认看「有问题」：只列有问题的图，能修的排最前、找不回的其次', () => {
    const { list } = setup([
      ...img('fine', ok(), ok()),
      ...img('lost', gone(), 'none'),
      ...img('fix', gone(), ok()),
      ...img('new', undefined, undefined),
      ...img('backup', ok(), gone()),
    ]);

    expect(list.view.value).toBe('problems');
    expect(ids(list.visible.value)).toEqual(['fix', 'lost', 'backup']);
    expect(list.problemCount.value).toBe(3);
  });

  it('没有问题时自动显示全部图片（「有问题 0」的空列表没有意义）；用户手动选过就照用户的', async () => {
    const { list, checkRows } = setup([...img('fine', ok(), ok())]);
    expect(list.view.value).toBe('all');

    checkRows.value = [...img('fine', ok(), ok()), ...img('fix', gone(), ok())];
    await nextTick();
    expect(list.view.value).toBe('problems');

    list.view.value = 'all';
    checkRows.value = [...img('fine', ok(), ok())];
    await nextTick();
    checkRows.value = [...img('fine', ok(), ok()), ...img('fix', gone(), ok())];
    await nextTick();
    expect(list.view.value).toBe('all');
  });

  it('检查进行中停在「有问题」：查出来一张列一张', () => {
    const { list } = setup([...img('fine', ok(), ok())], true);
    expect(list.view.value).toBe('problems');
  });

  it('「全部」列出所有图：有问题的在前，没检查的其次，正常的最后', () => {
    const { list } = setup([...img('fine', ok(), ok()), ...img('new', undefined, undefined), ...img('fix', gone(), ok())]);
    list.view.value = 'all';
    expect(ids(list.visible.value)).toEqual(['fix', 'new', 'fine']);
  });

  it('检查进行中不重排：行按原来的顺序待着，结果出来也不跳', () => {
    const { list } = setup([...img('fine', ok(), ok()), ...img('fix', gone(), ok())], true);
    list.view.value = 'all';
    expect(ids(list.visible.value)).toEqual(['fine', 'fix']);
  });

  it('图床筛选与搜索同时作用于两个视图和计数', async () => {
    const { list } = setup([
      ...img('cat-photo', gone(), ok()),
      ...img('dog-photo', gone(), 'none'),
      ...img('cat-sketch', ok(), ok()),
    ]);

    list.searchInput.value = 'CAT';
    await vi.advanceTimersByTimeAsync(250);
    expect(ids(list.visible.value)).toEqual(['cat-photo']);
    expect(list.problemCount.value).toBe(1);

    list.view.value = 'all';
    expect(ids(list.visible.value)).toEqual(['cat-photo', 'cat-sketch']);

    list.searchInput.value = '';
    await vi.advanceTimersByTimeAsync(250);
    list.serviceId.value = 'jd';
    expect(ids(list.visible.value)).toEqual(['cat-photo', 'cat-sketch']);
  });

  it('图床清单按图片数从多到少', () => {
    const { list } = setup([...img('a', ok(), ok()), ...img('b', ok(), 'none')]);
    expect(list.serviceList.value).toEqual([{ id: 'weibo', count: 2 }, { id: 'jd', count: 1 }]);
  });

  it('分页按图片算；切视图回到第一页；条目变少时页码收回来', async () => {
    const rows = Array.from({ length: IMAGE_PAGE_SIZE + 5 }, (_, i) => img(`p${i}`, gone(), 'none')).flat();
    const { list, checkRows } = setup(rows);

    expect(list.totalPages.value).toBe(2);
    list.page.value = 2;
    expect(list.visible.value).toHaveLength(5);

    list.view.value = 'all';
    await nextTick();
    expect(list.page.value).toBe(1);

    list.page.value = 2;
    checkRows.value = rows.slice(0, 10);
    await nextTick();
    expect(list.totalPages.value).toBe(1);
    expect(list.page.value).toBe(1);
  });

  it('检查进行中合并重建：进度很密时不每次都把整表重新分组，停下来立刻补上', async () => {
    const first = img('a', undefined, 'none');
    const { list, checkRows, isChecking } = setup(first, true);
    // 界面一直显示着汇总（计算结果已缓存）；行是原地改的，只有重建分组才会让它重算
    expect(list.summary.value.kinds.unchecked).toBe(1);

    first[0].checkResult = gone();
    checkRows.value = first.slice();
    await nextTick();
    expect(list.summary.value.kinds.broken).toBe(0);

    await vi.advanceTimersByTimeAsync(300);
    expect(list.summary.value.kinds.broken).toBe(1);

    first[0].checkResult = ok();
    checkRows.value = first.slice();
    isChecking.value = false;
    await nextTick();
    expect(list.summary.value.kinds.ok).toBe(1);
  });
});
