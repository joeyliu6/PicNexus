import { expect, test, type Page } from '@playwright/test';
import { openApp } from '../redesign/helpers';

// 图床页的整条连接流程（真浏览器 + 原生接口模拟）：从一个都没有开始，WebDAV 先测失败（指到密码）、再测通过并连上，
// 右侧换成它的详情。真机走查第一次连 WebDAV 时见过右侧停在空的连接表单，之后没能复现，这条用例守着这段流程。

const PASS = { success: true, message: '连接成功，公开链接可正常访问', failedStep: null, field: null };
const WRONG_PASSWORD = { success: false, message: '认证失败，请检查用户名和密码', failedStep: 'credentials', field: 'password' };

async function openHosts(page: Page): Promise<void> {
  // 从一个已添加的都没有开始（真机走查就是这样：全新的配置）
  await openApp(page, { config: { availableServices: ['r2'], enabledServices: [] }, invokeOverrides: { test_webdav_storage: { byArg: { key: 'password', results: { wrong: WRONG_PASSWORD, secret: PASS } } } } });
  await page.getByRole('navigation').getByRole('link', { name: '图床', exact: true }).click();
  await expect(page.locator('.hosts-list')).toBeVisible();
}

test('connecting a WebDAV host switches the right side to its detail', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openHosts(page);
  // 一个都没有时右侧直接是目录
  await page.locator('.host-catalog__card', { hasText: 'WebDAV' }).click();

  const fill = async (selector: string, value: string) => {
    await page.locator(selector).fill(value);
    await page.locator(selector).blur();
  };
  await fill('[id$="-url"]', 'https://dav.example.com/dav');
  await fill('[id$="-username"]', 'me');
  await page.getByRole('button', { name: '修改密码' }).click();
  await page.keyboard.type('wrong');
  await page.keyboard.press('Tab');
  await fill('[id$="-publicDomain"]', 'https://img.example.com');
  await page.getByRole('button', { name: '测试并连接' }).click();
  // 先失败一次：指到密码那一格，留在连接表单
  await expect(page.locator('.host-detail').getByRole('alert')).toContainText('密码无效');

  await page.getByRole('button', { name: '修改密码' }).click();
  await page.keyboard.type('secret');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: '测试并连接' }).click();

  const detail = page.locator('.host-detail');
  await expect(detail.locator('.host-head__name')).toHaveText('WebDAV 1');
  await expect(detail.getByRole('button', { name: '删除这份 WebDAV' })).toBeVisible();
  await expect(detail.getByRole('button', { name: '测试并连接' })).toHaveCount(0);
  await expect(page.locator('.hosts-list').getByRole('option', { name: /WebDAV 1/ })).toBeVisible();
  await expect(page.locator('[id$="-url"]')).toHaveValue('https://dav.example.com/dav');
});

// 800×600、一个图床都没有：窄窗口平时先列清单、点进去才是详情；清单是空的时候直接给目录，不留一整页空白
test('at 800×600 with no host yet the page opens on the catalog, not an empty list', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openApp(page, { config: { availableServices: ['r2'], enabledServices: [] } });
  await page.getByRole('navigation').getByRole('link', { name: '图床', exact: true }).click();
  await expect(page.locator('.host-catalog')).toBeVisible();
  await expect(page.locator('.hosts__back')).toHaveCount(0);
  // 点进连接表单有「‹ 图床」回到目录
  await page.locator('.host-catalog__card', { hasText: 'WebDAV' }).click();
  await page.locator('.hosts__back').click();
  await expect(page.locator('.host-catalog')).toBeVisible();
});

// 待拍板 ㉝（选 A）：Patterns「确认框默认焦点在『取消』，回车不会误触」——不只红色危险确认框，
// 公共图床风险（P11）这类琥珀确认框也一样：按回车不该直接同意风险
test('the public host risk confirm opens with 取消 focused', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, { config: { availableServices: [], enabledServices: [], publicServiceRiskAccepted: false } });
  await page.getByRole('button', { name: '启用京东图床（免配置）' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('button', { name: '启用京东图床（免配置）' })).toBeVisible();
});
