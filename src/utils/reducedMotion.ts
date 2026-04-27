/**
 * prefers-reduced-motion 工具
 * CSS 侧的 duration 已在 styles/motion.css 通过 @media 查询归零，
 * 本模块负责补齐 JS 侧硬编码的动画时长，让"减弱动效"偏好贯穿整个代码库。
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

export function prefersReducedVisualEffects(): boolean {
  if (prefersReducedMotion()) return true;
  if (typeof navigator === 'undefined') return false;

  const cores = navigator.hardwareConcurrency;
  if (typeof cores === 'number' && cores > 0 && cores <= 4) return true;

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === 'number' && memory > 0 && memory <= 4;
}
