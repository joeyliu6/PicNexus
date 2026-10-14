import { describe, expect, it } from 'vitest';
import { buildRescueVerdict, type RescueVerdictInput } from '@/composables/md-rescue/rescueVerdict';

function input(overrides: Partial<RescueVerdictInput> = {}): RescueVerdictInput {
  return {
    phase: 'scanning',
    collectingFound: null,
    scan: { stage: 'complete', checked: 24, total: 24 },
    stats: { files: 3, images: 24, problems: 5, problemFiles: 2, manual: 1, repaired: 0 },
    fixable: 4,
    fixing: null,
    failedFiles: 0,
    failedReason: null,
    ...overrides,
  };
}

describe('buildRescueVerdict', () => {
  it('找文件中：说在找，给取消', () => {
    expect(buildRescueVerdict(input({ collectingFound: 12 }))).toMatchObject({
      tone: 'running',
      title: '正在找 Markdown 文件…',
      subtitle: '已找到 12 个',
      secondary: { action: 'cancel', label: '取消' },
    });
  });

  it('检查中：标题报进度，副标题报目前打不开的数量', () => {
    expect(buildRescueVerdict(input({ scan: { stage: 'checking', checked: 12, total: 24 } }))).toMatchObject({
      tone: 'running',
      title: '正在检查图片 · 12 / 24',
      subtitle: '在 3 个文档里 · 目前有 5 张打不开',
      primary: null,
      secondary: { action: 'cancel' },
    });
    expect(buildRescueVerdict(input({ scan: { stage: 'backups', checked: 24, total: 24 } })).title).toBe('正在找能用的备份…');
    expect(buildRescueVerdict(input({ scan: { stage: 'cancelling', checked: 12, total: 24 } }))).toMatchObject({
      title: '正在停止…', primary: null, secondary: null,
    });
  });

  it('查出打不开的、有能换的：主按钮直接修，提醒改前会自动备份', () => {
    expect(buildRescueVerdict(input())).toMatchObject({
      tone: 'error',
      title: '5 张图片打不开',
      subtitle: '在 2 个文档里 · 4 张可以换成备份 · 1 张没有备份',
      primary: { action: 'repair', label: '修复 4 张' },
      secondary: { action: 'reset', label: '换一批文档' },
      note: '修改前会自动备份原文件，改完可以撤销',
    });
    expect(buildRescueVerdict(input({ stats: { files: 3, images: 24, problems: 4, problemFiles: 2, manual: 0, repaired: 0 } })).tone)
      .toBe('warning');
  });

  it('打不开的都没有备份：不给修复按钮，说清要手动处理', () => {
    expect(buildRescueVerdict(input({ fixable: 0, stats: { files: 3, images: 24, problems: 2, problemFiles: 1, manual: 2, repaired: 0 } })))
      .toMatchObject({ title: '2 张图片打不开', subtitle: '在 1 个文档里 · 都没有能用的备份，要手动处理', primary: null, note: null });
  });

  it('检查中途停了：说清只查了多少', () => {
    expect(buildRescueVerdict(input({ scan: { stage: 'cancelled', checked: 10, total: 24 } })).subtitle)
      .toBe('在 2 个文档里 · 4 张可以换成备份 · 1 张没有备份 · 检查停在 10 / 24');
    expect(buildRescueVerdict(input({
      scan: { stage: 'cancelled', checked: 10, total: 24 },
      stats: { files: 3, images: 24, problems: 0, problemFiles: 0, manual: 0, repaired: 0 },
      fixable: 0,
    }))).toMatchObject({ tone: 'ok', title: '已检查的 10 张都能打开', subtitle: '检查停在 10 / 24' });
  });

  it('都能打开 / 文档里没有图片：各说各的，只给「换一批文档」', () => {
    const fine = buildRescueVerdict(input({ stats: { files: 3, images: 24, problems: 0, problemFiles: 0, manual: 0, repaired: 0 }, fixable: 0 }));
    expect(fine).toMatchObject({ tone: 'ok', title: '24 张图片都能打开', subtitle: '检查了 3 个文档', primary: null });
    expect(fine.secondary).toEqual({ action: 'reset', label: '换一批文档' });

    expect(buildRescueVerdict(input({ stats: { files: 2, images: 0, problems: 0, problemFiles: 0, manual: 0, repaired: 0 }, fixable: 0 })))
      .toMatchObject({ tone: 'neutral', title: '这些文档里没有图片', subtitle: '检查了 2 个文档' });
  });

  it('修复中：按文档报进度', () => {
    expect(buildRescueVerdict(input({ phase: 'fixing', fixing: { current: 1, total: 2 } }))).toMatchObject({
      tone: 'running', title: '正在修复 · 1 / 2 个文档', secondary: { action: 'cancel' },
    });
  });

  it('修好了：一句结论，「完成」为主，「撤销」随时在', () => {
    expect(buildRescueVerdict(input({ phase: 'done', stats: { files: 3, images: 24, problems: 5, problemFiles: 2, manual: 1, repaired: 4 } })))
      .toMatchObject({
        tone: 'ok',
        title: '已修复 4 张图片',
        subtitle: '原文件已备份，可以撤销 · 1 张没有备份，要手动处理',
        primary: { action: 'finish', label: '完成' },
        secondary: { action: 'undo', label: '撤销' },
      });
  });

  it('写入错误说成人话，系统错误码不上卡片', () => {
    const subtitleFor = (failedReason: string) => buildRescueVerdict(input({
      phase: 'done', failedFiles: 1, failedReason,
      stats: { files: 3, images: 24, problems: 5, problemFiles: 2, manual: 1, repaired: 2 },
    })).subtitle;
    expect(subtitleFor('EACCES: permission denied, open')).toBe('没有写入权限 · 改好的可以撤销');
    expect(subtitleFor('EPERM')).toBe('没有写入权限 · 改好的可以撤销');
    expect(subtitleFor('EBUSY: resource busy or locked')).toBe('文件被其他程序占用 · 改好的可以撤销');
    expect(subtitleFor('ENOENT: no such file')).toBe('文件找不到了 · 改好的可以撤销');
    expect(subtitleFor('something odd happened')).toBe('写入时出错 · 改好的可以撤销');
  });

  it('有文档没写进去：如实说，并给出原因', () => {
    expect(buildRescueVerdict(input({
      phase: 'done',
      stats: { files: 3, images: 24, problems: 5, problemFiles: 2, manual: 1, repaired: 2 },
      failedFiles: 1,
      failedReason: '文件被其他程序占用',
    }))).toMatchObject({
      tone: 'warning',
      title: '修复了 2 张，1 个文档没改成',
      subtitle: '文件被其他程序占用 · 改好的可以撤销',
    });
  });
});
