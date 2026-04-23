import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';

// mock primevue/usetoast
const primeToastMock = {
  add: vi.fn(),
  removeGroup: vi.fn(),
  remove: vi.fn(),
};

vi.mock('primevue/usetoast', () => ({
  useToast: () => primeToastMock,
}));

import { useUndoToast } from '../../../composables/useUndoToast';

function harness() {
  let api: ReturnType<typeof useUndoToast> | null = null;
  const Harness = defineComponent({
    setup() {
      api = useUndoToast();
      return () => h('div');
    },
  });
  const wrapper = mount(Harness);
  return { wrapper, api: () => api! };
}

describe('useUndoToast', () => {
  beforeEach(() => {
    primeToastMock.add.mockReset();
    primeToastMock.removeGroup.mockReset();
    vi.useFakeTimers();
  });

  it('show 显示带 undo 分组的 toast', () => {
    const h = harness();
    h.api().show('确认删除', 3);
    expect(primeToastMock.add).toHaveBeenCalledWith(expect.objectContaining({
      group: 'undo',
      severity: 'error',
      closable: false,
    }));
    expect(h.api().state.summary).toBe('确认删除');
    expect(h.api().state.remaining).toBe(3);
  });

  it('倒计时结束后 resolve(true)', async () => {
    const h = harness();
    const p = h.api().show('delete', 2);
    // 第一次 tick：remaining=1
    vi.advanceTimersByTime(1000);
    expect(h.api().state.remaining).toBe(1);
    // 第二次 tick：remaining=0 → resolve(true)，removeGroup
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBe(true);
    expect(primeToastMock.removeGroup).toHaveBeenCalledWith('undo');
  });

  it('cancel 停止计时并 resolve(false) + 显示"已撤销"提示', async () => {
    const h = harness();
    const p = h.api().show('delete', 5);
    h.api().cancel();
    await expect(p).resolves.toBe(false);
    // removeGroup + 一条 success toast
    expect(primeToastMock.removeGroup).toHaveBeenCalledWith('undo');
    expect(primeToastMock.add).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'success',
      summary: '已撤销',
    }));
  });

  it('重复 show 取消前一轮 toast', async () => {
    const h = harness();
    const p1 = h.api().show('first', 5);
    h.api().show('second', 5);
    await expect(p1).resolves.toBe(false);
  });

  it('show 默认 seconds=5', () => {
    const h = harness();
    h.api().show('x');
    expect(h.api().state.remaining).toBe(5);
  });

  it('cancel 在无进行中的 show 时不抛错', () => {
    const h = harness();
    expect(() => h.api().cancel()).not.toThrow();
  });
});
