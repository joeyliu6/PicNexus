// 集中管理所有通知文案，便于维护和国际化

// 类型定义
export interface ToastMessageConfig {
  summary: string;
  detail?: string;
  life?: number;
}

type StaticMessage = ToastMessageConfig;

export const TOAST_MESSAGES = {
  // === 通用操作 ===
  common: {
    copySuccess: (count?: number): ToastMessageConfig => ({
      summary: '已复制',
      detail: count ? `${count} 个链接` : '链接已复制到剪贴板',
      life: 1500
    }),
    copyFailed: (error: string): ToastMessageConfig => ({
      summary: '复制失败',
      detail: error
    }),
    deleteSuccess: (count: number): ToastMessageConfig => ({
      summary: '已删除',
      detail: `${count} 条记录`
    }),
    deleteFailed: (error: string): ToastMessageConfig => ({
      summary: '删除失败',
      detail: error
    }),
    clearSuccess: (target: string): ToastMessageConfig => ({
      summary: '已清空',
      detail: target
    }),
    clearFailed: (error: string): ToastMessageConfig => ({
      summary: '清空失败',
      detail: error
    }),
    exportSuccess: (count: number): ToastMessageConfig => ({
      summary: '已导出',
      detail: `${count} 条记录`
    }),
    exportFailed: (error: string): ToastMessageConfig => ({
      summary: '导出失败',
      detail: error
    }),
    importSuccess: (detail?: string): ToastMessageConfig => ({
      summary: '已导入',
      detail
    }),
    importFailed: (error: string): ToastMessageConfig => ({
      summary: '导入失败',
      detail: error
    }),
    noSelection: {
      summary: '未选择',
      detail: '请先选择要操作的项目'
    } as StaticMessage,
    noData: {
      summary: '暂无数据',
      detail: '没有可操作的数据'
    } as StaticMessage,
    cancelled: {
      summary: '已取消'
    } as StaticMessage,
    loadFailed: (error: string): ToastMessageConfig => ({
      summary: '加载失败',
      detail: error
    })
  },

  // === 配置相关 ===
  config: {
    saveSuccess: {
      summary: '已保存'
    } as StaticMessage,
    saveFailed: (error: string): ToastMessageConfig => ({
      summary: '保存失败',
      detail: error
    }),
    loadFailed: (error: string): ToastMessageConfig => ({
      summary: '加载失败',
      detail: error
    }),
    validationFailed: (message: string): ToastMessageConfig => ({
      summary: '验证失败',
      detail: message
    }),
    resetWarning: {
      summary: '配置已重置',
      detail: '检测到配置数据异常，已使用默认配置'
    } as StaticMessage
  },

  // === 上传相关 ===
  upload: {
    success: (count: number): ToastMessageConfig => ({
      summary: '上传完成',
      detail: `成功上传 ${count} 个文件`
    }),
    partialSuccess: (success: number, fail: number): ToastMessageConfig => ({
      summary: '部分上传失败',
      detail: `成功 ${success} 个，失败 ${fail} 个`
    }),
    failed: (error: string): ToastMessageConfig => ({
      summary: '上传错误',
      detail: error
    }),
    retrying: (fileName: string, current: number, max: number): ToastMessageConfig => ({
      summary: '正在重试',
      detail: `${fileName} (${current}/${max})`
    }),
    retrySuccess: (serviceName: string): ToastMessageConfig => ({
      summary: '修复成功',
      detail: `${serviceName} 已补充上传成功`
    }),
    retryFailed: (serviceName: string, error: string): ToastMessageConfig => ({
      summary: '重试失败',
      detail: `${serviceName}: ${error}`
    }),
    noService: {
      summary: '未选择图床',
      detail: '请选择至少一个图床服务'
    } as StaticMessage,
    notConfigured: (serviceName: string): ToastMessageConfig => ({
      summary: '未配置',
      detail: `${serviceName} 图床未配置，请先在设置中配置`
    }),
    invalidFormat: (count: number): ToastMessageConfig => ({
      summary: '部分格式不支持',
      detail: `已自动忽略 ${count} 个不支持的文件`
    }),
    noImage: {
      summary: '未检测到图片',
      detail: '请选择有效的图片文件（支持 JPG, PNG, GIF, WEBP, BMP）'
    } as StaticMessage,
    queueCleared: {
      summary: '已清空',
      detail: '上传队列已清空'
    } as StaticMessage,
    completedCleared: {
      summary: '已清空',
      detail: '已完成的上传项已清理'
    } as StaticMessage,
    noRetryNeeded: {
      summary: '无需重试',
      detail: '没有失败的上传项'
    } as StaticMessage,
    selectFailed: (error: string): ToastMessageConfig => ({
      summary: '文件选择失败',
      detail: error
    })
  },

  // === 同步相关 ===
  sync: {
    uploadSuccess: (type: 'config' | 'history', count?: number): ToastMessageConfig => ({
      summary: '已上传',
      detail: type === 'config' ? '配置已上传到云端' : `${count} 条记录已上传`
    }),
    downloadSuccess: (type: 'config' | 'history', count?: number): ToastMessageConfig => ({
      summary: '已下载',
      detail: type === 'config' ? '配置已从云端恢复' : `${count} 条记录已下载`
    }),
    syncFailed: (error: string): ToastMessageConfig => ({
      summary: '同步失败',
      detail: error
    }),
    uploadFailed: (error: string): ToastMessageConfig => ({
      summary: '上传失败',
      detail: error
    }),
    downloadFailed: (error: string): ToastMessageConfig => ({
      summary: '下载失败',
      detail: error
    }),
    noWebDAV: {
      summary: '请先配置 WebDAV 连接'
    } as StaticMessage,
    noHistory: {
      summary: '没有可导出的历史记录'
    } as StaticMessage,
    noNewRecords: {
      summary: '无需上传',
      detail: '本地没有新增的记录'
    } as StaticMessage,
    refreshHint: {
      summary: '请刷新页面以使配置生效'
    } as StaticMessage,
    forceUploadSuccess: (count: number): ToastMessageConfig => ({
      summary: '已强制覆盖',
      detail: `云端记录（${count} 条）`
    })
  },

  // === 网络状态 ===
  network: {
    disconnected: {
      summary: '网络已断开',
      detail: '请检查网络连接'
    } as StaticMessage,
    restored: {
      summary: '网络已恢复',
      detail: '可以继续上传'
    } as StaticMessage
  },

  // === 认证相关 ===
  auth: {
    success: (serviceName: string): ToastMessageConfig => ({
      summary: '验证成功',
      detail: `${serviceName} 连接正常`
    }),
    tokenValid: (serviceName: string): ToastMessageConfig => ({
      summary: '验证成功',
      detail: `${serviceName} Token 有效`
    }),
    configValid: (serviceName: string): ToastMessageConfig => ({
      summary: '验证成功',
      detail: `${serviceName} 配置有效`
    }),
    cookieValid: (serviceName: string): ToastMessageConfig => ({
      summary: '验证成功',
      detail: `${serviceName} Cookie 有效`
    }),
    failed: (serviceName: string, error?: string): ToastMessageConfig => ({
      summary: '验证失败',
      detail: error || `${serviceName} 连接失败`
    }),
    tokenFailed: (serviceName: string, error: string): ToastMessageConfig => ({
      summary: '认证失败',
      detail: `${serviceName} Token 验证失败：${error}`
    }),
    connectionFailed: (serviceName: string, error: string): ToastMessageConfig => ({
      summary: '连接失败',
      detail: `${serviceName} 连接失败：${error}`
    }),
    testFailed: (error: string): ToastMessageConfig => ({
      summary: '测试失败',
      detail: error
    }),
    cookieUpdated: (serviceName: string): ToastMessageConfig => ({
      summary: 'Cookie 已更新',
      detail: `${serviceName} Cookie 已自动填充并保存！`
    }),
    cookieInvalid: {
      summary: 'Cookie 无效',
      detail: '接收到的 Cookie 为空'
    } as StaticMessage,
    unsupportedService: (serviceId: string): ToastMessageConfig => ({
      summary: '不支持的服务',
      detail: `${serviceId} 不支持自动获取 Cookie`
    }),
    loginWindowFailed: (error: string): ToastMessageConfig => ({
      summary: '打开登录窗口失败',
      detail: error,
      life: 5000
    }),
    serviceAvailable: (serviceName: string): ToastMessageConfig => ({
      summary: `${serviceName}可用`
    }),
    serviceUnavailable: (serviceName: string): ToastMessageConfig => ({
      summary: `${serviceName}不可用`
    })
  },

  // === 历史记录 ===
  history: {
    jumpFailed: (error: string): ToastMessageConfig => ({
      summary: '跳转失败',
      detail: error
    }),
    invalidId: {
      summary: '删除失败',
      detail: '无效的项目ID'
    } as StaticMessage,
    noLink: (serviceName?: string): ToastMessageConfig => ({
      summary: '无可用链接',
      detail: serviceName ? `${serviceName} 图床没有可用的链接` : '该项目没有可用的链接'
    }),
    noLoadableData: {
      summary: '无可用数据',
      detail: '选中的项目无法加载'
    } as StaticMessage
  },

  // === 剪贴板 ===
  clipboard: {
    pasteFailed: (error?: string): ToastMessageConfig => ({
      summary: '粘贴失败',
      detail: error || '无法读取剪贴板图片'
    })
  },

  // === 云存储 ===
  cloudStorage: {
    dragNotSupported: (count: number): ToastMessageConfig => ({
      summary: '提示',
      detail: `拖拽上传 ${count} 个文件暂不支持，请使用上传按钮`
    }),
    folderRenameNotSupported: {
      summary: '暂不支持',
      detail: '文件夹重命名功能暂不支持'
    } as StaticMessage,
    renameHint: {
      summary: '提示',
      detail: '重命名功能需要先下载再上传，建议在 Web 控制台操作'
    } as StaticMessage,
    moveHint: {
      summary: '提示',
      detail: '移动功能开发中，建议在 Web 控制台操作'
    } as StaticMessage,
    createFolderHint: {
      summary: '提示',
      detail: '创建文件夹功能开发中，可直接上传文件时指定路径'
    } as StaticMessage,
    folderDownloadNotSupported: {
      summary: '无法下载',
      detail: '不支持下载文件夹'
    } as StaticMessage,
    downloadStarted: (fileName: string): ToastMessageConfig => ({
      summary: '开始下载',
      detail: `正在下载 "${fileName}"`
    }),
    downloadFailed: {
      summary: '下载失败',
      detail: '无法获取下载链接'
    } as StaticMessage,
    invalidFile: {
      summary: '无法复制',
      detail: '请选择有效的文件'
    } as StaticMessage,
    renameFailed: (error: string): ToastMessageConfig => ({
      summary: '重命名失败',
      detail: error
    })
  },

  // === 缓存 ===
  cache: {
    clearSuccess: {
      summary: '已清理',
      detail: '应用缓存已清理，可能需要重新加载部分数据'
    } as StaticMessage,
    clearFailed: (error: string): ToastMessageConfig => ({
      summary: '清理失败',
      detail: error
    })
  },

  // === 通用提示 ===
  hint: {
    tauriDragDrop: {
      summary: '请使用 Tauri 文件拖拽',
      detail: '文件拖拽功能由 Tauri 提供'
    } as StaticMessage
  }
} as const;
