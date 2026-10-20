// 日历选中格的外圈：整圈要落在格子之间的空隙里，否则会盖住旁边的格子（选中那格也会被后画的邻格压住一半）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../../src/styles/tokens-extra.css'), 'utf-8');

function px(name: string): number[] {
  return [...css.matchAll(new RegExp(`${name}:\\s*([\\d.]+)px`, 'g'))].map((m) => Number(m[1]));
}

/** 外扩的 box-shadow（不带 inset）里最大的扩散半径 */
function outerSpreads(): number[] {
  return [...css.matchAll(/--pn-calendar-pick-ring:\s*([^;]+);/g)].map((m) => Math.max(0, ...m[1]
    .split(/,(?![^(]*\))/)
    .filter((part) => !part.includes('inset'))
    .map((part) => Number(/0 0 0 ([\d.]+)px/.exec(part)?.[1] ?? 0))));
}

describe('上传日历选中圈', () => {
  it('浅色、深色两套都不超过最窄的格间距', () => {
    const gaps = [...px('--pn-space-calendar-cell-gap'), ...px('--pn-space-calendar-cell-gap-narrow')];
    expect(gaps).toHaveLength(2);
    const spreads = outerSpreads();
    expect(spreads).toHaveLength(2);
    for (const spread of spreads) expect(spread).toBeLessThanOrEqual(Math.min(...gaps));
  });
});
