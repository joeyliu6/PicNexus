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
