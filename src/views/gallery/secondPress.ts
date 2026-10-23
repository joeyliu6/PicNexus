// 双击在第二次按下时就算（同 Windows），不等松开，也不靠 dblclick：第一下打开详情后网格、列表随之重排，
// 第二下的按下与松开可能落在不同的格子、不同的行上，按下的那个元素甚至已经被重排拆掉，浏览器就不发 dblclick，
// 这一下双击就丢了。按在格子里的按钮（选择、收藏、复制、⋯）上不算：连点收藏是收藏两次，不是打开大图。

/** 这一下是左键双击的第二次按下，而且不是按在格子里的按钮上 */
export function isSecondPress(event: MouseEvent): boolean {
  if (event.button !== 0 || event.detail !== 2) return false;
  return !(event.target instanceof Element && event.target.closest('button, a, input'));
}
