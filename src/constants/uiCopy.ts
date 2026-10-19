export const UI_COPY = {
  actions: {
    confirm: '确认',
    cancel: '取消',
    continue: '继续',
    delete: '删除',
    clear: '清空',
    refresh: '刷新',
    restore: '恢复',
    save: '保存',
    close: '关闭',
  },

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
      success: (count: number) => ({
        summary: '已上传',
        detail: `成功上传 ${count} 个文件`,
      }),
      failed: (error: string) => ({
        summary: '上传失败',
        detail: error,
      }),
    },
  },

  status: {
    waiting: '等待',
    processing: '处理中…',
    completed: '已完成',
    failed: '失败',
    skipped: '已跳过',
    cancelled: '已取消',
  },

  aria: {
    quickActions: 'PicNexus 快捷操作',
    newHostingService: '新增图床',
    publicServiceRisk: '公共图床风险说明',
    clearSelection: '清空选择',
  },
} as const;

export type UiCopy = typeof UI_COPY;
