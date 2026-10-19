// 花瓣排布（PetalScale.dc.html，交接说明规则 4.6）：花瓣 = 图床
// 1–4 个图床画经典四瓣（不足 4 个的空槽留浅灰轮廓）；5–8 个画 N 瓣、花瓣按数量变窄；
// 超过 8 个保持 8 瓣、按状态比例分配（正常在前，异常在后），右下角写总数。

export type PetalState = 'ok' | 'uploading' | 'waiting' | 'failed' | 'limited' | 'empty';

/** 经典四瓣：上、右、下、左（与品牌 Logo 同形） */
export const CLASSIC_PETAL_PATHS = [
  'M64 58L44 29Q40 22 45 16L57 4Q64 -2 71 4L83 16Q88 22 84 29Z',
  'M70 64L99 44Q106 40 112 45L124 57Q130 64 124 71L112 83Q106 88 99 84Z',
  'M64 70L84 99Q88 106 83 112L71 124Q64 130 57 124L45 112Q40 106 44 99Z',
  'M58 64L29 84Q22 88 16 83L4 71Q-2 64 4 57L16 45Q22 40 29 44Z',
] as const;

export const MAX_PETALS = 8;

export interface PetalShape {
  d: string;
  /** SVG transform；经典四瓣为空 */
  transform?: string;
  state: PetalState;
}

export interface PetalLayout {
  petals: PetalShape[];
  /** 超过 8 个图床时右下角的总数，否则 null */
  overflowCount: number | null;
}

/**
 * 5–8 瓣时单瓣横向缩放比例。
 * 设计稿只给了 6 瓣（0.74）和 8 瓣（0.56）两个样例，4.45 / N 取两位小数正好吻合这两个点；
 * 5、7 瓣按同一条曲线推断。
 */
export function petalWidthScale(count: number): number {
  return Math.round((4.45 / count) * 100) / 100;
}

/** 超过 8 个图床时 8 瓣的排列顺序：正常在前，异常在后（PetalScale.dc.html「12 个图床」） */
const OVERFLOW_ORDER: readonly PetalState[] = ['ok', 'uploading', 'waiting', 'empty', 'limited', 'failed'];

/**
 * 把超过 8 个图床的状态按比例分到 8 瓣上。出现过的状态至少占 1 瓣：
 * 12 个图床里只有 1 个失败，按比例只有 0.67 瓣，四舍五入就看不到红了。
 * 先取整数部分（至少 1），多了从超出比例最多的状态里扣，少了补给离比例差得最多的状态。
 */
export function allocatePetals(states: readonly PetalState[], slots = MAX_PETALS): PetalState[] {
  if (states.length <= slots) return [...states];
  const present = OVERFLOW_ORDER.map((state) => ({ state, quota: (states.filter((s) => s === state).length * slots) / states.length }))
    .filter((group) => group.quota > 0)
    .map((group) => ({ ...group, count: Math.max(1, Math.floor(group.quota)) }));
  let total = present.reduce((sum, group) => sum + group.count, 0);
  while (total > slots) {
    const over = present.filter((group) => group.count > 1).sort((a, b) => (b.count - b.quota) - (a.count - a.quota))[0];
    over.count -= 1;
    total -= 1;
  }
  // 按「比例还差多少」从大到小补（被抬到 1 瓣的已经不差了）；一样多时按排列顺序（sort 是稳定的）。
  // 各状态差的加起来正好等于空出来的瓣数，且每个都不到 1，所以一轮补得完
  const byShortfall = [...present].sort((a, b) => (b.quota - b.count) - (a.quota - a.count));
  for (const group of byShortfall.slice(0, slots - total)) group.count += 1;
  return present.flatMap((group) => Array<PetalState>(group.count).fill(group.state));
}

export function layoutPetals(states: readonly PetalState[]): PetalLayout {
  if (states.length <= 4) {
    return {
      petals: CLASSIC_PETAL_PATHS.map((d, i) => ({ d, state: states[i] ?? 'empty' })),
      overflowCount: null,
    };
  }

  const shown = allocatePetals(states);
  const n = shown.length;
  const scale = petalWidthScale(n);
  const step = 360 / n;
  return {
    petals: shown.map((state, i) => ({
      d: CLASSIC_PETAL_PATHS[0],
      transform: `rotate(${(step * i).toFixed(1)} 64 64) translate(64 0) scale(${scale} 1) translate(-64 0)`,
      state,
    })),
    overflowCount: states.length > MAX_PETALS ? states.length : null,
  };
}
