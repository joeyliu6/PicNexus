import { expect, test, type Page } from '@playwright/test';
import type { E2ESeed } from '../e2e/mocks/state';
import { capture, freezeTime, historyRow, NOW, openApp, SIZES } from './helpers';

/**
 * 图库各状态的像素基准，名字前缀对应设计画板（docs/design/redesign/handoff/states/STATES.md）。
 * K02 / K03 由每张图的 narrow 尺寸覆盖，K07 由深色那一套覆盖。
 * 样本仿 GalleryScreen.dc.html：今天 6 张、昨天 12 张，再加几张往年出过问题的图（刻度条才有年份）。
 */

type Health = 'ok' | 'dead' | 'limited';

interface Pic {
  name: string;
  w: number;
  h: number;
  /** 上传时间（东八区） */
  at: string;
  /** 第一个是「复制时使用」的那份 */
  hosts?: string[];
  /** 不写 = 每份都检测过、正常；写了就只有写到的那几份有结果，其余算「尚未检测」 */
  health?: Partial<Record<string, Health>>;
  fav?: boolean;
  size?: number;
}

const PICS: Pic[] = [
  { name: '截图_2026-10-15_142233.png', w: 1920, h: 1080, at: '2026-10-16T10:22', health: { jd: 'ok', r2: 'ok' }, size: 395_264 },
  { name: '架构图-v3.png', w: 2400, h: 1350, at: '2026-10-16T10:14', hosts: ['jd'], health: {}, size: 1_258_291 },
  { name: 'IMG_4821.JPG', w: 4032, h: 3024, at: '2026-10-16T10:08', fav: true, size: 655_360 },
  { name: '终端-cargo-test-输出.png', w: 1280, h: 2200, at: '2026-10-16T09:41', size: 217_088 },
  { name: 'logo-草图.png', w: 800, h: 800, at: '2026-10-16T07:08', hosts: ['jd'], size: 49_152 },
  { name: '对比表-图床延迟.png', w: 1600, h: 900, at: '2026-10-16T05:30', size: 98_304 },
  { name: 'clipboard_image_20261014_183005_8f3a.png', w: 1440, h: 900, at: '2026-10-15T18:30', size: 157_696 },
  { name: 'Rust-async-生命周期示意.png', w: 1800, h: 1000, at: '2026-10-15T11:02', hosts: ['r2', 'jd', 'github'], health: { r2: 'ok', jd: 'ok' }, fav: true, size: 421_888 },
  { name: '旧博客-封面.jpg', w: 1200, h: 630, at: '2026-10-15T10:15', hosts: ['weibo'], health: { weibo: 'dead' }, fav: true, size: 98_304 },
  { name: '设置页-暗色对比.png', w: 2560, h: 1440, at: '2026-10-15T09:47', size: 532_480 },
  { name: 'PR-评审意见.png', w: 1100, h: 1600, at: '2026-10-15T09:12', size: 192_512 },
  { name: '慢查询-explain.png', w: 1920, h: 800, at: '2026-10-15T08:55', size: 350_208 },
  { name: '周会-白板.jpg', w: 4000, h: 3000, at: '2026-10-15T08:40', size: 78_848 },
  { name: 'API-返回示例.png', w: 900, h: 1300, at: '2026-10-15T08:20', size: 98_304 },
  { name: '色板-对比.png', w: 1600, h: 600, at: '2026-10-15T08:05', size: 61_440 },
  { name: '首页-移动端.png', w: 1170, h: 2532, at: '2026-10-15T07:50', size: 614_400 },
  { name: '图标-导出预览.png', w: 1024, h: 1024, at: '2026-10-15T07:30', size: 40_960 },
  { name: '手绘-流程.jpg', w: 3000, h: 2000, at: '2026-10-15T07:10', size: 1_536_000 },
  { name: '2025-年终总结-配图.png', w: 1600, h: 1200, at: '2025-12-31T20:00', hosts: ['weibo', 'jd'], health: { weibo: 'limited', jd: 'ok' }, fav: true, size: 307_200 },
  { name: '读书会-海报.png', w: 1080, h: 1440, at: '2025-09-20T15:00', hosts: ['weibo', 'jd'], health: { weibo: 'limited' }, fav: true, size: 204_800 },
  { name: '2024-读书笔记-配图.jpg', w: 1080, h: 1440, at: '2024-08-02T21:40', hosts: ['weibo', 'jd'], health: { weibo: 'dead', jd: 'ok' }, size: 274_432 },
  { name: '团建-合影.jpg', w: 4000, h: 3000, at: '2023-05-18T19:00', hosts: ['weibo', 'jd'], health: { weibo: 'dead', jd: 'ok' }, fav: true, size: 1_048_576 },
  { name: 'Kafka-分区示意.png', w: 1800, h: 1000, at: '2023-05-18T10:00', hosts: ['weibo'], health: { weibo: 'dead' }, size: 163_840 },
];

function row(pic: Pic, index: number): Record<string, unknown> {
  const hosts = pic.hosts ?? ['jd', 'r2'];
  const health = pic.health ?? Object.fromEntries(hosts.map((host) => [host, 'ok' as const]));
  const minutesAgo = (NOW.getTime() - new Date(`${pic.at}+08:00`).getTime()) / 60_000;
  const base = historyRow(index + 1, pic.name, minutesAgo, hosts[0]);
  // 失效的那份放在 /gone/ 下：测试里这些地址一律 404（灯箱「这次没加载出来」G08）
  const urlOf = (host: string) => `https://mock.cdn/${health[host] === 'dead' ? 'gone/' : ''}${host}/${index + 1}-${pic.w}x${pic.h}.png`;
  const results = hosts.map((serviceId) => ({ serviceId, status: 'success', result: { serviceId, fileKey: urlOf(serviceId), url: urlOf(serviceId) } }));
  const status = Object.fromEntries(Object.entries(health).map(([host, state]) => [host, {
    isValid: state === 'ok',
    lastCheckTime: NOW.getTime() - 3_600_000,
    errorType: state === 'ok' ? 'success' : 'http_4xx',
    ...(state === 'limited' ? { browserMightWork: true } : {}),
  }]));
  return {
    ...base,
    width: pic.w,
    height: pic.h,
    aspect_ratio: pic.w / pic.h,
    file_size: pic.size ?? 400_000,
    results: JSON.stringify(results),
    generated_link: urlOf(hosts[0]),
    link_check_status: Object.keys(status).length ? JSON.stringify(status) : null,
    is_favorited: pic.fav ? 1 : 0,
    success_count: hosts.length,
    successful_service_ids: JSON.stringify(hosts),
  };
}

const ROWS = PICS.map(row);
const NO_FAVORITES = ROWS.map((r) => ({ ...r, is_favorited: 0 }));

const HOSTS = {
  availableServices: ['jd', 'r2', 'weibo', 'github'],
  enabledServices: ['jd', 'r2'],
  services: {
    r2: { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucketName: 'b', publicDomain: 'https://img.example.com' },
    weibo: { cookie: 'SUB=x' },
    github: { token: 't', owner: 'o', repo: 'r', branch: 'main' },
  },
  linkOutput: { autoCopy: true, defaultFormat: 'markdown' },
};

interface GalleryState {
  seed?: E2ESeed;
  act?: (page: Page) => Promise<void>;
}

const gallery = (page: Page) => page.locator('.gallery');
const tile = (page: Page, name: string) => page.locator(`.tile[aria-label="${name}"]`);

async function openGallery(page: Page, seed: E2ESeed): Promise<void> {
  await openApp(page, { config: HOSTS, ...seed });
  // 宽窗口是带字的侧栏，800 宽收成图标栏（只有 aria-label）：两种都按名字找
  await page.getByRole('navigation').getByRole('link', { name: '图库', exact: true }).click();
  await expect(gallery(page)).toBeVisible();
}

/**
 * 等每张缩略图都有了结果（加载出来，或候选链试完显示「图片加载失败」）：缩略图按页面时钟排队加载，
 * 还没轮到的格子连 <img> 都没有，capture 里「所有图片都 complete」会空转通过。
 * 还没读出图的天、快速滚动时画的是灰色占位块（.grid__slot），也算没到位。
 * 读库、404 靠真实时间；每轮再把页面时钟拨 500ms 推动防抖、超时与重试。等不到就让测试失败，不截半途的图。
 */
async function settleTiles(page: Page): Promise<void> {
  await expect.poll(async () => {
    const placeholders = await page.locator('.grid__slot').count();
    const pending = await page.locator('.tile').evaluateAll((tiles) => tiles.filter((tile) => {
      const img = tile.querySelector('img');
      return !tile.querySelector('.tile__broken') && !(img?.complete && img.classList.contains('tile__img--loaded'));
    }).length);
    if (placeholders + pending > 0) await page.clock.runFor(500);
    return placeholders + pending;
  }, { timeout: 20_000, intervals: [100] }).toBe(0);
}

async function filterStatus(page: Page, labels: string[]): Promise<void> {
  await gallery(page).getByRole('button', { name: '状态' }).click();
  for (const label of labels) await page.locator('.pn-menu').getByText(label, { exact: true }).click();
  await page.keyboard.press('Escape');
}

const STATES: Record<string, GalleryState> = {
  'G01-grid': {
    act: async (page) => {
      // 先等图加载完再悬停、滚动：之后时钟停住，刻度条才不会到点淡出
      await settleTiles(page);
      await tile(page, PICS[0].name).hover();
      await page.locator('.gallery__scroll').dispatchEvent('scroll');
      await freezeTime(page);
    },
  },
  'G02-list': {
    act: async (page) => {
      await gallery(page).getByLabel('列表', { exact: true }).click();
      await expect(page.locator('.list__row').first()).toContainText(PICS[0].name);
    },
  },
  'G03-filtered': {
    act: async (page) => {
      await gallery(page).getByRole('button', { name: '图床' }).click();
      await page.locator('.pn-menu').getByText('微博', { exact: true }).click();
      await gallery(page).getByRole('button', { name: '★ 收藏' }).click();
      await filterStatus(page, ['失效', '可能受限']);
      await expect(gallery(page).getByText('找到 4 张')).toBeVisible();
    },
  },
  'G04-multi-select': {
    act: async (page) => {
      await tile(page, PICS[0].name).hover();
      await tile(page, PICS[0].name).locator('.tile__select').click();
      for (const pic of PICS.slice(1, 12)) await tile(page, pic.name).click({ modifiers: ['Control'] });
      await expect(page.locator('.selection-bar')).toContainText('已选 12 张');
      await page.mouse.move(0, 0);
    },
  },
  'G05-detail-ok': {
    act: async (page) => {
      await tile(page, 'Rust-async-生命周期示意.png').click();
      await expect(page.locator('.detail')).toContainText('复制时使用');
      await page.mouse.move(0, 0);
    },
  },
  'G06-detail-broken': {
    act: async (page) => {
      await filterStatus(page, ['失效']);
      await tile(page, '2024-读书笔记-配图.jpg').click();
      await expect(page.locator('.detail')).toContainText('改用京东');
      await page.mouse.move(0, 0);
    },
  },
  'G07-detail-dead': {
    act: async (page) => {
      await tile(page, '旧博客-封面.jpg').click();
      await expect(page.locator('.detail')).toContainText('所有链接均已失效');
      await page.mouse.move(0, 0);
    },
  },
  'G08-lightbox': {
    act: async (page) => {
      await filterStatus(page, ['失效']);
      await tile(page, '2024-读书笔记-配图.jpg').dblclick();
      await expect(page.locator('.lightbox__banner')).toBeVisible();
      await page.locator('.lightbox__chip').click();
      await expect(page.locator('.lightbox__menu')).toBeVisible();
    },
  },
  'G09-empty': { seed: { historyRows: [] } },
  'G10-no-results': {
    act: async (page) => {
      await gallery(page).getByLabel('搜索文件名').fill('发布会-2019');
      await gallery(page).getByRole('button', { name: '时间' }).click();
      await page.locator('.pn-menu').getByText('最近 7 天', { exact: true }).click();
      await expect(gallery(page).getByText('没有匹配的图片')).toBeVisible();
    },
  },
  'G11-fav-empty': {
    seed: { historyRows: NO_FAVORITES },
    act: async (page) => {
      await gallery(page).getByRole('button', { name: '★ 收藏' }).click();
      await expect(gallery(page).getByText('还没有收藏')).toBeVisible();
    },
  },
  'G12-loading': {
    seed: { sqlHangDayStats: true },
    act: async (page) => {
      await page.clock.runFor(400);
      await expect(page.locator('.skeleton')).toBeVisible();
    },
  },
};

for (const size of SIZES) {
  test.describe(`图库 · ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const [name, state] of Object.entries(STATES)) {
      test(name, async ({ page }) => {
        await openGallery(page, { historyRows: ROWS, ...state.seed });
        await state.act?.(page);
        await settleTiles(page);
        await capture(page, `gallery-${name}-${size.name}`);
      });
    }
  });
}
