export interface EmptyStateCopy {
  icon: string;
  title: string;
  description?: string;
  hint?: string;
}

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
      icon: 'pi pi-exclamation-triangle',
    },
    warn: {
      header: '警告',
      acceptLabel: '继续',
      rejectLabel: '取消',
      icon: 'pi pi-exclamation-triangle',
      acceptClass: 'p-button-warning',
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

  emptyState: {
    noData: {
      icon: 'pi pi-inbox',
      title: '暂无数据',
      description: '没有可操作的数据',
    } satisfies EmptyStateCopy,
    searchNoResult: {
      icon: 'pi pi-search',
      title: '未找到结果',
      description: '尝试调整搜索关键词或筛选条件',
    } satisfies EmptyStateCopy,
    hostingRequired: {
      icon: 'pi pi-cog',
      title: '暂无可用图床',
      description: '请在设置中配置图床。',
    } satisfies EmptyStateCopy,
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
