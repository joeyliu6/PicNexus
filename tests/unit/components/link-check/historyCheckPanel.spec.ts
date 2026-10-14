import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks, useFakeTimers } from '../../helpers/wait';
import HistoryCheckPanel from '@/components/views/link-check/HistoryCheckPanel.vue';
import CheckImageList from '@/components/views/link-check/history-check/CheckImageList.vue';
import { createCheckLinkResult, createLinkCheckRow } from '../../factories/linkCheckFactory';
import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';

const toastSilent = vi.fn();
const toastError = vi.fn();

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ silent: toastSilent, error: toastError }),
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({ config: ref({}), getActivePrefix: vi.fn() }),
}));

const ok = () => createCheckLinkResult({ is_valid: true });
const gone = () => createCheckLinkResult({ is_valid: false, error_type: 'http_4xx', status_code: 404 });

function copy(historyId: string, serviceId: string, checkResult: CheckLinkResult | undefined, isPrimary = false): LinkCheckRow {
  return createLinkCheckRow({ historyId, serviceId, checkResult, isPrimary, fileName: `${historyId}.jpg`, checkedAt: Date.now() });
}

/** 一张能改用备份的（微博坏、京东好）、一张找不回的（纳米坏）、一张正常的（京东好、微博好） */
function mixedRows(): LinkCheckRow[] {
  return [
    copy('fixable', 'weibo', gone(), true),
    copy('fixable', 'jd', ok()),
    copy('lost', 'nami', gone(), true),
    copy('fine', 'jd', ok(), true),
    copy('fine', 'weibo', ok()),
  ];
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mountWithDefaults(HistoryCheckPanel, {
    props: {
      checkRows: [],
      isChecking: false,
      isPaused: false,
      isLoading: false,
      loadError: null,
      isPhase2Loading: false,
      progress: null,
      progressSource: null,
      isActionLocked: false,
      ...props,
    },
  });
}

const rowNames = (wrapper: VueWrapper) => wrapper.findAll('.image-row .row-name').map((n) => n.text());
const button = (wrapper: VueWrapper, label: string) => {
  const found = wrapper.findAll('button').find((b) => b.text() === label);
  if (!found) throw new Error(`没有找到按钮「${label}」，现有：${wrapper.findAll('button').map((b) => b.text()).join(' / ')}`);
  return found;
};

/** 行上的「⋯」菜单：取出它当前给的菜单项（Menu 是弹层，直接读它拿到的 model 最稳） */
async function openRowMenu(wrapper: VueWrapper, rowIndex: number): Promise<MenuItem[]> {
  await wrapper.findAll('.row-more')[rowIndex].trigger('click');
  return wrapper.findComponent(CheckImageList).findComponent(Menu).props('model') as MenuItem[];
}

beforeEach(() => {
  toastSilent.mockClear();
  toastError.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('HistoryCheckPanel', () => {
  it('首次加载：骨架与真实布局同形（结论卡 + 行）', () => {
    const wrapper = mountPanel({ isLoading: true });
    expect(wrapper.find('.lc-sk-card').exists()).toBe(true);
    expect(wrapper.findAll('.lc-sk-row')).toHaveLength(8);
  });

  it('从没检查过：页面上只剩一张居中的卡和「开始检查」', async () => {
    const wrapper = mountPanel({ checkRows: [copy('a', 'jd', undefined, true), copy('b', 'jd', undefined, true)] });

    expect(wrapper.find('.summary-card--hero').exists()).toBe(true);
    expect(wrapper.find('.summary-title').text()).toBe('检查图片还能不能打开');
    expect(wrapper.find('.check-toolbar').exists()).toBe(false);
    expect(wrapper.find('.image-row').exists()).toBe(false);

    await button(wrapper, '开始检查').trigger('click');
    expect(wrapper.emitted('check-all')).toHaveLength(1);
  });

  it('有打不开的：卡片报结论，一张图只占一行，能修的排最前', () => {
    const wrapper = mountPanel({ checkRows: mixedRows() });

    expect(wrapper.find('.summary-title').text()).toBe('2 张图片打不开');
    expect(rowNames(wrapper)).toEqual(['fixable.jpg', 'lost.jpg']);
    expect(wrapper.findAll('.list-section').map((s) => s.text())).toEqual(['能改用备份1', '打不开1']);
    expect(wrapper.find('.image-row--fixable .row-status').text()).toBe('微博上的图已不存在，京东上的备份能用');
  });

  it('「把 N 张改用备份」和行上的「改用 X」都发出要切换的主链接', async () => {
    const wrapper = mountPanel({ checkRows: mixedRows() });

    await button(wrapper, '把 1 张改用备份').trigger('click');
    await button(wrapper, '改用 京东').trigger('click');

    expect(wrapper.emitted('promote')).toEqual([
      [[{ historyId: 'fixable', serviceId: 'jd' }]],
      [[{ historyId: 'fixable', serviceId: 'jd' }]],
    ]);
  });

  it('切到「全部」看得到正常的图；搜索按文件名过滤', async () => {
    const timers = useFakeTimers();
    const wrapper = mountPanel({ checkRows: mixedRows() });

    await wrapper.findAll('.view-option')[1].trigger('click');
    expect(rowNames(wrapper)).toEqual(['fixable.jpg', 'lost.jpg', 'fine.jpg']);

    await wrapper.find('.search-field-input').setValue('fine');
    await timers.advanceBy(250);
    await flushPromisesAndTicks();
    expect(rowNames(wrapper)).toEqual(['fine.jpg']);
    timers.restore();
  });

  it('行上的「⋯」：复制在用的链接；移除只针对打不开的那几份', async () => {
    const wrapper = mountPanel({ checkRows: mixedRows() });

    const fixableMenu = await openRowMenu(wrapper, 0);
    expect(fixableMenu.map((i) => i.label).filter(Boolean)).toEqual(['复制链接', '重新检查', '移除失效的 1 个链接']);

    fixableMenu[0].command?.({ originalEvent: new Event('click'), item: fixableMenu[0] });
    await flushPromisesAndTicks();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mixedRows()[0].url);
    expect(wrapper.find('.row-note--ok').text()).toBe('已复制链接');

    fixableMenu[3].command?.({ originalEvent: new Event('click'), item: fixableMenu[3] });
    const [rows, scope] = wrapper.emitted('remove-links')![0] as [LinkCheckRow[], { kind: string }];
    expect(rows.map((r) => r.serviceId)).toEqual(['weibo']);
    expect(scope.kind).toBe('image');

    const lostMenu = await openRowMenu(wrapper, 1);
    expect(lostMenu.map((i) => i.label).filter(Boolean)).toContain('从记录中移除这张图');
  });

  it('卡片的「⋯」：只重查有问题的、导出当前列表、清理找不回的', async () => {
    const wrapper = mountPanel({ checkRows: mixedRows() });
    const items = wrapper.findComponent(HistoryCheckPanel).findAllComponents(Menu)
      .map((m) => m.props('model') as MenuItem[])
      .find((model) => model.some((i) => typeof i.label === 'string' && i.label.startsWith('只重查')))!;

    expect(items.map((i) => i.label).filter(Boolean)).toEqual(['只重查有问题的 2 张', '导出当前列表（CSV）', '清理 1 张找不回的图片']);

    items[0].command?.({ originalEvent: new Event('click'), item: items[0] });
    expect(wrapper.emitted('check-subset')![0]).toEqual([{ historyIds: ['fixable', 'lost'] }]);

    items[3].command?.({ originalEvent: new Event('click'), item: items[3] });
    const [rows, scope] = wrapper.emitted('remove-links')![0] as [LinkCheckRow[], { kind: string; images: number }];
    expect(rows.map((r) => r.historyId)).toEqual(['lost']);
    expect(scope).toEqual({ kind: 'lost', images: 1 });
  });

  it('检查中：卡片报进度并给暂停 / 停止；文档修复借用检测引擎时不算', async () => {
    const running = mountPanel({
      checkRows: mixedRows(), isChecking: true, progressSource: 'monitor', progress: { checked: 2, total: 5, current_url: '' },
    });
    expect(running.find('.summary-title').text()).toBe('正在检查链接 2 / 5');
    await button(running, '暂停').trigger('click');
    await button(running, '停止').trigger('click');
    expect(running.emitted('pause-check')).toHaveLength(1);
    expect(running.emitted('cancel-check')).toHaveLength(1);

    const rescueBorrowing = mountPanel({ checkRows: mixedRows(), isChecking: true, progressSource: 'rescue' });
    expect(rescueBorrowing.find('.summary-title').text()).toBe('2 张图片打不开');
  });

  it('全都正常、部分图没备份：提示去补充备份', async () => {
    const wrapper = mountPanel({
      checkRows: [copy('a', 'jd', ok(), true), copy('a', 'weibo', ok()), copy('b', 'jd', ok(), true)],
    });
    expect(wrapper.find('.summary-title').text()).toBe('全部正常');
    await wrapper.find('.hint-link').trigger('click');
    expect(wrapper.emitted('navigate')).toEqual([['migrate']]);
  });

  it('读取失败又一行都没有：如实说读取失败，给重试，不说「还没有图片」', async () => {
    const wrapper = mountPanel({ loadError: '数据库被锁住了' });
    expect(wrapper.find('.summary-title').text()).toBe('没读出检查记录');
    expect(wrapper.find('.summary-subtitle').text()).toBe('数据库被锁住了');
    await button(wrapper, '重试').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});
