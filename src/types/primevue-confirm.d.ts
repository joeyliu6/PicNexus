/**
 * 给 PrimeVue 的 ConfirmationOptions 补一个自定义字段
 *
 * PrimeVue 4 会把 `confirm.require(options)` 收到的**整个对象**原样交给
 * ConfirmDialog 的 `#message` slot（2026-08-20 实测确认，不是文档写的）。
 * 我们靠这条通道把「本次运行内不再提示」的勾选状态送进对话框、再取回来。
 *
 * 但它的类型只列了自家那几个字段，多传一个就报 TS2353。这里做模块增强，
 * 让这条约定在类型上成立一次，省得每个调用点各写一个 `as never`——
 * 那种写法会顺手把**真正的**拼写错误也一起放过去。
 *
 * 渲染在 `src/App.vue` 的 `#message` slot；写入方见
 * `src/composables/settings/useSecretClearConfirm.ts`。
 */
import 'primevue/confirmationoptions';

declare module 'primevue/confirmationoptions' {
  interface ConfirmationOptions {
    /**
     * 「本次运行内不再提示」勾选框的状态容器；不传就不渲染这个勾选框
     *
     * 是对象不是布尔值：对话框要把用户的选择**写回来**，按值传就断了。
     */
    clearOptOut?: { checked: boolean };
  }
}
