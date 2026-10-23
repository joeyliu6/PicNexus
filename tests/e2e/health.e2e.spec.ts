import { expect, test, type Page } from '@playwright/test';
import { historyRow, NOW, openApp } from '../redesign/helpers';

// 链接健康清单的两处筛选回归（审查发现）：
// 1. 点了日历上某一天再换年份，日期标签不能消失（否则清单被一个看不见、移除不了的条件卡住）
// 2. 筛选按钮被藏起来（窄窗口 / 检测中）时，原因 / 图床 / 年份三个筛选不能还暗中生效

type State = 'gone' | 'timeout';

function deadRow(index: number, name: string, at: string, state: State): Record<string, unknown> {
  const minutesAgo = (NOW.getTime() - new Date(`${at}+08:00`).getTime()) / 60_000;
  const url = `https://mock.cdn/weibo/e${index}.png`;
  return {
    ...historyRow(index, name, minutesAgo, 'weibo'),
    results: JSON.stringify([{ serviceId: 'weibo', status: 'success', result: { serviceId: 'weibo', fileKey: url, url } }]),
    generated_link: url,
    link_check_status: JSON.stringify({
      weibo: state === 'gone'
        ? { isValid: false, errorType: 'http_4xx', statusCode: 404, lastCheckTime: NOW.getTime() - 86_400_000 }
        : { isValid: false, errorType: 'timeout', lastCheckTime: NOW.getTime() - 86_400_000 },
    }),
  };
}

const ROWS = [
  deadRow(1, '五月那张.png', '2023-05-22T10:00', 'gone'),
  deadRow(2, '去年那张.png', '2024-03-08T10:00', 'timeout'),
];

async function openHealth(page: Page): Promise<void> {
  await openApp(page, { historyRows: ROWS, config: { availableServices: ['jd', 'weibo'], enabledServices: ['jd'] } });
  await page.getByRole('navigation').getByRole('link', { name: '链接健康', exact: true }).click();
  await expect(page.locator('.health-status')).toContainText('2 张图片失效');
}

test('the day chip survives switching the calendar year and can still be removed', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openHealth(page);
  await page.getByRole('radio', { name: '2023' }).click();
  await page.getByRole('button', { name: /^2023年5月22日/ }).click();
  const chip = page.locator('.dead-list__chip');
  await expect(chip).toContainText('2023年5月22日');
  await expect(page.locator('.dead-row')).toHaveCount(1);

  await page.getByRole('radio', { name: '2024' }).click();
  await expect(chip).toContainText('2023年5月22日');
  await chip.getByRole('button', { name: '移除这个筛选' }).click();
  await expect(page.locator('.dead-row')).toHaveCount(2);
});

test('filters stop applying when the narrow layout hides their buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openHealth(page);
  await page.locator('.health').getByRole('button', { name: /^原因/ }).click();
  await page.locator('.pn-menu').getByText('连接超时', { exact: true }).click();
  await expect(page.locator('.dead-row')).toHaveCount(1);

  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.locator('.dead-list__filter')).toHaveCount(0);
  await expect(page.locator('.dead-row')).toHaveCount(2);
});

// 真机走查：一个图床都没有时，补充备份卡写成「当前只有 1 个可用图床」
test('the backup card counts usable hosts instead of always saying one', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, { historyRows: [...ROWS, historyRow(3, '仅 1 份.png', 60, 'jd')], config: { availableServices: [], enabledServices: [] } });
  await page.getByRole('navigation').getByRole('link', { name: '链接健康', exact: true }).click();
  await expect(page.locator('.health-status')).toContainText('2 张图片失效');
  await expect(page.locator('.health')).toContainText('需要至少 2 个图床，当前没有可用图床');
});

// 待拍板 ⑤（选 A）：交接说明规则 4.7 把「链接健康从未检测」列为背景装饰的空状态，L01 漏画；
// 检测过之后（有问题、全部正常）不铺装饰
test('the never-checked page carries the background decoration, a checked one does not', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, { historyRows: [historyRow(1, '没检测过.png', 60, 'jd')], config: { availableServices: ['jd'], enabledServices: ['jd'] } });
  await page.getByRole('navigation').getByRole('link', { name: '链接健康', exact: true }).click();
  await expect(page.locator('.health-status')).toContainText('尚未检测');
  await expect(page.locator('.health .bg-decor')).toHaveCount(1);

  await page.goto('about:blank');
  await openHealth(page);
  await expect(page.locator('.health .bg-decor')).toHaveCount(0);
});

// 界面验收：行内按钮与状态文字（「重试」→「仍然失效」→「重试」）原地交叉淡入淡出。按钮、文字自己的
// transition / opacity（转圈的按钮钉死不透明）曾盖掉过渡类：文字硬切、转圈的按钮不淡出，换回时空一帧
test('the row button and its status text cross-fade both ways', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    historyRows: ROWS,
    config: { availableServices: ['jd', 'weibo'], enabledServices: ['jd'] },
    invokeOverrides: { check_image_link: { result: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false } } },
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('navigation').getByRole('link', { name: '链接健康', exact: true }).click();
  await expect(page.locator('.health-status')).toContainText('2 张图片失效');
  // 过渡类换到 -enter-to / -leave-to 的那一刻，记下这个元素上真正在跑的 CSS 过渡（页面时钟是假的，不靠 transitionstart 的时机）
  await page.evaluate(() => {
    const swaps: Record<string, string[]> = {};
    (window as unknown as { __swaps: Record<string, string[]> }).__swaps = swaps;
    new MutationObserver((records) => {
      for (const { target } of records) {
        const el = target as HTMLElement;
        const phase = /dead-row__swap-(enter|leave)-to/.exec(el.className)?.[1];
        if (!phase) continue;
        swaps[`${phase} ${el.textContent?.trim()}`] = el.getAnimations().map((a) => (a as CSSTransition).transitionProperty ?? 'animation');
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  });
  const swaps = () => page.evaluate(() => (window as unknown as { __swaps: Record<string, string[]> }).__swaps);
  const row = page.locator('.dead-row', { hasText: '去年那张.png' });

  await row.getByRole('button', { name: '重试' }).click();
  await expect.poll(async () => { await page.clock.runFor(100); return Object.keys(await swaps()); }, { timeout: 15_000 }).toEqual(expect.arrayContaining(['enter 仍然失效', 'leave 检测中']));
  // 「仍然失效」停 2 秒再换回「重试」
  await expect.poll(async () => { await page.clock.runFor(500); return Object.keys(await swaps()); }, { timeout: 15_000 }).toEqual(expect.arrayContaining(['leave 仍然失效', 'enter 重试']));
  expect(await swaps()).toMatchObject({
    'enter 仍然失效': expect.arrayContaining(['opacity']),
    'leave 检测中': expect.arrayContaining(['opacity']),
    'leave 仍然失效': expect.arrayContaining(['opacity']),
    'enter 重试': expect.arrayContaining(['opacity']),
  });
  await expect(row.getByRole('button', { name: '重试' })).toBeVisible();
});

/** 失效那份是微博、京东上还有一份好的：行上给「改用京东」 */
function backedUp(index: number, name: string, at: string, state: State = 'gone'): Record<string, unknown> {
  const row = deadRow(index, name, at, state);
  const url = (host: string) => `https://mock.cdn/${host}/e${index}.png`;
  return {
    ...row,
    results: JSON.stringify(['weibo', 'jd'].map((host) => ({ serviceId: host, status: 'success', result: { serviceId: host, fileKey: url(host), url: url(host) } }))),
    success_count: 2,
    successful_service_ids: JSON.stringify(['weibo', 'jd']),
    link_check_status: JSON.stringify({ ...JSON.parse(row.link_check_status as string), jd: { isValid: true, lastCheckTime: NOW.getTime() - 86_400_000 } }),
  };
}

/** 行离场换到 -leave-to 的那一刻，记下它身上真正在跑的过渡（页面时钟是假的，不靠 transitionend 的时机） */
async function recordRowLeaves(page: Page): Promise<() => Promise<Record<string, string[]>>> {
  await page.evaluate(() => {
    const leaves: Record<string, string[]> = {};
    (window as unknown as { __leaves: Record<string, string[]> }).__leaves = leaves;
    new MutationObserver((records) => {
      for (const { target } of records) {
        const el = target as HTMLElement;
        if (!el.classList?.contains('dead-row-leave-to')) continue;
        leaves[el.querySelector('.dead-row__name')?.textContent ?? '?'] = el.getAnimations().map((a) => (a as CSSTransition).transitionProperty ?? 'animation');
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  });
  return () => page.evaluate(() => (window as unknown as { __leaves: Record<string, string[]> }).__leaves);
}

// 改用备份修好的一行收起并淡出，下面的行跟着滑上来（不是一下消失）；换筛选拿掉的行照旧立刻消失（LoadingRules ①）
for (const motion of ['no-preference', 'reduce'] as const) {
  test(`a fixed row folds away, rows hidden by a filter just go (${motion})`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openApp(page, {
      historyRows: [
        backedUp(1, '有备份那张.png', '2024-03-08T10:00'),
        backedUp(3, '另一张有备份.png', '2024-03-09T10:00'),
        backedUp(4, '超时有备份.png', '2024-03-10T10:00', 'timeout'),
      ],
      config: { availableServices: ['jd', 'weibo'], enabledServices: ['jd'] },
    });
    await page.emulateMedia({ reducedMotion: motion });
    await page.getByRole('navigation').getByRole('link', { name: '链接健康', exact: true }).click();
    await expect(page.locator('.dead-row')).toHaveCount(3);
    const leaves = await recordRowLeaves(page);

    await page.locator('.dead-row', { hasText: '有备份那张.png' }).getByRole('button', { name: '改用京东' }).click();
    await expect.poll(async () => { await page.clock.runFor(100); return Object.keys(await leaves()); }, { timeout: 15_000 }).toContain('有备份那张.png');
    expect((await leaves())['有备份那张.png']).toEqual(motion === 'reduce' ? ['opacity'] : expect.arrayContaining(['max-height', 'opacity']));
    await expect(page.locator('.dead-row')).toHaveCount(2);

    // 同一组里留下「超时有备份」，筛掉的那行是在组内离开（整组没了时连离场的类都不挂，量不到）
    await page.locator('.dead-list__filter', { hasText: '原因' }).click();
    await page.getByRole('menuitemradio', { name: '连接超时' }).click();
    await expect.poll(async () => { await page.clock.runFor(100); return Object.keys(await leaves()); }, { timeout: 15_000 }).toContain('另一张有备份.png');
    expect((await leaves())['另一张有备份.png']).toEqual([]);
    await expect(page.locator('.dead-row')).toHaveCount(1);
    await expect(page.locator('.dead-row')).toContainText('超时有备份.png');
  });
}

// 界面验收：日历气泡在格子正上方居中，最左 / 最右几列会伸出日历（窄窗口里被滚动区裁掉一截）；要收进日历以内
test('the calendar tooltip stays inside the calendar at the first and last columns', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openHealth(page);
  const calendar = page.locator('.upload-calendar');
  const cells = calendar.locator('.upload-calendar__cell[data-day]');
  for (const cell of [cells.first(), cells.last()]) {
    await cell.hover();
    const tip = calendar.locator('.upload-calendar__tip');
    await expect(tip).toHaveCount(1);
    const box = (await tip.boundingBox())!;
    const bounds = (await calendar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
});

// 待拍板 ⑥（选 A）：全部正常、只有「可能受限」的图时，状态栏写了张数，也要能看到是哪几张
test('a limited-only page offers the list of limited images', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const checked = NOW.getTime() - 86_400_000;
  const ok = { ...historyRow(1, '正常那张.png', 60, 'jd'), link_check_status: JSON.stringify({ jd: { isValid: true, lastCheckTime: checked } }) };
  const limited = {
    ...historyRow(2, '受限那张.png', 120, 'jd'),
    link_check_status: JSON.stringify({ jd: { isValid: false, browserMightWork: true, errorType: 'http_4xx', statusCode: 403, lastCheckTime: checked } }),
  };
  await openApp(page, { historyRows: [ok, limited], config: { availableServices: ['jd'], enabledServices: ['jd'] } });
  await page.getByRole('navigation').getByRole('link', { name: '链接健康', exact: true }).click();
  await expect(page.locator('.health-status')).toContainText('另有 1 张可能受限');
  await expect(page.locator('.dead-row')).toHaveCount(0);

  await page.getByRole('button', { name: '查看可能受限的图片' }).click();
  await expect(page.locator('.dead-row')).toHaveCount(1);
  await expect(page.locator('.dead-row')).toContainText('受限那张.png');
  const chip = page.locator('.dead-list__chip');
  await expect(chip).toContainText('可能受限');

  await chip.getByRole('button', { name: '移除这个筛选' }).click();
  await expect(page.locator('.dead-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看可能受限的图片' })).toBeVisible();
});
