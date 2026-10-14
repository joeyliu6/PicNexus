import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed } from 'vue';

// 可控的 loadConfig/saveConfig，作为参数传给被测函数
//
// 不再 mock '@/composables/useConfig'：这两个函数已改成由调用方在 setup 期间取好
// configManager 传进来，模块运行时不再 import 它。「setup 之外不得自己 inject」
// 那条不变量由 setupContextGuard.spec.ts 钉着。
const loadConfigMock = vi.fn();
const saveConfigMock = vi.fn();
const configManager = {
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
} as unknown as ConfigManagerApi;

import type { ConfigManagerApi } from '@/composables/useConfig';
import {
  applyDefaultBackups,
  loadHostPreference,
  pickBackupForLink,
  preferServiceForAll,
  saveHostPreference,
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

describe('pickBackupForLink', () => {
  const link = () => makeLink('u1', {
    backups: [
      { url: 'b-weibo', serviceId: 'weibo', valid: true, responseTime: 300 },
      { url: 'b-r2', serviceId: 'r2', valid: true, responseTime: 80 },
      { url: 'b-dead', serviceId: 'jd', valid: false, responseTime: 10 },
    ],
  });

  it('priority：按顺序取首个可用备份，未列入的排最后', () => {
    expect(pickBackupForLink(link(), { type: 'priority', order: ['r2', 'weibo'] })).toBe('b-r2');
    expect(pickBackupForLink(link(), { type: 'priority', order: ['jd'] })).toBe('b-weibo');
  });

  it('fastest：只在可用备份里比响应时间', () => {
    expect(pickBackupForLink(link(), { type: 'fastest' })).toBe('b-r2');
  });

  it('链接本身有效 / 没有可用备份 → 不选', () => {
    expect(pickBackupForLink(makeLink('ok', { valid: true, backups: [{ url: 'b', serviceId: 'r2', valid: true }] }), { type: 'fastest' })).toBeUndefined();
    expect(pickBackupForLink(makeLink('x', { backups: [{ url: 'b', serviceId: 'r2', valid: false }] }), { type: 'fastest' })).toBeUndefined();
  });
});

describe('applyDefaultBackups', () => {
  beforeEach(resetState);

  it('有首选顺序按顺序选，没有就选最快的', () => {
    imageLinks.value = [makeLink('u1', {
      backups: [
        { url: 'b-weibo', serviceId: 'weibo', valid: true, responseTime: 300 },
        { url: 'b-r2', serviceId: 'r2', valid: true, responseTime: 80 },
      ],
    })];
    applyDefaultBackups(['weibo']);
    expect(imageLinks.value[0].selectedBackup).toBe('b-weibo');

    imageLinks.value = [makeLink('u1', {
      backups: [
        { url: 'b-weibo', serviceId: 'weibo', valid: true, responseTime: 300 },
        { url: 'b-r2', serviceId: 'r2', valid: true, responseTime: 80 },
      ],
    })];
    applyDefaultBackups([]);
    expect(imageLinks.value[0].selectedBackup).toBe('b-r2');
  });

  it('不覆盖用户已手动选过、且仍然可用的备份；选中项失效时重新选', () => {
    imageLinks.value = [
      makeLink('kept', {
        selectedBackup: 'b-weibo',
        backups: [
          { url: 'b-weibo', serviceId: 'weibo', valid: true, responseTime: 300 },
          { url: 'b-r2', serviceId: 'r2', valid: true, responseTime: 80 },
        ],
      }),
      makeLink('stale', {
        selectedBackup: 'b-dead',
        backups: [
          { url: 'b-dead', serviceId: 'jd', valid: false },
          { url: 'b-r2', serviceId: 'r2', valid: true },
        ],
      }),
    ];
    applyDefaultBackups([]);
    expect(imageLinks.value.map((l) => l.selectedBackup)).toEqual(['b-weibo', 'b-r2']);
  });

  it('没有可用备份的链接保持不选（需手动）', () => {
    imageLinks.value = [makeLink('manual', { backups: [{ url: 'b', serviceId: 'r2', valid: false }] })];
    applyDefaultBackups([]);
    expect(imageLinks.value[0].selectedBackup).toBeUndefined();
  });
});

describe('preferServiceForAll', () => {
  beforeEach(resetState);

  it('把图床提到首选最前，并应用到所有在它上面有可用备份的图', () => {
    hostPreference.value = ['r2', 'weibo'];
    imageLinks.value = [
      makeLink('a', {
        selectedBackup: 'a-r2',
        backups: [
          { url: 'a-r2', serviceId: 'r2', valid: true },
          { url: 'a-weibo', serviceId: 'weibo', valid: true },
        ],
      }),
      makeLink('b', {
        selectedBackup: 'b-r2',
        backups: [
          { url: 'b-r2', serviceId: 'r2', valid: true },
          { url: 'b-weibo', serviceId: 'weibo', valid: false },
        ],
      }),
    ];

    const changed = preferServiceForAll('weibo');

    expect(hostPreference.value).toEqual(['weibo', 'r2']);
    expect(changed).toBe(1);
    // b 在 weibo 上的备份不可用，保持原选择
    expect(imageLinks.value.map((l) => l.selectedBackup)).toEqual(['a-weibo', 'b-r2']);
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
    await loadHostPreference(configManager);
    expect(hostPreference.value).toEqual(['r2', 'weibo']);
  });

  it('配置缺字段时回退空数组', async () => {
    loadConfigMock.mockResolvedValue({});
    await loadHostPreference(configManager);
    expect(hostPreference.value).toEqual([]);
  });

  it('saveHostPreference 写回配置', async () => {
    loadConfigMock.mockResolvedValue({ foo: 'bar' });
    hostPreference.value = ['r2'];
    await saveHostPreference(configManager);
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
