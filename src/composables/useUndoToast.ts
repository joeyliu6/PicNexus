// 撤销 Toast Composable
// 「先生效、可撤销」或「倒计时后才执行」：通知底部一条倒计时细线 +「撤销」按钮（T05-Toasts.dc.html）。
// 每一轮各管各的：再来一轮不会撤掉上一轮；通知被挤掉或到时间都按「生效」处理（没人能再点撤销了）。

import { UNDO_LIFE } from '@/components/pn/toastStore';
import { useToast } from './useToast';

export function useUndoToast() {
  const toast = useToast();

  /**
   * 显示带撤销按钮的倒计时通知
   * @param summary  通知标题（写已经发生的事：「已删除方案「Web」」）
   * @param seconds  倒计时秒数，默认 6（Patterns.dc.html）
   * @param kind     success = 绿 ✓（设计稿的撤销通知）；warn = 琥珀 !（还没执行、到时间才执行的危险操作）
   * @returns Promise<boolean>：true = 倒计时结束（操作生效）；false = 用户点了撤销
   */
  const show = (summary: string, seconds?: number, kind: 'success' | 'warn' = 'success'): Promise<boolean> =>
    new Promise((resolve) => {
      let settled = false;
      const settle = (proceed: boolean) => {
        if (settled) return;
        settled = true;
        resolve(proceed);
      };
      const id = toast.withAction(kind, summary, undefined, {
        label: '撤销',
        run: () => {
          settle(false);
          toast.success('已撤销');
        },
      }, {
        life: seconds === undefined ? UNDO_LIFE : seconds * 1000,
        countdown: true,
        onExpire: () => settle(true),
      });
      // 全局静默期间通知发不出来：没有人能点撤销，按到时间处理
      if (id === null) settle(true);
    });

  return { show };
}
