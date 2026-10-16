import { describe, expect, it } from 'vitest';
import { useHistoryViewState } from '@/composables/history/useHistoryViewState';

const click = (shiftKey = false) => ({ shiftKey }) as MouseEvent;
const ORDER = ['a', 'b', 'c', 'd'];

describe('useHistoryViewState', () => {
  it('toggles one image per click and selects a range with Shift in page order', () => {
    const state = useHistoryViewState();
    state.handleSelectClick('b', click(), ORDER);
    state.handleSelectClick('d', click(true), ORDER);
    expect(state.selectedIdList.value).toEqual(['b', 'c', 'd']);

    state.handleSelectClick('c', click(), ORDER);
    expect(state.selectedIdList.value).toEqual(['b', 'd']);
    expect(state.hasSelection.value).toBe(true);
  });

  // Esc 清空后再 Shift 单击，不该从清空前的那张连选过来
  it('forgets the Shift anchor when the selection is cleared', () => {
    const state = useHistoryViewState();
    state.handleSelectClick('a', click(), ORDER);
    state.clearSelection();
    expect(state.hasSelection.value).toBe(false);

    state.handleSelectClick('c', click(true), ORDER);
    expect(state.selectedIdList.value).toEqual(['c']);
  });

  // Ctrl·⌘ A 逐张 select：已选的不能被反选掉
  it('select only adds', () => {
    const state = useHistoryViewState();
    state.select('a');
    state.select('a');
    state.select('b');
    expect(state.selectedIdList.value).toEqual(['a', 'b']);
  });
});
