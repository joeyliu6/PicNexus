import { describe, it, expect } from 'vitest';
import { ref, shallowRef } from 'vue';
import { useFlatBrokenRows } from '@/composables/md-rescue/useFlatBrokenRows';
import type { MdImageLinkWithFile } from '@/composables/useMdRescue';

function makeLink(
  sourceFile: string,
  url: string,
  opts: {
    valid?: boolean;
    backups?: { url: string; valid: boolean }[];
    selectedBackup?: string;
  } = {},
): MdImageLinkWithFile {
  const name = sourceFile.split(/[/\\]/).pop() ?? sourceFile;
  return {
    originalText: `![](${url})`,
    url,
    altText: '',
    lineNumber: 1,
    syntax: 'markdown',
    context: 'normal',
    sourceFile,
    sourceFileName: name,
    checkResult: { is_valid: opts.valid ?? false, error_type: 'http_4xx', response_time: 100 } as any,
    backupLinks: opts.backups?.map(b => ({
      url: b.url,
      serviceId: 'weibo',
      checkResult: { is_valid: b.valid } as any,
    })) as any,
    selectedBackup: opts.selectedBackup,
  };
}

describe('useFlatBrokenRows', () => {
  it('未设置 checkResult / 正常链接被过滤', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      { ...makeLink('a.md', 'u1'), checkResult: undefined as any },
      makeLink('b.md', 'u2', { valid: true }),
    ]);
    const isRepaired = ref(false);
    const { flatBrokenLinks, filterCounts } = useFlatBrokenRows(links, isRepaired);
    expect(flatBrokenLinks.value).toHaveLength(0);
    expect(filterCounts.value).toEqual({ all: 0, rescuable: 0, manual: 0 });
  });

  it('有可用 backup → rescuable，无 → manual', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('a.md', 'u1', { backups: [{ url: 'b1', valid: true }] }),
      makeLink('a.md', 'u2', { backups: [{ url: 'b2', valid: false }] }),
      makeLink('b.md', 'u3'),
    ]);
    const isRepaired = ref(false);
    const { filterCounts } = useFlatBrokenRows(links, isRepaired);
    expect(filterCounts.value).toEqual({ all: 3, rescuable: 1, manual: 2 });
  });

  it('isRepaired + selectedBackup → status replaced', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('a.md', 'u1', {
        backups: [{ url: 'b1', valid: true }],
        selectedBackup: 'b1',
      }),
    ]);
    const isRepaired = ref(true);
    const { flatBrokenLinks, rescuableChipLabel } = useFlatBrokenRows(links, isRepaired);
    expect(flatBrokenLinks.value[0].status).toBe('replaced');
    expect(rescuableChipLabel.value).toBe('已修复');
  });

  it('isRepaired 但文件未 healed 时不把 selectedBackup 误标为 replaced', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('a.md', 'u1', {
        backups: [{ url: 'b1', valid: true }],
        selectedBackup: 'b1',
      }),
    ]);
    const { flatBrokenLinks } = useFlatBrokenRows(links, ref(true), ref(new Set<string>()));
    expect(flatBrokenLinks.value[0].status).toBe('rescuable');
  });

  it('rescuableChipLabel 默认"可修复"', () => {
    const { rescuableChipLabel } = useFlatBrokenRows(shallowRef([]), ref(false));
    expect(rescuableChipLabel.value).toBe('可修复');
  });

  it('selectFilter 切换筛选并重置分页', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('a.md', 'u1', { backups: [{ url: 'b1', valid: true }] }),
      makeLink('a.md', 'u2'),
    ]);
    const { filteredRows, activeFilter, selectFilter, displayRowLimit, loadMoreRows } =
      useFlatBrokenRows(links, ref(false));

    expect(activeFilter.value).toBe('all');
    expect(filteredRows.value).toHaveLength(2);

    selectFilter('manual');
    expect(filteredRows.value).toHaveLength(1);
    expect(filteredRows.value[0].status).toBe('manual');

    selectFilter('rescuable');
    expect(filteredRows.value[0].status).toBe('rescuable');

    loadMoreRows();
    expect(displayRowLimit.value).toBeGreaterThan(200);

    // 相同 filter 再 select 无变化
    const before = displayRowLimit.value;
    selectFilter('rescuable');
    expect(displayRowLimit.value).toBe(before);
  });

  it('firstOfFile 标记：同文件内仅第一行为 true', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('a.md', 'u1'),
      makeLink('a.md', 'u2'),
      makeLink('b.md', 'u3'),
    ]);
    const { filteredRows } = useFlatBrokenRows(links, ref(false));
    expect(filteredRows.value[0].firstOfFile).toBe(true);
    expect(filteredRows.value[1].firstOfFile).toBe(false);
    expect(filteredRows.value[2].firstOfFile).toBe(true);
  });

  it('groupedRows 按 sourceFile 分组', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('docs/a.md', 'u1'),
      makeLink('docs/a.md', 'u2'),
      makeLink('docs/b.md', 'u3'),
    ]);
    const { groupedRows } = useFlatBrokenRows(links, ref(false));
    expect(groupedRows.value).toHaveLength(2);
    expect(groupedRows.value[0].rows).toHaveLength(2);
    expect(groupedRows.value[0].directory).toBe('docs');
  });

  it('visibleGroupedRows 超出显示上限时按 limit 截断', () => {
    const links = shallowRef<MdImageLinkWithFile[]>(
      Array.from({ length: 300 }, (_, i) => makeLink(`file${i % 3}.md`, `u${i}`)),
    );
    const { visibleGroupedRows, totalFilteredRowCount } = useFlatBrokenRows(links, ref(false));
    expect(totalFilteredRowCount.value).toBe(300);
    const shown = visibleGroupedRows.value.reduce((sum, g) => sum + g.rows.length, 0);
    expect(shown).toBeLessThanOrEqual(200);
  });

  it('visibleGroupedRows 未超限时返回全部组', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('a.md', 'u1'),
      makeLink('b.md', 'u2'),
    ]);
    const { visibleGroupedRows, groupedRows } = useFlatBrokenRows(links, ref(false));
    expect(visibleGroupedRows.value).toHaveLength(groupedRows.value.length);
  });

  it('toggleGroupCollapse 在集合中加/删', () => {
    const { collapsedGroups, toggleGroupCollapse } = useFlatBrokenRows(shallowRef([]), ref(false));
    toggleGroupCollapse('a.md');
    expect(collapsedGroups.value.has('a.md')).toBe(true);
    toggleGroupCollapse('a.md');
    expect(collapsedGroups.value.has('a.md')).toBe(false);
  });

  it('目录提取：单段路径 directory 为空', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('a.md', 'u1'),
    ]);
    const { groupedRows } = useFlatBrokenRows(links, ref(false));
    expect(groupedRows.value[0].directory).toBe('');
  });

  it('目录提取：Windows 反斜杠路径', () => {
    const links = shallowRef<MdImageLinkWithFile[]>([
      makeLink('C:\\docs\\notes\\a.md', 'u1'),
    ]);
    const { groupedRows } = useFlatBrokenRows(links, ref(false));
    expect(groupedRows.value[0].directory).toBe('notes');
  });
});
