import { expect, test, type Page } from '@playwright/test';
import { openApp } from '../redesign/helpers';

// 托盘（交接说明 8.6）：托盘、首页「上传到 / 复制为」、设置页改的是同一份配置，改一处另外两处跟着变。
// 托盘是系统原生菜单，这里核对的是应用交给菜单接口的结构（原生接口模拟把它记下来），点击直接调用菜单项的回调。

interface Entry { text?: string; checked?: boolean; enabled?: boolean; items?: Entry[] }

/** 名字与右侧说明：Windows 用制表符分出右列，macOS / Linux 写成「名字 · 说明」（WebKit 测试环境报的是 macOS） */
const SPLIT = /\t| · /;

function parts(text = ''): [string, string] {
  const [label, detail = ''] = text.split(SPLIT);
  return [label, detail];
}

/** 最近一次换上的托盘菜单 */
async function trayMenu(page: Page): Promise<Entry[]> {
  return page.evaluate(() => {
    const calls = globalThis.__PICNEXUS_E2E__?.calls ?? [];
    const last = [...calls].reverse().find((call) => call.type === 'tray.setMenu') as { items: Entry[] } | undefined;
    return last?.items ?? [];
  });
}

function row(entries: Entry[], label: string): Entry | undefined {
  return entries.find((entry) => parts(entry.text)[0] === label);
}

function detailOf(entries: Entry[], label: string): string | undefined {
  const found = row(entries, label);
  return found ? parts(found.text)[1] : undefined;
}

/** 点托盘菜单里的一项（path = 父项名 > 子项名） */
async function clickTray(page: Page, ...path: string[]): Promise<void> {
  await page.evaluate(({ labels, split }) => {
    type Live = { text?: string; items?: Live[]; action?: (id: string) => void };
    const pattern = new RegExp(split);
    let entries = (globalThis.__PICNEXUS_E2E_TRAY_MENU__ as unknown as { items: Live[] }).items;
    let target: Live | undefined;
    for (const label of labels) {
      target = entries.find((entry) => entry.text?.split(pattern)[0] === label);
      entries = target?.items ?? [];
    }
    if (!target?.action) throw new Error(`托盘菜单里没有「${labels.join(' > ')}」`);
    target.action('mock');
  }, { labels: path, split: SPLIT.source });
}

test('tray, home and settings change one shared config', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page);

  // 打开时：结构与当前值
  await expect.poll(async () => (await trayMenu(page)).map((entry) => (entry.text ? parts(entry.text)[0] : '—'))).toEqual([
    '上传剪贴板图片', '选择文件上传…', '—', '上传到', '复制为', '压缩', '—',
    '自动复制链接', '自动上传剪贴板', '全局快捷键', '—', '打开 PicNexus', '设置…', '退出 PicNexus',
  ]);
  expect(detailOf(await trayMenu(page), '上传到')).toBe('京东');
  // 模拟环境的剪贴板里没有图片：第一项变灰并写原因
  expect(row(await trayMenu(page), '上传剪贴板图片')).toMatchObject({ enabled: false });
  expect(detailOf(await trayMenu(page), '上传剪贴板图片')).toBe('剪贴板无图片');

  // 首页（第一次使用的样子）勾上七鱼 → 托盘的「上传到」跟着变
  await page.locator('.first-use__chips').click();
  await page.getByRole('checkbox', { name: /七鱼/ }).click();
  await expect.poll(async () => detailOf(await trayMenu(page), '上传到')).toBe('2 个图床');
  await page.keyboard.press('Escape');

  // 托盘改「复制为」→ 首页跟着变
  await clickTray(page, '复制为', 'Markdown');
  await expect(page.locator('.first-use__format')).toHaveText('Markdown');
  await expect.poll(async () => detailOf(await trayMenu(page), '复制为')).toBe('Markdown');

  // 托盘关「自动复制链接」→ 设置页的开关跟着变
  await clickTray(page, '自动复制链接');
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: /上传与链接/ }).click();
  await expect(page.getByRole('switch', { name: '自动复制链接' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[aria-label="默认复制为"] [data-state="on"]')).toHaveText('Markdown');

  // 设置页再打开 → 托盘的勾跟着变
  await page.getByRole('switch', { name: '自动复制链接' }).click();
  await expect.poll(async () => row(await trayMenu(page), '自动复制链接')?.checked).toBe(true);
});
