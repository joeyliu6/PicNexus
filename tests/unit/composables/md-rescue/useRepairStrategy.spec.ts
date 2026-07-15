import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed } from 'vue';

// Mock useConfig：返回可控的 loadConfig/saveConfig
const loadConfigMock = vi.fn();
const saveConfigMock = vi.fn();
vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    loadConfig: loadConfigMock,
    saveConfig: saveConfigMock,
  }),
}));

import {
  applyHostPreference,
  applyRepairStrategy,
  loadHostPreference,
  saveHostPreference,
  autoSelectAndGetSummary,
  toggleExclude,
  excludeAll,
  includeAll,
  useBottomStats,
} from '@/composables/md-rescue/useRepairStrategy';
import {
  imageLinks,
  excludedUrls,
  hostPreference,
  healedFiles,
  type MdImageLinkWithFile,
  type FileHealth,
} from '@/composables/md-rescue/shared';

function makeLink(
  url: string,
  opts: {
    valid?: boolean;
    sourceFile?: string;
    backups?: { url: string; serviceId: string; valid: boolean; responseTime?: number }[];
    selectedBackup?: string;
  } = {},
): MdImageLinkWithFile {
  const file = opts.sourceFile ?? 'a.md';
  return {
    originalText: `![](${url})`,
    url,
    altText: '',
    lineNumber: 1,
    syntax: 'markdown',
    context: 'normal',
    sourceFile: file,
    sourceFileName: file,
    checkResult: { is_valid: opts.valid ?? false, error_type: 'http_4xx', response_time: 100 } as any,
    backupLinks: opts.backups?.map(b => ({
      url: b.url,
      serviceId: b.serviceId,
      checkResult: { is_valid: b.valid, response_time: b.responseTime ?? 100 } as any,
    })) as any,
    selectedBackup: opts.selectedBackup,
  };
}

function resetState(): void {
  imageLinks.value = [];
  excludedUrls.value = new Set();
  hostPreference.value = [];
  healedFiles.value = new Set();
}

describe('applyHostPreference', () => {
  beforeEach(resetState);

  it('无偏好时不改变选择', () => {
    const links = [makeLink('u1', { backups: [
      { url: 'b1', serviceId: 'weibo', valid: true },
      { url: 'b2', serviceId: 'r2', valid: true },
    ]})];
    applyHostPreference(links, []);
    expect(links[0].selectedBackup).toBe('b1');
  });

  it('按偏好顺序选择首个 valid 备份', () => {
    const links = [makeLink('u1', { backups: [
      { url: 'b1', serviceId: 'weibo', valid: true },
      { url: 'b2', serviceId: 'r2', valid: true },
    ]})];
    applyHostPreference(links, ['r2', 'weibo']);
    expect(links[0].selectedBackup).toBe('b2');
  });

  it('偏好列表未命中的图床排在后面（9999）', () => {
    const links = [makeLink('u1', { backups: [
      { url: 'b1', serviceId: 'weibo', valid: true },
      { url: 'b2', serviceId: 'r2', valid: true },
    ]})];
    applyHostPreference(links, ['weibo']); // r2 未命中
    expect(links[0].selectedBackup).toBe('b1');
  });

  it('链接已有效 → 跳过', () => {
    const links = [makeLink('u1', { valid: true, backups: [{ url: 'b1', serviceId: 'r2', valid: true }] })];
    applyHostPreference(links, ['r2']);
    expect(links[0].selectedBackup).toBeUndefined();
  });

  it('无 backupLinks → 跳过', () => {
    const links = [makeLink('u1')];
    applyHostPreference(links, ['r2']);
    expect(links[0].selectedBackup).toBeUndefined();
  });
});

describe('applyRepairStrategy', () => {
  beforeEach(resetState);

  it('priority 策略按顺序选', () => {
    imageLinks.value = [makeLink('u1', { backups: [
      { url: 'b-weibo', serviceId: 'weibo', valid: true },
      { url: 'b-r2', serviceId: 'r2', valid: true },
    ]})];
    applyRepairStrategy({ type: 'priority', order: ['r2', 'weibo'] });
    expect(imageLinks.value[0].selectedBackup).toBe('b-r2');
  });

  it('fastest 策略按 response_time 升序选', () => {
    imageLinks.value = [makeLink('u1', { backups: [
      { url: 'slow', serviceId: 'a', valid: true, responseTime: 500 },
      { url: 'fast', serviceId: 'b', valid: true, responseTime: 50 },
    ]})];
    applyRepairStrategy({ type: 'fastest' });
    expect(imageLinks.value[0].selectedBackup).toBe('fast');
  });

  it('manual 策略使用 selections map', () => {
    imageLinks.value = [makeLink('u1', { backups: [
      { url: 'b1', serviceId: 'a', valid: true },
      { url: 'b2', serviceId: 'b', valid: true },
    ]})];
    const selections = new Map([['u1', 'b2']]);
    applyRepairStrategy({ type: 'manual', selections });
    expect(imageLinks.value[0].selectedBackup).toBe('b2');
  });

  it('manual 策略 selections 未命中 → 不修改 selectedBackup', () => {
    imageLinks.value = [makeLink('u1', { backups: [
      { url: 'b1', serviceId: 'a', valid: true },
    ]})];
    applyRepairStrategy({ type: 'manual', selections: new Map() });
    expect(imageLinks.value[0].selectedBackup).toBeUndefined();
  });

  it('无 valid 备份的链接被跳过', () => {
    imageLinks.value = [makeLink('u1', { backups: [{ url: 'b1', serviceId: 'a', valid: false }] })];
    applyRepairStrategy({ type: 'fastest' });
    expect(imageLinks.value[0].selectedBackup).toBeUndefined();
  });

  it('已有效 link 跳过', () => {
    imageLinks.value = [makeLink('u1', { valid: true, backups: [{ url: 'b1', serviceId: 'a', valid: true }] })];
    applyRepairStrategy({ type: 'fastest' });
    expect(imageLinks.value[0].selectedBackup).toBeUndefined();
  });
});

describe('autoSelectAndGetSummary', () => {
  beforeEach(resetState);

  it('自动选首个有效备份并构建摘要', () => {
    imageLinks.value = [
      makeLink('u1', { sourceFile: 'a.md', backups: [
        { url: 'b1', serviceId: 'weibo', valid: false },
        { url: 'b2', serviceId: 'r2', valid: true },
      ]}),
      makeLink('u2', { sourceFile: 'a.md', backups: [{ url: 'b3', serviceId: 'r2', valid: true }]}),
      makeLink('u3', { sourceFile: 'b.md', backups: [{ url: 'b4', serviceId: 'weibo', valid: true }]}),
    ];
    const summary = autoSelectAndGetSummary();
    expect(summary.totalFiles).toBe(2);
    expect(summary.totalReplacements).toBe(3);
    const aFile = summary.files.find(f => f.path === 'a.md');
    expect(aFile?.replacements).toHaveLength(2);
  });

  it('无备份 / 全无效 → 不计入', () => {
    imageLinks.value = [
      makeLink('u1'),
      makeLink('u2', { backups: [{ url: 'b', serviceId: 'a', valid: false }]}),
    ];
    const summary = autoSelectAndGetSummary();
    expect(summary.totalReplacements).toBe(0);
    expect(summary.totalFiles).toBe(0);
  });
});

describe('toggleExclude / excludeAll / includeAll', () => {
  beforeEach(resetState);

  it('toggleExclude 加/删', () => {
    toggleExclude('u1');
    expect(excludedUrls.value.has('u1')).toBe(true);
    toggleExclude('u1');
    expect(excludedUrls.value.has('u1')).toBe(false);
  });

  it('excludeAll 用 imageLinks 的 url 填充', () => {
    imageLinks.value = [makeLink('u1'), makeLink('u2')];
    excludeAll();
    expect(excludedUrls.value.size).toBe(2);
  });

  it('includeAll 清空', () => {
    excludedUrls.value = new Set(['u1', 'u2']);
    includeAll();
    expect(excludedUrls.value.size).toBe(0);
  });
});

describe('loadHostPreference / saveHostPreference', () => {
  beforeEach(() => {
    resetState();
    loadConfigMock.mockReset();
    saveConfigMock.mockReset();
  });

  it('loadHostPreference 从配置读取偏好', async () => {
    loadConfigMock.mockResolvedValue({ mdRescueHostPreference: ['r2', 'weibo'] });
    await loadHostPreference();
    expect(hostPreference.value).toEqual(['r2', 'weibo']);
  });

  it('配置缺字段时回退空数组', async () => {
    loadConfigMock.mockResolvedValue({});
    await loadHostPreference();
    expect(hostPreference.value).toEqual([]);
  });

  it('saveHostPreference 写回配置', async () => {
    loadConfigMock.mockResolvedValue({ foo: 'bar' });
    hostPreference.value = ['r2'];
    await saveHostPreference();
    expect(saveConfigMock).toHaveBeenCalledWith({ foo: 'bar', mdRescueHostPreference: ['r2'] }, true);
  });
});

describe('useBottomStats', () => {
  beforeEach(resetState);

  it('按 checkResult 分类统计', () => {
    imageLinks.value = [
      makeLink('u1', { valid: true }),
      makeLink('u2', { valid: true }),
      makeLink('u3', { sourceFile: 'a.md', backups: [{ url: 'b', serviceId: 'r2', valid: true }], selectedBackup: 'b' }),
      makeLink('u4'),
    ];
    healedFiles.value = new Set(['a.md']);

    const fileHealthList = computed<FileHealth[]>(() => [
      { path: 'a.md', name: 'a.md', totalCount: 2, brokenCount: 1, timeoutCount: 0, suspiciousCount: 0, rescuableCount: 1, unrescuableCount: 0, status: 'broken', ready: true, healed: true },
      { path: 'b.md', name: 'b.md', totalCount: 1, brokenCount: 1, timeoutCount: 0, suspiciousCount: 0, rescuableCount: 0, unrescuableCount: 1, status: 'broken', ready: true, healed: false },
      { path: 'c.md', name: 'c.md', totalCount: 0, brokenCount: 0, timeoutCount: 0, suspiciousCount: 0, rescuableCount: 0, unrescuableCount: 0, status: 'healthy', ready: false, healed: false },
    ]);

    const stats = useBottomStats(fileHealthList);
    expect(stats.value.totalImages).toBe(4);
    expect(stats.value.normalCount).toBe(2);
    expect(stats.value.repairedCount).toBe(1);
    expect(stats.value.manualCount).toBe(1);
    expect(stats.value.problemCount).toBe(2);
    expect(stats.value.checkedCount).toBe(4);
    // 未 ready 的 c.md 不计
    expect(stats.value.normalFileCount).toBe(0);
    expect(stats.value.problemFileCount).toBe(2);
    expect(stats.value.totalFiles).toBe(3);
  });

  it('无 checkResult 的 link 被跳过', () => {
    imageLinks.value = [{ ...makeLink('u1'), checkResult: undefined as any }];
    const stats = useBottomStats(computed(() => []));
    expect(stats.value.normalCount).toBe(0);
    expect(stats.value.problemCount).toBe(0);
  });
});
