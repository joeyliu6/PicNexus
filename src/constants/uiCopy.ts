export const UI_COPY = {
  confirm: {
    defaults: {
      header: '确认',
      acceptLabel: '确认',
      rejectLabel: '取消',
    },
    warn: {
      header: '警告',
      acceptLabel: '继续',
      rejectLabel: '取消',
    },
  },

  toast: {
    upload: {
      failed: (error: string) => ({
        summary: '上传失败',
        detail: error,
      }),
    },
  },
} as const;

export type UiCopy = typeof UI_COPY;
