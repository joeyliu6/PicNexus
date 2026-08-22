/* global $, $$, browser, describe, it, before */
/**
 * scan-history-fix-2026-08-22 真机验收（portable 隔离库，不碰真实数据）
 *
 * 前置（由外部脚本完成，见 docs/audits/scan-history-fix-2026-08-22.md）：
 * - src-tauri/target/debug/data/portable.json 存在（portable 模式，数据全进该目录）
 * - data/history.db 已 seed 6 条 e2e-* 记录
 *
 * 门控：仅 PICNEXUS_ACCEPTANCE=1 时执行，避免混进常规 smoke / CI。
 * 判据：
 * 1. 正常批量删除按实际条数报 toast（选 2 删 2 → 「2 条记录」）
 * 2. 陈旧行批量删除报实数（外部删 1 行后全选 4 行 → 「3 条记录」，无失败 toast，表清空）
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DB_PATH = path.join(
  __dirname, '..', '..', 'src-tauri', 'target', 'debug', 'data', 'history.db',
);

const suite = process.env.PICNEXUS_ACCEPTANCE === '1' ? describe : describe.skip;

/** msedgedriver 可能连到非主窗口（托盘等）：轮询句柄切到有 .main-layout 的那个 */
async function switchToMainWindow(timeout = 60_000) {
  await browser.waitUntil(async () => {
    const handles = await browser.getWindowHandles();
    for (const handle of handles) {
      try {
        await browser.switchToWindow(handle);
        const found = await browser.execute(
          () => Boolean(document.querySelector('#app .main-layout')),
        );
        if (found) return true;
      } catch {
        // 句柄可能中途失效，继续轮询
      }
    }
    return false;
  }, { timeout, timeoutMsg: 'No window with #app .main-layout found' });
}

async function waitForVisible(selector, timeout = 60_000) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

/** PrimeVue 组件对坐标点击不可靠：一律 DOM 直点 */
async function domClick(selector, timeout = 30_000) {
  await waitForVisible(selector, timeout);
  const result = await browser.execute((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: `${sel} not found` };
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { ok: true };
  }, selector);
  if (!result.ok) throw new Error(result.reason);
}

function dataRowsSelector() {
  return '.history-view .p-datatable-tbody > tr';
}

/** 等表格出现 count 行真实数据（无 skeleton） */
async function waitForDataRows(count, timeout = 60_000) {
  await browser.waitUntil(async () => {
    const state = await browser.execute((sel) => {
      const rows = Array.from(document.querySelectorAll(sel));
      const hasSkeleton = rows.some((row) => row.querySelector('.p-skeleton'));
      return { count: rows.length, hasSkeleton };
    }, dataRowsSelector());
    return !state.hasSkeleton && state.count === count;
  }, { timeout, timeoutMsg: `Expected ${count} data rows without skeleton` });
}

/** 点第 index 行的选择 checkbox */
async function toggleRowCheckbox(index) {
  const result = await browser.execute((sel, i) => {
    const rows = document.querySelectorAll(sel);
    const input = rows[i]?.querySelector('input[type="checkbox"]');
    if (!input) return { ok: false, reason: `row ${i} checkbox not found (rows=${rows.length})` };
    input.click();
    return { ok: true };
  }, dataRowsSelector(), index);
  if (!result.ok) throw new Error(result.reason);
}

/** 表头全选 checkbox */
async function toggleHeaderCheckbox() {
  const result = await browser.execute(() => {
    const input = document.querySelector(
      '.history-view .p-datatable-thead input[type="checkbox"]',
    );
    if (!input) return { ok: false, reason: 'header checkbox not found' };
    input.click();
    return { ok: true };
  });
  if (!result.ok) throw new Error(result.reason);
}

/** 展开浮动操作栏面板并点删除 */
async function clickFabDelete() {
  await waitForVisible('.fab-container');
  await browser.execute(() => {
    const fab = document.querySelector('.fab-container');
    fab.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  });
  await waitForVisible('.fab-panel .panel-item-delete', 10_000);
  await domClick('.fab-panel .panel-item-delete');
}

/**
 * ConfirmDialog：在所有 .p-dialog 里找含「删除」按钮的那个 DOM 直点，并断言它关闭。
 * portable 首启会弹新手引导 dialog（「跳过引导|下一步」），不能只抓第一个 dialog。
 */
async function acceptConfirmDialog() {
  await waitForVisible('.p-dialog');
  const clicked = await browser.execute(() => {
    const dialogs = Array.from(document.querySelectorAll('.p-dialog'));
    if (dialogs.length === 0) return { ok: false, reason: 'dialog not found' };
    const seen = [];
    for (const dialog of dialogs) {
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const accept = buttons.find((candidate) => candidate.textContent.trim() === '删除');
      if (accept) {
        accept.click();
        return { ok: true };
      }
      seen.push(buttons.map((candidate) => candidate.textContent.trim()).join('|'));
    }
    return { ok: false, reason: `accept button not found, saw: ${seen.join(' ;; ')}` };
  });
  if (!clicked.ok) throw new Error(clicked.reason);

  await browser.waitUntil(async () => {
    return await browser.execute(() => {
      const dialogs = Array.from(document.querySelectorAll('.p-dialog'));
      return !dialogs.some((dialog) => Array.from(dialog.querySelectorAll('button'))
        .some((candidate) => candidate.textContent.trim() === '删除'));
    });
  }, { timeout: 10_000, timeoutMsg: 'Confirm dialog did not close after accept click' });
}

/** portable 全新数据目录 = 首次启动，新手引导弹窗会挡操作：出现则点「跳过引导」 */
async function dismissOnboardingIfPresent(timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await browser.execute(() => {
      const skip = Array.from(document.querySelectorAll('.p-dialog button'))
        .find((candidate) => candidate.textContent.trim() === '跳过引导');
      if (skip) {
        skip.click();
        return 'clicked';
      }
      return document.querySelector('.p-dialog') ? 'other-dialog' : 'none';
    });
    if (state === 'clicked') {
      await browser.waitUntil(async () => {
        return await browser.execute(() => !Array.from(document.querySelectorAll('.p-dialog button'))
          .some((candidate) => candidate.textContent.trim() === '跳过引导'));
      }, { timeout: 10_000, timeoutMsg: 'Onboarding dialog did not close after skip click' });
      return;
    }
    if (state === 'none') {
      // 引导可能延迟弹出，短暂再等一轮
      await browser.pause(500);
    } else {
      await browser.pause(300);
    }
  }
}

/** 等出现文本包含 expected 的 toast，同时断言没有失败类 toast */
async function expectToast(expectedDetail, timeout = 15_000) {
  let seenText = '';
  await browser.waitUntil(async () => {
    seenText = await browser.execute(() => {
      const toasts = Array.from(document.querySelectorAll('.p-toast-message'));
      return toasts.map((node) => node.textContent).join(' || ');
    });
    return seenText.includes(expectedDetail);
  }, { timeout, timeoutMsg: `Expected toast containing ${JSON.stringify(expectedDetail)}` });

  if (seenText.includes('失败')) {
    throw new Error(`Unexpected failure toast alongside success: ${seenText}`);
  }
}

async function waitForToastGone(timeout = 15_000) {
  await browser.waitUntil(async () => {
    return await browser.execute(() => !document.querySelector('.p-toast-message'));
  }, { timeout, timeoutMsg: 'Toast did not disappear' });
}

/** 外部进程直删 DB 行（应用收不到事件 → 构造陈旧行） */
function deleteRowExternally(id) {
  const script = [
    'import sqlite3',
    `conn = sqlite3.connect(r'${DB_PATH}')`,
    `conn.execute("DELETE FROM history_items WHERE id='${id}'")`,
    'conn.commit()',
    'print(conn.execute("SELECT COUNT(*) FROM history_items").fetchone()[0])',
  ].join('\n');
  const result = spawnSync('python', ['-c', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`external delete failed: ${result.stderr}`);
  }
  return Number(result.stdout.trim());
}

suite('scan-history-fix acceptance (portable isolated DB)', () => {
  before(async () => {
    await switchToMainWindow();
    await browser.setWindowSize(1280, 900);
    await waitForVisible('#app .main-layout');
    await waitForVisible('.titlebar .app-title');
    await dismissOnboardingIfPresent();
  });

  it('判据 1：正常批量删除按实际条数报 toast', async () => {
    // 打开历史页（导航第 2 个按钮），默认 tab 即表格视图
    await domClick('.sidebar .nav-btn:nth-child(2)');
    await waitForVisible('.history-view .table-view-container');
    await waitForDataRows(6);

    await toggleRowCheckbox(0);
    await toggleRowCheckbox(1);
    await clickFabDelete();
    await acceptConfirmDialog();

    await expectToast('2 条记录');
    await waitForDataRows(4);
  });

  it('判据 2：陈旧行批量删除报实数、无失败 toast、行全部消失', async () => {
    await waitForToastGone();

    // 外部删掉一条仍显示在表格里的记录（e2e-002 在 2026-06 批次，此时必然未被判据 1 删除）
    const remaining = deleteRowExternally('e2e-002');
    if (remaining !== 3) {
      throw new Error(`Expected 3 rows left in DB after external delete, got ${remaining}`);
    }

    // 应用无感知：表格仍显示 4 行（其中 e2e-002 已是陈旧行）
    await waitForDataRows(4);

    await toggleHeaderCheckbox();
    await clickFabDelete();
    await acceptConfirmDialog();

    // 4 选中 - 1 陈旧 = 实际删除 3 条；修复前这里会虚报「4 条记录」
    await expectToast('3 条记录');

    // DB 复核：0 行
    const script = [
      'import sqlite3',
      `conn = sqlite3.connect(r'${DB_PATH}')`,
      'print(conn.execute("SELECT COUNT(*) FROM history_items").fetchone()[0])',
    ].join('\n');
    const result = spawnSync('python', ['-c', script], { encoding: 'utf8' });
    const dbCount = Number(result.stdout.trim());
    if (dbCount !== 0) {
      throw new Error(`Expected empty DB after bulk delete, got ${dbCount} rows`);
    }

    // 陈旧行也随视图刷新消失：数据行归零（空态组件出现与否随视图实现，不作为判据）
    await browser.waitUntil(async () => {
      const rowCount = await browser.execute(
        (sel) => document.querySelectorAll(sel).length,
        dataRowsSelector(),
      );
      return rowCount === 0;
    }, { timeout: 30_000, timeoutMsg: 'Expected all table rows (incl. stale row) to disappear' });
  });
});
