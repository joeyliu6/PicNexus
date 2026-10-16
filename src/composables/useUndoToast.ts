// 撤销 Toast Composable（模块级单例）
// 用于高破坏性操作的「倒计时后才执行」模式：通知底部一条倒计时细线 +「撤销」按钮，
// 倒计时走完才真正执行；期间点「撤销」中止。同一时间只保留一轮。

import { dismissToast } from '@/components/pn/toastStore';
import { useToast } from './useToast';

let pending: { id: number | null; resolve: (proceed: boolean) => void } | null = null;

function settle(proceed: boolean): void {
  const current = pending;
  pending = null;
  current?.resolve(proceed);
}

export function useUndoToast() {
  const toast = useToast();

  /**
   * 显示带撤销按钮的倒计时通知
   * @param summary  通知标题
   * @param seconds  倒计时秒数，默认 5
   * @returns Promise<boolean>：true = 倒计时结束、执行操作；false = 用户撤销（或被下一轮顶掉）
   */
  const show = (summary: string, seconds = 5): Promise<boolean> => {
    if (pending?.id != null) dismissToast(pending.id);
    settle(false);

    return new Promise((resolve) => {
      const round = { id: null as number | null, resolve };
      pending = round;
      round.id = toast.withAction('warn', summary, undefined, { label: '撤销', run: cancel }, {
        life: seconds * 1000,
        countdown: true,
        onExpire: () => { if (pending === round) settle(true); },
      });
      // 全局静默期间通知发不出来：没有人能点撤销，按到时间处理
      if (round.id === null) settle(true);
    });
  };

  /** 撤销——收回通知并 resolve(false) */
  function cancel(): void {
    if (!pending) return;
    if (pending.id != null) dismissToast(pending.id);
    settle(false);
    toast.success('已撤销', '历史记录保留完好');
  }

  return { show, cancel };
}
