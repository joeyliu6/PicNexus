import { describe, expect, it } from 'vitest';
import { buildDoneVerdict, buildRunVerdict, buildSetupVerdict, migrateFilterNote } from '@/composables/batch-migrate/migrateVerdict';
import type { MigrateItemStatus, MigrateSkipReason } from '@/types/batchMigrate';

const setup = (overrides: Partial<Parameters<typeof buildSetupVerdict>[0]> = {}) => buildSetupVerdict({
  targets: ['Cloudflare R2'],
  pending: 286,
  refreshing: false,
  noSource: false,
  publicTargets: [],
  filterNote: null,
  ...overrides,
});

const run = (overrides: Partial<Parameters<typeof buildRunVerdict>[0]> = {}) => buildRunVerdict({
  targets: ['Cloudflare R2'],
  done: 3,
  total: 18,
  success: 2,
  failed: 1,
  paused: false,
  pausing: false,
  cancelling: false,
  etaMs: 150_000,
  ...overrides,
});

function items(spec: { success?: number; failed?: number; partial?: number; skipped?: Array<MigrateSkipReason | undefined> }): MigrateItemStatus[] {
  const list: MigrateItemStatus[] = [];
  let n = 0;
  const push = (status: MigrateItemStatus['status'], skipReason?: MigrateSkipReason) => {
    n += 1;
    list.push({ historyId: `h${n}`, fileName: `${n}.jpg`, status, skipReason, serviceResults: {} });
  };
  for (let i = 0; i < (spec.success ?? 0); i++) push('success');
  for (let i = 0; i < (spec.failed ?? 0); i++) push('failed');
  for (const reason of spec.skipped ?? []) push('skipped', reason);
  return list;
}

/** spec.success 里含 spec.partial 张「部分目标失败」：引擎把它们记作成功，同时放进失败清单 */
const done = (spec: Parameters<typeof items>[0], pauseReason?: 'user-cancelled' | 'consecutive-failures' | 'runtime-error', retrying = 0) => {
  const snapshot = items(spec);
  const failures = [
    ...snapshot.filter((i) => i.status === 'failed'),
    ...snapshot.filter((i) => i.status === 'success').slice(0, spec.partial ?? 0),
  ].map((i) => ({
    historyId: i.historyId, fileName: i.fileName, error: 'x', details: [], isPartial: i.status === 'success',
  }));
  return buildDoneVerdict({
    targets: ['Cloudflare R2'],
    result: { successCount: spec.success ?? 0, failedCount: spec.failed ?? 0, pauseReason, itemsSnapshot: snapshot, failures, durationMs: 42_000 },
    retrying,
  });
};

describe('buildSetupVerdict', () => {
  it('还没选目标：说清这页能做什么，按钮先灰着并说明为什么', () => {
    const v = setup({ targets: [], pending: 0 });
    expect(v).toMatchObject({ tone: 'neutral', title: '给图片多存一份' });
    expect(v.subtitle).toBe('在下面选一个图床，把还没存到那里的图片复制过去；原来的图片不动');
    expect(v.primary).toEqual({ action: 'start', label: '开始备份', disabled: true, hint: '先在下面选一个图床' });
  });

  it('选好了：标题直接说要做什么，副标题说原图不动和大约多久', () => {
    const v = setup();
    expect(v.title).toBe('把 286 张图复制到 Cloudflare R2');
    expect(v.subtitle).toBe('原来的图片不动 · 大约 10 分钟');
    expect(v.primary).toEqual({ action: 'start', label: '开始备份' });
  });

  it('设了更多选项：副标题点出只备份哪些，免得用户忘了自己设过', () => {
    expect(setup({ filterNote: '来自京东 · 最近 30 天上传的' }).subtitle)
      .toBe('只备份来自京东 · 最近 30 天上传的 · 原来的图片不动 · 大约 10 分钟');
  });

  it('多个目标、公共图床：名字列全，并提醒公共图床的风险', () => {
    const v = setup({ targets: ['微博', 'GitHub'], publicTargets: ['微博'] });
    expect(v.title).toBe('把 286 张图复制到微博、GitHub');
    expect(v.note).toEqual({ tone: 'warning', text: '微博是公共图床：随时可能失效，单日上传数量也有限' });
  });

  it('都已经有了：不给开始按钮，说清没有要补的', () => {
    const v = setup({ pending: 0 });
    expect(v).toMatchObject({ tone: 'ok', title: '这些图片都已经存到 Cloudflare R2 了', subtitle: '没有要补的', primary: null });
    expect(setup({ pending: 0, filterNote: '最近 7 天上传的' }).subtitle).toBe('按现在的条件（最近 7 天上传的）没有要补的');
  });

  it('来源全取消了 / 正在重算：按钮灰着并说明原因', () => {
    expect(setup({ noSource: true })).toMatchObject({
      title: '没选来源图床',
      primary: { disabled: true, hint: '在「更多选项」里至少选一个来源图床' },
    });
    expect(setup({ refreshing: true })).toMatchObject({ title: '正在算要复制多少张…', primary: { disabled: true } });
  });
});

describe('buildRunVerdict', () => {
  it('进行中：标题报进度，副标题报成败与剩余时间，按钮是暂停 / 停止', () => {
    expect(run()).toMatchObject({
      tone: 'running',
      title: '正在备份到 Cloudflare R2 · 3 / 18',
      subtitle: '2 张已备份 · 1 张失败 · 预计还要 3 分钟',
      primary: { action: 'pause', label: '暂停' },
      secondary: { action: 'cancel', label: '停止' },
    });
  });

  it('暂停 / 正在暂停 / 正在停止：各说各的，不再给会打架的按钮', () => {
    expect(run({ paused: true })).toMatchObject({
      tone: 'paused', title: '已暂停 · 3 / 18', primary: { action: 'resume', label: '继续' }, secondary: { action: 'cancel' },
    });
    expect(run({ pausing: true })).toMatchObject({ title: '正在暂停…', subtitle: '手上这几张传完就停', primary: null });
    expect(run({ cancelling: true })).toMatchObject({ title: '正在停止…', subtitle: '已成功的会保留', primary: null, secondary: null });
  });
});

describe('buildDoneVerdict', () => {
  it('全部成功：一句结论 + 用时 + 完成', () => {
    expect(done({ success: 15, skipped: ['already-there'] })).toMatchObject({
      tone: 'ok',
      title: '已备份 15 张到 Cloudflare R2',
      subtitle: '另外 1 张本来就有 · 用时 42 秒',
      primary: { action: 'done', label: '完成' },
      secondary: null,
    });
  });

  it('有失败：主按钮重试失败的，失败原因在列表里', () => {
    expect(done({ success: 3, failed: 2, skipped: ['already-there'] })).toMatchObject({
      tone: 'warning',
      title: '3 张已备份，2 张没成功',
      subtitle: '1 张本来就有 · 失败的原因列在下面',
      primary: { action: 'retry-failed', label: '重试失败的 2 张' },
      secondary: { action: 'done', label: '完成' },
    });
  });

  it('部分目标没传上的也算没成功：卡片、失败清单、重试按钮三处数字一致', () => {
    expect(done({ success: 3, partial: 1, failed: 2, skipped: ['already-there'] })).toMatchObject({
      title: '2 张已备份，3 张没成功',
      subtitle: '其中 1 张只传成了一部分 · 1 张本来就有 · 失败的原因列在下面',
      primary: { action: 'retry-failed', label: '重试失败的 3 张' },
    });
  });

  it('停止后剩下的说「没处理」，不能说成「本来就有」', () => {
    const v = done({ success: 3, skipped: ['not-attempted', 'not-attempted', 'deleted', 'already-there'] }, 'user-cancelled');
    expect(v.title).toBe('已停止');
    expect(v.subtitle).toBe('3 张已备份 · 1 张本来就有 · 3 张没处理，下次开始会接着补');
  });

  it('连续失败自动停下：先让用户去查目标图床，重试放次要', () => {
    expect(done({ success: 1, failed: 5 }, 'consecutive-failures')).toMatchObject({
      tone: 'error',
      title: '连续失败，已自动停下',
      subtitle: '1 张已备份 · 5 张失败 · 可能是 Cloudflare R2 出了问题，先去设置里测一下连接',
      primary: { action: 'done' },
      secondary: { action: 'retry-failed', label: '重试失败的 5 张' },
    });
  });

  it('什么都不用传：说清本来就有', () => {
    expect(done({ skipped: ['already-there', 'not-needed'] }).title).toBe('这些图片在 Cloudflare R2 上本来就有');
  });

  it('正在重试：主按钮显示进度且不能再点', () => {
    expect(done({ success: 3, failed: 2 }, undefined, 2).primary).toEqual({
      action: 'retry-failed', label: '正在重试 2 张…', disabled: true,
    });
  });
});

describe('migrateFilterNote', () => {
  const DAY = 86_400_000;
  const NOW = Date.UTC(2026, 9, 14);
  const note = (overrides: Partial<Parameters<typeof migrateFilterNote>[0]> = {}) => migrateFilterNote({
    sourceNames: ['京东', '微博'],
    allSourcesSelected: true,
    timestampAfterMs: null,
    maxSuccessCount: 999,
    scope: 'all-backups',
    now: NOW,
    ...overrides,
  });

  it('什么都没设 → null（卡片上不出现「只备份……」）', () => {
    expect(note()).toBeNull();
  });

  it('设了几项就说几项，按「来源 · 时间 · 份数 · 范围」的顺序', () => {
    expect(note({ allSourcesSelected: false, sourceNames: ['京东'] })).toBe('来自京东');
    expect(note({ timestampAfterMs: NOW - 30 * DAY })).toBe('最近 30 天上传的');
    expect(note({ maxSuccessCount: 1 })).toBe('只有 1 份的');
    expect(note({ maxSuccessCount: 3 })).toBe('不超过 3 份的');
    expect(note({ scope: 'broken-with-valid-source' })).toBe('已经坏了一份的');
    expect(note({
      allSourcesSelected: false, sourceNames: ['京东'], timestampAfterMs: NOW - 7 * DAY, maxSuccessCount: 1,
    })).toBe('来自京东 · 最近 7 天上传的 · 只有 1 份的');
  });

  it('时间按最接近的整天数说，不说「最近 29.97 天」', () => {
    expect(note({ timestampAfterMs: NOW - 30 * DAY + 3_600_000 })).toBe('最近 30 天上传的');
  });
});
