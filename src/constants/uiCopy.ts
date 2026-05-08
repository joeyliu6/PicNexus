export interface ConfirmCopy {
  header: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  icon: string;
  acceptClass?: string;
}

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

  navigation: {
    main: {
      upload: '上传',
      browse: '浏览',
      maintenance: '维护',
      settings: '设置',
    },
    mainTitle: {
      upload: '上传',
      browse: '浏览记录',
      maintenance: '链接维护',
      settings: '设置',
    },
    settings: {
      title: '设置',
      general: '常规设置',
      hosting: '图床设置',
      advanced: '高级设置',
      backup: '备份与同步',
      about: '关于与更新',
    },
  },

  banner: {
    reload: {
      defaultMessage: '配置已更新，请刷新页面以使其生效',
      action: '刷新',
    },
  },

  confirm: {
    defaults: {
      header: '确认',
      acceptLabel: '确认',
      rejectLabel: '取消',
      icon: 'pi pi-exclamation-triangle',
    },
    delete: {
      header: '确认删除',
      acceptLabel: '删除',
      rejectLabel: '取消',
      icon: 'pi pi-trash',
      acceptClass: 'p-button-danger',
    },
    warn: {
      header: '警告',
      acceptLabel: '继续',
      rejectLabel: '取消',
      icon: 'pi pi-exclamation-triangle',
      acceptClass: 'p-button-warning',
    },
    upload: {
      clearQueue: {
        header: '确认清空',
        message: '确定要清空上传队列吗？此操作不可撤销。',
        acceptLabel: '清空',
        rejectLabel: '取消',
        icon: 'pi pi-exclamation-triangle',
        acceptClass: 'p-button-danger',
      } satisfies ConfirmCopy,
    },
  },

  toast: {
    upload: {
      inProgress: {
        summary: '上传进行中',
        detail: '请等待上传完成后再清空列表。',
        life: 3000,
      },
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
    uploadQueue: {
      icon: 'pi pi-inbox',
      title: '暂无上传队列',
    } satisfies EmptyStateCopy,
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

  dialogs: {
    urlDownload: {
      title: '从 URL 下载图片',
      inputLabel: '图片 URL（每行一个）',
      placeholder: 'https://example.com/image.jpg',
      note: '支持 JPG、PNG、GIF、WEBP、BMP 格式，Ctrl+Enter 快捷提交',
      confirm: '下载并上传',
      downloading: '正在下载...',
    },
    backupPassword: {
      title: {
        set: '设置备份密码',
        restore: '还原备份配置',
        change: '修改备份密码',
        disable: '关闭备份密码',
      },
      description: {
        restore: '你的配置文件已用备份密码加密。输入当时设置的密码，就能还原配置。',
        disable: '关闭后，后续导出的配置不再使用备份密码加密。已有备份仍需原密码打开。',
      },
      field: {
        currentPassword: '当前密码',
        backupPassword: '备份密码',
        password: '密码',
        newPassword: '新密码',
        confirmPassword: '确认密码',
      },
      placeholder: {
        currentPassword: '输入当前备份密码',
        restorePassword: '输入你之前设置的备份密码',
        newPassword: '至少 8 位，包含数字',
        confirmPassword: '再次输入密码',
      },
      strength: {
        minLength: '至少 8 位',
        number: '包含数字',
        letterCase: '大小写字母',
        symbol: '特殊符号',
      },
      note: {
        set: '请妥善保管密码，忘记后将无法还原。',
        change: '修改后旧备份仍需旧密码打开。请妥善保管密码，忘记后将无法还原。',
      },
      error: {
        requiredPassword: '请输入密码',
        requiredCurrentPassword: '请输入当前密码',
        requiredNewPassword: '请输入新密码',
        mismatch: '两次输入的密码不一致',
        wrongPassword: '密码不正确',
        remainingAttempts: (remaining: number) => `密码不正确，剩余尝试次数：${remaining}`,
      },
      action: {
        skipRestore: '跳过，使用默认配置',
        submit: {
          set: '确认设置',
          restore: '确认恢复',
          change: '确认修改',
          disable: '确认关闭',
        },
      },
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
