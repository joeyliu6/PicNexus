// 托盘上的上传进度（T02 / T07）：状态行的数字与托盘图标逐片点亮
import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@/core/UploadQueue';
import { TRAY_PETAL_OPACITY, trayIconOpacities, trayUploadStatus } from '@/tray/trayProgress';

type HostRecord = Record<string, { status: string; progress?: number; link?: string; error?: string }>;

function item(fileName: string, status: QueueItem['status'], hosts: HostRecord): QueueItem {
  return {
    id: fileName,
    fileName,
    filePath: `C:/${fileName}`,
    enabledServices: Object.keys(hosts),
    status,
    serviceProgress: Object.fromEntries(Object.entries(hosts).map(([id, h]) => [id, { serviceId: id, progress: h.progress ?? 0, ...h }])),
  };
}

const done = { status: '✓ 完成', progress: 100, link: 'https://x/a.png' };
const failed = { status: '✗ 失败', error: '登录已过期' };
const waiting = { status: '等待中...' };
const uploading = { status: '上传中 40%', progress: 40 };
const { lit, uploading: half, waiting: dim, paused } = TRAY_PETAL_OPACITY;

describe('trayUploadStatus', () => {
  it('没有正在进行的上传：不出状态行', () => {
    expect(trayUploadStatus([])).toBeNull();
  });

  it('单张：文件名 + 已完成的图床数 / 图床数，一瓣一个图床', () => {
    expect(trayUploadStatus([item('架构图.png', 'uploading', { jd: done, r2: uploading, weibo: waiting })])).toEqual({
      subject: '架构图.png', done: 1, total: 3, petals: ['ok', 'uploading', 'waiting'],
    });
  });

  it('多张：「N 张」+ 已落定的张数 / 总张数（失败的也算落定）', () => {
    const status = trayUploadStatus([
      item('a.png', 'success', { jd: done, r2: done }),
      item('b.png', 'error', { jd: failed, r2: failed }),
      item('c.png', 'uploading', { jd: done, r2: uploading }),
      item('d.png', 'pending', { jd: waiting, r2: waiting }),
    ]);
    expect(status).toMatchObject({ subject: '4 张', done: 2, total: 4 });
  });

  it('多张时每瓣是一个图床在整批上的情况：都落定才算传完', () => {
    const status = trayUploadStatus([
      item('a.png', 'success', { jd: done, r2: done, weibo: failed, smms: waiting }),
      item('b.png', 'uploading', { jd: done, r2: uploading, weibo: failed, smms: waiting }),
    ]);
    expect(status?.petals).toEqual(['ok', 'uploading', 'failed', 'waiting']);
  });
});

describe('trayIconOpacities', () => {
  it('平时四瓣全亮；关闭全局快捷键时整体变淡（T07）', () => {
    expect(trayIconOpacities(null, false)).toEqual([lit, lit, lit, lit]);
    expect(trayIconOpacities(null, true)).toEqual([paused, paused, paused, paused]);
  });

  it('上传中按图床逐片点亮：传完全亮、上传中半亮、等待和空槽暗（T02）', () => {
    const upload = { subject: 'a.png', done: 1, total: 3, petals: ['ok', 'uploading', 'waiting'] as const };
    expect(trayIconOpacities({ ...upload, petals: [...upload.petals] }, false)).toEqual([lit, half, dim, dim]);
  });

  it('上传中不叠加「变淡」：进度优先', () => {
    expect(trayIconOpacities({ subject: 'a.png', done: 0, total: 1, petals: ['uploading'] }, true)).toEqual([half, dim, dim, dim]);
  });

  it('失败的图床也算落定（单色小图分不出红）', () => {
    expect(trayIconOpacities({ subject: 'a.png', done: 1, total: 2, petals: ['ok', 'failed'] }, false)).toEqual([lit, lit, dim, dim]);
  });

  it('超过 4 个图床：按落定的比例点亮，下一片半亮', () => {
    // 6 个里落定 4 个 = 2.67 片：亮 2 片，第 3 片半亮
    const petals = ['ok', 'ok', 'ok', 'failed', 'uploading', 'waiting'] as const;
    expect(trayIconOpacities({ subject: 'a.png', done: 3, total: 6, petals: [...petals] }, false)).toEqual([lit, lit, half, dim]);
  });
});
