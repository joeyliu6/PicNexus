/**
 * 历史记录导入谓词的直接测试
 *
 * Why 单独一份：`isImportableHistoryItem` 是**导入链路的唯一判据**——本地文件导入和
 * 云端下载都靠它决定「这条记录能不能进库」，而 replace 模式下判定结果还会影响
 * 本地同 id 记录的去留。可它此前完全没有直接测试：唯一的消费端 spec
 * （useBackupLocal.spec.ts）把整个 `@/config/types` mock 掉了，真实实现一次都没跑过。
 * 于是「把条件写反」这类错误在 CI 里是全绿的。
 */

import { describe, expect, it } from 'vitest';
import { isImportableHistoryItem, isValidHistoryItem } from '@/config/types';

/** 一条刚好满足导入门槛的最小记录 */
function minimalImportable(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: 1_700_000_000_000,
    localFileName: 'a.png',
    primaryService: 'weibo',
    generatedLink: 'https://img.example.com/a.png',
    results: [],
    ...overrides,
  };
}

describe('isImportableHistoryItem', () => {
  it('接受最小合法记录', () => {
    expect(isImportableHistoryItem(minimalImportable())).toBe(true);
  });

  it('刻意放行缺 id 的记录（底层会自动补 id）', () => {
    // 这条是硬约束：ImportExportService 里「预处理：确保所有记录都有 ID」的兼容逻辑
    // 只有在谓词放行缺 id 记录时才可达。若把 id 列为必需，那段代码会变成死代码，
    // 手写/第三方导出的历史文件会被整份拒绝。
    const record = minimalImportable();
    expect('id' in record).toBe(false);
    expect(isImportableHistoryItem(record)).toBe(true);
  });

  it.each([
    ['timestamp 为 0', { timestamp: 0 }],
    ['timestamp 为负', { timestamp: -1 }],
    ['timestamp 非数字', { timestamp: 'nope' }],
    ['timestamp 为 NaN', { timestamp: Number.NaN }],
    ['localFileName 为空串', { localFileName: '' }],
    ['localFileName 非字符串', { localFileName: 123 }],
    ['primaryService 为空串', { primaryService: '' }],
    ['generatedLink 非字符串', { generatedLink: null }],
    ['results 不是数组', { results: {} }],
  ])('拒绝 %s', (_label, override) => {
    expect(isImportableHistoryItem(minimalImportable(override))).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['数组', []],
    ['字符串', 'nope'],
  ])('拒绝非对象输入：%s', (_label, value) => {
    expect(isImportableHistoryItem(value)).toBe(false);
  });

  it('刻意不对 results 逐项深检——导出侧不校验，深检会打破无损往返', () => {
    // 导出侧（exportHistoryToJson）对内容零校验，一旦导入比导出严，PicNexus 自己
    // 导出的文件就可能导不回来；replace 模式下还会连带删掉本地同 id 的行。
    const record = minimalImportable({ results: [{ garbage: true }] });
    expect(isImportableHistoryItem(record)).toBe(true);
  });

  // results 条目必须是**非空对象**：`[null]`/`[5]` 这类脏数据会在 DataTransformer 派生
  // 存量的 success_count 列时被 isUsableMirror(null) 访问 r.status 抛 TypeError——
  // 导入无事务包裹，超过 500 条会先写几批再崩。
  it.each([
    ['results 含 null', [null]],
    ['results 含数字', [5]],
    ['results 含字符串', ['nope']],
    ['results 含数组条目', [[]]],
    ['results 含 undefined', [undefined]],
  ])('拒绝 %s', (_label, badEntry) => {
    expect(isImportableHistoryItem(minimalImportable({ results: badEntry }))).toBe(false);
  });
});

describe('isValidHistoryItem 与 isImportableHistoryItem 的分工', () => {
  it('isValidHistoryItem 判「完整 HistoryItem 形状」，因此要求 id 且深检 results', () => {
    const noId = minimalImportable();
    expect(isImportableHistoryItem(noId)).toBe(true);
    expect(isValidHistoryItem(noId)).toBe(false);

    const badResults = minimalImportable({ id: 'x', results: [{ garbage: true }] });
    expect(isImportableHistoryItem(badResults)).toBe(true);
    expect(isValidHistoryItem(badResults)).toBe(false);
  });

  it('两者对同一条完整合法记录都为真', () => {
    const full = minimalImportable({
      id: 'x',
      results: [{ serviceId: 'weibo', status: 'success' }],
    });
    expect(isImportableHistoryItem(full)).toBe(true);
    expect(isValidHistoryItem(full)).toBe(true);
  });
});
