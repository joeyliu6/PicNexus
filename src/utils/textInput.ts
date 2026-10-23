// 「能打字的输入框」：右键菜单、弹窗回车都要先认出它

/** 这些 input 不能打字（按钮、勾选、滑块……） */
const NOT_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** 能打字的单行输入框（不含多行文本框） */
export function isTextInput(el: unknown): el is HTMLInputElement {
  return el instanceof HTMLInputElement && !NOT_TEXT_INPUTS.has(el.type);
}
