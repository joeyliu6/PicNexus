import { expect, test, type Page } from '@playwright/test';
import { historyRow, openApp, passwordSet, untilIdle, untilVisible } from '../redesign/helpers';

// 界面重构待拍板里定下的几条文案（交接说明第 9 节）：
// ⑪ ⑳ 9.8「打开新窗口 / 弹窗的按钮也加『…』」：「重新登录」开登录小窗，「添加模板」「添加 CDN」「编辑」「修改」「关闭」「设置密码」开弹窗；
// ㉒ 9.5 同一功能在首页、托盘、设置里同名「全局快捷键」；⑱ 重置组的说明不能说「清空全部记录」无法撤销。

const WEIBO = { services: { weibo: { cookie: 'SUB=x' } } };
/** 微博的 Cookie 过期了：上传返回认证失败 */
const WEIBO_EXPIRED = { upload_to_jd: { urlPrefix: 'https://mock.cdn/jd/' }, upload_file_stream: { error: '认证失败: 401' } };

/** 图库里已有记录：首页是常规布局（不是「第一次使用」） */
const OLDER = [historyRow(1, '系统架构图.png', 42)];

const pick = (page: Page) => page.locator('.drop-bar__pick').click();

test('relogin buttons on the home page end with an ellipsis', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    config: { ...WEIBO, availableServices: ['jd', 'weibo'], enabledServices: ['jd', 'weibo'] },
    historyRows: OLDER,
    dialogOpenResult: ['C:/Pictures/夏日海边.png'],
    invokeOverrides: WEIBO_EXPIRED,
  });
  await pick(page);
  await untilVisible(page, page.locator('.focus-card__failure'));
  await expect(page.locator('.focus-card__failure').getByRole('button', { name: '重新登录…', exact: true })).toBeVisible();
  await untilIdle(page);
});

test('the batch card offers 重新登录后补传… for a host whose login expired', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    config: { ...WEIBO, availableServices: ['jd', 'weibo'], enabledServices: ['jd', 'weibo'] },
    historyRows: OLDER,
    dialogOpenResult: ['C:/Pictures/a.png', 'C:/Pictures/b.png'],
    invokeOverrides: WEIBO_EXPIRED,
  });
  await pick(page);
  await untilVisible(page, page.locator('.batch-card').getByRole('button', { name: '重新登录后补传…', exact: true }));
  await untilIdle(page);
});

test('the template and CDN lists open their dialogs from 添加模板… / 添加 CDN…', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    config: {
      ...WEIBO,
      availableServices: ['weibo', 'github'],
      enabledServices: ['weibo', 'github'],
      services: { ...WEIBO.services, github: { token: 't', owner: 'o', repo: 'r', branch: 'main' } },
    },
  });
  await page.getByRole('navigation').getByRole('link', { name: '图床', exact: true }).click();
  await page.locator('.hosts').getByRole('option', { name: /微博/ }).click();
  await page.getByRole('button', { name: '添加模板…', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('添加模板');
  await page.keyboard.press('Escape');

  await page.locator('.hosts').getByRole('option', { name: /GitHub/ }).click();
  await expect(page.getByRole('button', { name: '添加 CDN…', exact: true })).toBeVisible();
});

test('settings buttons that open a dialog end with an ellipsis', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, {
    config: {
      imageCompression: {
        enabled: true,
        activePresetId: 'web',
        presets: [{ id: 'web', name: 'Web', quality: 80, outputFormat: 'webp', maxLongSide: 2560, scalePercent: 100, skipIfSmallerKB: 100, stripExif: true }],
      },
    },
  });
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  const settings = page.locator('.settings');
  await settings.getByRole('button', { name: '上传与链接', exact: true }).click();
  await expect(settings.locator('.upload__preset-edit')).toHaveText('编辑…');

  await settings.getByRole('button', { name: '备份与同步', exact: true }).click();
  await expect(settings.getByRole('button', { name: '设置密码…', exact: true })).toBeVisible();
});

test('the backup password buttons end with an ellipsis once a password is set', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await passwordSet(page);
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  const settings = page.locator('.settings');
  await settings.getByRole('button', { name: '备份与同步', exact: true }).click();
  await expect(settings.getByRole('button', { name: '修改…', exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: '关闭…', exact: true })).toBeVisible();
});

test('the settings switch shares the tray name 全局快捷键', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  const settings = page.locator('.settings');
  await settings.getByRole('button', { name: '快捷键', exact: true }).click();
  await expect(settings.getByRole('switch', { name: '全局快捷键', exact: true })).toBeVisible();
  await expect(settings).not.toContainText('启用全局快捷键');
});

test('the reset group says which action can be undone', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  const settings = page.locator('.settings');
  await settings.getByRole('button', { name: '数据与隐私', exact: true }).click();
  await expect(settings).toContainText('清空记录后 5 秒内可撤销；恢复默认设置无法撤销，建议先在「备份与同步」中导出配置。');
});
