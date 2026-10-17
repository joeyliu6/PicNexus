import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { mockObjectName } from '../e2e/mocks/core';
import type { E2ESeed } from '../e2e/mocks/state';

/**
 * 新界面像素基准的公共部分。
 *
 * 跑的是真应用（路由、外壳、上传控制器都是真的），原生接口走 tests/e2e/mocks；
 * 每张图需要的配置、历史记录和上传结果通过 E2ESeed 在页面加载前写进去。
 * 新增一张图：在对应 *.visual.spec.ts 里加一项，跑 `npm run test:visual:update` 录基准。
 */

/** 截图里的「现在」：相对时间（刚刚 / 3 分钟前）都按这一刻算 */
export const NOW = new Date('2026-10-16T10:30:00+08:00');

/** 交接说明第 14 节：宽窗口与窄窗口各一套 */
export const SIZES = [
  { name: 'wide', width: 1400, height: 900 },
  { name: 'narrow', width: 800, height: 600 },
] as const;

const GRADIENTS = [
  ['#60a5fa', '#a78bfa'],
  ['#34d399', '#22d3ee'],
  ['#f59e0b', '#f472b6'],
  ['#f87171', '#fb923c'],
  ['#818cf8', '#38bdf8'],
];

/** 同一个链接永远画同一张渐变图，基准才稳定 */
function imageFor(url: string): string {
  const index = [...url].reduce((sum, ch) => (sum + ch.charCodeAt(0)) % GRADIENTS.length, 0);
  const [from, to] = GRADIENTS[index];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><circle cx="470" cy="120" r="64" fill="rgba(255,255,255,.35)"/><path d="M0 330 150 200l90 74 90-104 310 166v84H0z" fill="rgba(15,23,42,.30)"/></svg>`;
}

/**
 * 路径里带 /ratio/ 的链接按文件名里的「宽x高」画（G13 不同比例）：高宽比超过 2 的画成一页长截图（白底、一行行内容），
 * 文件名带 -alpha 的画成透明底的花瓣图标，其余是同款渐变风景。
 */
function ratioImageFor(url: string): string | null {
  const match = /\/ratio\/.*-(\d+)x(\d+)(-alpha)?\.\w+$/.exec(url);
  if (!match) return null;
  const [w, h] = [Number(match[1]), Number(match[2])];
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  if (match[3]) {
    const size = Math.min(w, h) * 0.8;
    const scale = size / 136;
    const petals = '<path d="M64 58L44 29Q40 22 45 16L57 4Q64 -2 71 4L83 16Q88 22 84 29Z"/><path d="M70 64L99 44Q106 40 112 45L124 57Q130 64 124 71L112 83Q106 88 99 84Z"/><path d="M64 70L84 99Q88 106 83 112L71 124Q64 130 57 124L45 112Q40 106 44 99Z"/><path d="M58 64L29 84Q22 88 16 83L4 71Q-2 64 4 57L16 45Q22 40 29 44Z"/>';
    return `${open}<g fill="#4D63F0" transform="translate(${(w - size) / 2 + 4 * scale} ${(h - size) / 2 + 4 * scale}) scale(${scale})">${petals}</g></svg>`;
  }
  if (h > w * 2) {
    const lines = Array.from({ length: Math.floor(h / (w * 0.3)) }, (_, i) => {
      const y = w * 0.12 + i * w * 0.3;
      return `<rect x="${w * 0.1}" y="${y}" width="${w * (i % 3 === 0 ? 0.8 : 0.55)}" height="${w * 0.05}" rx="${w * 0.02}" fill="#D5DBE5"/><rect x="${w * 0.1}" y="${y + w * 0.09}" width="${w * 0.8}" height="${w * 0.14}" rx="${w * 0.03}" fill="${i % 2 ? '#EEF4EE' : '#E8EEF8'}"/>`;
    }).join('');
    return `${open}<rect width="${w}" height="${h}" fill="#FFFFFF"/>${lines}</svg>`;
  }
  const r = Math.min(w, h);
  return `${open}<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.3}" r="${r * 0.15}" fill="rgba(255,255,255,.4)"/><path d="M0 ${h * 0.8} ${w * 0.25} ${h * 0.5} ${w * 0.4} ${h * 0.65} ${w * 0.55} ${h * 0.42} ${w} ${h * 0.82}V${h}H0z" fill="rgba(15,23,42,.3)"/></svg>`;
}

async function fulfillExternal(route: Route): Promise<void> {
  const request = route.request();
  // 路径里带 /gone/ 的链接当作图床上已经没了（失效的「复制时使用」那份）
  if (decodeURIComponent(request.url()).includes('/gone/')) {
    await route.fulfill({ status: 404, body: '' });
    return;
  }
  if (request.resourceType() === 'image' || (request.headers().accept ?? '').includes('image/')) {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ratioImageFor(request.url()) ?? imageFor(request.url()) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
}

export interface OpenOptions {
  /** 渐进提示是否已经出现过（默认是，免得每张图都带着它） */
  hintShown?: boolean;
}

export async function openApp(page: Page, seed: E2ESeed = {}, options: OpenOptions = {}): Promise<void> {
  await page.clock.install({ time: NOW });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ data, hintShown }) => {
    (window as unknown as { __PICNEXUS_E2E_SEED__?: unknown }).__PICNEXUS_E2E_SEED__ = data;
    if (hintShown) localStorage.setItem('picnexus-hint-fast-upload', '1');
    // 应用的 CSP 不放行外网 fetch（上传前的联网检测会被拦），与冒烟测试一样在页面里直接应答
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/^https?:\/\//.test(url) && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(url)) {
        return Promise.resolve(new Response(init?.method === 'HEAD' ? null : '{}', { status: 200 }));
      }
      return nativeFetch(input, init);
    };
  }, { data: seed, hintShown: options.hintShown ?? true });
  await page.route(/^https?:\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$))/, fulfillExternal);
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
}

/**
 * 等到 locator 出现：上传失败会自动重试（京东按 2 s、4 s 退避），
 * 每轮把页面时钟往前拨 1 秒，不必真等。
 */
export async function untilVisible(page: Page, locator: Locator): Promise<void> {
  for (let i = 0; i < 40 && !(await locator.isVisible()); i++) await page.clock.runFor(1000);
  await expect(locator).toBeVisible();
}

/** 这次上传（含自动重试）全部收尾：标题栏的传输入口只在有任务时出现 */
export async function untilIdle(page: Page): Promise<void> {
  const transfer = page.getByRole('button', { name: '传输中心' });
  for (let i = 0; i < 40 && (await transfer.isVisible()); i++) await page.clock.runFor(1000);
  await expect(transfer).toBeHidden();
}

/** 停住页面时钟：上传中的蠕动进度、自动消失的提示都定在这一刻 */
export async function freezeTime(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 500);
}

/**
 * 新界面同一台机器渲染稳定，差几十个像素就是真变了。全局那条「1% 像素」在 1400×900 上是
 * 12,600 个像素，整列按钮换了样子（约 7,000 个）都看不出来，本机收紧到 100 个。
 * CI 的机器文字抗锯齿与本机不同，那边照旧用全局的 1%（只防大的走样）。
 */
const MAX_DIFF_PIXELS = 100;

export async function capture(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    ...(process.env.CI ? {} : { maxDiffPixels: MAX_DIFF_PIXELS }),
  });
}

/** 一条历史记录（列名同数据库 history_items） */
export function historyRow(index: number, name: string, minutesAgo: number, service = 'jd'): Record<string, unknown> {
  const url = `https://mock.cdn/${service}/${mockObjectName(name)}`;
  return {
    id: `history-${index}`,
    timestamp: NOW.getTime() - minutesAgo * 60_000,
    local_file_name: name,
    local_file_name_lower: name.toLowerCase(),
    file_path: `C:/Pictures/${name}`,
    primary_service: service,
    results: JSON.stringify([{ serviceId: service, status: 'success', result: { serviceId: service, fileKey: url, url } }]),
    generated_link: url,
    link_check_status: null,
    link_check_summary: null,
    width: 1600,
    height: 1000,
    aspect_ratio: 1.6,
    file_size: 482_000,
    format: 'png',
    color_type: 'unknown',
    has_alpha: 0,
    is_favorited: 0,
    favorite_updated_at: 0,
    favorite_updated_by: null,
    success_count: 1,
    successful_service_ids: JSON.stringify([service]),
    migration_skip: 0,
    link_check_skip: 0,
  };
}
