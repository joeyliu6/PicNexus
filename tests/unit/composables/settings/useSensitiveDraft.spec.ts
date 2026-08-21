import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import {
  useSensitiveDraft,
  CLEAR_TO_DELETE_PLACEHOLDER,
  type SensitiveDraftOptions,
  type SensitiveDraft,
} from '@/composables/settings/useSensitiveDraft';

/**
 * 在 effect scope 里构造，和组件里的真实环境一致。
 * 少了它，内部的 useCopyBadgeFeedback 会因为 onScopeDispose 找不到作用域而告警，
 * 保存反馈的定时器也不会随组件卸载被清掉。
 */
const scopes: EffectScope[] = [];

function inScope(build: () => SensitiveDraft): SensitiveDraft {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(build) as SensitiveDraft;
}

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
});

/** 一个最小的后端替身：stored 就是"已落盘"的值 */
function setup(over: Partial<SensitiveDraftOptions> = {}) {
  const stored: Record<string, string> = {};
  const commit = vi.fn((key: string, draft: string) => {
    stored[key] = draft;
  });
  const reveal = vi.fn(async (key: string) => stored[key] ?? '');

  // 默认「同意清除」：绝大多数用例不关心确认框，关心的那几条自己覆盖
  const confirmClear = vi.fn(async () => true);

  const options: SensitiveDraftOptions = {
    hasStored: (key: string) => !!stored[key],
    reveal,
    commit,
    confirmClear,
    ...over,
  };

  return { stored, commit, reveal, confirmClear, draft: inScope(() => useSensitiveDraft(options)) };
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
    expect(draft.placeholder('smms.token', '从 SM.MS 官网获取')).toBe(CLEAR_TO_DELETE_PLACEHOLDER);
  });

  describe('bindingsFor', () => {
    it('一次给齐 SensitiveField 需要的六个 prop', () => {
      const { draft, stored } = setup();
      stored['smms.token'] = 'tok-123';

      const bound = draft.bindingsFor('smms.token', '从 SM.MS 官网获取');

      expect(bound.modelValue).toBe('');
      expect(bound.hasStoredValue).toBe(true);
      expect(bound.revealStored).toBeTypeOf('function');
      expect(bound.placeholder).toBe(CLEAR_TO_DELETE_PLACEHOLDER);
    });

    it('绑定的监听器改的是同一份草稿', async () => {
      const { draft, stored, commit } = setup();

      draft.bindingsFor('smms.token', 'hint')['onUpdate:modelValue']('typed');
      expect(draft.draftOf('smms.token')).toBe('typed');
      // 重新取一次 bindings，modelValue 要反映最新草稿
      expect(draft.bindingsFor('smms.token', 'hint').modelValue).toBe('typed');

      draft.bindingsFor('smms.token', 'hint').onBlur();
      await Promise.resolve();
      await Promise.resolve();

      expect(commit).toHaveBeenCalledWith('smms.token', 'typed');
      expect(stored['smms.token']).toBe('typed');
    });

    it('未存过值时 revealStored 为 null', () => {
      const { draft } = setup();
      expect(draft.bindingsFor('smms.token', 'hint').revealStored).toBeNull();
      expect(draft.bindingsFor('smms.token', 'hint').placeholder).toBe('hint');
    });
  });

  // 聚焦即取值：让输入框变回普通密码框——想改一个字符就改一个字符，不用整串重打
  describe('beginEdit（聚焦取值）', () => {
    it('把已存的值取出来填进草稿', async () => {
      const { draft, stored, reveal } = setup();
      stored['smms.token'] = 'ghp_original';

      await draft.beginEdit('smms.token');

      expect(reveal).toHaveBeenCalledWith('smms.token');
      expect(draft.draftOf('smms.token')).toBe('ghp_original');
    });

    // 这条是旧「明文不进 modelValue」结构性保证的替身，最关键
    it('取出来一个字符没动就失焦 —— 不写盘', async () => {
      const { draft, commit, stored } = setup();
      stored['webdav.pw'] = 'unchanged-secret';

      await draft.beginEdit('webdav.pw');
      // 先确认真的取出来了，否则下面的断言会因为"草稿是空的"而假通过
      expect(draft.draftOf('webdav.pw')).toBe('unchanged-secret');

      await draft.commitDraft('webdav.pw');

      expect(commit).not.toHaveBeenCalled();
      // 草稿要清干净，否则框里会留着明文、圆点也回不来
      expect(draft.draftOf('webdav.pw')).toBe('');
    });

    it('改了一个字符 → 提交改后的完整值', async () => {
      const { draft, stored, commit } = setup();
      stored['smms.token'] = 'ghp_original';

      await draft.beginEdit('smms.token');
      draft.setDraft('smms.token', 'ghp_originaX');
      await draft.commitDraft('smms.token');

      expect(commit).toHaveBeenCalledWith('smms.token', 'ghp_originaX');
      expect(stored['smms.token']).toBe('ghp_originaX');
    });

    // 「点眼睛看一眼 → 顺手点进去改」这条路上，明文已经在手上了
    it('传入已知明文时直接用，不再解密一次', async () => {
      const { draft, stored, reveal } = setup();
      stored['webdav.pw'] = 'cipher-only';

      await draft.beginEdit('webdav.pw', 'already-decrypted');

      expect(reveal).not.toHaveBeenCalled();
      expect(draft.draftOf('webdav.pw')).toBe('already-decrypted');
    });

    // 这条路径漏记 originals 的话，看一眼就会被判成"改过了"而重新加密写回
    it('传入已知明文后原样失焦 —— 同样不写盘', async () => {
      const { draft, commit, stored } = setup();
      stored['webdav.pw'] = 'cipher-only';

      await draft.beginEdit('webdav.pw', 'already-decrypted');
      await draft.commitDraft('webdav.pw');

      expect(commit).not.toHaveBeenCalled();
      expect(draft.draftOf('webdav.pw')).toBe('');
    });

    it('没存过的字段不取值 —— 本来就是空框输入', async () => {
      const { draft, reveal } = setup();

      await draft.beginEdit('smms.token');

      expect(reveal).not.toHaveBeenCalled();
      expect(draft.draftOf('smms.token')).toBe('');
    });

    it('已经在编辑时重复聚焦不覆盖草稿', async () => {
      const { draft, stored, reveal } = setup();
      stored['smms.token'] = 'ghp_original';

      await draft.beginEdit('smms.token');
      draft.setDraft('smms.token', '我改了一半');
      await draft.beginEdit('smms.token');

      expect(reveal).toHaveBeenCalledTimes(1);
      expect(draft.draftOf('smms.token')).toBe('我改了一半');
    });

    it('取值失败时草稿保持空，且失焦不会清掉已存的值', async () => {
      const failure = new Error('decrypt failed');
      const onRevealError = vi.fn();
      const stored: Record<string, string> = { 'webdav.pw': 'cipher' };
      const commit = vi.fn();
      const draft = inScope(() => useSensitiveDraft({
        hasStored: () => true,
        reveal: () => Promise.reject(failure),
        commit,
        onRevealError,
      }));

      await draft.beginEdit('webdav.pw');

      expect(onRevealError).toHaveBeenCalledWith(failure, 'webdav.pw');
      expect(draft.draftOf('webdav.pw')).toBe('');

      // 空草稿 → 不提交。解不开也绝不能把已存的值抹掉，那才是真正的丢数据
      await draft.commitDraft('webdav.pw');
      expect(commit).not.toHaveBeenCalled();
      expect(stored['webdav.pw']).toBe('cipher');
    });

    it('解密返回前用户已经开始打字 → 不覆盖用户输入', async () => {
      let release: (value: string) => void = () => {};
      const draft = inScope(() => useSensitiveDraft({
        hasStored: () => true,
        reveal: () => new Promise<string>(resolve => { release = resolve; }),
        commit: vi.fn(),
      }));

      const pending = draft.beginEdit('webdav.pw');
      draft.setDraft('webdav.pw', '手快先敲的');
      release('慢吞吞解出来的');
      await pending;

      expect(draft.draftOf('webdav.pw')).toBe('手快先敲的');
    });

    it('取值期间 isLoading 为真，结束后转假', async () => {
      let release: (value: string) => void = () => {};
      const draft = inScope(() => useSensitiveDraft({
        hasStored: () => true,
        reveal: () => new Promise<string>(resolve => { release = resolve; }),
        commit: vi.fn(),
      }));

      expect(draft.isLoading('webdav.pw')).toBe(false);
      const pending = draft.beginEdit('webdav.pw');
      expect(draft.isLoading('webdav.pw')).toBe(true);

      release('secret');
      await pending;
      expect(draft.isLoading('webdav.pw')).toBe(false);
    });
  });

  describe('chipLabel（保存反馈）', () => {
    it('提交成功后短暂变「已更新」，到点回「已保存」', async () => {
      vi.useFakeTimers();
      const { draft } = setup();

      expect(draft.chipLabel('smms.token')).toBe('已保存');

      draft.setDraft('smms.token', 'new-token');
      await draft.commitDraft('smms.token');

      // 改了却什么反馈都没有，用户没法确认这一下存住了
      expect(draft.chipLabel('smms.token')).toBe('已更新');

      vi.advanceTimersByTime(2000);
      expect(draft.chipLabel('smms.token')).toBe('已保存');
      vi.useRealTimers();
    });

    it('只有刚保存的那个字段显示「已更新」', async () => {
      const { draft } = setup();

      draft.setDraft('a', 'value-a');
      await draft.commitDraft('a');

      expect(draft.chipLabel('a')).toBe('已更新');
      expect(draft.chipLabel('b')).toBe('已保存');
    });

    it('没改动而跳过提交时不冒充「已更新」', async () => {
      const { draft, stored } = setup();
      stored['smms.token'] = 'untouched';

      await draft.beginEdit('smms.token');
      expect(draft.draftOf('smms.token')).toBe('untouched');

      await draft.commitDraft('smms.token');

      expect(draft.chipLabel('smms.token')).toBe('已保存');
    });
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
  /**
   * 「框是空的」有四种来路，四种结果各不相同。这一组把四种全钉住。
   *
   * 改这套逻辑之前先想清楚：一律不删 → 用户永远删不掉已存的凭证（这正是修改前的
   * 表现）；一律删 → 解密抖一下就把好凭证抹了。中间那条线全靠 originals 这笔账。
   */
  describe('清空即删除', () => {
    /** 模拟真实交互：点进框（取出真值）→ 全选删光 → 离开 */
    async function focusThenClear(draft: SensitiveDraft, key: string) {
      await draft.beginEdit(key);
      draft.setDraft(key, '');
      await draft.commitDraft(key);
    }

    it('看到真值后清空 → 确认后真的删掉', async () => {
      const { draft, stored, commit, confirmClear } = setup();
      stored['smms.token'] = 'tok-123';

      await focusThenClear(draft, 'smms.token');

      expect(confirmClear).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith('smms.token', '');
      expect(stored['smms.token']).toBe('');
      expect(draft.hasStored('smms.token')).toBe(false);
    });

    it('确认框里点取消 → 原值一个字节都不动', async () => {
      const { draft, stored, commit } = setup({ confirmClear: vi.fn(async () => false) });
      stored['smms.token'] = 'tok-123';

      await focusThenClear(draft, 'smms.token');

      expect(commit).not.toHaveBeenCalled();
      expect(stored['smms.token']).toBe('tok-123');
      // 草稿留空，圆点会自己回来
      expect(draft.draftOf('smms.token')).toBe('');
    });

    /**
     * 解密失败时真值压根没进过框。这时的空框不是「用户删了」，
     * 当成删除就会把一把解不开、但确实存在的钥匙抹掉——用户毫无察觉。
     */
    it('解密失败留下的空框 → 不删、也不问', async () => {
      const onRevealError = vi.fn();
      const { draft, stored, commit, confirmClear } = setup({
        reveal: vi.fn(async () => { throw new Error('解不开'); }),
        onRevealError,
      });
      stored['smms.token'] = 'tok-123';

      await focusThenClear(draft, 'smms.token');

      expect(onRevealError).toHaveBeenCalled();
      expect(confirmClear).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(stored['smms.token']).toBe('tok-123');
    });

    /**
     * 在设置页一路 Tab 会大量制造这条路径：点进去、解密还没回来、焦点就走了。
     * 这是最容易被误伤的一种，而且用户根本不知道自己"删"过东西。
     */
    it('解密还没回来人就走了 → 不删、也不问', async () => {
      const { draft, stored, commit, confirmClear } = setup();
      stored['smms.token'] = 'tok-123';

      // 不 await beginEdit：模拟解密在途中就失焦
      void draft.beginEdit('smms.token');
      await draft.commitDraft('smms.token');

      expect(confirmClear).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(stored['smms.token']).toBe('tok-123');
    });

    it('从没存过值的空框 → 什么也不发生', async () => {
      const { draft, commit, confirmClear } = setup();

      await draft.beginEdit('smms.token');
      await draft.commitDraft('smms.token');

      expect(confirmClear).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    });

    it('清除失败时草稿保持空着，让用户看得出这下没成', async () => {
      const onCommitError = vi.fn();
      const { draft, stored } = setup({
        commit: vi.fn(() => Promise.reject(new Error('写盘失败'))),
        onCommitError,
      });
      stored['smms.token'] = 'tok-123';

      await focusThenClear(draft, 'smms.token');

      expect(onCommitError).toHaveBeenCalled();
      expect(draft.draftOf('smms.token')).toBe('');
    });

    /** 点眼睛看过之后再删，跟直接点进框里删是同一条路 */
    it('点过眼睛拿到明文后清空 → 同样能删', async () => {
      const { draft, stored, commit } = setup();
      stored['smms.token'] = 'tok-123';

      await draft.beginEdit('smms.token', 'tok-123');
      draft.setDraft('smms.token', '');
      await draft.commitDraft('smms.token');

      expect(commit).toHaveBeenCalledWith('smms.token', '');
      expect(stored['smms.token']).toBe('');
    });
  });
});
