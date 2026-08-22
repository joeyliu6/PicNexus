import { test, expect } from '@playwright/test';
import { gotoVisualState } from '../helpers';
import { collectLayoutReport } from './layoutProbe';

/**
 * 探针自检 —— 证明布局哨兵真的有牙齿。
 *
 * 一条从不报警的规则和没有规则是一回事。layout-invariants 那份跑绿了只能说明
 * 「现在没塌」，说明不了「塌了能抓到」。这里往页面里塞已知形状的塌陷与已知形状的
 * 正常结构，正反两面都验一遍：
 *
 *   正面：真被裁掉 / 真跑出视口 → 必须报
 *   反面：滚动容器、省略号截断、图片裁切盒 → 必须不报
 *
 * 以后有人为了消除误报去放宽规则，这份会先失败，把「哨兵被架空」这件事挡在门外。
 * 它同样跑在 layout-webkit 上，所以顺带验证了探针本身在 WebKit 下的行为一致。
 */

const HOST_STATE = { page: 'upload', state: 'empty' } as const;

/** 往页面里塞一棵受控的探测树，避免依赖任何业务组件的当前实现 */
async function mountFixture(page: import('@playwright/test').Page, html: string): Promise<void> {
  await page.evaluate((markup) => {
    const host = document.createElement('div');
    host.id = 'probe-self-check';
    // 固定在左上角，避免把业务布局挤变形而污染其他断言
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;';
    host.innerHTML = markup;
    document.body.appendChild(host);
  }, html);
}

test('真的被裁掉时必须报出来', async ({ page }) => {
  await gotoVisualState(page, HOST_STATE.page, HOST_STATE.state);
  await mountFixture(page, `
    <div class="sc-clip-box" style="position:relative;width:100px;height:50px;overflow:hidden;">
      <div class="sc-clipped-child" style="width:300px;height:200px;background:#f00;">x</div>
    </div>
  `);

  const report = await collectLayoutReport(page);

  const x = report.clippedX.find((item) => item.path.includes('sc-clip-box'));
  expect(x, '横向被裁 200px 没有报出来').toBeDefined();
  expect(x!.offenders.join(' ')).toContain('sc-clipped-child');
  expect(x!.overflowBy).toBeGreaterThan(150);

  const y = report.clippedY.find((item) => item.path.includes('sc-clip-box'));
  expect(y, '纵向被裁 150px 没有报出来').toBeDefined();
  expect(y!.offenders.join(' ')).toContain('sc-clipped-child');
});

test('跑出视口的 fixed 层必须报出来', async ({ page }) => {
  await gotoVisualState(page, HOST_STATE.page, HOST_STATE.state);
  await page.evaluate(() => {
    const escapee = document.createElement('div');
    escapee.className = 'sc-escapee';
    escapee.style.cssText = 'position:fixed;left:-200px;top:10px;width:100px;height:100px;background:#0f0;';
    document.body.appendChild(escapee);
  });

  const report = await collectLayoutReport(page);
  const hit = report.escapedViewport.find((item) => item.path.includes('sc-escapee'));
  expect(hit, '整块跑到视口左外侧的 fixed 层没有报出来').toBeDefined();
  expect(hit!.reason).toBe('fixed');
});

test('正常结构不能误报', async ({ page }) => {
  await gotoVisualState(page, HOST_STATE.page, HOST_STATE.state);
  await mountFixture(page, `
    <div class="sc-scroller" style="position:relative;width:100px;height:50px;overflow:auto;">
      <div class="sc-scrolled-child" style="width:300px;height:200px;">x</div>
    </div>
    <div class="sc-ellipsis" style="position:relative;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
      <span class="sc-long-label">这是一段一定放不下的很长很长的标签文字</span>
    </div>
    <div class="sc-crop" style="position:relative;width:40px;height:40px;overflow:hidden;">
      <img class="sc-cover" alt="" style="width:120px;height:120px;"
           src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" />
    </div>
  `);

  const report = await collectLayoutReport(page);
  const all = [...report.clippedX, ...report.clippedY];

  expect(all.filter((item) => item.path.includes('sc-scroller')), '可滚动容器不该算被裁 —— 用户滚一下就能看到').toEqual([]);
  expect(all.filter((item) => item.path.includes('sc-ellipsis')), '单行省略号截断是设计意图，不该报').toEqual([]);
  expect(all.filter((item) => item.path.includes('sc-crop')), '图片裁切盒是设计意图，不该报').toEqual([]);
});
