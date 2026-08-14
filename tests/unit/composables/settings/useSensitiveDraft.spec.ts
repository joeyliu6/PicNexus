import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useSensitiveDraft,
  KEEP_STORED_PLACEHOLDER,
  type SensitiveDraftOptions,
} from '@/composables/settings/useSensitiveDraft';

/** 一个最小的后端替身：stored 就是"已落盘"的值 */
function setup(over: Partial<SensitiveDraftOptions> = {}) {
  const stored: Record<string, string> = {};
  const commit = vi.fn((key: string, draft: string) => {
    stored[key] = draft;
  });
  const reveal = vi.fn(async (key: string) => stored[key] ?? '');

  const options: SensitiveDraftOptions = {
    hasStored: (key: string) => !!stored[key],
    reveal,
    commit,
    ...over,
  };

  return { stored, commit, reveal, draft: useSensitiveDraft(options) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSensitiveDraft', () => {
  it('记录草稿，提交成功后清空', async () => {
    const { draft, stored, commit } = setup();

    expect(draft.draftOf('smms.token')).toBe('');

    draft.setDraft('smms.token', 'tok-123');
    expect(draft.draftOf('smms.token')).toBe('tok-123');

    await draft.commitDraft('smms.token');

    expect(commit).toHaveBeenCalledWith('smms.token', 'tok-123');
    expect(stored['smms.token']).toBe('tok-123');
    // 草稿留在内存里就等于明文常驻，正是这套设计要避免的
    expect(draft.draftOf('smms.token')).toBe('');
  });

  it('空草稿不提交 —— 留空表示不修改已保存的值', async () => {
    const { draft, commit, stored } = setup();
    stored['smms.token'] = 'existing';

    await draft.commitDraft('smms.token');
    expect(commit).not.toHaveBeenCalled();

    draft.setDraft('smms.token', '');
    await draft.commitDraft('smms.token');
    expect(commit).not.toHaveBeenCalled();

    expect(stored['smms.token']).toBe('existing');
  });

  it('提交失败时保留草稿并回调 onCommitError', async () => {
    const failure = new Error('encrypt failed');
    const onCommitError = vi.fn();
    const { draft } = setup({
      commit: vi.fn(() => Promise.reject(failure)),
      onCommitError,
    });

    draft.setDraft('webdav.pw', 'secret');
    await draft.commitDraft('webdav.pw');

    expect(onCommitError).toHaveBeenCalledWith(failure, 'webdav.pw');
    // 抹掉用户刚输入的内容是二次伤害
    expect(draft.draftOf('webdav.pw')).toBe('secret');
  });

  it('提交失败且未传 onCommitError 时不向外抛', async () => {
    const { draft } = setup({ commit: vi.fn(() => Promise.reject(new Error('boom'))) });

    draft.setDraft('webdav.pw', 'secret');
    await expect(draft.commitDraft('webdav.pw')).resolves.toBeUndefined();
  });

  it('未存过值时 makeRevealer 返回 null —— 眼睛按钮随之禁用', () => {
    const { draft, stored } = setup();

    expect(draft.makeRevealer('smms.token')).toBeNull();
    expect(draft.hasStored('smms.token')).toBe(false);

    stored['smms.token'] = 'tok-123';
    expect(draft.makeRevealer('smms.token')).toBeTypeOf('function');
    expect(draft.hasStored('smms.token')).toBe(true);
  });

  it('revealer 引用稳定，且只在被调用时才取明文', async () => {
    const { draft, stored, reveal } = setup();
    stored['smms.token'] = 'tok-123';

    const first = draft.makeRevealer('smms.token');
    const second = draft.makeRevealer('smms.token');

    // 每次渲染都新建闭包会让 revealStored prop 每帧都"变化"
    expect(first).toBe(second);
    expect(reveal).not.toHaveBeenCalled();

    await expect(first?.()).resolves.toBe('tok-123');
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('缓存的 revealer 读的是当前值，不是创建时的快照', async () => {
    const { draft, stored } = setup();
    stored['smms.token'] = 'old';

    const revealer = draft.makeRevealer('smms.token');
    stored['smms.token'] = 'rotated';

    await expect(revealer?.()).resolves.toBe('rotated');
  });

  it('揭示失败时回调 onRevealError 并继续抛出', async () => {
    const failure = new Error('decrypt failed');
    const onRevealError = vi.fn();
    const { draft } = setup({
      hasStored: () => true,
      reveal: vi.fn(() => Promise.reject(failure)),
      onRevealError,
    });

    const revealer = draft.makeRevealer('webdav.pw');
    // 必须继续抛：SensitiveField 要靠它决定「不进入展示态」
    await expect(revealer?.()).rejects.toBe(failure);
    expect(onRevealError).toHaveBeenCalledWith(failure, 'webdav.pw');
  });

  it('揭示失败且未传 onRevealError 时仍然抛出', async () => {
    const failure = new Error('decrypt failed');
    const { draft } = setup({
      hasStored: () => true,
      reveal: vi.fn(() => Promise.reject(failure)),
    });

    await expect(draft.makeRevealer('webdav.pw')?.()).rejects.toBe(failure);
  });

  it('placeholder 按是否已存过切换文案', () => {
    const { draft, stored } = setup();

    expect(draft.placeholder('smms.token', '从 SM.MS 官网获取')).toBe('从 SM.MS 官网获取');

    stored['smms.token'] = 'tok-123';
    expect(draft.placeholder('smms.token', '从 SM.MS 官网获取')).toBe(KEEP_STORED_PLACEHOLDER);
  });

  it('多个 key 的草稿互不干扰', async () => {
    const { draft, stored } = setup();

    draft.setDraft('a', 'value-a');
    draft.setDraft('b', 'value-b');
    await draft.commitDraft('a');

    expect(stored).toEqual({ a: 'value-a' });
    expect(draft.draftOf('a')).toBe('');
    expect(draft.draftOf('b')).toBe('value-b');
  });
});
