// 通知队列（交接说明 6.2 / T05-Toasts.dc.html）
// 右下角，最多叠 3 条，新的在最下面，旧的略淡；四种：成功 / 失败 / 警示 / 带「撤销」（底部倒计时细线）。
// 普通通知 4 秒；带撤销的默认 6 秒；鼠标停在通知上时全部暂停计时。
// 只放队列与计时，不碰 Vue 组件，便于单测；画面在 PnToaster.vue。

import { reactive } from 'vue';

export type ToastKind = 'success' | 'error' | 'warn' | 'info';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  kind: ToastKind;
  title: string;
  desc?: string;
  action?: ToastAction;
  /** 停留毫秒数；不给按种类取默认值 */
  life?: number;
  /** 底部画倒计时细线（「撤销」类） */
  countdown?: boolean;
  /** 到时间自然消失（含被新通知挤掉）时调用；点了动作按钮或手动关闭不调用 */
  onExpire?: () => void;
}

export interface ToastItem extends Readonly<Required<Pick<ToastOptions, 'kind' | 'title'>>> {
  readonly id: number;
  readonly desc?: string;
  readonly action?: ToastAction;
  readonly countdown: boolean;
  readonly life: number;
}

export const MAX_TOASTS = 3;
/** 普通通知 4 秒后消失；带「撤销」的停留 6 秒（Patterns.dc.html） */
const PLAIN_LIFE = 4000;
export const UNDO_LIFE = 6000;

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
  onExpire?: () => void;
}

const items = reactive<ToastItem[]>([]);
const timers = new Map<number, Timer>();
let nextId = 1;
let paused = false;

function startTimer(id: number, timer: Timer): void {
  timer.startedAt = Date.now();
  timer.handle = setTimeout(() => expire(id), timer.remaining);
}

function remove(id: number): Timer | undefined {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) items.splice(index, 1);
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
  return timer;
}

function expire(id: number): void {
  remove(id)?.onExpire?.();
}

export function pushToast(options: ToastOptions): number {
  const id = nextId++;
  const life = options.life ?? (options.countdown ? UNDO_LIFE : PLAIN_LIFE);
  items.push({
    id,
    kind: options.kind,
    title: options.title,
    desc: options.desc,
    action: options.action,
    countdown: options.countdown ?? false,
    life,
  });
  const timer: Timer = { handle: null, remaining: life, startedAt: 0, onExpire: options.onExpire };
  timers.set(id, timer);
  if (!paused) startTimer(id, timer);

  // 超过 3 条：挤掉最旧的普通通知；带倒计时的「撤销」类尽量留着，免得用户还没来得及撤销就生效
  while (items.length > MAX_TOASTS) {
    const victim = items.find((item) => !item.countdown && item.id !== id) ?? items[0];
    expire(victim.id);
  }
  return id;
}

/** 关闭一条通知，不触发 onExpire（点了动作按钮、或调用方主动收回） */
export function dismissToast(id: number): void {
  remove(id);
}

export function runToastAction(id: number): void {
  const item = items.find((toast) => toast.id === id);
  if (!item?.action) return;
  remove(id);
  item.action.run();
}

export function pauseToasts(): void {
  if (paused) return;
  paused = true;
  const now = Date.now();
  for (const timer of timers.values()) {
    if (!timer.handle) continue;
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt));
  }
}

export function resumeToasts(): void {
  if (!paused) return;
  paused = false;
  for (const [id, timer] of timers) startTimer(id, timer);
}

export function clearToasts(): void {
  for (const item of [...items]) remove(item.id);
}

export function useToastItems(): readonly ToastItem[] {
  return items;
}

export function __resetToastsForTests(): void {
  clearToasts();
  paused = false;
  nextId = 1;
}
