/** restore = 启动时还原（阻塞）；unlock = 设置页同步 / 导入时遇到加密文件 */
export type BackupPasswordDialogMode = 'set' | 'change' | 'disable' | 'restore' | 'unlock';

export type BackupPasswordConfirmPayload =
  | { mode: 'set'; password: string }
  | { mode: 'change'; currentPassword: string; newPassword: string; confirmPassword: string }
  | { mode: 'disable'; currentPassword: string }
  | { mode: 'restore' | 'unlock'; password: string };
