// 撤销 Toast Composable（模块级单例）
// 用于高破坏性操作的"倒计时撤销"模式：
// 确认后在 Toast 里显示 "(Xs)" 倒计时，期间可点撤销中止
//
// 实现要点：复用 useToast 暴露的 addRaw / removeGroup 入口，
// 这样"已撤销"成功提示也能享受统一的去重/抑制机制，
// 避免之前直接持有 primeToast 单例造成的两套 Toast 体系问题。

import { reactive } from 'vue';
import { useToast } from './useToast';

const UNDO_GROUP = 'undo';

interface UndoToastState {
  summary: string;
  remaining: number;
}

const state = reactive<UndoToastState>({
  summary: '',
  remaining: 0,
});

let resolveRef: ((value: boolean) => void) | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
// useToast 实例缓存：模块级单例，避免在非 setup 上下文重复 inject
let toastApi: ReturnType<typeof useToast> | null = null;

function clearTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

export function useUndoToast() {
  // 在 setup 阶段捕获 Toast 服务（inject 上下文仅在此时可用）
  if (!toastApi) {
    toastApi = useToast();
  }

  /**
   * 显示带撤销按钮的倒计时 Toast
   * @param summary  Toast 标题文案
   * @param seconds  倒计时秒数，默认 5
   * @returns Promise<boolean>：true = 倒计时结束执行操作，false = 用户撤销
   */
  const show = (summary: string, seconds = 5): Promise<boolean> => {
    resolveRef?.(false);
    resolveRef = null;
    clearTimer();
    return new Promise((resolve) => {
      resolveRef = resolve;
      state.summary = summary;
      state.remaining = seconds;

      toastApi!.addRaw({
        group: UNDO_GROUP,
        severity: 'error',
        closable: false,
      });

      timerId = setInterval(() => {
        state.remaining--;
        if (state.remaining <= 0) {
          clearTimer();
          toastApi!.removeGroup(UNDO_GROUP);
          resolve(true);
          resolveRef = null;
        }
      }, 1000);
    });
  };

  /**
   * 撤销——停止计时并关闭 Toast
   */
  const cancel = () => {
    clearTimer();
    toastApi?.removeGroup(UNDO_GROUP);
    toastApi?.success('已撤销', '历史记录保留完好');
    resolveRef?.(false);
    resolveRef = null;
  };

  return { state, show, cancel };
}
