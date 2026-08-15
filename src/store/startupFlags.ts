/** 应用启动期间产生的一次性状态标记，供 App.vue 在 onMounted 后消费 */
export const startupFlags = {
  configResetDueToKeyMismatch: false,
  /**
   * 启动时清空的孤儿密文名字（如 `WebDAV 图床「我的 OpenList」`）
   * 非空时 App.vue 弹一条不自动消失的警告，提示用户去重填这几个密码
   */
  orphanSecretLabels: [] as string[],
};
