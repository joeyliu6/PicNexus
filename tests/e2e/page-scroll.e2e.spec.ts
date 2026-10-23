import { expect, test, type Locator, type Page } from '@playwright/test';
import { historyRow, NOW, openApp } from '../redesign/helpers';

// 页面一直开着（KeepAlive）：切到别的页面再回来，停在原处。浏览器把摘下来的元素滚动位置清零，useKeepScroll 放回去。
// 回来是为了看别的（换了一个图床、从图床页带着筛选进链接健康）时从顶上开始（ui-patterns.md「滚动条与布局」）

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
const scrollTop = (el: Locator) => el.evaluate((node) => node.scrollTop);

/** 用滚轮往下滚一段，等停稳，返回停在哪 */
async function wheelDown(page: Page, el: Locator, dy: number): Promise<number> {
  await el.hover();
  await page.mouse.wheel(0, dy);
  let last = -1;
  await expect.poll(async () => {
    const now = await scrollTop(el);
    const settled = now === last && now > 0;
    last = now;
    return settled;
  }, { intervals: [100] }).toBe(true);
  return last;
}

test('settings is where you left it after visiting another page', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openApp(page, {});
  await nav(page, '设置');
  await page.getByRole('button', { name: '编辑器与命令行' }).click();
  const scroller = page.locator('.settings__scroll');
  const top = await wheelDown(page, scroller, 120);

  await nav(page, '快传');
  await nav(page, '设置');
  await expect.poll(() => scrollTop(scroller)).toBe(top);
});

const TWO_HOSTS = {
  availableServices: ['r2', 'weibo'],
  enabledServices: ['r2', 'weibo'],
  services: {
    r2: { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucketName: 'b', publicDomain: 'https://img.example.com' },
    weibo: { cookie: 'SUB=x' },
  },
};

/** 在左栏点开 R2，展开高级选项（这样详情才比窗口高） */
async function openR2(page: Page): Promise<void> {
  await page.locator('.hosts-list__row', { hasText: 'Cloudflare R2' }).click();
  await page.getByRole('button', { name: /^高级选项/ }).click();
}

test('a host detail keeps its place, another host starts at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 600 });
  await openApp(page, { config: TWO_HOSTS });
  await nav(page, '图床');
  await openR2(page);
  const detail = page.locator('.hosts__scroll');
  const top = await wheelDown(page, detail, 200);

  await nav(page, '快传');
  await nav(page, '图床');
  await expect.poll(() => scrollTop(detail)).toBe(top);

  await page.locator('.hosts-list__row', { hasText: '微博' }).click();
  await expect.poll(() => scrollTop(detail)).toBe(0);
});

// 窄窗口两级（先清单、点进去才是详情）：退回清单时详情整块拆掉，再点开的是新的一块，上一次的位置不作数
test('in a narrow window a host opened again from the list starts at the top', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openApp(page, { config: TWO_HOSTS });
  await nav(page, '图床');
  await openR2(page);
  await wheelDown(page, page.locator('.hosts__scroll'), 200);
  await page.locator('.hosts__back').click();
  await openR2(page);

  await nav(page, '快传');
  await nav(page, '图床');
  await expect(page.locator('.hosts__scroll')).toBeVisible();
  await expect.poll(() => scrollTop(page.locator('.hosts__scroll'))).toBe(0);
});

const DEAD = Array.from({ length: 30 }, (_, i) => ({
  ...historyRow(i + 1, `失效-${i + 1}.png`, (i + 1) * 1440, 'weibo'),
  link_check_status: JSON.stringify({ weibo: { isValid: false, errorType: 'http_4xx', statusCode: 404, lastCheckTime: NOW.getTime() - 86_400_000 } }),
}));

test('link health keeps its place, but arriving with a host filter starts at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 600 });
  await openApp(page, { historyRows: DEAD, config: { availableServices: ['jd', 'weibo'], enabledServices: ['jd', 'weibo'], services: { weibo: { cookie: 'SUB=x' } } } });
  await nav(page, '链接健康');
  await expect(page.locator('.health-status')).toContainText('30 张图片失效');
  const scroller = page.locator('.health__scroll');
  const top = await wheelDown(page, scroller, 400);

  await nav(page, '快传');
  await nav(page, '链接健康');
  await expect.poll(() => scrollTop(scroller)).toBe(top);

  await nav(page, '图床');
  await page.locator('.hosts-list__row', { hasText: '微博' }).click();
  await page.getByRole('button', { name: /张失效/ }).click();
  await expect(page.locator('.dead-row').first()).toBeVisible();
  await expect.poll(() => scrollTop(scroller)).toBe(0);
});
