// 集中管理所有通知文案，便于维护和国际化
import { getErrorMessage } from '@/types/errors';
import { UI_COPY } from './uiCopy';
import { formatCount } from '@/utils/formatters';

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
    copyFailed: (error: string): ToastMessageConfig => ({
      summary: '复制失败',
      detail: error
    }),
    exportSuccess: (count: number): ToastMessageConfig => ({
      summary: '已导出',
      detail: `${formatCount(count)} 条记录`
    }),
    /** 读不出记录时请重试；写不进所选的文件（没有权限、磁盘满了）时换个位置 */
    exportFailed: (error: unknown, stage: 'read' | 'write'): ToastMessageConfig => ({
      summary: '导出失败',
      detail: `${getErrorMessage(error)}，${stage === 'write' ? '请换个位置重试' : '请重试'}`
    }),
    noSelection: {
      summary: '未选择',
      detail: '请先选择要操作的项目'
    } as StaticMessage,
    noData: {
      summary: '暂无数据',
      detail: '没有可操作的数据'
    } as StaticMessage,
  },

  // === 配置相关 ===
  config: {
    saveSuccess: {
      summary: '已保存'
    } as StaticMessage,
    /** 改动即保存的地方（设置页、图床页、首页与托盘的「上传到 / 复制为 / 压缩」）没写进去：红色，原因 + 重试 */
    notSaved: (error: unknown): ToastMessageConfig => ({
      summary: '未能保存',
      detail: `${getErrorMessage(error) || '配置文件写入失败'}，请重试`
    }),
    saveFailed: (error: string): ToastMessageConfig => ({
      summary: '保存失败',
      detail: error
    }),
    loadFailed: (error: string): ToastMessageConfig => ({
      summary: '加载失败',
      detail: error
    }),
    keyMismatchReset: {
      summary: '配置已重置为默认值',
      detail: '检测到加密密钥不匹配，所有配置（包含图床密钥）已重置，请重新进行配置。',
      life: 0
    } as StaticMessage,
    /**
     * 存量孤儿密文清理告知
     *
     * `life: 0`（不自动消失）：用户必须去图床页手动重填，一闪而过的提示等于没提示。
     */
    orphanSecretsCleared: (labels: string[]): ToastMessageConfig => ({
      summary: '部分密码已失效，需要重新填写',
      detail: `${labels.join('、')} 的密码因早前设置备份密码而无法解密，已清空。请到图床页重新填写。`,
      life: 0
    }),
    /**
     * 换钥匙搬运时遇到的存量孤儿密文
     *
     * Why 把成功文案并进这一条、而不是再弹一个 success：一条自动消失、一条常驻地叠在
     * 一起，等于对同一次操作给两种色调的回执。有孤儿时用户只需要读一条、只有一个待办。
     *
     * `action` 传成功态的 summary（如「备份密码设置成功」）：换钥匙本身确实成功了，
     * 这条信息不能因为附带一个待办就丢掉。
     */
    orphanSecretsKept: (action: string, labels: string[]): ToastMessageConfig => ({
      summary: `${action}，但部分密码需要重新填写`,
      detail: `${labels.join('、')} 的密码在此之前就已无法解密，没能迁移到新密钥。请到图床页重新填写。`,
      life: 0
    })
  },

  // === 上传相关 ===
  upload: {
    success: UI_COPY.toast.upload.success,
    partialSuccess: (success: number, fail: number): ToastMessageConfig => ({
      summary: '部分上传失败',
      detail: `成功 ${success} 个，失败 ${fail} 个`
    }),
    failed: UI_COPY.toast.upload.failed,
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
    noHost: {
      summary: '先启用一个图床',
      detail: '请在首页「上传到」或图床页启用一个图床。'
    } as StaticMessage,
    invalidFormat: (count: number): ToastMessageConfig => ({
      summary: '部分格式不支持',
      detail: `已自动忽略 ${count} 个不支持的文件`
    }),
    noImage: {
      summary: '未检测到图片',
      detail: '请选择有效的图片文件（支持 JPG, PNG, GIF, WEBP, BMP, SVG, TIFF, ICO, AVIF）'
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

  // === URL 下载 ===
  urlDownload: {
    invalidUrl: {
      summary: '无效 URL',
      detail: '请输入有效的图片链接（以 http:// 或 https:// 开头）'
    } as StaticMessage,
    /** 一个都未能下载（对话框不关，改了地址可以再点） */
    downloadFailed: (reason: string): ToastMessageConfig => ({
      summary: 'URL 下载失败',
      detail: `${reason}，请检查地址后重试`
    }),
    partialFailed: (success: number, failed: number): ToastMessageConfig => ({
      summary: '部分下载失败',
      detail: `成功下载 ${success} 个，失败 ${failed} 个，已上传成功的部分`
    }),
    tooManyUrls: (limit: number, truncated: number): ToastMessageConfig => ({
      summary: 'URL 数量超限',
      detail: `单次最多处理 ${limit} 个 URL，已忽略多余的 ${truncated} 个`
    }),
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
    testFailed: (error: string): ToastMessageConfig => ({
      summary: '测试失败',
      detail: error
    }),
    // 交接说明 8.7：登录成功小窗自动关闭，主窗口通知「已登录 微博」
    cookieUpdated: (serviceName: string): ToastMessageConfig => ({
      summary: `已登录 ${serviceName}`,
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
    noLink: (serviceName?: string): ToastMessageConfig => ({
      summary: '无可用链接',
      detail: serviceName ? `${serviceName} 图床没有可用的链接` : '该项目没有可用的链接'
    }),
    noLoadableData: {
      summary: '无可用数据',
      detail: '选中的项目无法加载'
    } as StaticMessage,
    // 按图床移除链接（链接检测）：回执和确认框用同一个单位——整张图移除说张数，只剥掉链接说个数
    imagesRemoved: (count: number): ToastMessageConfig => ({
      summary: `已从记录中移除 ${formatCount(count)} 张图片`
    }),
    linksRemoved: (count: number): ToastMessageConfig => ({
      summary: `已移除 ${formatCount(count)} 个链接`
    }),
    removePartial: (failedImages: number): ToastMessageConfig => ({
      summary: `${formatCount(failedImages)} 张图片未能移除`,
      detail: '其余的已移除；未移除的仍在列表中，请重试'
    }),
    removeFailed: (error: string): ToastMessageConfig => ({
      summary: '未能移除',
      detail: `${error}，请稍后重试`
    })
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

  // === 通用提示 ===
  hint: {
    tauriDragDrop: {
      summary: '请使用 Tauri 文件拖拽',
      detail: '文件拖拽功能由 Tauri 提供'
    } as StaticMessage
  }
} as const;
