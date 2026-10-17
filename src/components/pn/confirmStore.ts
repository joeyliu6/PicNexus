// 确认框队列：useConfirm 往这里放请求，PnConfirmHost 一次画一个（先来先画）。
// 只放队列，不碰 Vue 组件，便于单测。

import { computed, reactive } from 'vue';

export type ConfirmResult = 'accept' | 'reject' | 'dismiss';
export type ConfirmTone = 'brand' | 'warning' | 'danger';

export interface ConfirmRequestOptions {
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  tone: ConfirmTone;
  /** 确认按钮用危险样式（红底）；默认焦点随之落在「取消」，回车不会误触 */
  danger: boolean;
  /** 正文下面单独一行等宽显示的内容（P12 明文 HTTP 确认里的地址） */
  code?: string;
}

export interface ConfirmRequest extends ConfirmRequestOptions {
  readonly id: number;
}

interface Pending {
  request: ConfirmRequest;
  resolve: (result: ConfirmResult) => void;
}

const queue = reactive<Pending[]>([]);
let nextId = 1;

export const currentConfirm = computed<ConfirmRequest | null>(() => queue[0]?.request ?? null);

export function requestConfirm(options: ConfirmRequestOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    queue.push({ request: { ...options, id: nextId++ }, resolve });
  });
}

/** 结束当前这一个（id 不匹配时忽略，防止关闭动画期间的重复回调） */
export function settleConfirm(id: number, result: ConfirmResult): void {
  const head = queue[0];
  if (!head || head.request.id !== id) return;
  queue.shift();
  head.resolve(result);
}

/** 代码里主动收回（等价于用户按 Esc） */
export function dismissCurrentConfirm(): void {
  const head = queue[0];
  if (head) settleConfirm(head.request.id, 'dismiss');
}

export function __resetConfirmsForTests(): void {
  queue.splice(0);
  nextId = 1;
}
