import { expect, test, type Page } from '@playwright/test';
import type { E2ESeed } from '../e2e/mocks/state';
import { capture, historyRow, openApp, SIZES } from './helpers';

/**
 * 图床页各状态的像素基准，名字前缀对应设计画板 P01–P15（docs/design/redesign/handoff/states/STATES.md）。
 * K09（深色 · 测试失败）由 P08 的深色那一套覆盖。P16（Cookie 登录小窗）是独立窗口，不在这里。
 * 样本仿 HostsScreen.dc.html：微博登录失效、京东、Cloudflare R2 已启用，WebDAV「家里 NAS」停用。
 */

const R2 = {
  accountId: '3b9d1c7a0e5f42b8a6c1d9e7f0a2b4c6',
  accessKeyId: 'a41f9c0e2b7d44f1e83c',
  secretAccessKey: '8f2c41e0b97d4a5e9c13f7a06b2d88e4c5f1a3d7',
  bucketName: 'picnexus-images',
  publicDomain: 'https://img.lumen-notes.dev',
  path: '',
};

const NAS = {
  id: 'nas',
  name: '家里 NAS',
  url: 'http://192.168.1.20:5005/dav',
  username: 'picnexus',
  passwordEncrypted: 'mock-encrypted',
  remotePath: '/picnexus',
  publicDomain: 'http://nas.lumen.home:5005/picnexus',
  publicUrlTemplate: '{domain}/{path}',
  uniqueFileName: true,
};

const HOSTS = {
  availableServices: ['weibo', 'jd', 'r2', 'webdav:nas'],
  enabledServices: ['weibo', 'jd', 'r2'],
  services: { weibo: { enabled: true, cookie: 'SUB=_2A25Lmock' }, r2: { enabled: true, ...R2 } },
  webdav_profiles: [NAS],
};

/** 微博登录失效（上传时认出来的） */
const HEALTH = {
  '/mock/appdata/.sync-status.dat': JSON.stringify({
    serviceHealth: { weibo: { status: 'error', lastVerifiedAt: null, lastError: '登录已过期', errorSource: 'upload' } },
  }),
};

/** 近 14 天每天几张，传到京东和 R2；再有些更早的 */
function rows(): Array<Record<string, unknown>> {
  const daily = [6, 9, 4, 12, 8, 3, 0, 7, 11, 5, 9, 14, 6, 10];
  const out: Array<Record<string, unknown>> = [];
  let n = 0;
  daily.forEach((count, i) => {
    for (let k = 0; k < count; k++) {
      n++;
      const hosts = n % 3 === 0 ? ['jd'] : ['jd', 'r2'];
      const primary = n % 4 === 0 ? 'r2' : 'jd';
      const base = historyRow(n, `截图-${n}.png`, (13 - i) * 1440 + k * 7 + 60, primary);
      out.push({ ...base, successful_service_ids: JSON.stringify(hosts), success_count: hosts.length });
    }
  });
  for (let k = 0; k < 40; k++) {
    n++;
    out.push({ ...historyRow(n, `旧图-${n}.png`, 30 * 1440 + k * 600, 'jd'), successful_service_ids: JSON.stringify(['jd', 'weibo']), success_count: 2 });
  }
  return out;
}

const PASS = { ok: true, failedStep: null, field: null, message: '', steps: ['credentials', 'write', 'public'] };
const SIGNATURE = { ok: false, failedStep: 'credentials', field: 'secret_key', message: '服务商拒绝了签名', steps: ['credentials', 'write', 'public'] };

function seed(extra: E2ESeed = {}): E2ESeed {
  return {
    historyRows: rows(),
    ...extra,
    config: { ...HOSTS, ...extra.config },
    files: { ...HEALTH, ...extra.files },
  };
}

const list = (page: Page) => page.locator('.hosts-list');
const detail = (page: Page) => page.locator('.host-detail');

async function openHosts(page: Page, data: E2ESeed): Promise<void> {
  await openApp(page, data);
  await page.getByRole('navigation').getByRole('link', { name: '图床', exact: true }).click();
  await expect(list(page)).toBeVisible();
}

async function pick(page: Page, name: string): Promise<void> {
  await list(page).getByRole('option', { name }).click();
  await expect(detail(page).locator('.host-head__name')).toHaveText(name);
  // 点完移开：不然那一行停在悬停态（浮出「启用 / 停用」）
  await page.mouse.move(0, 0);
}

async function settle(page: Page): Promise<void> {
  await page.clock.runFor(600);
  await page.mouse.move(0, 0);
}

interface State {
  data?: E2ESeed;
  /** 只录窄窗口（P14 / P15 本来就是 800×600 的画板） */
  narrowOnly?: boolean;
  act?: (page: Page, narrow: boolean) => Promise<void>;
}

const STATES: Record<string, State> = {
  'P01-jd': {
    act: async (page, narrow) => {
      await pick(page, '京东');
      await settle(page);
      // 悬停「家里 NAS」那一行：浮出「启用」
      if (!narrow) await list(page).getByRole('option', { name: '家里 NAS' }).hover();
    },
  },
  'P02-weibo': { act: async (page) => { await pick(page, '微博'); } },
  'P03-github': {
    act: async (page) => {
      await list(page).getByRole('button', { name: '添加图床' }).click();
      await page.locator('.host-catalog__card', { hasText: 'GitHub' }).click();
      await page.locator('#host-github-token').click();
      await page.keyboard.type('ghp_mock0123456789abcdefghij');
      await page.locator('#host-github-repo').click();
      await page.keyboard.type('lumen/picnexus-images');
      await page.locator('#host-github-path').click();
      await page.keyboard.type('images/');
      await page.locator('#host-github-path').blur();
      await page.locator('.hosts__scroll').evaluate((el) => el.scrollTo(0, 0));
    },
  },
  'P04-r2': { act: async (page) => { await pick(page, 'Cloudflare R2'); } },
  'P05-nas': { act: async (page) => { await pick(page, '家里 NAS'); } },
  'P06-testing': {
    data: { invokeOverrides: { probe_s3_storage: { hang: true } } },
    act: async (page) => {
      await pick(page, 'Cloudflare R2');
      await detail(page).getByRole('button', { name: '测试连接' }).click();
      await expect(detail(page).getByRole('button', { name: '正在检测…' })).toBeDisabled();
    },
  },
  'P07-test-ok': {
    data: { invokeOverrides: { probe_s3_storage: { result: PASS, delayMs: 180 } } },
    act: async (page) => {
      await pick(page, 'Cloudflare R2');
      await detail(page).getByRole('button', { name: '测试连接' }).click();
      await page.clock.runFor(180);
      await expect(detail(page).getByRole('status')).toContainText('服务可用 · 180ms');
    },
  },
  'P08-test-fail': {
    data: { invokeOverrides: { probe_s3_storage: { result: SIGNATURE } } },
    act: async (page) => {
      await pick(page, 'Cloudflare R2');
      await detail(page).getByRole('button', { name: '测试连接' }).click();
      await expect(detail(page).getByRole('alert')).toContainText('Secret Access Key 无效');
    },
  },
  'P09-secret-revealed': {
    act: async (page) => {
      await pick(page, 'Cloudflare R2');
      await detail(page).getByRole('button', { name: '查看' }).click();
      await expect(detail(page)).toContainText('30 秒后自动隐藏');
    },
  },
  'P10-secret-editing': {
    act: async (page) => {
      await pick(page, 'Cloudflare R2');
      await detail(page).getByRole('button', { name: '修改Secret Access Key' }).click();
      await expect(detail(page)).toContainText('失焦后自动保存并测试');
    },
  },
  'P11-risk-dialog': {
    data: { config: { publicServiceRiskAccepted: false, enabledServices: ['weibo', 'r2'] } },
    act: async (page) => {
      await pick(page, '京东');
      await detail(page).getByRole('button', { name: '启用', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('启用公共图床？');
    },
  },
  'P12-http-dialog': {
    data: { invokeOverrides: { test_webdav_storage: { errorValue: { type: 'WEBDAV_LAN_HTTP_UNCONFIRMED', data: { message: 'fake-ip' } } } } },
    act: async (page) => {
      await pick(page, '家里 NAS');
      await detail(page).getByRole('button', { name: '测试连接' }).click();
      await expect(page.getByRole('dialog')).toContainText('允许通过 HTTP 访问此地址？');
    },
  },
  'P13-add-menu': {
    act: async (page) => {
      await list(page).getByRole('button', { name: '添加图床' }).click();
      await page.locator('.host-catalog__card', { hasText: '七鱼' }).hover();
    },
  },
  'P14-narrow-list': { narrowOnly: true },
  'P15-narrow-detail': { narrowOnly: true, act: async (page) => { await pick(page, 'Cloudflare R2'); } },
};

for (const size of SIZES) {
  test.describe(`图床 · ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const [name, state] of Object.entries(STATES)) {
      if (state.narrowOnly && size.name !== 'narrow') continue;
      test(name, async ({ page }) => {
        await openHosts(page, seed(state.data));
        await settle(page);
        await state.act?.(page, size.name === 'narrow');
        await capture(page, `hosts-${name}-${size.name}`);
      });
    }
  });
}
