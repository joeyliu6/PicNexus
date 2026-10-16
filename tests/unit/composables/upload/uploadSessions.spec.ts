import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@/core/UploadQueue';
import {
  firstFailure, hasLink, hostFailureText, hostMisses, itemPhase, petalStates, sessionCounts,
} from '@/composables/upload/uploadSessions';

function item(status: QueueItem['status'], hosts: Record<string, { status: string; progress?: number; link?: string; error?: string }>): QueueItem {
  return {
    id: Math.random().toString(36).slice(2),
    fileName: 'a.png',
    filePath: 'C:/a.png',
    enabledServices: Object.keys(hosts),
    status,
    serviceProgress: Object.fromEntries(Object.entries(hosts).map(([id, h]) => [id, { serviceId: id, progress: h.progress ?? 0, ...h }])),
  };
}

const done = { status: '✓ 完成', progress: 100, link: 'https://x/a.png' };
const failed = { status: '✗ 失败', error: '登录已过期' };
const waiting = { status: '等待中...' };
const uploading = { status: '上传中 40%', progress: 40 };

describe('uploadSessions', () => {
  it('lights one petal per finished host and turns the failed host red', () => {
    expect(petalStates(item('uploading', { jd: done, r2: uploading, weibo: waiting }))).toEqual(['ok', 'uploading', 'waiting']);
    expect(petalStates(item('success', { jd: done, r2: done, weibo: failed }))).toEqual(['ok', 'ok', 'failed']);
  });

  it('treats a format-skipped host as an empty petal, not a failure', () => {
    const skipped = item('success', { jd: done, smms: { status: '已跳过（不支持 .svg）', error: '该图床不支持 .svg 格式' } });
    expect(petalStates(skipped)).toEqual(['ok', 'empty']);
    expect(itemPhase(skipped)).toBe('done');
  });

  it('tells uploading, done, partial and failed apart', () => {
    expect(itemPhase(item('uploading', { jd: done, r2: uploading }))).toBe('uploading');
    expect(itemPhase(item('success', { jd: done, r2: done }))).toBe('done');
    expect(itemPhase(item('success', { jd: done, weibo: failed }))).toBe('partial');
    expect(itemPhase(item('error', { jd: failed, weibo: failed }))).toBe('failed');
  });

  it('has a link as soon as the first host finishes', () => {
    expect(hasLink(item('uploading', { jd: done, r2: uploading }))).toBe(true);
    expect(hasLink(item('uploading', { jd: uploading }))).toBe(false);
  });

  it('counts a batch image as done when at least one host has it', () => {
    const counts = sessionCounts([
      item('success', { jd: done, weibo: failed }),
      item('error', { jd: failed, weibo: failed }),
      item('uploading', { jd: uploading, weibo: waiting }),
      item('pending', { jd: waiting, weibo: waiting }),
    ]);
    expect(counts).toEqual({ total: 4, done: 1, failed: 1, uploading: 1, waiting: 1 });
  });

  // 交接说明 4.9：某个图床没传上只报一行并写清几张；整张都失败的那几张另有一行，这里不重复算
  it('groups the images each host missed, leaving whole failures to their own line', () => {
    const batch = [
      item('success', { jd: done, weibo: { status: '✗ 失败', error: '401' } }),
      item('success', { jd: done, weibo: done }),
      item('error', { jd: failed, weibo: failed }),
      item('success', { jd: done, weibo: failed }),
    ];
    expect(hostMisses(batch)).toEqual([{ hostId: 'weibo', items: [batch[0], batch[3]], error: '401' }]);
    expect(hostMisses([batch[1]])).toEqual([]);
  });

  it('picks the first failed host for the reason line', () => {
    expect(firstFailure(item('success', { jd: done, weibo: failed }))).toMatchObject({ id: 'weibo', error: '登录已过期' });
  });

  it('words a host failure by how that host logs in', () => {
    const hosts = [{ id: 'weibo', cookieLogin: true }, { id: 'r2', cookieLogin: false }];
    expect(hostFailureText('weibo', '微博上传失败: 认证失败: 401', hosts).reason).toBe('登录已过期');
    expect(hostFailureText('r2', '403 forbidden', hosts).reason).toBe('凭证无效');
    expect(hostFailureText('r2', undefined, hosts)).toEqual({ reason: '上传失败', advice: '请稍后重试' });
  });
});
