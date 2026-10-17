import { expect, test, type Page } from '@playwright/test';
import type { E2ESeed } from '../e2e/mocks/state';
import { capture, freezeTime, historyRow, NOW, openApp, SIZES } from './helpers';

/**
 * 链接健康各状态的像素基准，名字前缀对应设计画板 L01–L18（docs/design/redesign/handoff/states/STATES.md）。
 * K04 由每张图的 narrow 尺寸覆盖，K08 由深色那一套覆盖。
 * 样本仿 HealthScreen.dc.html：失效集中在 2020–2023 年上传到微博的图片，一部分有京东 / R2 备份；
 * 文档文件夹 D:\Notes 里有三篇 Markdown 引用了其中几张。
 */

type Copy = 'ok' | 'gone' | 'denied' | 'timeout' | 'limited' | 'unchecked';

interface Pic {
  name: string;
  /** 上传时间（东八区） */
  at: string;
  /** 每份的状态；第一个是「复制时使用」的那份；响应时间按顺序 300 / 120 / 500 ms */
  copies: Array<[host: string, state: Copy]>;
}

const DEAD: Pic[] = [
  { name: '2022-读书笔记-配图.jpg', at: '2022-09-05T21:40', copies: [['weibo', 'gone'], ['jd', 'ok']] },
  { name: 'tokio-调度.png', at: '2023-05-22T10:00', copies: [['weibo', 'gone'], ['r2', 'ok']] },
  { name: 'tokio-任务模型.png', at: '2023-05-22T10:05', copies: [['weibo', 'gone'], ['jd', 'ok']] },
  { name: '年度数据.png', at: '2021-12-30T15:00', copies: [['jd', 'denied'], ['r2', 'ok']] },
  { name: '架构-旧版.png', at: '2021-03-08T09:00', copies: [['weibo', 'gone'], ['jd', 'ok']] },
  { name: 'Kafka-分区示意.png', at: '2020-06-03T10:00', copies: [['r2', 'timeout']] },
  { name: '旧博客-封面.jpg', at: '2020-11-18T20:00', copies: [['weibo', 'gone']] },
  { name: '讲座-签到表.jpg', at: '2020-11-18T21:00', copies: [['weibo', 'gone'], ['jd', 'gone']] },
];

const LIMITED: Pic[] = [
  { name: '2025-年终总结-配图.png', at: '2025-12-31T20:00', copies: [['weibo', 'limited'], ['jd', 'ok']] },
];

/** 平常的图：每年若干天、每天几张，日历才有深浅 */
function okPics(): Pic[] {
  const pics: Pic[] = [];
  const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  let n = 0;
  for (const year of years) {
    for (let i = 0; i < 18; i++) {
      const month = (i * 7 + year) % 12;
      const day = ((i * 11 + year) % 27) + 1;
      if (year === 2026 && month > 8) continue;
      for (let k = 0; k <= (i + year) % 4; k++) {
        n++;
        const copies: Pic['copies'] = n % 3 === 0 ? [['jd', 'ok']] : [['jd', 'ok'], ['r2', 'ok']];
        pics.push({ name: `截图-${year}-${n}.png`, at: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(9 + k).padStart(2, '0')}:00`, copies });
      }
    }
  }
  return pics;
}

const LATENCY = [300, 120, 500];

function row(pic: Pic, index: number, checked = true): Record<string, unknown> {
  const minutesAgo = (NOW.getTime() - new Date(`${pic.at}+08:00`).getTime()) / 60_000;
  const [primary] = pic.copies[0];
  const base = historyRow(index + 1, pic.name, minutesAgo, primary);
  const urlOf = (host: string) => `https://mock.cdn/${host}/h${index + 1}.png`;
  const results = pic.copies.map(([serviceId]) => ({ serviceId, status: 'success', result: { serviceId, fileKey: urlOf(serviceId), url: urlOf(serviceId) } }));
  const checkedCopies = pic.copies.filter((c): c is [string, Exclude<Copy, 'unchecked'>] => c[1] !== 'unchecked');
  const status = Object.fromEntries(checkedCopies.map(([host, s], i) => [host, {
    isValid: s === 'ok',
    lastCheckTime: NOW.getTime() - 3 * 86_400_000,
    responseTime: LATENCY[i],
    errorType: { ok: 'success', gone: 'http_4xx', denied: 'http_4xx', timeout: 'timeout', limited: 'http_4xx' }[s],
    statusCode: { ok: 200, gone: 404, denied: 403, timeout: undefined, limited: 403 }[s],
    browserMightWork: s === 'limited',
  }]));
  return {
    ...base,
    results: JSON.stringify(results),
    generated_link: urlOf(primary),
    link_check_status: checked && Object.keys(status).length ? JSON.stringify(status) : null,
    success_count: pic.copies.length,
    successful_service_ids: JSON.stringify(pic.copies.map(([h]) => h)),
  };
}

const ALL = [...DEAD, ...LIMITED, ...okPics()];
const ROWS = ALL.map((pic, i) => row(pic, i));
const UNCHECKED = ALL.map((pic, i) => row(pic, i, false));
const ALL_GOOD = ALL.map((pic, i) => row({ ...pic, copies: pic.copies.map(([h]) => [h, 'ok']) }, i));
/** L17：只剩 1 份的都在京东上，补到 R2 后每张都至少 2 份 */
const BACKUP_ALL = ALL.map((pic, i) => row(['年度数据.png', 'tokio-调度.png'].includes(pic.name) ? { ...pic, copies: [...pic.copies, ['jd', 'ok']] } : pic, i));
const urlOfPic = (name: string, host: string) => `https://mock.cdn/${host}/h${ALL.findIndex((p) => p.name === name) + 1}.png`;

const DOCS: Record<string, string> = {
  'D:\\Notes\\blog\\2025-年终总结.md': `# 2025\n![](${urlOfPic('2022-读书笔记-配图.jpg', 'weibo')})\n![](${urlOfPic('2022-读书笔记-配图.jpg', 'weibo')})\n`,
  'D:\\Notes\\rust\\Rust 异步踩坑记.md': `![](${urlOfPic('tokio-调度.png', 'weibo')})\n![](${urlOfPic('旧博客-封面.jpg', 'weibo')})\n`,
  'D:\\Code\\toy-project\\README.md': `![](${urlOfPic('年度数据.png', 'jd')})\n`,
};

function scanResult(folder: string): Record<string, unknown> {
  const files = Object.entries(DOCS)
    .filter(([path]) => path.startsWith(`${folder}\\`))
    .map(([filePath, text]) => ({
      filePath,
      fileName: filePath.split('\\').pop(),
      links: [...text.matchAll(/!\[\]\((.+?)\)/g)].map((m, i) => ({ url: m[1], lineNumber: i + 2, originalText: m[0], altText: '', syntax: 'markdown', context: 'normal' })),
    }));
  return { files, totalFiles: files.length, totalLinks: 0, elapsedMs: 1, skippedDirs: [], readFailedFiles: [] };
}

const FOLDERS = ['D:\\Notes', 'D:\\Code\\toy-project'];
/** 文件夹里还有些没有失效图片的文档（「97 个文档」） */
const PLAIN_DOCS = Array.from({ length: 6 }, (_, i) => ({ filePath: `D:\\Notes\\misc\\note-${i}.md`, fileName: `note-${i}.md`, links: [] }));

const HOSTS = {
  availableServices: ['jd', 'r2', 'weibo'],
  enabledServices: ['jd', 'r2'],
  services: {
    r2: { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucketName: 'b', publicDomain: 'https://img.example.com' },
    weibo: { cookie: 'SUB=x' },
  },
};

function seed(extra: E2ESeed = {}, folders = FOLDERS): E2ESeed {
  const notes = scanResult('D:\\Notes') as { files: unknown[] };
  return {
    config: { ...HOSTS, linkHealth: { docFolders: folders, autoCheck: { enabled: true, intervalDays: 7 } } },
    historyRows: ROWS,
    files: DOCS,
    ...extra,
    invokeOverrides: {
      scan_md_folder: { byArg: { key: 'dir', results: { 'D:\\Notes': { ...notes, files: [...notes.files, ...PLAIN_DOCS] }, 'D:\\Code\\toy-project': scanResult('D:\\Code\\toy-project') } } },
      ...extra.invokeOverrides,
    },
  };
}

const health = (page: Page) => page.locator('.health');
const status = (page: Page) => page.locator('.health-status');
const deadRow = (page: Page, name: string) => page.locator('.dead-row', { hasText: name });

async function openHealth(page: Page, data: E2ESeed): Promise<void> {
  await openApp(page, data);
  await page.getByRole('navigation').getByRole('link', { name: '链接健康', exact: true }).click();
  await expect(health(page)).toBeVisible();
  await expect(status(page).locator('.health-status__title')).not.toBeEmpty();
}

/** 进度事件：已查 checked 条，顺带这几张图的结果（「边查边出现」） */
async function emitProgress(page: Page, checked: number, total: number, found: Array<[name: string, host: string]>): Promise<void> {
  const results = found.map(([name, host]) => (DEAD.find((p) => p.name === name)?.copies[0][1] === 'timeout' ? {
    history_id: `history-${ALL.findIndex((p) => p.name === name) + 1}`,
    service_id: host,
    link: '',
    is_valid: false,
    error_type: 'timeout',
    browser_might_work: false,
  } : {
    history_id: `history-${ALL.findIndex((p) => p.name === name) + 1}`,
    service_id: host,
    link: '',
    is_valid: false,
    status_code: 404,
    error_type: 'http_4xx',
    browser_might_work: false,
  }));
  await page.evaluate(({ checked, total, results }) => {
    const emit = (globalThis as unknown as { __PICNEXUS_E2E_EMIT__: (e: string, p: unknown) => Promise<void> }).__PICNEXUS_E2E_EMIT__;
    return emit('link-check://progress', { checked, total, current_url: '', recent_results: results });
  }, { checked, total, results });
}

async function settle(page: Page): Promise<void> {
  // 检测中模型 300ms 重算一次、缩略图按页面时钟排队：拨一下时钟让它们到位
  await page.clock.runFor(600);
  await page.mouse.move(0, 0);
}

const STATES: Record<string, { data?: E2ESeed; folders?: string[]; wideOnly?: boolean; act?: (page: Page) => Promise<void> }> = {
  'L01-never-checked': { data: { historyRows: UNCHECKED }, folders: [] },
  'L02-checking': {
    data: { invokeOverrides: { batch_check_links: { hang: true } } },
    act: async (page) => {
      await status(page).getByRole('button', { name: '重新检测' }).click();
      await emitProgress(page, 104, 350, [['tokio-调度.png', 'weibo'], ['2022-读书笔记-配图.jpg', 'weibo'], ['Kafka-分区示意.png', 'r2']]);
      await settle(page);
      await expect(status(page)).toContainText('正在检测');
    },
  },
  'L03-paused': {
    data: { invokeOverrides: { batch_check_links: { hang: true } } },
    act: async (page) => {
      await status(page).getByRole('button', { name: '重新检测' }).click();
      await emitProgress(page, 104, 350, [['tokio-调度.png', 'weibo'], ['2022-读书笔记-配图.jpg', 'weibo'], ['Kafka-分区示意.png', 'r2']]);
      await status(page).getByRole('button', { name: '暂停' }).click();
      await settle(page);
      await expect(status(page)).toContainText('检测已暂停');
    },
  },
  'L04-problems': {},
  'L05-row-menu': {
    act: async (page) => {
      await deadRow(page, '旧博客-封面.jpg').getByRole('button', { name: '更多' }).click();
      await expect(page.locator('.pn-menu')).toContainText('移除失效链接…');
    },
  },
  'L06-card-menu': {
    act: async (page) => {
      await status(page).getByRole('button', { name: '更多' }).click();
      await expect(page.locator('.pn-menu')).toContainText('清理找不回的图片…');
    },
  },
  // 窄窗口隐藏筛选按钮（交接说明 8.3「窄窗口」）：只录宽窗口
  'L07-year-filter': {
    wideOnly: true,
    act: async (page) => {
      await health(page).getByRole('button', { name: /^年份/ }).click();
      await expect(page.locator('.pn-menu')).toContainText('与上方日历同步');
    },
  },
  'L08-day-filter': {
    act: async (page) => {
      await page.getByRole('button', { name: /^2023年5月22日/ }).click();
      await expect(page.locator('.dead-list__chip')).toContainText('2023年5月22日');
    },
  },
  'L09-retry-still': {
    data: { invokeOverrides: { check_image_link: { result: { link: '', is_valid: false, error_type: 'timeout', browser_might_work: false } } } },
    act: async (page) => {
      await health(page).getByRole('button', { name: /^显示其余.*张$/ }).last().click();
      await deadRow(page, 'Kafka-分区示意.png').getByRole('button', { name: '重试' }).click();
      await expect.poll(async () => {
        await page.clock.runFor(300);
        return deadRow(page, 'Kafka-分区示意.png').locator('.dead-row__note').count();
      }).toBe(1);
      await page.mouse.move(0, 0);
      await freezeTime(page);
    },
  },
  'L10-fixing': {
    // 读到第二张（tokio-调度）的记录时停住：第一张已改用、第二张正在修复、其余等待中
    data: { sqlHangFor: `history-${DEAD.findIndex((p) => p.name === 'tokio-调度.png') + 1}` },
    act: async (page) => {
      await status(page).getByRole('button', { name: /^修复/ }).click();
      await expect(status(page)).toContainText('正在修复');
      await settle(page);
    },
  },
  'L11-fixed': {
    act: async (page) => {
      await status(page).getByRole('button', { name: /^修复/ }).click();
      await expect(page.locator('.pn-toaster')).toContainText('已修复');
      await settle(page);
      await freezeTime(page);
    },
  },
  'L12-fix-partial': {
    data: { failWriteTextFile: { 'D:\\Code\\toy-project\\README.md': 'The process cannot access the file because it is being used by another process. (os error 32)' } },
    act: async (page) => {
      await status(page).getByRole('button', { name: /^修复/ }).click();
      await expect(page.locator('.pn-toaster')).toContainText('未能更新');
      await settle(page);
      await freezeTime(page);
    },
  },
  'L13-all-good': { data: { historyRows: ALL_GOOD } },
  'L14-repair-dialog': {
    act: async (page) => {
      await health(page).getByRole('button', { name: '修复文档…' }).click();
      await expect(page.getByRole('dialog')).toContainText('需要修复的文档');
    },
  },
  'L15-backup-dialog': {
    act: async (page) => {
      await health(page).getByRole('button', { name: '补充备份…' }).click();
      await expect(page.getByRole('dialog')).toContainText('复制到');
    },
  },
  'L16-backup-running': {
    data: { invokeOverrides: { upload_to_s3_compatible: { hang: true } } },
    act: async (page) => {
      await health(page).getByRole('button', { name: '补充备份…' }).click();
      await page.getByRole('dialog').getByRole('radio', { name: /Cloudflare R2/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: '开始备份' }).click();
      await expect(health(page)).toContainText('正在复制到');
      await settle(page);
    },
  },
  'L17-backup-done': {
    data: { historyRows: BACKUP_ALL, invokeOverrides: { upload_to_s3_compatible: { urlPrefix: 'https://mock.cdn/r2/new-' } } },
    act: async (page) => {
      await health(page).getByRole('button', { name: '补充备份…' }).click();
      await page.getByRole('dialog').getByRole('radio', { name: /Cloudflare R2/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: '开始备份' }).click();
      await expect(health(page).locator('.tool-card', { hasText: '补充备份' })).toContainText('已完成');
      await settle(page);
    },
  },
  'L18-backup-no-target': {
    data: { config: { availableServices: ['jd'], enabledServices: ['jd'], linkHealth: { docFolders: FOLDERS, autoCheck: { enabled: true, intervalDays: 7 } } } },
  },
};

for (const size of SIZES) {
  test.describe(`链接健康 · ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const [name, state] of Object.entries(STATES)) {
      if (state.wideOnly && size.name !== 'wide') continue;
      test(name, async ({ page }) => {
        await openHealth(page, seed(state.data, state.folders));
        await settle(page);
        await state.act?.(page);
        await capture(page, `health-${name}-${size.name}`);
      });
    }
  });
}
