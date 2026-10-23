import { expect, test, type Page } from '@playwright/test';
import type { E2ESeed } from '../e2e/mocks/state';
import { capture, historyRow, NOW, openApp, passwordSet, SIZES } from './helpers';

/**
 * 设置页各状态的像素基准，名字前缀对应设计画板 S01–S21（docs/design/redesign/handoff/states/STATES.md）。
 * K05（800×600 · 快捷键）由 S03 的窄窗口那一张覆盖，K10（深色 · 上传与链接）由 S02 的深色那一套覆盖。
 * 样本仿 SettingsScreen.dc.html：坚果云 WebDAV、Markdown、Web / 高清 / 原图三个压缩方案。
 */

const page$ = (page: Page) => page.locator('.settings');

const DAV = 'https://dav.jianguoyun.com/dav/PicNexus';

/** 设计稿里全局快捷键开着（e2e 默认关着，免得冒烟测试注册系统快捷键） */
const SHORTCUTS_ON: E2ESeed = {
  config: { globalShortcut: { enabled: true, uploadClipboard: 'CommandOrControl+Shift+C', uploadFromFile: 'CommandOrControl+Shift+O' } },
};

/** S02 / K10：Markdown、自定义模板、自动复制；压缩开着，三个方案选 Web */
const UPLOAD: E2ESeed = {
  config: {
    linkOutput: { defaultFormat: 'markdown', customTemplate: '<figure><img src="{url}" alt="{filename}"></figure>', autoCopy: true },
    imageCompression: {
      enabled: true,
      activePresetId: 'web',
      presets: [
        { id: 'web', name: 'Web', quality: 80, outputFormat: 'webp', maxLongSide: 2560, scalePercent: 100, skipIfSmallerKB: 100, stripExif: true },
        { id: 'hd', name: '高清', quality: 92, outputFormat: 'jpeg', maxLongSide: 0, scalePercent: 100, skipIfSmallerKB: 0, stripExif: false },
        { id: 'raw', name: '原图', quality: 100, outputFormat: 'original', maxLongSide: 0, scalePercent: 100, skipIfSmallerKB: 0, stripExif: true },
      ],
    },
  },
};

/** S04：京东与 Cloudflare R2 已添加；Obsidian 走京东，命令行已加入 PATH，Typora 还没配置 */
const EDITORS: E2ESeed = {
  config: {
    availableServices: ['jd', 'r2'],
    enabledServices: ['jd', 'r2'],
    services: { r2: { enabled: true, accountId: 'acc', accessKeyId: 'key', secretAccessKey: 'secret', bucketName: 'picnexus', path: '', publicDomain: 'https://img.lumen-notes.dev' } },
    editorServer: { enabled: true, typoraEnabled: false, cliEnabled: true, port: 36677, typoraService: null, obsidianService: 'jd', authToken: 'mock-token' },
  },
  invokeOverrides: {
    get_executable_path: { result: 'C:\\Program Files\\PicNexus\\picnexus.exe' },
    get_cli_path_status: { result: { supported: true, inPath: true, executableDir: 'C:\\Program Files\\PicNexus', commandName: 'picnexus', needsTerminalRestart: false } },
  },
};

/** 压缩预览的样图：横图，天空渐变 + 太阳 + 海面 */
const SAMPLE_PHOTO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b5bdb"/><stop offset="1" stop-color="#f59f00"/></linearGradient></defs><rect width="1600" height="620" fill="url(#s)"/><circle cx="800" cy="600" r="120" fill="#ffd43b"/><rect y="620" width="1600" height="280" fill="#1864ab"/></svg>')}`;

/** 本机 3 条上传记录 */
const LOCAL_ROWS = [1, 2, 3].map((n) => historyRow(n, `截图-${n}.png`, n * 90));

/** S05 / S10–S15：坚果云 WebDAV，2 小时前同步过 */
function backup(extra: E2ESeed = {}): E2ESeed {
  return {
    historyRows: LOCAL_ROWS,
    ...extra,
    config: {
      webdav: {
        profiles: [{ id: 'nut', name: '坚果云', url: 'https://dav.jianguoyun.com/dav/', username: 'me@lumen.dev', passwordEncrypted: 'mock-encrypted', remotePath: '/PicNexus/' }],
        activeId: 'nut',
      },
      ...extra.config,
    },
    files: {
      '/mock/appdata/.sync-status.dat': JSON.stringify({
        status: { syncByProfile: { nut: { providerName: '坚果云', configLastSync: null, configSyncResult: 'success', historyLastSync: null, historySyncResult: 'success', lastSyncAt: NOW.getTime() - 2 * 3600_000 } } },
      }),
      ...extra.files,
    },
  };
}

/** 云端：settings.json 没有（首次同步配置），history.json 里有 5 条本机没有的记录 */
const CLOUD_HISTORY = JSON.stringify([4, 5, 6, 7, 8].map((n) => ({ id: `cloud-${n}`, timestamp: NOW.getTime() - n * 86_400_000, localFileName: `旧图-${n}.png`, filePath: '', primaryService: 'jd', results: [{ serviceId: 'jd', status: 'success', result: { serviceId: 'jd', fileKey: `https://mock.cdn/jd/${n}.png`, url: `https://mock.cdn/jd/${n}.png` } }], generatedLink: `https://mock.cdn/jd/${n}.png` })));
const DAV_OK = {
  webdav_request: {
    result: { status: 201, body: '' },
    byArg: {
      key: ['request.method', 'request.url'],
      results: {
        [`GET ${DAV}/settings.json`]: { status: 404, body: null },
        [`GET ${DAV}/history.json`]: { status: 200, body: CLOUD_HISTORY },
      },
    },
  },
};

/** 云端有一份配置（另一台电脑同步上去的） */
const DAV_CLOUD_CONFIG = {
  webdav_request: {
    result: { status: 201, body: '' },
    byArg: {
      key: ['request.method', 'request.url'],
      results: { [`GET ${DAV}/settings.json`]: { status: 200, body: JSON.stringify({ enabledServices: ['jd'], availableServices: ['jd'], services: {}, onboardingCompleted: true }) } },
    },
  },
};

/** 最近操作的三条（S05） */
async function recentLogs(page: Page): Promise<void> {
  const now = NOW.getTime();
  await page.evaluate(async (at) => {
    const dbPath = '/src/services/database/index.ts';
    const { historyDB }: typeof import('../../src/services/database/index') = await import(/* @vite-ignore */ dbPath);
    const rows = [
      { operation: 'password_change', result: 'success', timestamp: at - 27 * 86_400_000 },
      { operation: 'export_history_local', result: 'success', details: 'D:\\Backup\\picnexus-records.json', timestamp: at - 7 * 86_400_000 },
      { operation: 'sync_history', result: 'success', details: '上传 3 条 · 下载 5 条', timestamp: at - 2 * 3600_000 },
    ];
    for (const [i, row] of rows.entries()) await historyDB.addSyncLog({ id: `log-${i}`, profileId: 'nut', profileName: '坚果云', ...row } as never);
  }, now);
}

async function openSettings(page: Page, data: E2ESeed, group: string, before?: (page: Page) => Promise<void>): Promise<void> {
  await openApp(page, data);
  await before?.(page);
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  await expect(page$(page)).toBeVisible();
  if (group !== '通用') await page$(page).getByRole('button', { name: group, exact: true }).click();
  await expect(page$(page).locator('.settings__title')).toHaveText(group);
}

async function settle(page: Page): Promise<void> {
  await page.clock.runFor(600);
  await page.mouse.move(0, 0);
}

const checkUpdate = (page: Page) => page$(page).getByRole('button', { name: '检查更新' }).click();
const updateNow = async (page: Page) => {
  await checkUpdate(page);
  await page$(page).getByRole('button', { name: '立即更新' }).click();
};
const RELEASE = { version: '1.2.0', total: 18 * 1024 * 1024, body: '## [1.2.0]\n- 图库支持按健康状态筛选\n- 补充备份支持仅处理副本已失效的图片\n- 修复 macOS 托盘图标偶尔不显示的问题' };

interface State {
  group: string;
  data?: E2ESeed;
  before?: (page: Page) => Promise<void>;
  act?: (page: Page, narrow: boolean) => Promise<void>;
}

const STATES: Record<string, State> = {
  'S01-general': { group: '通用' },
  'S02-upload': { group: '上传与链接', data: UPLOAD },
  // 压缩预览（设计没画，decisions/settings.md）：左原图、右压缩后各铺满一栏；左栏滚轮放大一格，右栏不跟着动
  'S02b-compress-preview': {
    group: '上传与链接',
    data: {
      ...UPLOAD,
      dialogOpenResult: 'C:/Users/me/Pictures/海边日落.png',
      invokeOverrides: {
        read_image_as_base64: { result: SAMPLE_PHOTO },
        compress_image: { result: { outputPath: 'C:/tmp/out.webp', originalSize: 2_480_000, compressedSize: 412_000, ratio: 0.166, width: 1600, height: 900, format: 'webp' } },
      },
    },
    act: async (page) => {
      await page$(page).getByRole('button', { name: '压缩预览…' }).click();
      const view = page.locator('.compress-view');
      await expect(view).toContainText('节省 83%');
      await view.locator('[data-pane="original"]').hover();
      await page.mouse.wheel(0, -100);
      await expect(view.locator('[data-pane="original"]')).toContainText('原图 · 112%');
    },
  },
  'S03-shortcut': { group: '快捷键', data: SHORTCUTS_ON },
  'S04-editor': { group: '编辑器与命令行', data: EDITORS },
  // 命令框里点了「复制」：「✓ 已复制」是 CopyButton 自己的绿（成功浅底），不被命令框里的透明底盖成灰字（设计没画，Patterns.dc.html 的已复制）。
  // 绿字与灰字亮度几乎一样，像素比对的容差分不出来，所以另外直接比对成功色令牌
  'S04b-editor-copied': {
    group: '编辑器与命令行',
    data: EDITORS,
    act: async (page) => {
      await page$(page).getByRole('button', { name: '复制', exact: true }).first().click();
      const copied = page$(page).getByRole('button', { name: '已复制', exact: true });
      await expect(copied).toBeVisible();
      await expect.poll(() => copied.evaluate((el) => {
        const token = (name: string, prop: 'color' | 'backgroundColor') => {
          const probe = document.createElement('span');
          probe.style[prop] = `var(${name})`;
          document.body.append(probe);
          const value = getComputedStyle(probe)[prop];
          probe.remove();
          return value;
        };
        const style = getComputedStyle(el);
        return { green: style.color === token('--pn-success', 'color'), soft: style.backgroundColor === token('--pn-success-soft', 'backgroundColor') };
      })).toEqual({ green: true, soft: true });
    },
  },
  'S05-backup': { group: '备份与同步', data: backup(), before: async (page) => { await passwordSet(page); await recentLogs(page); } },
  // 数据位置：配置存储也按这个命令找目录，只能给 mock 自己的那个
  'S06-privacy': { group: '数据与隐私', data: { historyRows: LOCAL_ROWS, invokeOverrides: { get_user_data_dir: { result: '/mock/appdata' } } } },
  'S07-about': { group: '关于', data: { update: RELEASE }, act: (page) => checkUpdate(page) },
  'S08-recording': {
    group: '快捷键',
    data: SHORTCUTS_ON,
    act: async (page) => {
      await page$(page).getByRole('button', { name: /^上传剪贴板图片：/ }).click();
      await expect(page$(page)).toContainText('按下新的组合键…');
    },
  },
  'S09-conflict': {
    group: '快捷键',
    data: SHORTCUTS_ON,
    act: async (page) => {
      await page$(page).getByRole('button', { name: /^上传剪贴板图片：/ }).click();
      await page.keyboard.press('Control+Shift+O');
      await expect(page$(page).getByRole('alert')).toHaveText('该组合键已用于「选择文件上传」，请更换');
    },
  },
  'S10-export-warn': {
    group: '备份与同步',
    data: backup(),
    act: async (page) => {
      await page$(page).getByRole('button', { name: /导出配置…/ }).click();
      await expect(page.getByRole('dialog')).toContainText('先设置备份密码？');
    },
  },
  'S11-syncing': {
    group: '备份与同步',
    data: backup({ invokeOverrides: { webdav_request: { hang: true } } }),
    before: passwordSet,
    act: async (page) => {
      await page$(page).getByRole('button', { name: '同步', exact: true }).click();
      await expect(page$(page).getByRole('button', { name: '同步中' })).toBeDisabled();
    },
  },
  'S12-sync-ok': {
    group: '备份与同步',
    data: backup({ invokeOverrides: DAV_OK }),
    before: passwordSet,
    act: async (page) => {
      await page$(page).getByRole('button', { name: '同步', exact: true }).click();
      await expect(page$(page)).toContainText('已同步 · 上传 3 条 · 下载 5 条');
    },
  },
  'S13-sync-fail': {
    group: '备份与同步',
    data: backup({ invokeOverrides: { webdav_request: { result: { status: 401, body: '' } } } }),
    before: passwordSet,
    act: async (page) => {
      await page$(page).getByRole('button', { name: '同步', exact: true }).click();
      await expect(page$(page).getByRole('button', { name: '重试' })).toBeVisible();
    },
  },
  'S14-overwrite-local': {
    group: '备份与同步',
    data: backup(),
    before: passwordSet,
    act: async (page) => {
      await page$(page).getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: /用云端覆盖本机…/ }).click();
      await expect(page.getByRole('dialog')).toContainText('覆盖本地配置？');
    },
  },
  'S15-refresh-banner': {
    group: '备份与同步',
    data: backup({ invokeOverrides: DAV_CLOUD_CONFIG }),
    before: passwordSet,
    act: async (page) => {
      await page$(page).getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: /用云端覆盖本机…/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: '覆盖本地' }).click();
      await expect(page$(page).getByRole('status').filter({ hasText: '刷新后生效' })).toBeVisible();
    },
  },
  'S16-up-checking': { group: '关于', data: { update: { hang: 'check' } }, act: (page) => checkUpdate(page) },
  'S17-up-latest': {
    group: '关于',
    act: async (page) => {
      await checkUpdate(page);
      await expect(page$(page)).toContainText('已是最新版本');
    },
  },
  'S18-up-downloading': {
    group: '关于',
    data: { update: { ...RELEASE, downloaded: 11 * 1024 * 1024, hang: 'download' } },
    act: async (page) => {
      await updateNow(page);
      await expect(page$(page)).toContainText('正在下载 1.2.0 · 11 / 18 MB');
    },
  },
  'S19-up-installing': {
    group: '关于',
    data: { update: { ...RELEASE, downloaded: 18 * 1024 * 1024, hang: 'install' } },
    act: async (page) => {
      await updateNow(page);
      await expect(page$(page)).toContainText('正在安装…');
    },
  },
  'S20-up-installed': {
    group: '关于',
    data: { update: { ...RELEASE, downloaded: 18 * 1024 * 1024 } },
    act: async (page) => {
      await updateNow(page);
      await expect(page$(page)).toContainText('1.2.0 已安装');
    },
  },
  'S21-up-failed': {
    group: '关于',
    data: { update: { ...RELEASE, downloaded: 6 * 1024 * 1024, downloadError: 'error sending request for url (https://github.com/joeyliu6/PicNexus/releases/download/v1.2.0/PicNexus.msi)' } },
    act: async (page) => {
      await updateNow(page);
      await expect(page$(page)).toContainText('更新失败：下载被中断');
    },
  },
};

for (const size of SIZES) {
  test.describe(`设置 · ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const [name, state] of Object.entries(STATES)) {
      test(name, async ({ page }) => {
        await openSettings(page, state.data ?? {}, state.group, state.before);
        await settle(page);
        await state.act?.(page, size.name === 'narrow');
        await page.mouse.move(0, 0);
        await capture(page, `settings-${name}-${size.name}`);
      });
    }
  });
}
