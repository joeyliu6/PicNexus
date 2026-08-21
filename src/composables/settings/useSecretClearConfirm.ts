/**
 * useSecretClearConfirm — 清除已保存凭证前的那句确认
 *
 * 四个设置分组（Token / Cookie / S3 / WebDAV）共用同一句文案。抄四遍的话，
 * 改一处忘三处，同一个动作在不同卡片上说不同的话。
 *
 * Why 用 confirmThreeWay 而不是 confirm：`confirm` 只在点「确认」「取消」时兑现，
 * 按 ESC / 点叉叉关掉时那个 Promise **永远不会兑现**——落在这里就是 `commitDraft`
 * 挂着不返回，输入框卡在空态。三态版本把「叉叉关闭」也报出来，这里一律当成不删。
 */
import { reactive } from 'vue';
import { useConfirm } from '../useConfirm';

/** 确认框文案。删掉的东西拿不回来，所以要把「代价」写进去，不能只问「确定吗」 */
const CLEAR_SECRET_MESSAGE =
  '清除后这一项会被删除，需要重新到服务商控制台获取。确定清除吗？';
const CLEAR_SECRET_HEADER = '清除已保存的凭据';

/**
 * 本次运行内是否已被用户叫停
 *
 * Why 只记在内存里、重启就恢复：这个确认框防的是「全选删掉准备重填，中途被打断」
 * 这种**意外**。而会去点「不再提示」的人，一定是在**故意删**的那一刻点的——
 * 拿一次故意操作换掉以后所有意外的保护，代价不对等。
 *
 * 真正会让人烦的是「一口气连删好几个」（重配图床、跑验收），那是一次会话内的事，
 * 记到会话结束正好够用。所以不落盘、不进配置，页面一刷新就回到有保护的状态。
 *
 * Why 是模块级而不是每个 composable 实例一份：四个设置分组各自调一次
 * `useSecretClearConfirm()`，按实例存的话在 S3 卡片点了「不再提示」，
 * 切到 Token 卡片又会弹——用户眼里那就是没生效。
 */
let mutedForThisSession = false;

/** 仅供测试复位；生产代码不要调用 */
export function resetSecretClearMuteForTest(): void {
  mutedForThisSession = false;
}

/**
 * 返回可直接塞进 `useSensitiveDraft` 的 `confirmClear`
 *
 * 只有用户明确点了「清除」才返回 true；取消、ESC、点叉叉一律 false。
 * 这个方向不能反：判断不出来的时候，宁可留着一把用户想删的钥匙，
 * 也不能删掉一把他还要用的。
 */
export function useSecretClearConfirm(): () => Promise<boolean> {
  const { confirmThreeWay } = useConfirm();

  return async () => {
    if (mutedForThisSession) return true;

    // 交给对话框就地改的勾选状态。传对象而不是布尔值，是因为要让
    // App.vue 那个 slot 把用户的选择**写回来**——布尔值传过去就断了。
    const clearOptOut = reactive({ checked: false });

    const result = await confirmThreeWay({
      header: CLEAR_SECRET_HEADER,
      message: CLEAR_SECRET_MESSAGE,
      acceptLabel: '清除',
      rejectLabel: '取消',
      clearOptOut,
    });

    if (result !== 'accept') return false;

    // 只在**确认清除**时才认这个勾。取消/ESC 时勾了也不算：
    // 那次交互的结论是「不要删」，顺手关掉保护不是用户的意思。
    if (clearOptOut.checked) mutedForThisSession = true;
    return true;
  };
}
