/**
 * 回归测试（钉住当前行为，见 docs/audits/scan-config-mirror-2026-09-07.md P1-2）：
 *
 * 切主图床 / 移除镜像不改 timestamp，mergeHistoryCollections(cloud, local) 同 id 同
 * timestamp 时以「基准集合」（baseItems）一方为准 → 常规同步路径会把这类内容层改动
 * 判为「无变化」而跳过。这是当前设计下的真实行为，不是本测试要修的 bug——
 * docs/flows/mirror-fallback-flow.md 边界 12 已同步改写为准确描述。
 * 这条测试的作用是防止以后有人在不知情的情况下悄悄改动 mergeHistoryItem 的
 * 判定逻辑，导致文档描述与代码再次脱节。
 */
import { describe, expect, it } from 'vitest';
import { mergeHistoryCollections } from '@/services/database/HistoryMerge';
import type { HistoryItem } from '@/config/types';

function item(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 'h1',
    timestamp: 1_710_000_000_000,
    localFileName: 'pic.png',
    primaryService: 'jd',
    generatedLink: 'https://jd.example/pic.png',
    results: [
      { serviceId: 'jd', status: 'success', result: { serviceId: 'jd', url: 'https://jd.example/pic.png' } },
      { serviceId: 'qiyu', status: 'success', result: { serviceId: 'qiyu', url: 'https://qiyu.example/pic.png' } },
    ],
    ...overrides,
  } as HistoryItem;
}

describe('云端合并对镜像改动的处理', () => {
  const cloud = item({});
  // 本地：切主到 qiyu 并移除了 jd
  const local = item({
    primaryService: 'qiyu',
    generatedLink: 'https://qiyu.example/pic.png',
    results: [
      { serviceId: 'qiyu', status: 'success', result: { serviceId: 'qiyu', url: 'https://qiyu.example/pic.png' } },
    ],
  });

  it('上传方向 merge(cloud, local)：云端旧记录胜出，updatedCount 为 0', () => {
    const { items, addedCount, updatedCount } = mergeHistoryCollections([cloud], [local]);
    expect(addedCount).toBe(0);
    expect(updatedCount).toBe(0);
    expect(items[0].primaryService).toBe('jd');
    expect(items[0].results.map(r => r.serviceId)).toEqual(['jd', 'qiyu']);
  });

  it('下载方向 merge(local, cloud)：本地胜出，合并不会把死链接带回来', () => {
    const { items, updatedCount } = mergeHistoryCollections([local], [cloud]);
    expect(updatedCount).toBe(0);
    expect(items[0].primaryService).toBe('qiyu');
    expect(items[0].results.map(r => r.serviceId)).toEqual(['qiyu']);
  });
});
