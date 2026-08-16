import { describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useHistoryBadgeLayout } from '@/composables/history/useHistoryBadgeLayout';

type BadgeLayout = ReturnType<typeof useHistoryBadgeLayout>;

/**
 * 在真实组件实例里跑，避免 onUnmounted 脱离 setup 触发 Vue 警告
 * （badgeColumnWidth 默认 200；不挂 DOM 就不会被 ResizeObserver 改写）
 */
function setup(): BadgeLayout {
  let api!: BadgeLayout;
  mount(defineComponent({
    setup() {
      api = useHistoryBadgeLayout(ref(null));
      return () => null;
    },
  }));
  return api;
}

/**
 * 徽章宽度估算必须与 history-table.css 的 `.badge-label { max-width: 96px }` 同步封顶。
 *
 * profile 查不到时 getServiceDisplayName 会返回 `WebDAV (<原始ID>)`，
 * ID 越长名字越长——这是构造超长显示名最直接的杠杆。
 */
describe('useHistoryBadgeLayout · 长图床名的徽章估算', () => {
  /** 不封顶时估算 = 16 + 18 + 128 * 6 ≈ 802px，单个徽章就吃满整列 */
  const veryLongIds = [
    `webdav:${'x'.repeat(120)}`,
    `webdav:${'y'.repeat(120)}`,
    `webdav:${'z'.repeat(120)}`,
  ];

  it('超长名字不会把估算撑爆，仍能并排显示多个徽章', () => {
    const { getVisibleCount, badgeColumnWidth } = setup();
    badgeColumnWidth.value = 400;

    // 封顶后每个徽章估 16 + 18 + 96 = 130px，400px 放得下 3 个
    // 一旦 MAX_LABEL_WIDTH 被摘掉，这里会退化成 1
    expect(getVisibleCount(veryLongIds)).toBe(3);
  });

  it('列宽很窄时仍至少保留一个徽章', () => {
    const { getVisibleCount, badgeColumnWidth } = setup();
    badgeColumnWidth.value = 80;

    expect(getVisibleCount(veryLongIds)).toBe(1);
  });

  it('短名字不受封顶影响，按实际宽度排布', () => {
    const { getVisibleCount, badgeColumnWidth } = setup();
    badgeColumnWidth.value = 1000;

    expect(getVisibleCount(['weibo', 'github', 'smms'])).toBe(3);
  });
});
