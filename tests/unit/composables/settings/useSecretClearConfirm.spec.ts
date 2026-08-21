import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 确认框替身。`choice` 决定用户怎么关掉对话框，`tickOptOut` 模拟他勾没勾
 * 「本次运行内不再提示」——真实场景里那一勾是 App.vue 的 slot 写进
 * `options.clearOptOut.checked` 的，这里直接代劳。
 */
const state = vi.hoisted(() => ({
  choice: 'accept' as 'accept' | 'reject' | 'dismiss',
  tickOptOut: false,
  calls: 0,
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmThreeWay: vi.fn(async (options: { clearOptOut?: { checked: boolean } }) => {
      state.calls += 1;
      if (state.tickOptOut && options.clearOptOut) options.clearOptOut.checked = true;
      return state.choice;
    }),
  }),
}));

const { useSecretClearConfirm, resetSecretClearMuteForTest } =
  await import('@/composables/settings/useSecretClearConfirm');

beforeEach(() => {
  state.choice = 'accept';
  state.tickOptOut = false;
  state.calls = 0;
  resetSecretClearMuteForTest();
});

describe('useSecretClearConfirm', () => {
  it('点「清除」才返回 true', async () => {
    const confirmClear = useSecretClearConfirm();
    expect(await confirmClear()).toBe(true);
  });

  it('点「取消」返回 false', async () => {
    state.choice = 'reject';
    expect(await useSecretClearConfirm()()).toBe(false);
  });

  /**
   * PrimeVue 的 accept/reject 都不覆盖「按 ESC / 点叉叉」。这条路径当成「删」的话，
   * 用户想取消反而删掉了——判断不出来的时候必须倒向不删。
   */
  it('按 ESC / 点叉叉关掉 —— 不删', async () => {
    state.choice = 'dismiss';
    expect(await useSecretClearConfirm()()).toBe(false);
  });

  describe('本次运行内不再提示', () => {
    it('勾上并确认后，后续清除不再弹框', async () => {
      state.tickOptOut = true;
      const confirmClear = useSecretClearConfirm();

      expect(await confirmClear()).toBe(true);
      expect(state.calls).toBe(1);

      state.tickOptOut = false;
      expect(await confirmClear()).toBe(true);
      expect(await confirmClear()).toBe(true);
      expect(state.calls).toBe(1);  // 一次都没再弹
    });

    /**
     * 这条是这个功能最要紧的判据：勾了框但**点了取消**，那次交互的结论是
     * 「不要删」。顺手把保护也关掉不是用户的意思——下次误删就没人拦了。
     */
    it('勾上但点了取消 —— 不生效，下次照样弹', async () => {
      state.choice = 'reject';
      state.tickOptOut = true;
      const confirmClear = useSecretClearConfirm();

      expect(await confirmClear()).toBe(false);

      state.choice = 'accept';
      state.tickOptOut = false;
      expect(await confirmClear()).toBe(true);
      expect(state.calls).toBe(2);  // 第二次确实又弹了
    });

    it('勾上但按 ESC —— 同样不生效', async () => {
      state.choice = 'dismiss';
      state.tickOptOut = true;
      const confirmClear = useSecretClearConfirm();

      expect(await confirmClear()).toBe(false);

      state.choice = 'accept';
      state.tickOptOut = false;
      await confirmClear();
      expect(state.calls).toBe(2);
    });

    it('没勾就确认 —— 下次照样弹', async () => {
      const confirmClear = useSecretClearConfirm();

      await confirmClear();
      await confirmClear();

      expect(state.calls).toBe(2);
    });

    /**
     * 四个设置分组各自调一次 useSecretClearConfirm()。按实例记的话，
     * 在 S3 卡片点了「不再提示」、切到 Token 卡片又会弹——用户眼里就是没生效。
     */
    it('跨分组共享 —— 在一处勾上，另一处也不再弹', async () => {
      state.tickOptOut = true;
      const fromS3Card = useSecretClearConfirm();
      const fromTokenCard = useSecretClearConfirm();

      await fromS3Card();
      expect(state.calls).toBe(1);

      state.tickOptOut = false;
      await fromTokenCard();
      expect(state.calls).toBe(1);
    });
  });
});
