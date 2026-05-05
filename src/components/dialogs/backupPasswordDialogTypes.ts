export type BackupPasswordDialogMode = 'set' | 'change' | 'disable' | 'restore';

export type BackupPasswordConfirmPayload =
  | { mode: 'set'; password: string }
  | { mode: 'change'; currentPassword: string; newPassword: string; confirmPassword: string }
  | { mode: 'disable'; currentPassword: string }
  | { mode: 'restore'; password: string };
