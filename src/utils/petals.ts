// 花瓣排布（PetalScale.dc.html，交接说明规则 4.6）：花瓣 = 图床
// 1–4 个图床画经典四瓣（不足 4 个的空槽留浅灰轮廓）；5–8 个画 N 瓣、花瓣按数量变窄；
// 超过 8 个保持 8 瓣并在右下角写总数。

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

export function layoutPetals(states: readonly PetalState[]): PetalLayout {
  if (states.length <= 4) {
    return {
      petals: CLASSIC_PETAL_PATHS.map((d, i) => ({ d, state: states[i] ?? 'empty' })),
      overflowCount: null,
    };
  }

  const shown = states.slice(0, MAX_PETALS);
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
