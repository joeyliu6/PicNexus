import { beforeEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { __resetSidebarCollapseForTests, useSidebarCollapse } from '@/shell/useSidebarCollapse';

describe('useSidebarCollapse', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSidebarCollapseForTests();
  });

  it('collapses automatically below 1000px', () => {
    const width = ref(1400);
    const { collapsed } = useSidebarCollapse(width);
    expect(collapsed.value).toBe(false);
    width.value = 999;
    expect(collapsed.value).toBe(true);
  });

  it('toggles manually on wide windows and remembers the choice', () => {
    const width = ref(1400);
    const { collapsed, toggle } = useSidebarCollapse(width);
    toggle();
    expect(collapsed.value).toBe(true);
    expect(localStorage.getItem('picnexus-sidebar-collapsed')).toBe('1');
    __resetSidebarCollapseForTests();
    expect(useSidebarCollapse(width).collapsed.value).toBe(true);
  });

  it('ignores the toggle while the window is narrow', () => {
    const width = ref(800);
    const { collapsed, toggle } = useSidebarCollapse(width);
    toggle();
    expect(collapsed.value).toBe(true);
    width.value = 1400;
    expect(collapsed.value).toBe(false);
  });
});
