import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { useMdLinkFilter, generateDiff } from '../../../../composables/md-rescue/useMdLinkFilter';
import {
  imageLinks,
  mode,
  fileContent,
  type MdImageLinkWithFile,
} from '../../../../composables/md-rescue/shared';

function makeLink(
  url: string,
  opts: {
    valid?: boolean;
    errorType?: string;
    sourceFileName?: string;
    altText?: string;
    backups?: { url: string; valid: boolean }[];
    selectedBackup?: string;
  } = {},
): MdImageLinkWithFile {
  const name = opts.sourceFileName ?? 'a.md';
  return {
    originalText: `![${opts.altText ?? ''}](${url})`,
    url,
    altText: opts.altText ?? '',
    lineNumber: 1,
    syntax: 'markdown',
    context: 'normal',
    sourceFile: name,
    sourceFileName: name,
    checkResult: opts.valid === undefined
      ? undefined as any
      : { is_valid: opts.valid, error_type: opts.errorType ?? 'http_4xx', response_time: 100 } as any,
    backupLinks: opts.backups?.map(b => ({
      url: b.url,
      serviceId: 'weibo',
      checkResult: { is_valid: b.valid } as any,
    })) as any,
    selectedBackup: opts.selectedBackup,
  };
}

function resetState(): void {
  imageLinks.value = [];
  mode.value = null;
  fileContent.value = null;
}

describe('useMdLinkFilter - stats', () => {
  beforeEach(resetState);

  it('按 checkResult.is_valid / error_type 分类', () => {
    imageLinks.value = [
      makeLink('u1', { valid: true }),
      makeLink('u2', { valid: false, errorType: 'http_4xx' }),
      makeLink('u3', { valid: false, errorType: 'timeout' }),
      makeLink('u4', { valid: false, errorType: 'suspicious' }),
      makeLink('u5'), // unchecked
    ];
    const { stats } = useMdLinkFilter();
    expect(stats.value.valid).toBe(1);
    expect(stats.value.invalid).toBe(1);
    expect(stats.value.timeout).toBe(1);
    expect(stats.value.suspicious).toBe(1);
    expect(stats.value.unchecked).toBe(1);
    expect(stats.value.broken).toBe(3);
    expect(stats.value.total).toBe(5);
    expect(stats.value.checked).toBe(4);
  });

  it('rescuable = broken 里有 backupLinks 的数量', () => {
    imageLinks.value = [
      makeLink('u1', { valid: false, backups: [{ url: 'b', valid: true }] }),
      makeLink('u2', { valid: false }),
    ];
    const { stats } = useMdLinkFilter();
    expect(stats.value.broken).toBe(2);
    expect(stats.value.rescuable).toBe(1);
    expect(stats.value.unresolvable).toBe(1);
  });
});

describe('useMdLinkFilter - sourceFileList', () => {
  beforeEach(resetState);

  it('按 sourceFileName 聚合计数并按数量降序', () => {
    imageLinks.value = [
      makeLink('u1', { sourceFileName: 'a.md' }),
      makeLink('u2', { sourceFileName: 'a.md' }),
      makeLink('u3', { sourceFileName: 'b.md' }),
    ];
    const { sourceFileList } = useMdLinkFilter();
    expect(sourceFileList.value).toEqual([
      { name: 'a.md', count: 2 },
      { name: 'b.md', count: 1 },
    ]);
  });
});

describe('useMdLinkFilter - scopedLinks', () => {
  beforeEach(resetState);

  it('按 selectedSourceFile 过滤', async () => {
    imageLinks.value = [
      makeLink('u1', { sourceFileName: 'a.md' }),
      makeLink('u2', { sourceFileName: 'b.md' }),
    ];
    const { selectedSourceFile, scopedLinks } = useMdLinkFilter();
    selectedSourceFile.value = 'a.md';
    await nextTick();
    expect(scopedLinks.value).toHaveLength(1);
  });

  it('searchQuery 按 url / fileName / altText 子串过滤', () => {
    imageLinks.value = [
      makeLink('https://foo.com/x.png', { sourceFileName: 'a.md' }),
      makeLink('https://bar.com/y.png', { sourceFileName: 'b.md', altText: 'desc' }),
    ];
    const { searchQuery, scopedLinks } = useMdLinkFilter();
    searchQuery.value = 'foo';
    expect(scopedLinks.value).toHaveLength(1);
    searchQuery.value = 'DESC';
    expect(scopedLinks.value).toHaveLength(1);
    searchQuery.value = 'b.md';
    expect(scopedLinks.value).toHaveLength(1);
  });
});

describe('useMdLinkFilter - filteredLinks 状态分支', () => {
  beforeEach(resetState);

  it('statusFilter 各分支', () => {
    imageLinks.value = [
      makeLink('u1', { valid: true }),
      makeLink('u2', { valid: false, errorType: 'http_4xx' }),
      makeLink('u3', { valid: false, errorType: 'timeout' }),
      makeLink('u4', { valid: false, errorType: 'suspicious' }),
      makeLink('u5'),
    ];
    const { statusFilter, filteredLinks } = useMdLinkFilter();

    statusFilter.value = 'valid';
    expect(filteredLinks.value).toHaveLength(1);

    statusFilter.value = 'invalid';
    expect(filteredLinks.value.map(l => l.url)).toEqual(['u2']);

    statusFilter.value = 'timeout';
    expect(filteredLinks.value.map(l => l.url)).toEqual(['u3']);

    statusFilter.value = 'suspicious';
    expect(filteredLinks.value.map(l => l.url)).toEqual(['u4']);

    statusFilter.value = 'unchecked';
    expect(filteredLinks.value.map(l => l.url)).toEqual(['u5']);

    statusFilter.value = 'all';
    expect(filteredLinks.value).toHaveLength(5);

    statusFilter.value = null;
    expect(filteredLinks.value).toHaveLength(5);
  });

  it('按 severity 排序（error_type 越小越靠前）', () => {
    imageLinks.value = [
      makeLink('u1', { valid: false, errorType: 'suspicious' }),
      makeLink('u2', { valid: false, errorType: 'http_4xx' }),
      makeLink('u3', { valid: false, errorType: 'network' }),
      makeLink('u4', { valid: true, errorType: 'success' }),
    ];
    const { filteredLinks, statusFilter } = useMdLinkFilter();
    statusFilter.value = 'all';
    expect(filteredLinks.value.map(l => l.url)).toEqual(['u2', 'u3', 'u1', 'u4']);
  });
});

describe('useMdLinkFilter - 分页', () => {
  beforeEach(resetState);

  it('totalPages 至少 1，按 PAGE_SIZE 划分', () => {
    imageLinks.value = Array.from({ length: 250 }, (_, i) =>
      makeLink(`u${i}`, { valid: true }),
    );
    const { totalPages, visibleLinks, currentPage } = useMdLinkFilter();
    expect(totalPages.value).toBe(3);
    expect(visibleLinks.value).toHaveLength(100);
    currentPage.value = 3;
    expect(visibleLinks.value).toHaveLength(50);
  });

  it('empty 时 totalPages 仍为 1', () => {
    const { totalPages } = useMdLinkFilter();
    expect(totalPages.value).toBe(1);
  });
});

describe('useMdLinkFilter - brokenLinks/healthyLinks', () => {
  beforeEach(resetState);

  it('分离 broken / healthy', () => {
    imageLinks.value = [
      makeLink('u1', { valid: true }),
      makeLink('u2', { valid: false }),
      makeLink('u3'), // unchecked
    ];
    const { brokenLinks, healthyLinks } = useMdLinkFilter();
    expect(brokenLinks.value.map(l => l.url)).toEqual(['u2']);
    expect(healthyLinks.value.map(l => l.url)).toEqual(['u1']);
  });
});

describe('generateDiff', () => {
  beforeEach(resetState);

  it('fileLinks 为空 → 返回空数组', () => {
    imageLinks.value = [];
    expect(generateDiff()).toEqual([]);
  });

  it('folder 模式 / 非 file 模式 → 返回空数组', () => {
    mode.value = 'folder';
    fileContent.value = '![](old)';
    imageLinks.value = [
      makeLink('old', { valid: false, selectedBackup: 'new', backups: [{ url: 'new', valid: true }] }),
    ];
    expect(generateDiff()).toEqual([]);
  });

  it('file 模式单文件生成 unchanged / removed / added 行', () => {
    mode.value = 'file';
    fileContent.value = 'line1\n![](old)\nline3';
    imageLinks.value = [
      { ...makeLink('old', { valid: false, selectedBackup: 'new', backups: [{ url: 'new', valid: true }] }),
        originalText: '![](old)', lineNumber: 2 },
    ];
    const diff = generateDiff();
    // 包含至少一行 removed 和一行 added
    const removed = diff.filter(d => d.type === 'removed');
    const added = diff.filter(d => d.type === 'added');
    expect(removed.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
    expect(diff.some(d => d.type === 'unchanged')).toBe(true);
  });
});
