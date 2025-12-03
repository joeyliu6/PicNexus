// src/main.ts
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { dialog } from '@tauri-apps/api';

import { Store } from './store';
import { UserConfig, HistoryItem, DEFAULT_CONFIG, ServiceType, LinkPrefixConfig, DEFAULT_PREFIXES, migrateConfig } from './config/types';
import { getCookieProvider } from './config/cookieProviders';
// import { validateR2Config } from './coreLogic'; // 暂未使用

// 新架构导入
import { initializeUploaders } from './uploaders';
import { MultiServiceUploader, MultiUploadResult } from './core/MultiServiceUploader';
import { writeText } from '@tauri-apps/api/clipboard';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { getClient, ResponseType, Body } from '@tauri-apps/api/http';
import { WebviewWindow, appWindow } from '@tauri-apps/api/window';
import { UploadQueueManager } from './uploadQueue';
import { R2Manager } from './r2-manager';
import { showConfirmModal, showAlertModal } from './ui/modal';
import { createApp } from 'vue';
import BackupView from './components/BackupView.vue';
import { basename } from '@tauri-apps/api/path';

// --- GLOBAL ERROR HANDLERS ---
window.addEventListener('error', (event) => {
  console.error('[全局错误]:', event.error);
  // 防止应用崩溃
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[未处理的Promise拒绝]:', event.reason);
  // 防止应用崩溃
  event.preventDefault();
});

// --- STORES ---
const configStore = new Store('.settings.dat');
const historyStore = new Store('.history.dat');

// --- UPLOAD QUEUE MANAGER ---
let uploadQueueManager: UploadQueueManager | null = null;

// --- R2 MANAGER ---
let r2Manager: R2Manager | null = null;

// --- TITLE BAR LOGIC ---
function initTitleBar() {
  document.getElementById('titlebar-minimize')?.addEventListener('click', () => {
    appWindow.minimize();
  });
  document.getElementById('titlebar-maximize')?.addEventListener('click', () => {
    appWindow.toggleMaximize();
  });
  document.getElementById('titlebar-close')?.addEventListener('click', () => {
    appWindow.close();
  });
}

// --- APP STATE (全局状态管理) ---
/**
 * 应用全局状态
 */
export const appState = {
  isR2Dirty: true, // 默认为 true，确保应用启动后第一次点击能加载数据
};

/**
 * Gallery View State Interface
 */
interface GalleryViewState {
  viewMode: 'table' | 'grid';
  currentFilter: ServiceType | 'all';
  displayedItems: HistoryItem[];
  gridLoadedCount: number;
  gridBatchSize: number;
  selectedGridItems: Set<string>;
  lightboxCurrentIndex: number;
}

/**
 * Gallery View State
 */
const galleryState: GalleryViewState = {
  viewMode: 'table',
  currentFilter: 'all',
  displayedItems: [],
  gridLoadedCount: 0,
  gridBatchSize: 50,
  selectedGridItems: new Set(),
  lightboxCurrentIndex: -1,
};

/**
 * 获取 DOM 元素，带空值检查和类型断言
 * @param id 元素 ID
 * @param elementType 元素类型描述（用于错误消息）
 * @returns DOM 元素或 null
 */
function getElement<T extends HTMLElement>(id: string, elementType: string = '元素'): T | null {
  const element = document.getElementById(id);
  if (!element) {
    console.error(`[DOM] ${elementType} 不存在: ${id}`);
    return null;
  }
  return element as T;
}

/**
 * 使用 querySelector 获取 DOM 元素，带空值检查
 * @param selector CSS 选择器
 * @param elementType 元素类型描述（用于错误消息）
 * @returns DOM 元素或 null
 */
function queryElement<T extends HTMLElement>(selector: string, elementType: string = '元素'): T | null {
  const element = document.querySelector(selector);
  if (!element) {
    console.error(`[DOM] ${elementType} 不存在: ${selector}`);
    return null;
  }
  return element as T;
}

// --- DOM ELEMENTS ---
// Views
const uploadView = getElement<HTMLElement>('upload-view', '上传视图');
const historyView = getElement<HTMLElement>('history-view', '历史视图');
const settingsView = getElement<HTMLElement>('settings-view', '设置视图');
const r2ManagerView = getElement<HTMLElement>('r2-manager-view', 'R2管理视图');
const backupView = getElement<HTMLElement>('backup-view', '备份视图');
const linkCheckerView = getElement<HTMLElement>('link-checker-view', '链接检测视图');
const views = [uploadView, historyView, settingsView, r2ManagerView, backupView, linkCheckerView].filter((v): v is HTMLElement => v !== null);

// Navigation
const navUploadBtn = getElement<HTMLButtonElement>('nav-upload', '上传导航按钮');
const navHistoryBtn = getElement<HTMLButtonElement>('nav-history', '历史导航按钮');
const navR2ManagerBtn = getElement<HTMLButtonElement>('nav-r2-manager', 'R2管理导航按钮');
const navBackupBtn = getElement<HTMLButtonElement>('nav-backup', '备份导航按钮');
const navLinkCheckerBtn = getElement<HTMLButtonElement>('nav-link-checker', '链接检测导航按钮');
const navSettingsBtn = getElement<HTMLButtonElement>('nav-settings', '设置导航按钮');
const navButtons = [navUploadBtn, navHistoryBtn, navR2ManagerBtn, navBackupBtn, navLinkCheckerBtn, navSettingsBtn].filter((b): b is HTMLButtonElement => b !== null);

// Upload View Elements
const dropZoneHeader = getElement<HTMLElement>('drop-zone-header', '拖放区域头部');
// Service buttons (上传界面 - 新按钮式UI)
const serviceButtons = {
  weibo: document.querySelector<HTMLButtonElement>('.service-btn[data-service="weibo"]'),
  r2: document.querySelector<HTMLButtonElement>('.service-btn[data-service="r2"]'),
  tcl: document.querySelector<HTMLButtonElement>('.service-btn[data-service="tcl"]'),
  jd: document.querySelector<HTMLButtonElement>('.service-btn[data-service="jd"]'),
  nowcoder: document.querySelector<HTMLButtonElement>('.service-btn[data-service="nowcoder"]'),
  qiyu: document.querySelector<HTMLButtonElement>('.service-btn[data-service="qiyu"]')
};

// Available service checkboxes (设置界面 - 控制哪些图床在上传界面可用)
const availableServiceCheckboxes = {
  weibo: document.querySelector<HTMLInputElement>('#available-weibo'),
  r2: document.querySelector<HTMLInputElement>('#available-r2'),
  tcl: document.querySelector<HTMLInputElement>('#available-tcl'),
  jd: document.querySelector<HTMLInputElement>('#available-jd'),
  nowcoder: document.querySelector<HTMLInputElement>('#available-nowcoder'),
  qiyu: document.querySelector<HTMLInputElement>('#available-qiyu')
};

// Settings View Elements
const weiboCookieEl = getElement<HTMLTextAreaElement>('weibo-cookie', '微博Cookie输入框');
const testCookieBtn = getElement<HTMLButtonElement>('test-cookie-btn', 'Cookie测试按钮');
const cookieStatusEl = getElement<HTMLElement>('cookie-status', 'Cookie状态');
const r2AccountIdEl = getElement<HTMLInputElement>('r2-account-id', 'R2账户ID输入框');
const r2KeyIdEl = getElement<HTMLInputElement>('r2-key-id', 'R2密钥ID输入框');
const r2SecretKeyEl = getElement<HTMLInputElement>('r2-secret-key', 'R2密钥输入框');
const r2BucketEl = getElement<HTMLInputElement>('r2-bucket', 'R2存储桶输入框');
const r2PathEl = getElement<HTMLInputElement>('r2-path', 'R2路径输入框');
const r2PublicDomainEl = getElement<HTMLInputElement>('r2-public-domain', 'R2公开域名输入框');
// 链接前缀配置元素
const prefixEnabledEl = getElement<HTMLInputElement>('prefix-enabled', '前缀启用开关');
const prefixSelectorEl = getElement<HTMLSelectElement>('prefix-selector', '前缀选择器');
const prefixSelectorWrapper = getElement<HTMLElement>('prefix-selector-wrapper', '前缀选择器容器');
const addPrefixBtn = getElement<HTMLButtonElement>('add-prefix-btn', '添加前缀按钮');
const deletePrefixBtn = getElement<HTMLButtonElement>('delete-prefix-btn', '删除前缀按钮');
const addPrefixModal = getElement<HTMLElement>('add-prefix-modal', '添加前缀模态框');
const newPrefixInput = getElement<HTMLInputElement>('new-prefix-input', '新前缀输入框');
const cancelAddPrefixBtn = getElement<HTMLButtonElement>('cancel-add-prefix', '取消添加按钮');
const confirmAddPrefixBtn = getElement<HTMLButtonElement>('confirm-add-prefix', '确认添加按钮');
const webdavUrlEl = getElement<HTMLInputElement>('webdav-url', 'WebDAV URL输入框');
const webdavUsernameEl = getElement<HTMLInputElement>('webdav-username', 'WebDAV用户名输入框');
const webdavPasswordEl = getElement<HTMLInputElement>('webdav-password', 'WebDAV密码输入框');
const webdavRemotePathEl = getElement<HTMLInputElement>('webdav-remote-path', 'WebDAV远程路径输入框');
const nowcoderCookieEl = document.querySelector<HTMLTextAreaElement>('#nowcoder-cookie');
const qiyuTokenEl = document.querySelector<HTMLTextAreaElement>('#qiyu-token');
const saveStatusEl = getElement<HTMLElement>('save-status', '保存状态');
const loginWithWebviewBtn = getElement<HTMLButtonElement>('login-with-webview-btn', 'WebView登录按钮');
const testR2Btn = getElement<HTMLButtonElement>('test-r2-btn', 'R2测试按钮');
const r2StatusMessageEl = getElement<HTMLElement>('r2-status-message', 'R2状态消息');
const testWebdavBtn = getElement<HTMLButtonElement>('test-webdav-btn', 'WebDAV测试按钮');
const webdavStatusMessageEl = getElement<HTMLElement>('webdav-status-message', 'WebDAV状态消息');

// Toast Elements
const globalToastEl = getElement<HTMLElement>('global-toast', '全局Toast容器');
const toastIconEl = getElement<HTMLElement>('toast-icon', 'Toast图标');
const toastMessageEl = getElement<HTMLElement>('toast-message', 'Toast消息');

// History View Elements
const historyBody = getElement<HTMLElement>('history-body', '历史记录表格体');
const clearHistoryBtn = getElement<HTMLButtonElement>('clear-history-btn', '清空历史按钮');
const searchInput = getElement<HTMLInputElement>('search-input', '搜索输入框');
const historyStatusMessageEl = queryElement<HTMLElement>('#history-view #status-message', '历史状态消息');

// Gallery View Elements (新增)
const viewModeTableBtn = getElement<HTMLButtonElement>('view-mode-table', '表格视图按钮');
const viewModeGridBtn = getElement<HTMLButtonElement>('view-mode-grid', '瀑布流视图按钮');
const imageBedFilter = getElement<HTMLSelectElement>('image-bed-filter', '图床筛选器');
const tableViewContainer = getElement<HTMLElement>('table-view-container', '表格视图容器');
const gridViewContainer = getElement<HTMLElement>('grid-view-container', '瀑布流视图容器');
const galleryGrid = getElement<HTMLElement>('gallery-grid', '瀑布流网格');
const gridLoadingIndicator = getElement<HTMLElement>('grid-loading-indicator', '加载指示器');
const gridEndMessage = getElement<HTMLElement>('grid-end-message', '加载完成消息');

// Lightbox Elements (新增)
const lightboxModal = getElement<HTMLElement>('lightbox-modal', 'Lightbox模态框');
const lightboxImage = getElement<HTMLImageElement>('lightbox-image', 'Lightbox图片');
const lightboxFilename = getElement<HTMLElement>('lightbox-filename', 'Lightbox文件名');
const lightboxServiceBadge = getElement<HTMLElement>('lightbox-service-badge', 'Lightbox图床徽章');
const lightboxTimestamp = getElement<HTMLElement>('lightbox-timestamp', 'Lightbox时间戳');
const lightboxClose = getElement<HTMLButtonElement>('lightbox-close', 'Lightbox关闭按钮');
const lightboxPrev = getElement<HTMLButtonElement>('lightbox-prev', 'Lightbox上一张按钮');
const lightboxNext = getElement<HTMLButtonElement>('lightbox-next', 'Lightbox下一张按钮');
const lightboxCopyBtn = getElement<HTMLButtonElement>('lightbox-copy-btn', 'Lightbox复制按钮');
const lightboxDeleteBtn = getElement<HTMLButtonElement>('lightbox-delete-btn', 'Lightbox删除按钮');

// Context Menu Elements (新增)
const contextMenu = getElement<HTMLElement>('context-menu', '右键菜单');
const ctxPreview = getElement<HTMLElement>('ctx-preview', '右键预览');
const ctxCopyLink = getElement<HTMLElement>('ctx-copy-link', '右键复制链接');
const ctxDelete = getElement<HTMLElement>('ctx-delete', '右键删除');

// Link Checker View Elements
const linkCheckerServiceFilter = getElement<HTMLSelectElement>('link-checker-service-filter', '链接检测图床筛选器');
const linkCheckerStartBtn = getElement<HTMLButtonElement>('link-checker-start-btn', '开始检测按钮');
const linkCheckerCancelBtn = getElement<HTMLButtonElement>('link-checker-cancel-btn', '取消检测按钮');
const linkCheckerProgress = getElement<HTMLElement>('link-checker-progress', '链接检测进度条');
const linkCheckerProgressText = getElement<HTMLElement>('link-checker-progress-text', '进度文本');
const linkCheckerProgressPercent = getElement<HTMLElement>('link-checker-progress-percent', '进度百分比');
const linkCheckerProgressBar = getElement<HTMLElement>('link-checker-progress-bar', '进度条');
const linkCheckerTotalEl = getElement<HTMLElement>('link-checker-total', '总数统计');
const linkCheckerValidEl = getElement<HTMLElement>('link-checker-valid', '有效数统计');
const linkCheckerInvalidEl = getElement<HTMLElement>('link-checker-invalid', '失效数统计');
const linkCheckerPendingEl = getElement<HTMLElement>('link-checker-pending', '待检测数统计');
const linkCheckerResultsBody = getElement<HTMLElement>('link-checker-results-body', '检测结果表格');
const linkCheckerDeleteInvalidBtn = getElement<HTMLButtonElement>('link-checker-delete-invalid-btn', '删除失效按钮');

// --- FILE VALIDATION ---
/**
 * 验证文件类型（PRD 1.2）
 * @param filePath 文件路径
 * @returns 是否为有效的图片文件
 */
function validateFileType(filePath: string): boolean {
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
  const lowerPath = filePath.toLowerCase();
  return validExtensions.some(ext => lowerPath.endsWith(ext));
}

/**
 * 从文件路径列表中过滤出有效的图片文件
 * @param filePaths 文件路径列表
 * @returns 过滤后的有效文件路径和被拒绝的文件
 */
async function filterValidFiles(filePaths: string[]): Promise<{ valid: string[]; invalid: string[] }> {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const path of filePaths) {
    if (validateFileType(path)) {
      valid.push(path);
    } else {
      invalid.push(path);
    }
  }

  // 显示被拒绝文件的提示（PRD 1.2）
  if (invalid.length > 0) {
    for (const invalidPath of invalid) {
      const fileName = invalidPath.split(/[/\\]/).pop() || invalidPath;
      await showAlertModal(
        `文件类型不支持：${fileName} 不是一个有效的图片格式，已自动跳过。`,
        '文件类型验证'
      );
      console.warn(`[文件验证] 跳过不支持的文件类型: ${fileName}`);
    }
  }

  return { valid, invalid };
}

/**
 * 并发处理上传队列（新架构 - 多图床并行上传）
 * @param filePaths 文件路径列表
 * @param config 用户配置
 * @param enabledServices 启用的图床服务列表
 * @param maxConcurrent 最大并发数（默认3）
 */
async function processUploadQueue(
  filePaths: string[],
  config: UserConfig,
  enabledServices: ServiceType[],
  maxConcurrent: number = 3
): Promise<void> {
  if (!uploadQueueManager) {
    console.error('[并发上传] 上传队列管理器未初始化');
    return;
  }

  console.log(`[并发上传] 开始处理 ${filePaths.length} 个文件，启用图床:`, enabledServices);

  const multiServiceUploader = new MultiServiceUploader();

  // 为每个文件创建队列项
  const uploadTasks = filePaths.map(filePath => {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const itemId = uploadQueueManager!.addFile(filePath, fileName, enabledServices);

    return async () => {
      try {
        console.log(`[并发上传] 开始上传: ${fileName}`);

        // 使用多图床上传编排器
        const result = await multiServiceUploader.uploadToMultipleServices(
          filePath,
          enabledServices,
          config,
          (serviceId, percent) => {
            // 每个图床独立进度回调
            uploadQueueManager!.updateServiceProgress(itemId, serviceId, percent);
          }
        );

        console.log(`[并发上传] ${fileName} 上传完成，主力图床: ${result.primaryService}`);

        // 更新每个服务的链接信息
        result.results.forEach(serviceResult => {
          if (serviceResult.status === 'success' && serviceResult.result) {
            const item = uploadQueueManager!.vm!.getItem(itemId);
            if (item && item.serviceProgress[serviceResult.serviceId]) {
              uploadQueueManager!.vm!.updateItem(itemId, {
                serviceProgress: {
                  ...item.serviceProgress,
                  [serviceResult.serviceId]: {
                    ...item.serviceProgress[serviceResult.serviceId],
                    link: serviceResult.result.url
                  }
                }
              });
            }
          }
        });

        // 保存历史记录
        await saveHistoryItem(filePath, result, config);

        // 通知队列管理器上传成功
        uploadQueueManager!.markItemComplete(itemId, result.primaryUrl);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[并发上传] ${fileName} 上传失败:`, errorMsg);
        uploadQueueManager!.markItemFailed(itemId, errorMsg);
      }
    };
  });

  // 使用并发限制执行上传任务
  const executing: Promise<void>[] = [];

  for (const task of uploadTasks) {
    const promise = task().finally(() => {
      executing.splice(executing.indexOf(promise), 1);
    });

    executing.push(promise);

    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
    }
  }

  // 等待所有剩余任务完成
  await Promise.all(executing);

  console.log(`[并发上传] 所有文件处理完成`);
}

/**
 * 保存历史记录（新架构 - 多图床结果）
 * @param filePath 文件路径
 * @param uploadResult 多图床上传结果
 * @param config 用户配置
 */
async function saveHistoryItem(
  filePath: string,
  uploadResult: MultiUploadResult,
  _config: UserConfig  // 保留以备将来使用
): Promise<void> {
  try {
    const historyStore = new Store('.history.dat');
    let items: HistoryItem[] = [];

    try {
      items = await historyStore.get<HistoryItem[]>('uploads') || [];
      if (!Array.isArray(items)) {
        items = [];
      }
    } catch (readError: any) {
      console.error('[历史记录] 读取历史记录失败:', readError?.message || String(readError));
      items = [];
    }

    // 获取本地文件名
    let fileName: string;
    try {
      fileName = await basename(filePath);
      if (!fileName || fileName.trim().length === 0) {
        fileName = filePath.split(/[/\\]/).pop() || '未知文件';
      }
    } catch (nameError: any) {
      fileName = filePath.split(/[/\\]/).pop() || '未知文件';
    }

    // 创建新的历史记录项
    const newItem: HistoryItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      localFileName: fileName,
      filePath: filePath,  // 保存文件路径用于重试
      primaryService: uploadResult.primaryService,
      results: uploadResult.results,
      generatedLink: uploadResult.primaryUrl
    };

    const newItems = [newItem, ...items];

    try {
      await historyStore.set('uploads', newItems);
      await historyStore.save();
      console.log(`[历史记录] ✓ 已保存成功，共 ${newItems.length} 条记录`);
    } catch (saveError: any) {
      console.error('[历史记录] 保存历史记录失败:', saveError?.message || String(saveError));
    }
  } catch (historyError: any) {
    console.error('[历史记录] 保存历史记录时发生异常:', historyError?.message || String(historyError));
  }
}

// --- VIEW ROUTING ---
/**
 * 导航到指定视图
 * @param viewId 视图 ID ('upload' | 'history' | 'settings' | 'r2-manager' | 'backup' | 'link-checker')
 */
function navigateTo(viewId: 'upload' | 'history' | 'settings' | 'r2-manager' | 'backup' | 'link-checker'): void {
  try {
    // Deactivate all views and buttons
    views.forEach(v => {
      try {
        v.classList.remove('active');
      } catch (error) {
        console.warn('[导航] 移除视图 active 类失败:', error);
      }
    });
    
    navButtons.forEach(b => {
      try {
        b.classList.remove('active');
      } catch (error) {
        console.warn('[导航] 移除按钮 active 类失败:', error);
      }
    });

    // Activate the target view and button
    const targetView = getElement<HTMLElement>(`${viewId}-view`, '目标视图');
    const targetNavBtn = getElement<HTMLButtonElement>(`nav-${viewId}`, '目标导航按钮');

    if (targetView) {
      try {
        targetView.classList.add('active');
      } catch (error) {
        console.error(`[导航] 激活目标视图失败 (${viewId}):`, error);
      }
    } else {
      console.error(`[导航] 目标视图不存在: ${viewId}-view`);
    }
    
    if (targetNavBtn) {
      try {
        targetNavBtn.classList.add('active');
      } catch (error) {
        console.error(`[导航] 激活导航按钮失败 (${viewId}):`, error);
      }
    } else {
      console.error(`[导航] 目标导航按钮不存在: nav-${viewId}`);
    }

    // Load data for view if necessary
    try {
      if (viewId === 'history') {
        loadHistory().catch(err => {
          console.error('[导航] 加载历史记录失败:', err);
          if (historyStatusMessageEl) {
            historyStatusMessageEl.textContent = `❌ 加载失败: ${err instanceof Error ? err.message : String(err)}`;
          }
        });
      } else if (viewId === 'settings') {
        loadSettings().catch(err => {
          console.error('[导航] 加载设置失败:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          showToast(`加载设置失败: ${errorMsg}`, 'error', 3000);
        });
      } else if (viewId === 'r2-manager') {
        // [v2.6 优化] 检查脏标记，只在需要时刷新
        if (appState.isR2Dirty) {
          console.log('[R2管理] 检测到数据变更，正在刷新 R2 列表...');
          // 初始化 R2 管理器（如果还未初始化）
          if (!r2Manager) {
            configStore.get<UserConfig>('config').then(config => {
              const currentConfig = config || DEFAULT_CONFIG;
              r2Manager = new R2Manager(currentConfig);
              r2Manager.loadObjects().then(() => {
                appState.isR2Dirty = false; // 加载完成后，重置标记
              }).catch(err => {
                console.error('[导航] 加载R2对象失败:', err);
              });
            }).catch(err => {
              console.error('[导航] 获取配置失败:', err);
            });
          } else {
            // [v2.7 优化] 如果已经初始化，先清理旧实例的事件监听器
            // 然后刷新配置并重新加载
            r2Manager.cleanup();
            configStore.get<UserConfig>('config').then(config => {
              const currentConfig = config || DEFAULT_CONFIG;
              r2Manager!.updateConfig(currentConfig);
              r2Manager!.loadObjects().then(() => {
                appState.isR2Dirty = false; // 加载完成后，重置标记
              }).catch(err => {
                console.error('[导航] 加载R2对象失败:', err);
              });
            }).catch(err => {
              console.error('[导航] 获取配置失败:', err);
            });
          }
        } else {
          console.log('[R2管理] 数据未变更，使用现有视图缓存');
          // 这里什么都不用做，保持 DOM 原样即可
        }
      }
    } catch (error) {
      console.error(`[导航] 加载视图数据失败 (${viewId}):`, error);
    }
  } catch (error) {
    console.error('[导航] 导航失败:', error);
  }
}

// --- UPLOAD LOGIC (v2.0 - Queue Manager) ---
/**
 * 初始化文件上传监听器（使用队列管理器）
 * v2.0: 支持文件类型验证、实时进度、并发上传
 * @throws {Error} 如果初始化失败
 */
async function initializeUpload(): Promise<void> {
    try {
      // 初始化队列管理器
      uploadQueueManager = new UploadQueueManager('upload-queue-list');
      console.log('[上传] 队列管理器初始化成功');

      // 注意：重试功能现在由新架构的 retryServiceUpload 函数处理
      // 队列管理器的重试按钮功能已被新的多图床重试机制替代

      // 处理文件上传的核心函数
      const handleFiles = async (filePaths: string[]) => {
        try {
          // 验证输入
          if (!Array.isArray(filePaths) || filePaths.length === 0) {
            console.warn('[上传] 无效的文件列表:', filePaths);
            return;
          }

          console.log('[上传] 接收到文件:', filePaths);

          // 获取配置
          let config: UserConfig | null = null;
          try {
            config = await configStore.get<UserConfig>('config');
          } catch (error) {
            console.error('[上传] 读取配置失败:', error);
            await showAlertModal('读取配置失败，请重试', '配置错误', 'error');
            return;
          }

          // 验证配置存在
          if (!config) {
            console.warn('[上传] 配置不存在，使用默认配置');
            config = DEFAULT_CONFIG;
          }

          // 文件类型验证（PRD 1.2）
          const { valid, invalid } = await filterValidFiles(filePaths);

          if (valid.length === 0) {
            console.warn('[上传] 没有有效的图片文件');
            return;
          }

          console.log(`[上传] 有效文件: ${valid.length}个，无效文件: ${invalid.length}个`);

          // 从按钮读取启用的图床服务列表
          const enabledServices: ServiceType[] = [];
          if (serviceButtons.weibo?.classList.contains('selected')) enabledServices.push('weibo');
          if (serviceButtons.r2?.classList.contains('selected')) enabledServices.push('r2');
          if (serviceButtons.tcl?.classList.contains('selected')) enabledServices.push('tcl');
          if (serviceButtons.jd?.classList.contains('selected')) enabledServices.push('jd');
          if (serviceButtons.nowcoder?.classList.contains('selected')) enabledServices.push('nowcoder');
          if (serviceButtons.qiyu?.classList.contains('selected')) enabledServices.push('qiyu');

          if (enabledServices.length === 0) {
            console.warn('[上传] 没有选择任何图床');
            await showAlertModal('请至少选择一个图床服务！', '配置缺失');
            return;
          }

          // 保存用户选择到配置
          config.enabledServices = enabledServices;
          try {
            await configStore.set('config', config);
            await configStore.save();
          } catch (error) {
            console.warn('[上传] 保存图床选择失败:', error);
            // 不阻塞上传流程
          }

          console.log(`[上传] 启用的图床:`, enabledServices);

          // 并发处理上传队列
          await processUploadQueue(valid, config, enabledServices);

          console.log('[上传] 上传队列处理完成');
        } catch (error) {
          console.error('[上传] 文件处理失败:', error);
          const errorMsg = error instanceof Error ? error.message : String(error);
          await showAlertModal(`上传失败: ${errorMsg}`, '上传错误', 'error');
        }
      };
      
      // 监听文件拖拽事件
      await listen('tauri://file-drop', async (event) => {
        const filePaths = event.payload as string[];
        await handleFiles(filePaths);
      });
      
      // 监听拖拽悬停事件
      await listen('tauri://file-drop-hover', () => {
        try {
          if (dropZoneHeader) {
            dropZoneHeader.classList.add('drag-over');
          }
        } catch (error) {
          console.error('[上传] 拖拽悬停处理失败:', error);
        }
      });
      
      // 监听拖拽取消事件
      await listen('tauri://file-drop-cancelled', () => {
        try {
          if (dropZoneHeader) {
            dropZoneHeader.classList.remove('drag-over');
          }
        } catch (error) {
          console.error('[上传] 拖拽取消处理失败:', error);
        }
      });
      
      // 点击拖拽区域触发文件选择
      if (dropZoneHeader) {
        dropZoneHeader.addEventListener('click', async () => {
          try {
            const selected = await dialog.open({
              multiple: true,
              filters: [{
                name: '图片',
                extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']
              }]
            });
            
            if (selected) {
              const filePaths = Array.isArray(selected) ? selected : [selected];
              await handleFiles(filePaths);
            }
          } catch (error) {
            console.error('[上传] 文件选择失败:', error);
          }
        });
      }
      
      // 阻止默认的拖拽行为
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => e.preventDefault());
      
      console.log('[上传] 上传监听器初始化成功');
    } catch (error) {
      console.error('[上传] 初始化上传监听器失败:', error);
      throw error;
    }
}

// --- LINK CHECKER LOGIC ---

/**
 * 链接检测结果类型
 */
interface LinkCheckResult {
  id: string;
  historyItem: HistoryItem;
  serviceId: ServiceType;
  url: string;
  status: 'pending' | 'checking' | 'valid' | 'invalid';
  statusCode?: number;
  error?: string;
}

/**
 * 链接检测状态
 */
const linkCheckerState = {
  results: [] as LinkCheckResult[],
  isChecking: false,
  cancelRequested: false
};

/**
 * 图床名称映射
 */
const linkCheckerServiceNames: Record<ServiceType, string> = {
  weibo: '微博',
  r2: 'R2',
  tcl: 'TCL',
  jd: '京东',
  nowcoder: '牛客',
  qiyu: '七鱼'
};

/**
 * 从历史记录提取待检测的链接
 */
function extractLinksFromHistory(history: HistoryItem[], filterService: string): LinkCheckResult[] {
  const results: LinkCheckResult[] = [];

  history.forEach(item => {
    item.results.forEach(result => {
      if (result.status === 'success' && result.result?.url) {
        // 如果有筛选条件，检查是否匹配
        if (filterService !== 'all' && result.serviceId !== filterService) {
          return;
        }

        results.push({
          id: `${item.id}_${result.serviceId}`,
          historyItem: item,
          serviceId: result.serviceId,
          url: result.result.url,
          status: 'pending'
        });
      }
    });
  });

  return results;
}

/**
 * 检测单个链接的有效性
 * 使用 HTTP HEAD 请求（只获取响应头，不下载图片内容）
 */
async function checkLinkValidity(url: string): Promise<{ valid: boolean; statusCode?: number; error?: string }> {
  try {
    const client = await getClient();
    const response = await client.request({
      method: 'HEAD',
      url: url,
      timeout: 10,
      responseType: ResponseType.Text
    });

    const statusCode = response.status;

    // 2xx 视为有效
    if (statusCode >= 200 && statusCode < 300) {
      return { valid: true, statusCode };
    }

    // 403, 404 视为失效
    if (statusCode === 403 || statusCode === 404) {
      return { valid: false, statusCode };
    }

    // 其他 4xx/5xx 也视为失效
    if (statusCode >= 400) {
      return { valid: false, statusCode };
    }

    return { valid: true, statusCode };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorMsg };
  }
}

/**
 * 更新链接检测统计数据
 */
function updateLinkCheckerStats(): void {
  const total = linkCheckerState.results.length;
  const valid = linkCheckerState.results.filter(r => r.status === 'valid').length;
  const invalid = linkCheckerState.results.filter(r => r.status === 'invalid').length;
  const pending = linkCheckerState.results.filter(r => r.status === 'pending' || r.status === 'checking').length;

  if (linkCheckerTotalEl) linkCheckerTotalEl.textContent = String(total);
  if (linkCheckerValidEl) linkCheckerValidEl.textContent = String(valid);
  if (linkCheckerInvalidEl) linkCheckerInvalidEl.textContent = String(invalid);
  if (linkCheckerPendingEl) linkCheckerPendingEl.textContent = String(pending);

  // 更新按钮状态
  if (linkCheckerDeleteInvalidBtn) {
    linkCheckerDeleteInvalidBtn.disabled = invalid === 0 || linkCheckerState.isChecking;
  }
}

/**
 * 渲染链接检测结果表格
 */
function renderLinkCheckerResults(): void {
  if (!linkCheckerResultsBody) return;

  if (linkCheckerState.results.length === 0) {
    linkCheckerResultsBody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="link-checker-empty">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <p>没有找到符合条件的历史记录</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  linkCheckerResultsBody.innerHTML = linkCheckerState.results.map(result => {
    const statusClass = result.status;
    const statusText: Record<string, string> = {
      pending: '待检测',
      checking: '检测中...',
      valid: '有效',
      invalid: '失效'
    };
    const statusIcon: Record<string, string> = {
      pending: '⏳',
      checking: '🔄',
      valid: '✓',
      invalid: '✗'
    };

    return `
      <tr data-id="${result.id}">
        <td class="filename" title="${result.historyItem.localFileName}">${result.historyItem.localFileName}</td>
        <td class="link" title="${result.url}">${result.url}</td>
        <td><span class="link-checker-service-badge">${linkCheckerServiceNames[result.serviceId] || result.serviceId}</span></td>
        <td><span class="link-checker-status-badge ${statusClass}">${statusIcon[result.status]} ${statusText[result.status]}</span></td>
        <td>
          <button class="link-checker-action-btn" onclick="window.open('${result.url}', '_blank')" title="打开链接">🔗</button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 批量检测链接
 */
async function batchCheckLinks(): Promise<void> {
  if (linkCheckerState.isChecking) return;

  linkCheckerState.isChecking = true;
  linkCheckerState.cancelRequested = false;

  if (linkCheckerStartBtn) linkCheckerStartBtn.disabled = true;
  if (linkCheckerCancelBtn) linkCheckerCancelBtn.disabled = false;
  if (linkCheckerProgress) linkCheckerProgress.style.display = 'block';

  const total = linkCheckerState.results.length;
  let checked = 0;

  for (const result of linkCheckerState.results) {
    if (linkCheckerState.cancelRequested) {
      break;
    }

    result.status = 'checking';
    renderLinkCheckerResults();

    const checkResult = await checkLinkValidity(result.url);

    result.status = checkResult.valid ? 'valid' : 'invalid';
    result.statusCode = checkResult.statusCode;
    result.error = checkResult.error;

    checked++;

    // 更新进度
    const percent = Math.round((checked / total) * 100);
    if (linkCheckerProgressText) linkCheckerProgressText.textContent = `检测中... ${checked}/${total}`;
    if (linkCheckerProgressPercent) linkCheckerProgressPercent.textContent = `${percent}%`;
    if (linkCheckerProgressBar) linkCheckerProgressBar.style.width = `${percent}%`;

    updateLinkCheckerStats();
    renderLinkCheckerResults();

    // 限速：每次请求间隔 200ms
    if (checked < total && !linkCheckerState.cancelRequested) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  linkCheckerState.isChecking = false;
  if (linkCheckerStartBtn) linkCheckerStartBtn.disabled = false;
  if (linkCheckerCancelBtn) linkCheckerCancelBtn.disabled = true;

  if (linkCheckerState.cancelRequested) {
    showToast('检测已取消', 'success');
  } else {
    showToast('检测完成', 'success');
  }
}

/**
 * 删除失效的历史记录
 */
async function deleteInvalidLinkCheckerItems(): Promise<void> {
  const invalidResults = linkCheckerState.results.filter(r => r.status === 'invalid');
  if (invalidResults.length === 0) {
    showToast('没有失效的记录', 'error');
    return;
  }

  const confirmed = await showConfirmModal(
    '确认删除',
    `确定要删除 ${invalidResults.length} 条失效记录吗？此操作不可撤销。`
  );
  if (!confirmed) return;

  try {
    // 加载历史记录
    const history = await historyStore.get<HistoryItem[]>('uploads', []) || [];

    // 获取需要删除的历史记录 ID
    const invalidHistoryIds = new Set(invalidResults.map(r => r.historyItem.id));

    // 过滤掉失效的记录
    const newHistory = history.filter(item => !invalidHistoryIds.has(item.id));

    // 保存
    await historyStore.set('uploads', newHistory);

    // 从检测结果中移除
    linkCheckerState.results = linkCheckerState.results.filter(r => r.status !== 'invalid');

    updateLinkCheckerStats();
    renderLinkCheckerResults();

    showToast(`已删除 ${invalidResults.length} 条失效记录`, 'success');
    console.log(`[链接检测] 已删除 ${invalidResults.length} 条失效记录`);
  } catch (error) {
    console.error('[链接检测] 删除失效记录失败:', error);
    showToast('删除失败', 'error');
  }
}

/**
 * 初始化链接检测视图事件监听
 */
function initLinkCheckerEvents(): void {
  // 开始检测按钮
  if (linkCheckerStartBtn) {
    linkCheckerStartBtn.addEventListener('click', async () => {
      const filterService = linkCheckerServiceFilter?.value || 'all';

      // 加载历史记录
      const history = await historyStore.get<HistoryItem[]>('uploads', []) || [];
      if (history.length === 0) {
        showToast('没有历史记录', 'error');
        return;
      }

      // 提取待检测的链接
      linkCheckerState.results = extractLinksFromHistory(history, filterService);

      if (linkCheckerState.results.length === 0) {
        showToast('没有找到符合条件的链接', 'error');
        return;
      }

      updateLinkCheckerStats();
      renderLinkCheckerResults();

      // 开始检测
      await batchCheckLinks();
    });
  }

  // 取消检测按钮
  if (linkCheckerCancelBtn) {
    linkCheckerCancelBtn.addEventListener('click', () => {
      linkCheckerState.cancelRequested = true;
      if (linkCheckerCancelBtn) linkCheckerCancelBtn.disabled = true;
    });
  }

  // 删除失效按钮
  if (linkCheckerDeleteInvalidBtn) {
    linkCheckerDeleteInvalidBtn.addEventListener('click', deleteInvalidLinkCheckerItems);
  }

  console.log('[链接检测] 事件监听器初始化完成');
}

// --- LOGIN WINDOW LOGIC ---
/**
 * 打开 WebView 登录窗口
 * 允许用户通过官方登录页面获取 Cookie
 * @param serviceId 服务标识（weibo/nowcoder 等），默认为 weibo
 */
async function openWebviewLoginWindow(serviceId: string = 'weibo'): Promise<void> {
  try {
    // 获取 Cookie 提供者配置
    const provider = getCookieProvider(serviceId);
    if (!provider) {
      showToast(`不支持的服务: ${serviceId}`, 'error', 3000);
      console.error('[WebView登录窗口] 不支持的服务:', serviceId);
      return;
    }

    console.log(`[WebView登录窗口] 开始打开 ${provider.name} 登录窗口`);

    // 检查窗口是否已存在
    try {
      const existingWindow = WebviewWindow.getByLabel('login-webview');
      if (existingWindow) {
        console.log('[WebView登录窗口] 窗口已存在，聚焦');
        await existingWindow.setFocus();
        return;
      }
    } catch (error) {
      console.warn('[WebView登录窗口] 检查已存在窗口失败:', error);
      // 继续创建新窗口
    }

    // 创建新的Cookie获取窗口（通过 URL 参数传递服务类型）
    try {
      const loginWindow = new WebviewWindow('login-webview', {
        url: `/login-webview.html?service=${serviceId}`,
        title: `${provider.name}登录 - 自动获取Cookie`,
        width: 500,
        height: 800,
        resizable: true,
        center: true,
        alwaysOnTop: false,
        decorations: true,
        transparent: false,
      });

      loginWindow.once('tauri://created', () => {
        console.log(`[WebView登录窗口] ✓ ${provider.name} 窗口创建成功`);
      });

      loginWindow.once('tauri://error', (e) => {
        console.error('[WebView登录窗口] 窗口创建失败:', e);
        const errorMsg = e && typeof e === 'object' && 'payload' in e ? String(e.payload) : String(e);
        showToast(`打开登录窗口失败: ${errorMsg}`, 'error', 5000);
      });
    } catch (createError) {
      const errorMsg = createError instanceof Error ? createError.message : String(createError);
      console.error('[WebView登录窗口] 创建窗口异常:', createError);
      showToast(`创建登录窗口失败: ${errorMsg}`, 'error', 5000);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[WebView登录窗口] 打开窗口异常:', error);
    showToast(`打开登录窗口失败: ${errorMsg}`, 'error', 5000);
  }
}


/**
 * Cookie 更新事件的 payload 类型
 */
interface CookieUpdatedPayload {
  serviceId: string;
  cookie: string;
}

/**
 * 设置 Cookie 更新监听器
 * 监听来自登录窗口的 Cookie 更新事件（支持多服务）
 */
async function setupCookieListener(): Promise<void> {
  try {
    // 监听新格式的事件 {serviceId, cookie}
    await listen<CookieUpdatedPayload>('cookie-updated', async (event) => {
      try {
        const payload = event.payload;

        // 兼容旧格式（直接是 string）和新格式（{serviceId, cookie}）
        let serviceId: string;
        let cookie: string;

        if (typeof payload === 'string') {
          // 旧格式：直接是 cookie 字符串，默认为微博
          serviceId = 'weibo';
          cookie = payload;
        } else if (payload && typeof payload === 'object') {
          // 新格式：{serviceId, cookie}
          serviceId = payload.serviceId || 'weibo';
          cookie = payload.cookie;
        } else {
          console.error('[Cookie更新] 无效的 payload 格式:', typeof payload);
          return;
        }

        console.log(`[Cookie更新] 收到 ${serviceId} Cookie更新事件，长度:`, cookie?.length || 0);

        // 验证 Cookie
        if (!cookie || typeof cookie !== 'string' || cookie.trim().length === 0) {
          console.error('[Cookie更新] Cookie为空或无效');
          showToast('接收到的 Cookie 无效', 'error', 3000);
          return;
        }

        const trimmedCookie = cookie.trim();

        try {
          // 根据服务类型更新对应的 UI 和配置
          await handleCookieUpdate(serviceId, trimmedCookie);

          // 刷新上传界面的服务按钮状态
          await loadServiceButtonStates();

          // 显示成功提示
          const provider = getCookieProvider(serviceId);
          const serviceName = provider?.name || serviceId;
          showToast(`${serviceName} Cookie 已自动填充并保存！`, 'success', 3000);

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Cookie更新] 保存Cookie失败:', error);
          showToast(`保存失败: ${errorMsg}`, 'error', 5000);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Cookie更新] 处理Cookie更新事件失败:', error);
        showToast(`处理失败: ${errorMsg}`, 'error', 5000);
      }
    });

    console.log('[Cookie更新] ✓ 监听器已设置（支持多服务）');
  } catch (error) {
    console.error('[Cookie更新] 设置监听器失败:', error);
    // 不抛出错误，避免阻塞应用启动
  }
}

/**
 * 处理 Cookie 更新（根据服务类型更新 UI 和配置）
 * @param serviceId 服务标识
 * @param cookie Cookie 字符串
 */
async function handleCookieUpdate(serviceId: string, cookie: string): Promise<void> {
  // 读取配置
  let config: UserConfig;
  try {
    const existingConfig = await configStore.get<UserConfig>('config');
    config = existingConfig || DEFAULT_CONFIG;
  } catch (getError) {
    console.warn('[Cookie更新] 读取现有配置失败，使用默认配置:', getError);
    config = { ...DEFAULT_CONFIG };
  }

  // 确保 services 对象存在
  if (!config.services) {
    config.services = {};
  }

  // 根据服务类型更新
  switch (serviceId) {
    case 'weibo':
      // 更新微博 Cookie
      if (!config.services.weibo) {
        config.services.weibo = { enabled: true, cookie: '' };
      }
      config.services.weibo.cookie = cookie;

      // 更新 UI
      if (weiboCookieEl) {
        weiboCookieEl.value = cookie;
        console.log('[Cookie更新] ✓ 微博 Cookie UI 已更新');
      }

      // 更新状态显示
      if (cookieStatusEl) {
        cookieStatusEl.textContent = '✅ Cookie已自动填充并保存！';
        cookieStatusEl.style.color = 'lightgreen';
        setTimeout(() => {
          if (cookieStatusEl) cookieStatusEl.textContent = '';
        }, 3000);
      }
      break;

    case 'nowcoder':
      // 更新牛客 Cookie
      if (!config.services.nowcoder) {
        config.services.nowcoder = { enabled: true, cookie: '' };
      }
      config.services.nowcoder.cookie = cookie;

      // 更新 UI
      const nowcoderCookieEl = document.getElementById('nowcoder-cookie') as HTMLTextAreaElement | null;
      if (nowcoderCookieEl) {
        nowcoderCookieEl.value = cookie;
        console.log('[Cookie更新] ✓ 牛客 Cookie UI 已更新');
      }

      // 更新状态显示
      const nowcoderStatusEl = document.getElementById('nowcoder-cookie-status');
      if (nowcoderStatusEl) {
        nowcoderStatusEl.textContent = '✅ Cookie已自动填充并保存！';
        nowcoderStatusEl.style.color = 'lightgreen';
        setTimeout(() => {
          if (nowcoderStatusEl) nowcoderStatusEl.textContent = '';
        }, 3000);
      }
      break;

    default:
      console.warn(`[Cookie更新] 未知的服务类型: ${serviceId}`);
      // 尝试通用处理
      (config.services as Record<string, any>)[serviceId] = {
        enabled: true,
        cookie: cookie
      };
  }

  // 保存配置
  try {
    await configStore.set('config', config);
    await configStore.save();
    console.log(`[Cookie更新] ✓ ${serviceId} Cookie已保存到存储`);
  } catch (saveError) {
    throw new Error(`保存配置失败: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
  }
}

// --- SETTINGS LOGIC (from settings.ts) ---
/**
 * 加载设置到 UI
 * 从存储中读取用户配置并填充到表单元素
 */
async function loadSettings(): Promise<void> {
  try {
    console.log('[设置] 开始加载设置...');
    
    // 读取配置（带自动恢复功能）
    let config: UserConfig;
    try {
      // 如果配置文件损坏，get 方法会自动使用 DEFAULT_CONFIG 恢复
      const loadedConfig = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
      config = loadedConfig || DEFAULT_CONFIG;
      console.log('[设置] ✓ 配置加载成功');
    } catch (error) {
      console.error('[设置] 读取配置失败，使用默认配置:', error);
      config = DEFAULT_CONFIG;
      showToast('读取配置失败，已使用默认值', 'error', 3000);
    }
  
    // 填充表单元素（带空值检查）
    try {
      if (weiboCookieEl) weiboCookieEl.value = config.services?.weibo?.cookie || '';
      if (r2AccountIdEl) r2AccountIdEl.value = config.services?.r2?.accountId || '';
      if (r2KeyIdEl) r2KeyIdEl.value = config.services?.r2?.accessKeyId || '';
      if (r2SecretKeyEl) r2SecretKeyEl.value = config.services?.r2?.secretAccessKey || '';
      if (r2BucketEl) r2BucketEl.value = config.services?.r2?.bucketName || '';
      if (r2PathEl) r2PathEl.value = config.services?.r2?.path || '';
      if (r2PublicDomainEl) r2PublicDomainEl.value = config.services?.r2?.publicDomain || '';
      if (nowcoderCookieEl) nowcoderCookieEl.value = config.services?.nowcoder?.cookie || '';
      if (qiyuTokenEl) qiyuTokenEl.value = config.services?.qiyu?.token || '';

      // 链接前缀配置（使用迁移函数确保兼容旧配置）
      const migratedConfig = migrateConfig(config);
      populatePrefixSelector(migratedConfig.linkPrefixConfig!);

      // WebDAV 配置
      if (config.webdav) {
        if (webdavUrlEl) webdavUrlEl.value = config.webdav.url || '';
        if (webdavUsernameEl) webdavUsernameEl.value = config.webdav.username || '';
        if (webdavPasswordEl) webdavPasswordEl.value = config.webdav.password || '';
        if (webdavRemotePathEl) webdavRemotePathEl.value = config.webdav.remotePath || DEFAULT_CONFIG.webdav?.remotePath || '/WeiboDR/history.json';
      } else {
        if (webdavUrlEl) webdavUrlEl.value = '';
        if (webdavUsernameEl) webdavUsernameEl.value = '';
        if (webdavPasswordEl) webdavPasswordEl.value = '';
        if (webdavRemotePathEl) webdavRemotePathEl.value = DEFAULT_CONFIG.webdav?.remotePath || '/WeiboDR/history.json';
      }
      
      // 输出格式（不再需要设置单选按钮，因为已删除）

      // 加载可用图床配置
      const availableServices = config.availableServices || DEFAULT_CONFIG.availableServices || [];
      Object.entries(availableServiceCheckboxes).forEach(([serviceId, checkbox]) => {
        if (checkbox) {
          checkbox.checked = availableServices.includes(serviceId as ServiceType);
        }
      });

      // 更新上传界面的图床显示状态
      updateUploadServiceVisibility(availableServices);

      console.log('[设置] ✓ 设置已填充到UI');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[设置] 填充UI失败:', error);
      showToast(`加载失败: ${errorMsg}`, 'error', 3000);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[设置] 加载设置失败:', error);
    showToast(`加载失败: ${errorMsg}`, 'error', 3000);
  }
}

/**
 * 更新上传界面的图床显示状态
 * 根据设置中的可用图床配置，显示或隐藏上传界面的图床选项
 */
function updateUploadServiceVisibility(availableServices: ServiceType[]): void {
  // 获取所有上传界面的图床按钮
  const allServiceBtns = document.querySelectorAll<HTMLButtonElement>('.service-btn');

  allServiceBtns.forEach(btn => {
    const serviceId = btn.getAttribute('data-service') as ServiceType;
    if (serviceId) {
      if (availableServices.includes(serviceId)) {
        // 显示该图床选项
        btn.style.display = '';
      } else {
        // 隐藏该图床选项，并取消选中
        btn.style.display = 'none';
        btn.classList.remove('selected');
      }
    }
  });

  console.log('[上传界面] 已根据配置更新可用图床:', availableServices);
}

/**
 * 保存设置（已弃用 - 现在使用 handleAutoSave）
 * 从 UI 表单中读取配置并保存到存储
 * 此函数保留以备将来需要手动触发保存的场景
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// @ts-ignore - 保留以备将来使用
async function saveSettings(): Promise<void> {
  try {
    console.log('[设置] 开始保存设置...');
    
    // 显示保存状态
    if (saveStatusEl) {
      saveStatusEl.textContent = '保存中...';
    }
    
    // 从已保存的配置中读取输出格式，或使用默认值
    let savedConfig: UserConfig | null = null;
    try {
      savedConfig = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
    } catch (error) {
      console.warn('[设置] 读取已保存配置失败，使用默认值:', error);
    }
    const format: string = savedConfig?.outputFormat || 'baidu';
  
    // 验证必填字段
    if (format === 'r2' && r2PublicDomainEl && !r2PublicDomainEl.value.trim()) {
      const errorMsg = '❌ 当输出格式为 R2 时，公开访问域名不能为空！';
      console.warn('[设置] 验证失败:', errorMsg);
      if (saveStatusEl) {
        saveStatusEl.textContent = errorMsg;
      }
      return;
    }

    // 构建配置对象（新架构）
    const enabledServices: ServiceType[] = savedConfig?.enabledServices || ['tcl'];

    const config: UserConfig = {
      enabledServices: enabledServices,
      services: {
        weibo: {
          enabled: enabledServices.includes('weibo'),
          cookie: weiboCookieEl?.value.trim() || ''
        },
        r2: {
          enabled: enabledServices.includes('r2'),
          accountId: r2AccountIdEl?.value.trim() || '',
          accessKeyId: r2KeyIdEl?.value.trim() || '',
          secretAccessKey: r2SecretKeyEl?.value.trim() || '',
          bucketName: r2BucketEl?.value.trim() || '',
          path: r2PathEl?.value.trim() || '',
          publicDomain: r2PublicDomainEl?.value.trim() || ''
        },
        tcl: {
          enabled: enabledServices.includes('tcl')
        }
      },
      outputFormat: savedConfig?.outputFormat || DEFAULT_CONFIG.outputFormat,
      baiduPrefix: getActivePrefixFromUI() || DEFAULT_CONFIG.baiduPrefix, // 向后兼容
      linkPrefixConfig: getLinkPrefixConfigFromUI(savedConfig?.linkPrefixConfig)
    };

    // 保存到存储
    try {
      await configStore.set('config', config);
      await configStore.save();
      console.log('[设置] ✓ 配置保存成功');
      
      if (saveStatusEl) {
        saveStatusEl.textContent = '✅ 已保存！';
        
        setTimeout(() => {
          if (saveStatusEl) {
            saveStatusEl.textContent = '';
          }
        }, 2000);
      }
    } catch (saveError) {
      const errorMsg = saveError instanceof Error ? saveError.message : String(saveError);
      console.error('[设置] 保存配置失败:', saveError);
      if (saveStatusEl) {
        saveStatusEl.textContent = `❌ 保存失败: ${errorMsg}`;
      }
      throw saveError;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[设置] 保存设置失败:', error);
    if (saveStatusEl) {
      saveStatusEl.textContent = `❌ 保存失败: ${errorMsg}`;
    }
  }
}

/**
 * 显示全局 Toast 通知
 * @param message 消息内容
 * @param type 类型: 'success' | 'error' | 'loading'
 * @param duration 持续时间 (ms)，默认 2000ms，0 表示不自动隐藏
 */
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, type: 'success' | 'error' | 'loading' = 'success', duration: number = 2000): void {
  if (!globalToastEl || !toastIconEl || !toastMessageEl) {
    console.warn('[Toast] Toast 元素不存在，无法显示通知');
    return;
  }

  // 1. 清除上一次的定时器
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }

  // 2. 设置内容和图标
  toastMessageEl.textContent = message;

  let icon = '';
  if (type === 'success') {
    icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (type === 'error') {
    icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else if (type === 'loading') {
    icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  }

  toastIconEl.innerHTML = icon;

  // 3. 重置样式类
  globalToastEl.className = 'app-toast show'; // 基础类 + 显示类
  globalToastEl.classList.add(type); // 添加类型类 (success/error/loading)

  // 4. 设置自动隐藏 (loading 状态通常不自动隐藏，由调用者手动更新)
  if (type !== 'loading' && duration > 0) {
    toastTimeout = setTimeout(() => {
      if (globalToastEl) {
        globalToastEl.classList.remove('show');
      }
    }, duration);
  }
}

// 将 showToast 挂载到 window 对象，供 Vue 组件使用
(window as any).showToast = showToast;

/**
 * 自动保存设置（无需手动点击保存按钮）
 * 在用户修改表单后自动触发
 */
async function handleAutoSave(): Promise<void> {
  try {
    console.log('[自动保存] 触发自动保存...');

    // 1. 显示保存中状态
    showToast('正在保存设置...', 'loading', 0);

    // 从已保存的配置中读取输出格式，或使用默认值
    let savedConfig: UserConfig | null = null;
    try {
      savedConfig = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);
    } catch (error) {
      console.warn('[自动保存] 读取已保存配置失败，使用默认值:', error);
    }
    const format: string = savedConfig?.outputFormat || 'baidu';
  
    // 验证必填字段
    if (format === 'r2' && r2PublicDomainEl && !r2PublicDomainEl.value.trim()) {
      const errorMsg = '当输出格式为 R2 时，公开访问域名不能为空！';
      console.warn('[自动保存] 验证失败:', errorMsg);
      showToast(errorMsg, 'error', 4000);
      return;
    }

    // 构建配置对象（新架构）
    const enabledServices: ServiceType[] = savedConfig?.enabledServices || ['tcl'];

    // 收集可用图床配置
    const availableServices: ServiceType[] = [];
    Object.entries(availableServiceCheckboxes).forEach(([serviceId, checkbox]) => {
      if (checkbox?.checked) {
        availableServices.push(serviceId as ServiceType);
      }
    });

    // 验证至少有一个可用图床
    if (availableServices.length === 0) {
      showToast('至少需要启用一个图床', 'error', 3000);
      return;
    }

    const config: UserConfig = {
      enabledServices: enabledServices,
      availableServices: availableServices,
      services: {
        weibo: {
          enabled: enabledServices.includes('weibo'),
          cookie: weiboCookieEl?.value.trim() || ''
        },
        r2: {
          enabled: enabledServices.includes('r2'),
          accountId: r2AccountIdEl?.value.trim() || '',
          accessKeyId: r2KeyIdEl?.value.trim() || '',
          secretAccessKey: r2SecretKeyEl?.value.trim() || '',
          bucketName: r2BucketEl?.value.trim() || '',
          path: r2PathEl?.value.trim() || '',
          publicDomain: r2PublicDomainEl?.value.trim() || ''
        },
        tcl: {
          enabled: enabledServices.includes('tcl')
        },
        jd: {
          enabled: enabledServices.includes('jd')
        },
        nowcoder: {
          enabled: enabledServices.includes('nowcoder'),
          cookie: nowcoderCookieEl?.value.trim() || ''
        },
        qiyu: {
          enabled: enabledServices.includes('qiyu'),
          token: qiyuTokenEl?.value.trim() || ''
        }
      },
      outputFormat: savedConfig?.outputFormat || DEFAULT_CONFIG.outputFormat,
      baiduPrefix: getActivePrefixFromUI() || DEFAULT_CONFIG.baiduPrefix, // 向后兼容
      linkPrefixConfig: getLinkPrefixConfigFromUI(savedConfig?.linkPrefixConfig)
    };

    // 保存到存储
    try {
      await configStore.set('config', config);
      await configStore.save();
      console.log('[自动保存] ✓ 配置自动保存成功');

      // 3. 刷新上传界面的服务按钮状态
      await loadServiceButtonStates();
      console.log('[自动保存] ✓ 服务按钮状态已刷新');

      // 4. 更新上传界面的图床显示状态
      updateUploadServiceVisibility(availableServices);
      console.log('[自动保存] ✓ 上传界面图床显示状态已更新');

      // 5. 显示成功状态
      showToast('设置已自动保存', 'success', 2000);
    } catch (saveError) {
      const errorMsg = saveError instanceof Error ? saveError.message : String(saveError);
      console.error('[自动保存] 保存配置失败:', saveError);

      // 4. 显示失败状态
      showToast(`保存失败: ${errorMsg}`, 'error', 4000);
      throw saveError;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[自动保存] 自动保存失败:', error);
    showToast(`自动保存失败: ${errorMsg}`, 'error', 4000);
  }
}

// ========== 链接前缀配置辅助函数 ==========

// 当前前缀列表（内存缓存，用于 UI 操作）
let currentPrefixList: string[] = [...DEFAULT_PREFIXES];

/**
 * 填充前缀选择器下拉框
 */
function populatePrefixSelector(linkPrefixConfig: LinkPrefixConfig): void {
  if (!prefixSelectorEl || !prefixEnabledEl) return;

  // 更新内存缓存
  currentPrefixList = linkPrefixConfig.prefixList || [...DEFAULT_PREFIXES];

  // 设置开关状态
  prefixEnabledEl.checked = linkPrefixConfig.enabled;
  updatePrefixSelectorState(linkPrefixConfig.enabled);

  // 清空现有选项
  prefixSelectorEl.innerHTML = '';

  // 填充选项
  currentPrefixList.forEach((prefix, index) => {
    const option = document.createElement('option');
    option.value = index.toString();
    // 截断长 URL 以便显示
    const displayText = prefix.length > 50
      ? prefix.substring(0, 47) + '...'
      : prefix;
    option.textContent = displayText;
    option.title = prefix; // 完整 URL 作为 tooltip
    option.selected = index === linkPrefixConfig.selectedIndex;
    prefixSelectorEl.appendChild(option);
  });

  console.log('[前缀配置] 已填充前缀选择器，共', currentPrefixList.length, '个前缀');
}

/**
 * 更新前缀选择器禁用状态
 */
function updatePrefixSelectorState(enabled: boolean): void {
  if (prefixSelectorWrapper) {
    if (enabled) {
      prefixSelectorWrapper.classList.remove('disabled');
    } else {
      prefixSelectorWrapper.classList.add('disabled');
    }
  }
}

/**
 * 从 UI 获取当前选中的前缀
 */
function getActivePrefixFromUI(): string | null {
  if (!prefixEnabledEl?.checked) return null;
  if (!prefixSelectorEl) return DEFAULT_PREFIXES[0];

  const selectedIndex = parseInt(prefixSelectorEl.value);
  if (selectedIndex >= 0 && selectedIndex < currentPrefixList.length) {
    return currentPrefixList[selectedIndex];
  }
  return currentPrefixList[0] || DEFAULT_PREFIXES[0];
}

/**
 * 从 UI 获取完整的前缀配置
 */
function getLinkPrefixConfigFromUI(savedConfig?: LinkPrefixConfig): LinkPrefixConfig {
  return {
    enabled: prefixEnabledEl?.checked ?? true,
    selectedIndex: prefixSelectorEl ? parseInt(prefixSelectorEl.value) : 0,
    prefixList: savedConfig?.prefixList || currentPrefixList
  };
}

/**
 * 验证 URL 格式
 */
function isValidPrefixUrl(url: string): boolean {
  try {
    new URL(url);
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
}

/**
 * 初始化前缀配置事件监听器
 */
function initPrefixEventListeners(): void {
  // 开关切换
  if (prefixEnabledEl) {
    prefixEnabledEl.addEventListener('change', () => {
      updatePrefixSelectorState(prefixEnabledEl.checked);
      handleAutoSave().catch(err => {
        console.error('[前缀配置] 保存开关状态失败:', err);
      });
    });
  }

  // 选择器切换
  if (prefixSelectorEl) {
    prefixSelectorEl.addEventListener('change', () => {
      handleAutoSave().catch(err => {
        console.error('[前缀配置] 保存选择失败:', err);
      });
    });
  }

  // 添加前缀按钮
  if (addPrefixBtn) {
    addPrefixBtn.addEventListener('click', () => {
      if (addPrefixModal && newPrefixInput) {
        newPrefixInput.value = '';
        addPrefixModal.classList.remove('hidden');
        newPrefixInput.focus();
      }
    });
  }

  // 取消添加
  if (cancelAddPrefixBtn) {
    cancelAddPrefixBtn.addEventListener('click', () => {
      addPrefixModal?.classList.add('hidden');
    });
  }

  // 确认添加
  if (confirmAddPrefixBtn) {
    confirmAddPrefixBtn.addEventListener('click', async () => {
      if (!newPrefixInput) return;

      const newPrefix = newPrefixInput.value.trim();

      // 验证 URL
      if (!newPrefix) {
        showToast('请输入前缀 URL', 'error', 3000);
        return;
      }

      if (!isValidPrefixUrl(newPrefix)) {
        showToast('请输入有效的 URL（以 http:// 或 https:// 开头）', 'error', 3000);
        return;
      }

      // 检查重复
      if (currentPrefixList.includes(newPrefix)) {
        showToast('该前缀已存在', 'error', 3000);
        return;
      }

      // 添加新前缀
      currentPrefixList.push(newPrefix);
      const newIndex = currentPrefixList.length - 1;

      // 更新 UI
      const option = document.createElement('option');
      option.value = newIndex.toString();
      const displayText = newPrefix.length > 50
        ? newPrefix.substring(0, 47) + '...'
        : newPrefix;
      option.textContent = displayText;
      option.title = newPrefix;
      prefixSelectorEl?.appendChild(option);

      // 选中新添加的前缀
      if (prefixSelectorEl) {
        prefixSelectorEl.value = newIndex.toString();
      }

      // 保存配置
      try {
        await handleAutoSave();
        addPrefixModal?.classList.add('hidden');
        showToast('前缀添加成功', 'success', 2000);
      } catch (err) {
        console.error('[前缀配置] 添加前缀失败:', err);
        // 回滚
        currentPrefixList.pop();
        if (prefixSelectorEl && prefixSelectorEl.lastChild) {
          prefixSelectorEl.removeChild(prefixSelectorEl.lastChild);
        }
      }
    });
  }

  // 删除前缀按钮
  if (deletePrefixBtn) {
    deletePrefixBtn.addEventListener('click', async () => {
      if (!prefixSelectorEl) return;

      const selectedIndex = parseInt(prefixSelectorEl.value);

      // 确保至少保留一个前缀
      if (currentPrefixList.length <= 1) {
        showToast('至少需要保留一个前缀', 'error', 3000);
        return;
      }

      const prefixToDelete = currentPrefixList[selectedIndex];

      // 确认删除
      const confirmed = await showConfirmModal(
        `确定要删除该前缀吗？\n\n${prefixToDelete}`,
        '删除前缀'
      );

      if (!confirmed) return;

      // 删除前缀
      currentPrefixList.splice(selectedIndex, 1);

      // 调整选中索引
      let newSelectedIndex = selectedIndex;
      if (newSelectedIndex >= currentPrefixList.length) {
        newSelectedIndex = currentPrefixList.length - 1;
      }

      // 重新填充选择器
      const linkPrefixConfig: LinkPrefixConfig = {
        enabled: prefixEnabledEl?.checked ?? true,
        selectedIndex: newSelectedIndex,
        prefixList: currentPrefixList
      };
      populatePrefixSelector(linkPrefixConfig);

      // 保存配置
      try {
        await handleAutoSave();
        showToast('前缀已删除', 'success', 2000);
      } catch (err) {
        console.error('[前缀配置] 删除前缀失败:', err);
      }
    });
  }

  // 点击模态框外部关闭
  if (addPrefixModal) {
    addPrefixModal.addEventListener('click', (e) => {
      if (e.target === addPrefixModal) {
        addPrefixModal.classList.add('hidden');
      }
    });
  }

  console.log('[前缀配置] 事件监听器已初始化');
}

/**
 * 测试 R2 连接
 * 调用 Rust 后端验证 R2 凭据是否有效
 */
async function testR2Connection(): Promise<void> {
  try {
    console.log('[R2测试] 开始测试 R2 连接...');
    
    if (!r2StatusMessageEl) {
      console.error('[R2测试] r2StatusMessageEl 不存在');
      return;
    }
    
    // 禁用测试按钮，显示加载状态
    if (testR2Btn) {
      testR2Btn.disabled = true;
      testR2Btn.textContent = '连接中...';
    }
    
    // 构建 R2 配置
    const r2Config = {
      accountId: r2AccountIdEl?.value.trim() || '',
      accessKeyId: r2KeyIdEl?.value.trim() || '',
      secretAccessKey: r2SecretKeyEl?.value.trim() || '',
      bucketName: r2BucketEl?.value.trim() || '',
      path: r2PathEl?.value.trim() || '',
      publicDomain: r2PublicDomainEl?.value.trim() || '',
    };
    
    // 更新状态
    r2StatusMessageEl.textContent = '⏳ 测试中...';
    r2StatusMessageEl.style.color = 'orange';
    
    try {
      const successMessage = await invoke<string>('test_r2_connection', { config: r2Config });
      r2StatusMessageEl.textContent = `✓ ${successMessage}`;
      r2StatusMessageEl.style.color = 'lightgreen';
      
      setTimeout(() => {
        if (r2StatusMessageEl) {
          r2StatusMessageEl.textContent = '';
        }
      }, 3000);
    } catch (errorMessage) {
      r2StatusMessageEl.textContent = `✗ ${errorMessage}`;
      r2StatusMessageEl.style.color = 'red';
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[R2测试] 测试 R2 连接失败:', error);
    if (r2StatusMessageEl) {
      r2StatusMessageEl.textContent = `✗ 测试失败: ${errorMsg}`;
      r2StatusMessageEl.style.color = 'red';
    }
  } finally {
    // 恢复按钮状态
    if (testR2Btn) {
      testR2Btn.disabled = false;
      testR2Btn.textContent = '测试连接';
    }
  }
}

/**
 * 测试 WebDAV 连接
 * 调用 Rust 后端验证 WebDAV 凭据是否有效
 */
async function testWebDAVConnection(): Promise<void> {
  try {
    console.log('[WebDAV测试] 开始测试 WebDAV 连接...');
    
    if (!webdavStatusMessageEl) {
      console.error('[WebDAV测试] webdavStatusMessageEl 不存在');
      return;
    }
    
    // 禁用测试按钮，显示加载状态
    if (testWebdavBtn) {
      testWebdavBtn.disabled = true;
      testWebdavBtn.textContent = '连接中...';
    }
    
    // 构建 WebDAV 配置
    const webdavConfig = {
      url: webdavUrlEl?.value.trim() || '',
      username: webdavUsernameEl?.value.trim() || '',
      password: webdavPasswordEl?.value.trim() || '',
      remotePath: webdavRemotePathEl?.value.trim() || DEFAULT_CONFIG.webdav?.remotePath || '/WeiboDR/history.json',
    };
    
    // 更新状态
    webdavStatusMessageEl.textContent = '⏳ 测试中...';
    webdavStatusMessageEl.style.color = 'orange';
    
    try {
      const successMessage = await invoke<string>('test_webdav_connection', { config: webdavConfig });
      webdavStatusMessageEl.textContent = `✓ ${successMessage}`;
      webdavStatusMessageEl.style.color = 'lightgreen';
      
      setTimeout(() => {
        if (webdavStatusMessageEl) {
          webdavStatusMessageEl.textContent = '';
        }
      }, 3000);
    } catch (errorMessage) {
      webdavStatusMessageEl.textContent = `✗ ${errorMessage}`;
      webdavStatusMessageEl.style.color = 'red';
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[WebDAV测试] 测试 WebDAV 连接失败:', error);
    if (webdavStatusMessageEl) {
      webdavStatusMessageEl.textContent = `✗ 测试失败: ${errorMsg}`;
      webdavStatusMessageEl.style.color = 'red';
    }
  } finally {
    // 恢复按钮状态
    if (testWebdavBtn) {
      testWebdavBtn.disabled = false;
      testWebdavBtn.textContent = '测试连接';
    }
  }
}

/**
 * 测试微博 Cookie 连接
 * 通过调用微博 API 验证 Cookie 是否有效
 */
async function testWeiboConnection(): Promise<void> {
  try {
    console.log('[Cookie测试] 开始测试微博连接...');
    
    // 验证输入
    if (!weiboCookieEl) {
      console.error('[Cookie测试] weiboCookieEl 不存在');
      if (cookieStatusEl) {
        cookieStatusEl.textContent = '❌ Cookie 输入框不存在';
        cookieStatusEl.style.color = 'red';
      }
      return;
    }
    
    const cookie = weiboCookieEl.value.trim();
    if (!cookie || cookie.length === 0) {
      console.warn('[Cookie测试] Cookie 为空');
      if (cookieStatusEl) {
        cookieStatusEl.textContent = '❌ Cookie 不能为空！';
        cookieStatusEl.style.color = 'red';
      }
      return;
    }
  
  // 禁用测试按钮，显示加载状态
  if (testCookieBtn) {
    testCookieBtn.disabled = true;
    testCookieBtn.textContent = '测试中...';
  }
  
  // 更新状态
  if (cookieStatusEl) {
    cookieStatusEl.textContent = '⏳ 测试中...';
    cookieStatusEl.style.color = 'yellow';
  }

  try {
    // 获取 HTTP 客户端
    const client = await getClient();
      
      // 发送测试请求（带超时保护）
      const response = await client.get<{ code: string }>(
        'https://weibo.com/aj/onoff/getstatus?sid=0',
        {
          responseType: ResponseType.JSON,
          headers: { 
            Cookie: cookie,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' 
          },
          timeout: 10000, // 10秒超时
        }
      );
  
      // 检查 HTTP 状态码
      if (!response.ok) {
        const errorMsg = `❌ 测试失败 (HTTP ${response.status})`;
        console.warn('[Cookie测试] HTTP 请求失败:', response.status);
        if (cookieStatusEl) {
          if (response.status === 401 || response.status === 403) {
            cookieStatusEl.textContent = `${errorMsg}: Cookie 无效或已过期`;
          } else if (response.status >= 500) {
            cookieStatusEl.textContent = `${errorMsg}: 微博服务器错误`;
          } else {
            cookieStatusEl.textContent = errorMsg;
          }
          cookieStatusEl.style.color = 'red';
        }
        return;
      }
  
      // 检查响应数据
      if (!response.data) {
        console.warn('[Cookie测试] 响应数据为空');
        if (cookieStatusEl) {
          cookieStatusEl.textContent = '❌ 测试失败: 响应数据为空';
          cookieStatusEl.style.color = 'red';
        }
        return;
      }
      
      // 验证返回码
      if (response.data.code === '100000') {
        console.log('[Cookie测试] ✓ Cookie 有效');
        if (cookieStatusEl) {
          cookieStatusEl.textContent = '✅ Cookie 有效！ (已登录)';
          cookieStatusEl.style.color = 'lightgreen';
        }
      } else {
        console.warn('[Cookie测试] Cookie 无效，返回码:', response.data.code);
        if (cookieStatusEl) {
          cookieStatusEl.textContent = `❌ Cookie 无效或已过期 (返回码: ${response.data.code || '未知'})`;
          cookieStatusEl.style.color = 'red';
        }
      }
    } catch (err: any) {
      const errorStr = err?.toString() || String(err) || '';
      const errorMsg = err?.message || errorStr || '';
      const fullError = (errorMsg + ' ' + errorStr).toLowerCase();
      
      console.error('[Cookie测试] 测试失败:', err);
  
      let displayMessage = '❌ 测试失败: 未知错误';
      if (fullError.includes('json') || fullError.includes('parse')) {
        displayMessage = '❌ 测试失败: Cookie 完全无效或格式错误 (无法解析响应)';
      } else if (fullError.includes('network') || fullError.includes('fetch') || fullError.includes('connection')) {
        displayMessage = '❌ 测试失败: 网络连接失败，请检查网络连接或防火墙设置';
      } else if (fullError.includes('timeout') || fullError.includes('超时')) {
        displayMessage = '❌ 测试失败: 请求超时，请检查网络连接';
      } else if (errorMsg) {
        const shortError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
        displayMessage = `❌ 测试失败: ${shortError}`;
      }
      
      if (cookieStatusEl) {
        cookieStatusEl.textContent = displayMessage;
        cookieStatusEl.style.color = 'red';
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Cookie测试] 测试微博连接失败:', error);
    if (cookieStatusEl) {
      cookieStatusEl.textContent = `❌ 测试失败: ${errorMsg}`;
      cookieStatusEl.style.color = 'red';
    }
  } finally {
    // 恢复按钮状态
    if (testCookieBtn) {
      testCookieBtn.disabled = false;
      testCookieBtn.textContent = '测试Cookie';
    }
  }
}

/**
 * 测试牛客 Cookie 连接
 * 通过调用牛客上传 API 验证 Cookie 是否有效
 */
async function testNowcoderConnection(): Promise<void> {
  const nowcoderCookieStatusEl = document.getElementById('nowcoder-cookie-status');
  const testNowcoderBtn = document.getElementById('test-nowcoder-cookie-btn') as HTMLButtonElement | null;

  try {
    console.log('[牛客Cookie测试] 开始测试牛客连接...');

    // 验证输入
    if (!nowcoderCookieEl) {
      console.error('[牛客Cookie测试] nowcoderCookieEl 不存在');
      if (nowcoderCookieStatusEl) {
        nowcoderCookieStatusEl.textContent = '❌ Cookie 输入框不存在';
        nowcoderCookieStatusEl.style.color = 'red';
      }
      return;
    }

    const cookie = nowcoderCookieEl.value.trim();
    if (!cookie || cookie.length === 0) {
      console.warn('[牛客Cookie测试] Cookie 为空');
      if (nowcoderCookieStatusEl) {
        nowcoderCookieStatusEl.textContent = '❌ Cookie 不能为空！';
        nowcoderCookieStatusEl.style.color = 'red';
      }
      return;
    }

    // 检查必要字段
    if (!cookie.includes('t=')) {
      console.warn('[牛客Cookie测试] Cookie 缺少 t 字段');
      if (nowcoderCookieStatusEl) {
        nowcoderCookieStatusEl.textContent = '❌ Cookie 缺少必要字段 t（需要登录后的 Cookie）';
        nowcoderCookieStatusEl.style.color = 'red';
      }
      return;
    }

    // 禁用测试按钮，显示加载状态
    if (testNowcoderBtn) {
      testNowcoderBtn.disabled = true;
      testNowcoderBtn.textContent = '测试中...';
    }

    // 更新状态
    if (nowcoderCookieStatusEl) {
      nowcoderCookieStatusEl.textContent = '⏳ 测试中...';
      nowcoderCookieStatusEl.style.color = 'yellow';
    }

    try {
      // 获取 HTTP 客户端
      const client = await getClient();

      // 创建最小的 1x1 透明 PNG（67 字节）
      const minimalPng = new Uint8Array([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, // 8-bit RGBA
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, // IDAT chunk
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, // compressed data
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, // checksum
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
        0xAE, 0x42, 0x60, 0x82  // IEND CRC
      ]);

      // 发送测试请求
      const timestamp = Date.now();
      const response = await client.post<{ code: number; msg: string; url?: string }>(
        `https://www.nowcoder.com/uploadImage?type=1&_=${timestamp}`,
        Body.bytes(minimalPng),
        {
          responseType: ResponseType.JSON,
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/octet-stream',
            'Referer': 'https://www.nowcoder.com/creation/write/article',
            'Origin': 'https://www.nowcoder.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
          },
          timeout: 15000, // 15秒超时
        }
      );

      // 检查 HTTP 状态码
      if (!response.ok) {
        const errorMsg = `❌ 测试失败 (HTTP ${response.status})`;
        console.warn('[牛客Cookie测试] HTTP 请求失败:', response.status);
        if (nowcoderCookieStatusEl) {
          if (response.status === 401 || response.status === 403) {
            nowcoderCookieStatusEl.textContent = `${errorMsg}: Cookie 无效或已过期`;
          } else if (response.status >= 500) {
            nowcoderCookieStatusEl.textContent = `${errorMsg}: 牛客服务器错误`;
          } else {
            nowcoderCookieStatusEl.textContent = errorMsg;
          }
          nowcoderCookieStatusEl.style.color = 'red';
        }
        return;
      }

      // 检查响应数据
      if (!response.data) {
        console.warn('[牛客Cookie测试] 响应数据为空');
        if (nowcoderCookieStatusEl) {
          nowcoderCookieStatusEl.textContent = '❌ 测试失败: 响应数据为空';
          nowcoderCookieStatusEl.style.color = 'red';
        }
        return;
      }

      // 验证返回码
      if (response.data.code === 0) {
        console.log('[牛客Cookie测试] ✓ Cookie 有效');
        if (nowcoderCookieStatusEl) {
          nowcoderCookieStatusEl.textContent = '✅ Cookie 有效！ (已登录)';
          nowcoderCookieStatusEl.style.color = 'lightgreen';
        }
      } else {
        console.warn('[牛客Cookie测试] Cookie 无效，返回:', response.data);
        if (nowcoderCookieStatusEl) {
          nowcoderCookieStatusEl.textContent = `❌ ${response.data.msg || 'Cookie 无效或已过期'} (code: ${response.data.code})`;
          nowcoderCookieStatusEl.style.color = 'red';
        }
      }
    } catch (err: unknown) {
      const errorStr = err?.toString() || String(err) || '';
      const errorMsg = err instanceof Error ? err.message : errorStr;
      const fullError = (errorMsg + ' ' + errorStr).toLowerCase();

      console.error('[牛客Cookie测试] 测试失败:', err);

      let displayMessage = '❌ 测试失败: 未知错误';
      if (fullError.includes('json') || fullError.includes('parse')) {
        displayMessage = '❌ 测试失败: Cookie 无效或格式错误 (无法解析响应)';
      } else if (fullError.includes('network') || fullError.includes('fetch') || fullError.includes('connection')) {
        displayMessage = '❌ 测试失败: 网络连接失败，请检查网络连接';
      } else if (fullError.includes('timeout') || fullError.includes('超时')) {
        displayMessage = '❌ 测试失败: 请求超时，请检查网络连接';
      } else if (errorMsg) {
        const shortError = errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
        displayMessage = `❌ 测试失败: ${shortError}`;
      }

      if (nowcoderCookieStatusEl) {
        nowcoderCookieStatusEl.textContent = displayMessage;
        nowcoderCookieStatusEl.style.color = 'red';
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[牛客Cookie测试] 测试牛客连接失败:', error);
    if (nowcoderCookieStatusEl) {
      nowcoderCookieStatusEl.textContent = `❌ 测试失败: ${errorMsg}`;
      nowcoderCookieStatusEl.style.color = 'red';
    }
  } finally {
    // 恢复按钮状态
    if (testNowcoderBtn) {
      testNowcoderBtn.disabled = false;
      testNowcoderBtn.textContent = '测试连接';
    }
  }
}


// --- HISTORY LOGIC (from history.ts) ---
let allHistoryItems: HistoryItem[] = [];

/**
 * 删除单条历史记录

 * @param itemId 历史记录项的唯一 ID
 */
async function deleteHistoryItem(itemId: string): Promise<void> {
  try {
    if (!itemId || typeof itemId !== 'string' || itemId.trim().length === 0) {
      console.error('[历史记录] 删除失败: 无效的 itemId:', itemId);
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = '❌ 删除失败: 无效的项目ID';
      }
      return;
    }
    
    const confirmed = await showConfirmModal(
      '您确定要从本地历史记录中删除此条目吗？此操作不会删除已上传到微博的图片。', 
      '确认删除'
    );
    
    if (!confirmed) {
      console.log('[历史记录] 用户取消删除');
      return;
    }
  
    if (historyStatusMessageEl) {
      historyStatusMessageEl.textContent = '删除中...';
    }
    
    try {
      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      const filteredItems = items.filter(item => item.id !== itemId);
      
      if (filteredItems.length === items.length) {
        console.warn('[历史记录] 未找到要删除的项目:', itemId);
        if (historyStatusMessageEl) {
          historyStatusMessageEl.textContent = '⚠️ 未找到要删除的项目';
        }
        return;
      }
      
      await historyStore.set('uploads', filteredItems);
      await historyStore.save();
      
      console.log('[历史记录] ✓ 删除成功:', itemId);
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = '✅ 已删除';
        setTimeout(() => {
          if (historyStatusMessageEl) {
            historyStatusMessageEl.textContent = '';
          }
        }, 2000);
      }
      
      loadHistory().catch(err => {
        console.error('[历史记录] 重新加载历史记录失败:', err);
      });
    } catch (storeError) {
      const errorMsg = storeError instanceof Error ? storeError.message : String(storeError);
      console.error('[历史记录] 删除失败:', storeError);
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = `❌ 删除失败: ${errorMsg}`;
      }
      throw storeError;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[历史记录] 删除历史记录失败:', err);
    if (historyStatusMessageEl) {
      historyStatusMessageEl.textContent = `❌ 删除失败: ${errorMsg}`;
    }
  }
}

function migrateHistoryItem(item: any): HistoryItem {
    // 如果是新格式且有必要字段，直接返回
    if (item.id && item.localFileName && item.generatedLink &&
        item.primaryService && item.results) {
      return item as HistoryItem;
    }

    // 迁移旧格式
    const migratedItem: HistoryItem = {
      id: item.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: item.timestamp || Date.now(),
      localFileName: item.localFileName || item.fileName || '未知文件',
      filePath: item.filePath || undefined,

      // 新架构必需字段
      primaryService: item.primaryService || 'weibo',
      results: item.results || [],
      generatedLink: item.generatedLink || item.link || '',
    };

    // 如果旧数据有链接但没有 results，构建兼容的 results
    if (migratedItem.generatedLink && migratedItem.results.length === 0) {
      migratedItem.results.push({
        serviceId: 'weibo',
        result: { url: migratedItem.generatedLink },
        status: 'success'
      });
    }

    return migratedItem;
}

function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// 预览URL生成函数（保留以备将来UI功能使用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getPreviewUrl(weiboPid: string): Promise<string> {
    try {
      const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
      const baiduPrefix = config.baiduPrefix || DEFAULT_CONFIG.baiduPrefix;
      const bmiddleUrl = `https://tvax1.sinaimg.cn/bmiddle/${weiboPid}.jpg`;
      return baiduPrefix + bmiddleUrl;
    } catch {
      const bmiddleUrl = `https://tvax1.sinaimg.cn/bmiddle/${weiboPid}.jpg`;
      return DEFAULT_CONFIG.baiduPrefix + bmiddleUrl;
    }
}

/**
 * 渲染历史记录表格（新架构 - 多图床展示）
 * [v2.7 优化] 使用 DocumentFragment 批量插入，减少 DOM 重排
 * [v3.0 新功能] 支持多图床状态徽章、重试按钮、链接选择下拉
 */
async function renderHistoryTable(items: HistoryItem[]) {
    if (!historyBody) {
      console.error('[历史记录] historyBody 不存在，无法渲染表格');
      return;
    }

    historyBody.innerHTML = '';

    if (items.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #888;">暂无历史记录</td></tr>';
      return;
    }

    // [v2.7 优化] 使用 DocumentFragment 进行批量插入
    const fragment = document.createDocumentFragment();

    for (const item of items) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', item.id);
      tr.setAttribute('data-filename', item.localFileName.toLowerCase());

      // 0. 复选框列（批量操作）
      const tdCheckbox = document.createElement('td');
      tdCheckbox.className = 'checkbox-col';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'row-checkbox';
      checkbox.setAttribute('data-item-id', item.id);
      checkbox.addEventListener('change', updateBulkActionButtons);
      tdCheckbox.appendChild(checkbox);
      tr.appendChild(tdCheckbox);

      // 1. 预览列
      const tdPreview = document.createElement('td');
      const img = document.createElement('img');
      img.style.width = '50px';
      img.style.height = '50px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '4px';
      img.alt = item.localFileName;

      // 从成功的图床结果中获取预览图
      const successResult = item.results?.find(r => r.status === 'success');
      if (successResult?.result?.url) {
        img.src = successResult.result.url;
      } else {
        img.src = item.generatedLink;
      }
      img.onerror = () => { img.style.display = 'none'; };
      tdPreview.appendChild(img);
      tr.appendChild(tdPreview);

      // 2. 文件名列
      const tdName = document.createElement('td');
      tdName.textContent = item.localFileName;
      tdName.title = item.localFileName;
      tr.appendChild(tdName);

      // 3. 图床状态列（新增）
      const tdServices = document.createElement('td');
      const servicesContainer = document.createElement('div');
      servicesContainer.className = 'service-badges-container';

      // 渲染所有图床的状态徽章
      if (item.results && item.results.length > 0) {
        item.results.forEach(serviceResult => {
          const badge = document.createElement('span');
          badge.className = `service-badge ${serviceResult.status}`;
          badge.title = serviceResult.error || serviceResult.result?.url || '';

          // 图床名称映射
          const serviceNames: Record<ServiceType, string> = {
            weibo: '微博',
            r2: 'R2',
            tcl: 'TCL',
            jd: '京东',
            nowcoder: '牛客',
            qiyu: '七鱼'
          };

          const serviceName = serviceNames[serviceResult.serviceId] || serviceResult.serviceId;
          badge.textContent = `${serviceName} ${serviceResult.status === 'success' ? '✓' : '✗'}`;

          servicesContainer.appendChild(badge);

          // 失败的图床显示重试按钮
          if (serviceResult.status === 'failed') {
            const retryBtn = document.createElement('button');
            retryBtn.className = 'service-retry-btn';
            retryBtn.innerHTML = '↻';
            retryBtn.title = `重试上传到 ${serviceName}`;
            retryBtn.onclick = () => retryServiceUpload(item.id, serviceResult.serviceId);
            badge.appendChild(retryBtn);
          }
        });
      } else {
        // 旧数据兼容：没有 results 字段
        const badge = document.createElement('span');
        badge.className = 'service-badge success';
        badge.textContent = `${item.primaryService || '未知'} ✓`;
        servicesContainer.appendChild(badge);
      }

      tdServices.appendChild(servicesContainer);
      tr.appendChild(tdServices);

      // 4. 链接选择列（新增下拉框）
      const tdLink = document.createElement('td');

      if (item.results && item.results.length > 0) {
        // 获取当前前缀配置
        const activePrefix = getActivePrefixFromUI();

        // 创建链接选择下拉框
        const linkSelector = document.createElement('select');
        linkSelector.className = 'link-selector';
        linkSelector.title = '选择要复制的链接';

        item.results.forEach(serviceResult => {
          if (serviceResult.status === 'success' && serviceResult.result?.url) {
            const option = document.createElement('option');

            // 微博链接动态拼接当前选择的前缀
            let displayUrl = serviceResult.result.url;
            if (serviceResult.serviceId === 'weibo' && activePrefix) {
              displayUrl = activePrefix + serviceResult.result.url;
            }
            option.value = displayUrl;

            const serviceNames: Record<ServiceType, string> = {
              weibo: '微博',
              r2: 'R2',
              tcl: 'TCL',
              jd: '京东',
              nowcoder: '牛客',
              qiyu: '七鱼'
            };

            const serviceName = serviceNames[serviceResult.serviceId] || serviceResult.serviceId;
            const isPrimary = serviceResult.serviceId === item.primaryService;
            option.textContent = `${serviceName}${isPrimary ? ' (主)' : ''}`;

            if (isPrimary) {
              option.selected = true;
            }

            linkSelector.appendChild(option);
          }
        });

        // 如果只有一个成功的链接，直接显示链接
        if (linkSelector.options.length === 1) {
          // 获取实际显示的链接（已经包含前缀处理）
          const displayLink = linkSelector.options[0].value;
          const link = document.createElement('a');
          link.href = displayLink;
          link.target = '_blank';
          link.textContent = displayLink;
          link.title = displayLink;
          link.className = 'history-link';
          tdLink.appendChild(link);
        } else if (linkSelector.options.length > 1) {
          tdLink.appendChild(linkSelector);
        } else {
          tdLink.textContent = '无可用链接';
        }
      } else {
        // 旧数据兼容：动态处理微博链接前缀
        const activePrefix = getActivePrefixFromUI();
        let displayLink = item.generatedLink;

        // 如果是微博链接且有前缀配置，需要处理
        if (item.primaryService === 'weibo' && activePrefix) {
          // 检查链接是否已经包含旧前缀，如果是则替换
          const oldPrefixes = [...DEFAULT_PREFIXES];
          let isOldPrefixed = false;
          for (const oldPrefix of oldPrefixes) {
            if (displayLink.startsWith(oldPrefix)) {
              // 移除旧前缀，添加新前缀
              displayLink = activePrefix + displayLink.substring(oldPrefix.length);
              isOldPrefixed = true;
              break;
            }
          }
          // 如果没有旧前缀，直接添加新前缀
          if (!isOldPrefixed && !displayLink.startsWith('http')) {
            displayLink = activePrefix + displayLink;
          }
        }

        const link = document.createElement('a');
        link.href = displayLink;
        link.target = '_blank';
        link.textContent = displayLink;
        link.title = displayLink;
        link.className = 'history-link';
        tdLink.appendChild(link);
      }

      tr.appendChild(tdLink);

      // 5. 时间列
      const tdTime = document.createElement('td');
      tdTime.textContent = formatTimestamp(item.timestamp);
      tr.appendChild(tdTime);

      // 6. 复制操作列
      const tdAction = document.createElement('td');
      const copyBtn = document.createElement('button');
      const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      const checkIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

      copyBtn.innerHTML = copyIcon;
      copyBtn.title = '复制当前选择的链接';
      copyBtn.className = 'icon-btn';

      copyBtn.addEventListener('click', async () => {
        try {
          let linkToCopy = item.generatedLink;

          // 如果有下拉框，复制选中的链接
          const selector = tr.querySelector<HTMLSelectElement>('.link-selector');
          if (selector) {
            linkToCopy = selector.value;
          }

          await writeText(linkToCopy);
          copyBtn.innerHTML = checkIcon;
          copyBtn.style.color = 'var(--success)';
          setTimeout(() => {
            copyBtn.innerHTML = copyIcon;
            copyBtn.style.color = '';
          }, 1500);
        } catch (err) {
          copyBtn.innerHTML = '❌';
          copyBtn.style.color = 'var(--error)';
          copyBtn.style.fontSize = '14px';
        }
      });
      tdAction.appendChild(copyBtn);
      tr.appendChild(tdAction);

      // 7. 删除操作列
      const tdDelete = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      deleteBtn.title = '删除此记录';
      deleteBtn.className = 'icon-btn';
      deleteBtn.addEventListener('click', () => deleteHistoryItem(item.id));
      tdDelete.appendChild(deleteBtn);
      tr.appendChild(tdDelete);

      // 添加到 DocumentFragment 而不是直接添加到 DOM
      fragment.appendChild(tr);
    }

    // 一次性插入所有行，只触发一次重排
    historyBody.appendChild(fragment);
}

/**
 * 重试单个图床的上传（新功能）
 * @param historyId 历史记录 ID
 * @param serviceId 图床服务 ID
 */
async function retryServiceUpload(historyId: string, serviceId: ServiceType): Promise<void> {
  console.log(`[重试] 开始重试: historyId=${historyId}, serviceId=${serviceId}`);

  try {
    // 1. 获取历史记录项
    const items = await historyStore.get<HistoryItem[]>('uploads', []);
    const item = items.find(i => i.id === historyId);

    if (!item) {
      throw new Error('找不到历史记录项');
    }

    // 2. 检查是否有文件路径
    if (!item.filePath) {
      throw new Error('该历史记录没有保存原始文件路径，无法重试');
    }

    // 3. 检查文件是否存在
    try {
      const fileExists = await invoke<boolean>('file_exists', { path: item.filePath });
      if (!fileExists) {
        throw new Error(`原始文件不存在: ${item.filePath}`);
      }
    } catch (checkError: any) {
      throw new Error(`检查文件失败: ${checkError.message || String(checkError)}`);
    }

    // 4. 获取当前配置
    const config = await configStore.get<UserConfig>('config', DEFAULT_CONFIG);

    // 5. 显示加载状态
    const serviceNames: Record<ServiceType, string> = {
      weibo: '微博',
      r2: 'R2',
      tcl: 'TCL',
      jd: '京东',
      nowcoder: '牛客',
      qiyu: '七鱼'
    };
    const serviceName = serviceNames[serviceId] || serviceId;
    showToast(`正在重试上传到 ${serviceName}...`, 'loading', 0);

    // 6. 重试上传
    const multiUploader = new MultiServiceUploader();
    const result = await multiUploader.retryUpload(
      item.filePath,
      serviceId,
      config,
      (percent) => {
        console.log(`[重试] ${serviceName} 进度: ${percent}%`);
      }
    );

    console.log(`[重试] ${serviceName} 上传成功:`, result);

    // 7. 更新历史记录中的结果状态
    // ⚠️ 关键修复：确保 results 数组存在（兼容旧数据）
    if (!item.results) {
      item.results = [];
    }

    const targetResult = item.results.find(r => r.serviceId === serviceId);
    if (targetResult) {
      targetResult.status = 'success';
      targetResult.result = result;
      delete targetResult.error;
    } else {
      // 如果原本没有这个图床的结果，添加新的
      item.results.push({
        serviceId,
        result,
        status: 'success'
      });
    }

    // 如果重试成功的图床是第一个成功的，更新主力图床
    const successResults = item.results.filter(r => r.status === 'success');
    if (successResults.length === 1 && successResults[0].serviceId === serviceId) {
      item.primaryService = serviceId;
      item.generatedLink = result.url;
    }

    // 8. 保存更新后的历史记录
    await historyStore.set('uploads', items);
    await historyStore.save();

    console.log(`[重试] 历史记录已更新`);

    // 9. 显示成功提示
    showToast(`${serviceName} 重试成功！`, 'success', 3000);

    // 10. 重新加载历史记录表格
    await loadHistory();

  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`[重试] 重试失败:`, error);
    showToast(`重试失败: ${errorMsg}`, 'error', 5000);
  }
}

/**
 * 批量操作：获取选中的历史记录项
 */
function getSelectedHistoryItems(): string[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.row-checkbox:checked');
  return Array.from(checkboxes).map(cb => cb.getAttribute('data-item-id')).filter((id): id is string => !!id);
}

/**
 * 批量操作：更新批量操作按钮的启用/禁用状态
 */
function updateBulkActionButtons(): void {
  const selectedIds = getSelectedHistoryItems();
  const bulkCopyBtn = document.getElementById('bulk-copy-btn') as HTMLButtonElement | null;
  const bulkExportBtn = document.getElementById('bulk-export-btn') as HTMLButtonElement | null;
  const bulkDeleteBtn = document.getElementById('bulk-delete-btn') as HTMLButtonElement | null;

  const hasSelection = selectedIds.length > 0;

  if (bulkCopyBtn) bulkCopyBtn.disabled = !hasSelection;
  if (bulkExportBtn) bulkExportBtn.disabled = !hasSelection;
  if (bulkDeleteBtn) bulkDeleteBtn.disabled = !hasSelection;
}

/**
 * 批量操作：全选/取消全选
 */
function toggleSelectAll(checked: boolean): void {
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.row-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = checked;
  });
  updateBulkActionButtons();
}

/**
 * 批量操作：批量复制链接
 */
async function bulkCopyLinks(): Promise<void> {
  try {
    const selectedIds = getSelectedHistoryItems();
    if (selectedIds.length === 0) {
      showToast('请先选择要复制的项目', 'error', 3000);
      return;
    }

    const items = await historyStore.get<HistoryItem[]>('uploads', []);
    const selectedItems = items.filter(item => selectedIds.includes(item.id));

    // 收集所有链接
    const links = selectedItems.map(item => item.generatedLink).filter(link => !!link);

    if (links.length === 0) {
      showToast('选中的项目没有可用链接', 'error', 3000);
      return;
    }

    // 复制到剪贴板（每行一个链接）
    await writeText(links.join('\n'));

    showToast(`已复制 ${links.length} 个链接到剪贴板`, 'success', 3000);
    console.log(`[批量操作] 已复制 ${links.length} 个链接`);

  } catch (error: any) {
    console.error('[批量操作] 复制失败:', error);
    showToast(`复制失败: ${error.message || String(error)}`, 'error', 5000);
  }
}

/**
 * 批量操作：批量导出为 JSON
 */
async function bulkExportJSON(): Promise<void> {
  try {
    const selectedIds = getSelectedHistoryItems();
    if (selectedIds.length === 0) {
      showToast('请先选择要导出的项目', 'error', 3000);
      return;
    }

    const items = await historyStore.get<HistoryItem[]>('uploads', []);
    const selectedItems = items.filter(item => selectedIds.includes(item.id));

    // 生成 JSON 内容
    const jsonContent = JSON.stringify(selectedItems, null, 2);

    // 保存文件
    const filePath = await save({
      defaultPath: `weibo-history-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!filePath) {
      console.log('[批量操作] 用户取消导出');
      return;
    }

    await writeTextFile(filePath, jsonContent);

    showToast(`已导出 ${selectedItems.length} 条记录到 ${filePath}`, 'success', 3000);
    console.log(`[批量操作] 已导出 ${selectedItems.length} 条记录`);

  } catch (error: any) {
    console.error('[批量操作] 导出失败:', error);
    showToast(`导出失败: ${error.message || String(error)}`, 'error', 5000);
  }
}

/**
 * 批量操作：批量删除记录
 */
async function bulkDeleteRecords(): Promise<void> {
  try {
    const selectedIds = getSelectedHistoryItems();
    if (selectedIds.length === 0) {
      showToast('请先选择要删除的项目', 'error', 3000);
      return;
    }

    const confirmed = await showConfirmModal(
      `确定要删除选中的 ${selectedIds.length} 条历史记录吗？此操作不可撤销。`,
      '批量删除确认'
    );

    if (!confirmed) {
      console.log('[批量操作] 用户取消删除');
      return;
    }

    const items = await historyStore.get<HistoryItem[]>('uploads', []);
    const remainingItems = items.filter(item => !selectedIds.includes(item.id));

    await historyStore.set('uploads', remainingItems);
    await historyStore.save();

    showToast(`已删除 ${selectedIds.length} 条记录`, 'success', 3000);
    console.log(`[批量操作] 已删除 ${selectedIds.length} 条记录`);

    // 重新加载历史记录
    await loadHistory();

  } catch (error: any) {
    console.error('[批量操作] 删除失败:', error);
    showToast(`删除失败: ${error.message || String(error)}`, 'error', 5000);
  }
}

async function loadHistory() {
    let items = await historyStore.get<any[]>('uploads');
    if (!items || items.length === 0) {
      allHistoryItems = [];
      galleryState.displayedItems = [];
      renderHistoryTable([]);
      return;
    }

    const migratedItems = items.map(migrateHistoryItem);
    const needsSave = items.some(item =>
      !item.id ||
      !item.localFileName ||
      !item.generatedLink ||
      !item.results ||          // 检查新架构必需字段
      !item.primaryService      // 检查新架构必需字段
    );
    if (needsSave) {
      await historyStore.set('uploads', migratedItems);
      await historyStore.save();
    }

    allHistoryItems = migratedItems.sort((a, b) => b.timestamp - a.timestamp);

    // 初始化displayedItems - 应用当前筛选
    if (galleryState.currentFilter === 'all') {
      galleryState.displayedItems = allHistoryItems;
    } else {
      galleryState.displayedItems = allHistoryItems.filter(item =>
        item.results?.some(r => r.serviceId === galleryState.currentFilter && r.status === 'success')
      );
    }

    await applySearchFilter();
}

async function applySearchFilter() {
    if (!searchInput) {
      console.warn('[历史记录] searchInput 不存在，无法应用过滤');
      return;
    }

    const searchTerm = searchInput.value.toLowerCase().trim();
    let filteredItems: HistoryItem[];

    if (!searchTerm) {
      // 没有搜索词，使用displayedItems（可能已有图床筛选）
      filteredItems = galleryState.displayedItems;
    } else {
      // 有搜索词，在displayedItems基础上进一步筛选
      filteredItems = galleryState.displayedItems.filter(item =>
        item.localFileName.toLowerCase().includes(searchTerm)
      );
    }

    // 根据当前视图模式渲染
    if (galleryState.viewMode === 'grid') {
      // 更新displayedItems用于瀑布流（需要重新设置以触发重新渲染）
      const tempItems = filteredItems;
      galleryState.displayedItems = tempItems;
      renderGalleryView();
    } else {
      await renderHistoryTable(filteredItems);
    }
}

async function clearHistory() {
    const confirmed = await showConfirmModal(
      '确定要清空所有上传历史记录吗？此操作不可撤销。',
      '确认清空'
    );
    if (!confirmed) {
      return;
    }
    try {
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = '清空中...';
      }
      await historyStore.clear();
      await historyStore.save();
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = '已清空。';
      }
      loadHistory();
    } catch (err) {
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = `清空失败: ${err}`;
      }
    }
}

// JSON导出函数（保留以备将来UI功能使用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function exportToJson() {
    try {
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = '准备导出...';
      }
      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      if (items.length === 0) {
        if (historyStatusMessageEl) {
          historyStatusMessageEl.textContent = '没有可导出的历史记录。';
        }
        return;
      }
      const jsonContent = JSON.stringify(items, null, 2);
      const filePath = await save({
        defaultPath: 'weibo_dr_export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!filePath) {
        if (historyStatusMessageEl) {
          historyStatusMessageEl.textContent = '已取消导出。';
        }
        return;
      }
      await writeTextFile(filePath, jsonContent);
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = `✅ 已导出 ${items.length} 条记录到 ${filePath}`;
      }
    } catch (err) {
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = `导出失败: ${err}`;
      }
      console.error('导出失败:', err);
    }
}

// WebDAV同步函数（保留以备将来UI功能使用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function syncToWebDAV() {
    try {
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = '同步中...';
      }
      const config = await configStore.get<UserConfig>('config');
      if (!config || !config.webdav || !config.webdav.url || !config.webdav.username || !config.webdav.password || !config.webdav.remotePath) {
        if (historyStatusMessageEl) {
          historyStatusMessageEl.textContent = '❌ WebDAV 配置不完整，请检查设置。';
        }
        navigateTo('settings');
        return;
      }
      const { url, username, password, remotePath } = config.webdav;
      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      const jsonContent = JSON.stringify(items, null, 2);
      
      const baseUrl = url.trim();
      let path = remotePath.trim();
      
      // 如果路径以 / 结尾，假设是目录，追加 history.json
      if (path.endsWith('/')) {
        path += 'history.json';
      } else if (!path.toLowerCase().endsWith('.json')) {
        // 如果没有扩展名，也假设是目录（或者追加 .json）
        path += '/history.json';
      }

      let webdavUrl: string;
      if (baseUrl.endsWith('/') && path.startsWith('/')) {
        webdavUrl = baseUrl + path.substring(1);
      } else if (baseUrl.endsWith('/') || path.startsWith('/')) {
        webdavUrl = baseUrl + path;
      } else {
        webdavUrl = baseUrl + '/' + path;
      }

      const auth = btoa(`${username}:${password}`);
      const client = await getClient();
      const response = await client.put(webdavUrl, Body.text(jsonContent), {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
          'Overwrite': 'T'  // WebDAV 标准：允许覆盖现有文件
        }
      });
      if (historyStatusMessageEl) {
        if (response.ok) {
          historyStatusMessageEl.textContent = `✅ 已同步 ${items.length} 条记录到 WebDAV`;
        } else {
          const status = response.status;
          let errorMsg = `❌ 同步失败: HTTP ${status}`;
          if (status === 409) {
            errorMsg = '❌ 同步失败: 文件冲突 (HTTP 409)，请检查 WebDAV 服务器设置';
          } else if (status === 401 || status === 403) {
            errorMsg = `❌ 同步失败: 认证失败 (HTTP ${status})，请检查用户名和密码`;
          } else if (status === 404) {
            errorMsg = `❌ 同步失败: 路径不存在 (HTTP ${status})，请检查远程路径配置`;
          } else if (status >= 500) {
            errorMsg = `❌ 同步失败: 服务器错误 (HTTP ${status})，WebDAV 服务器可能暂时不可用`;
          }
          historyStatusMessageEl.textContent = errorMsg;
        }
      }
    } catch (err: any) {
      if (historyStatusMessageEl) {
        historyStatusMessageEl.textContent = `❌ 同步失败: ${err.message || err}`;
      }
      console.error('WebDAV 同步失败:', err);
    }
}

/**
 * 加载并更新服务按钮状态
 */
async function loadServiceButtonStates(): Promise<void> {
  try {
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

    // 加载保存的选择状态（默认选中 tcl 和 jd）
    const enabledServices = config.enabledServices || ['tcl', 'jd'];
    const services: ServiceType[] = ['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu'];

    services.forEach(serviceId => {
      const btn = serviceButtons[serviceId as keyof typeof serviceButtons];
      if (!btn) return;

      // 先更新配置状态（决定是否 disabled）
      updateServiceStatus(serviceId, config);

      // 如果不是 disabled 且在 enabledServices 中，设为选中
      if (!btn.classList.contains('disabled') && enabledServices.includes(serviceId)) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });

    console.log('[服务按钮] 已加载状态:', enabledServices);
  } catch (error) {
    console.error('[服务按钮] 加载状态失败:', error);
  }
}

/**
 * 更新服务按钮状态（根据配置情况启用/禁用）
 */
function updateServiceStatus(serviceId: ServiceType, config: UserConfig): void {
  const btn = serviceButtons[serviceId as keyof typeof serviceButtons];
  if (!btn) return;

  // 确保 config.services 存在
  if (!config.services) {
    config.services = {};
  }

  // TCL 和 JD 开箱即用，始终可用
  if (serviceId === 'tcl' || serviceId === 'jd') {
    return;
  }

  // 判断是否已配置
  let isConfigured = false;
  if (serviceId === 'weibo') {
    const weiboConfig = config.services.weibo;
    isConfigured = !!weiboConfig?.cookie && weiboConfig.cookie.trim().length > 0;
  } else if (serviceId === 'r2') {
    const r2Config = config.services.r2;
    isConfigured = !!(
      r2Config?.accountId &&
      r2Config.accessKeyId &&
      r2Config.secretAccessKey &&
      r2Config.bucketName
    );
  } else if (serviceId === 'nowcoder') {
    const nowcoderConfig = config.services.nowcoder;
    isConfigured = !!nowcoderConfig?.cookie && nowcoderConfig.cookie.trim().length > 0;
  } else if (serviceId === 'qiyu') {
    const qiyuConfig = config.services.qiyu;
    isConfigured = !!qiyuConfig?.token && qiyuConfig.token.trim().length > 0;
  }

  // 更新按钮状态
  if (!isConfigured) {
    btn.classList.add('disabled');
    btn.classList.remove('selected');
  } else {
    btn.classList.remove('disabled');
  }
}

// ========================================
// GALLERY VIEW FUNCTIONS (浏览视图功能)
// ========================================

/**
 * 切换视图模式
 */
function switchViewMode(mode: 'table' | 'grid'): void {
  galleryState.viewMode = mode;

  // 更新按钮状态
  if (viewModeTableBtn && viewModeGridBtn) {
    if (mode === 'table') {
      viewModeTableBtn.classList.add('active');
      viewModeGridBtn.classList.remove('active');
    } else {
      viewModeTableBtn.classList.remove('active');
      viewModeGridBtn.classList.add('active');
    }
  }

  // 切换容器显示
  if (tableViewContainer && gridViewContainer) {
    if (mode === 'table') {
      tableViewContainer.style.display = 'block';
      gridViewContainer.style.display = 'none';
    } else {
      tableViewContainer.style.display = 'none';
      gridViewContainer.style.display = 'block';
      renderGalleryView();
    }
  }

  // 保存偏好设置
  saveViewModePreference(mode);
}

/**
 * 保存视图模式偏好
 */
async function saveViewModePreference(mode: 'table' | 'grid'): Promise<void> {
  try {
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
    if (!config.galleryViewPreferences) {
      config.galleryViewPreferences = {
        viewMode: mode,
        gridColumnWidth: 220,
      };
    } else {
      config.galleryViewPreferences.viewMode = mode;
    }
    await configStore.set('config', config);
  } catch (error) {
    console.error('[Gallery] 保存视图偏好失败:', error);
  }
}

/**
 * 加载视图模式偏好
 */
async function loadViewModePreference(): Promise<void> {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (config?.galleryViewPreferences?.viewMode) {
      const mode = config.galleryViewPreferences.viewMode;
      if (mode === 'grid') {
        switchViewMode('grid');
      }
    }
  } catch (error) {
    console.error('[Gallery] 加载视图偏好失败:', error);
  }
}

/**
 * 渲染瀑布流视图
 */
function renderGalleryView(): void {
  if (!galleryGrid) return;

  galleryState.gridLoadedCount = 0;
  galleryGrid.innerHTML = '';

  if (galleryState.displayedItems.length === 0) {
    renderEmptyState();
    return;
  }

  loadMoreGridItems();
  setupLazyLoading();
}

/**
 * 渲染空状态
 */
function renderEmptyState(): void {
  if (!galleryGrid) return;

  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'grid-empty-state';
  emptyDiv.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
    <p>暂无图片</p>
  `;
  galleryGrid.appendChild(emptyDiv);
}

/**
 * 加载更多网格项
 */
function loadMoreGridItems(): void {
  if (!galleryGrid) return;

  const startIndex = galleryState.gridLoadedCount;
  const endIndex = Math.min(
    startIndex + galleryState.gridBatchSize,
    galleryState.displayedItems.length
  );

  const itemsToLoad = galleryState.displayedItems.slice(startIndex, endIndex);
  const fragment = document.createDocumentFragment();

  itemsToLoad.forEach(item => {
    const cardElement = createGalleryCard(item);
    fragment.appendChild(cardElement);
  });

  galleryGrid.appendChild(fragment);
  galleryState.gridLoadedCount = endIndex;
  updateGridLoadingState();
}

/**
 * 创建瀑布流卡片
 */
function createGalleryCard(item: HistoryItem): HTMLElement {
  const card = document.createElement('div');
  card.className = 'gallery-item';
  card.setAttribute('data-id', item.id);

  // 复选框
  const checkboxDiv = document.createElement('div');
  checkboxDiv.className = 'gallery-item-checkbox';
  if (galleryState.selectedGridItems.has(item.id)) {
    checkboxDiv.classList.add('has-checked');
  }

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'grid-row-checkbox';
  checkbox.setAttribute('data-item-id', item.id);
  checkbox.checked = galleryState.selectedGridItems.has(item.id);
  checkbox.addEventListener('change', (e) => {
    e.stopPropagation();
    handleGridCheckboxChange(item.id, checkbox.checked);
  });
  checkbox.addEventListener('click', (e) => e.stopPropagation());
  checkboxDiv.appendChild(checkbox);
  card.appendChild(checkboxDiv);

  // 图床徽章
  const badgeDiv = document.createElement('div');
  badgeDiv.className = 'gallery-item-badge';

  // 获取成功的图床
  const successResults = item.results?.filter(r => r.status === 'success') || [];
  successResults.slice(0, 2).forEach(result => {
    const badge = document.createElement('span');
    badge.className = 'service-badge success';
    badge.textContent = getServiceDisplayName(result.serviceId);
    badgeDiv.appendChild(badge);
  });

  if (successResults.length > 2) {
    const moreBadge = document.createElement('span');
    moreBadge.className = 'service-badge success';
    moreBadge.textContent = `+${successResults.length - 2}`;
    badgeDiv.appendChild(moreBadge);
  }

  card.appendChild(badgeDiv);

  // 图片
  const imageWrapper = document.createElement('div');
  imageWrapper.className = 'gallery-item-image-wrapper';

  const img = document.createElement('img');
  img.className = 'gallery-item-image';
  img.alt = item.localFileName;

  const imageUrl = getImageUrlFromItem(item);
  img.setAttribute('data-src', imageUrl);
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    img.style.display = 'none';
  });

  imageWrapper.appendChild(img);
  card.appendChild(imageWrapper);

  // 文件名
  const footer = document.createElement('div');
  footer.className = 'gallery-item-footer';

  const filename = document.createElement('div');
  filename.className = 'gallery-item-filename';
  filename.textContent = item.localFileName;
  filename.title = item.localFileName;

  footer.appendChild(filename);
  card.appendChild(footer);

  // 事件
  card.addEventListener('click', () => openLightbox(item.id));
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    handleCardContextMenu(e, item.id);
  });

  return card;
}

/**
 * 获取图片URL
 */
function getImageUrlFromItem(item: HistoryItem): string {
  const successResult = item.results?.find(r => r.status === 'success');
  if (successResult?.result?.url) {
    return successResult.result.url;
  }
  return item.generatedLink || '';
}

/**
 * 获取服务显示名称
 */
function getServiceDisplayName(serviceId: ServiceType): string {
  const names: Record<ServiceType, string> = {
    weibo: '微博',
    r2: 'R2',
    tcl: 'TCL',
    jd: '京东',
    nowcoder: '牛客',
    qiyu: '七鱼'
  };
  return names[serviceId] || serviceId;
}

/**
 * 更新网格加载状态
 */
function updateGridLoadingState(): void {
  if (!gridLoadingIndicator || !gridEndMessage) return;

  const hasMore = galleryState.gridLoadedCount < galleryState.displayedItems.length;

  if (hasMore) {
    gridLoadingIndicator.style.display = 'none';
    gridEndMessage.style.display = 'none';
  } else if (galleryState.displayedItems.length > 0) {
    gridLoadingIndicator.style.display = 'none';
    gridEndMessage.style.display = 'block';
  } else {
    gridLoadingIndicator.style.display = 'none';
    gridEndMessage.style.display = 'none';
  }
}

/**
 * 处理网格复选框变化
 */
function handleGridCheckboxChange(itemId: string, checked: boolean): void {
  if (checked) {
    galleryState.selectedGridItems.add(itemId);
  } else {
    galleryState.selectedGridItems.delete(itemId);
  }

  // 更新复选框容器的显示状态
  const card = galleryGrid?.querySelector(`[data-id="${itemId}"]`);
  if (card) {
    const checkboxDiv = card.querySelector('.gallery-item-checkbox');
    if (checkboxDiv) {
      if (checked) {
        checkboxDiv.classList.add('has-checked');
      } else {
        checkboxDiv.classList.remove('has-checked');
      }
    }
  }

  updateBulkActionButtons();
}

/**
 * 设置懒加载
 */
let gridObserver: IntersectionObserver | null = null;
let loadMoreObserver: IntersectionObserver | null = null;

function setupLazyLoading(): void {
  // 图片懒加载
  if (gridObserver) gridObserver.disconnect();

  gridObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          const src = img.getAttribute('data-src');
          if (src) {
            img.src = src;
            img.removeAttribute('data-src');
            gridObserver!.unobserve(img);
          }
        }
      });
    },
    { rootMargin: '50px', threshold: 0.01 }
  );

  const images = document.querySelectorAll<HTMLImageElement>('.gallery-item-image[data-src]');
  images.forEach(img => gridObserver!.observe(img));

  // 加载更多
  if (loadMoreObserver) loadMoreObserver.disconnect();

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const hasMore = galleryState.gridLoadedCount < galleryState.displayedItems.length;
          if (hasMore && gridLoadingIndicator) {
            gridLoadingIndicator.style.display = 'flex';
            setTimeout(() => {
              loadMoreGridItems();
              // 观察新加载的图片
              const newImages = document.querySelectorAll<HTMLImageElement>('.gallery-item-image[data-src]');
              newImages.forEach(img => gridObserver?.observe(img));
            }, 300);
          }
        }
      });
    },
    { rootMargin: '200px', threshold: 0.01 }
  );

  if (gridLoadingIndicator) loadMoreObserver.observe(gridLoadingIndicator);
}

// ========================================
// LIGHTBOX FUNCTIONS (Lightbox 功能)
// ========================================

/**
 * 打开Lightbox
 */
function openLightbox(itemId: string): void {
  const index = galleryState.displayedItems.findIndex(item => item.id === itemId);
  if (index === -1) return;

  galleryState.lightboxCurrentIndex = index;
  updateLightboxContent();

  if (lightboxModal) {
    lightboxModal.style.display = 'flex';
    document.addEventListener('keydown', handleLightboxKeydown);
  }
}

/**
 * 关闭Lightbox
 */
function closeLightbox(): void {
  if (lightboxModal) {
    lightboxModal.style.display = 'none';
    document.removeEventListener('keydown', handleLightboxKeydown);
  }
}

/**
 * 更新Lightbox内容
 */
function updateLightboxContent(): void {
  const item = galleryState.displayedItems[galleryState.lightboxCurrentIndex];
  if (!item) return;

  // 更新图片
  if (lightboxImage) {
    lightboxImage.src = getImageUrlFromItem(item);
    lightboxImage.alt = item.localFileName;
  }

  // 更新文件名
  if (lightboxFilename) {
    lightboxFilename.textContent = item.localFileName;
  }

  // 更新图床徽章
  if (lightboxServiceBadge) {
    const successResults = item.results?.filter(r => r.status === 'success') || [];
    if (successResults.length > 0) {
      lightboxServiceBadge.className = 'service-badge success';
      lightboxServiceBadge.textContent = successResults.map(r => getServiceDisplayName(r.serviceId)).join(', ');
    } else {
      lightboxServiceBadge.textContent = '';
    }
  }

  // 更新时间戳
  if (lightboxTimestamp) {
    lightboxTimestamp.textContent = formatTimestamp(item.timestamp);
  }

  // 更新导航按钮状态
  if (lightboxPrev) {
    lightboxPrev.disabled = galleryState.lightboxCurrentIndex === 0;
  }
  if (lightboxNext) {
    lightboxNext.disabled = galleryState.lightboxCurrentIndex === galleryState.displayedItems.length - 1;
  }
}

/**
 * 处理Lightbox键盘事件
 */
function handleLightboxKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'Escape':
      closeLightbox();
      break;
    case 'ArrowLeft':
      navigateLightbox(-1);
      break;
    case 'ArrowRight':
      navigateLightbox(1);
      break;
  }
}

/**
 * Lightbox导航
 */
function navigateLightbox(direction: number): void {
  const newIndex = galleryState.lightboxCurrentIndex + direction;
  if (newIndex >= 0 && newIndex < galleryState.displayedItems.length) {
    galleryState.lightboxCurrentIndex = newIndex;
    updateLightboxContent();
  }
}

/**
 * Lightbox复制链接
 */
async function lightboxCopyLink(): Promise<void> {
  const item = galleryState.displayedItems[galleryState.lightboxCurrentIndex];
  if (!item) return;

  try {
    const url = getImageUrlFromItem(item);
    await writeText(url);
    showToast('success', '链接已复制到剪贴板');
  } catch (error) {
    console.error('[Lightbox] 复制链接失败:', error);
    showToast('error', '复制失败');
  }
}

/**
 * Lightbox删除
 */
async function lightboxDelete(): Promise<void> {
  const item = galleryState.displayedItems[galleryState.lightboxCurrentIndex];
  if (!item) return;

  const confirmed = await showConfirmModal(
    '确认删除',
    `确定要删除 "${item.localFileName}" 的历史记录吗？`
  );

  if (confirmed) {
    // 先关闭lightbox
    closeLightbox();
    // 删除记录
    await deleteHistoryItem(item.id);
  }
}

// ========================================
// CONTEXT MENU FUNCTIONS (右键菜单功能)
// ========================================

let currentContextItemId: string | null = null;

/**
 * 处理卡片右键菜单
 */
function handleCardContextMenu(e: MouseEvent, itemId: string): void {
  showContextMenu(e.clientX, e.clientY, itemId);
}

/**
 * 显示右键菜单
 */
function showContextMenu(x: number, y: number, itemId: string): void {
  if (!contextMenu) return;

  currentContextItemId = itemId;

  // 定位菜单
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.style.display = 'block';

  // 点击其他地方关闭菜单
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

/**
 * 隐藏右键菜单
 */
function hideContextMenu(): void {
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
  currentContextItemId = null;
}

/**
 * 右键预览
 */
function contextMenuPreview(): void {
  if (currentContextItemId) {
    openLightbox(currentContextItemId);
  }
  hideContextMenu();
}

/**
 * 右键复制链接
 */
async function contextMenuCopyLink(): Promise<void> {
  if (!currentContextItemId) return;

  const item = galleryState.displayedItems.find(i => i.id === currentContextItemId);
  if (!item) return;

  try {
    const url = getImageUrlFromItem(item);
    await writeText(url);
    showToast('success', '链接已复制到剪贴板');
  } catch (error) {
    console.error('[Context Menu] 复制链接失败:', error);
    showToast('error', '复制失败');
  }

  hideContextMenu();
}

/**
 * 右键删除
 */
async function contextMenuDelete(): Promise<void> {
  if (!currentContextItemId) return;

  const item = galleryState.displayedItems.find(i => i.id === currentContextItemId);
  if (!item) return;

  hideContextMenu();

  const confirmed = await showConfirmModal(
    '确认删除',
    `确定要删除 "${item.localFileName}" 的历史记录吗？`
  );

  if (confirmed) {
    await deleteHistoryItem(item.id);
  }
}

// ========================================
// FILTER FUNCTIONS (筛选功能)
// ========================================

/**
 * 应用图床筛选
 */
function applyImageBedFilter(serviceName: ServiceType | 'all'): void {
  galleryState.currentFilter = serviceName;

  if (serviceName === 'all') {
    galleryState.displayedItems = allHistoryItems;
  } else {
    galleryState.displayedItems = allHistoryItems.filter(item =>
      item.results?.some(r => r.serviceId === serviceName && r.status === 'success')
    );
  }

  // 重新渲染当前视图
  if (galleryState.viewMode === 'grid') {
    renderGalleryView();
  } else {
    renderHistoryTable(galleryState.displayedItems);
  }
}

// --- INITIALIZATION ---
/**
 * 初始化应用
 * 绑定事件监听器、设置监听器、初始化上传功能等
 */
function initialize(): void {
  try {
    console.log('[初始化] 开始初始化应用...');

    // 初始化上传器（注册微博、R2 等）
    try {
      initializeUploaders();
      console.log('[初始化] 上传器已注册');
    } catch (error) {
      console.error('[初始化] 上传器注册失败:', error);
    }

    // 加载服务按钮状态
    loadServiceButtonStates().catch(err => {
      console.error('[初始化] 加载服务按钮状态失败:', err);
    });

    // 绑定服务按钮点击事件
    Object.entries(serviceButtons).forEach(([_serviceId, btn]) => {
      if (btn) {
        btn.addEventListener('click', async () => {
          // 如果是 disabled 状态，不处理点击
          if (btn.classList.contains('disabled')) {
            return;
          }
          // 切换选中状态
          btn.classList.toggle('selected');
          // 保存选择状态到配置
          try {
            const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
            const enabledServices: ServiceType[] = [];
            if (serviceButtons.weibo?.classList.contains('selected')) enabledServices.push('weibo');
            if (serviceButtons.r2?.classList.contains('selected')) enabledServices.push('r2');
            if (serviceButtons.tcl?.classList.contains('selected')) enabledServices.push('tcl');
            if (serviceButtons.jd?.classList.contains('selected')) enabledServices.push('jd');
            if (serviceButtons.nowcoder?.classList.contains('selected')) enabledServices.push('nowcoder');
            if (serviceButtons.qiyu?.classList.contains('selected')) enabledServices.push('qiyu');
            config.enabledServices = enabledServices;
            await configStore.set('config', config);
            await configStore.save();
          } catch (err) {
            console.error('[服务按钮] 保存选择状态失败:', err);
          }
        });
      }
    });

    // Bind navigation events (带空值检查)
    if (navUploadBtn) {
      navUploadBtn.addEventListener('click', () => navigateTo('upload'));
    } else {
      console.warn('[初始化] 警告: 上传导航按钮不存在');
    }
    
    if (navHistoryBtn) {
      navHistoryBtn.addEventListener('click', () => navigateTo('history'));
    } else {
      console.warn('[初始化] 警告: 历史导航按钮不存在');
    }
    
    if (navR2ManagerBtn) {
      navR2ManagerBtn.addEventListener('click', () => navigateTo('r2-manager'));
    } else {
      console.warn('[初始化] 警告: R2管理导航按钮不存在');
    }
    
    if (navBackupBtn) {
      navBackupBtn.addEventListener('click', () => navigateTo('backup'));
    } else {
      console.warn('[初始化] 警告: 备份导航按钮不存在');
    }

    if (navLinkCheckerBtn) {
      navLinkCheckerBtn.addEventListener('click', () => navigateTo('link-checker'));
    } else {
      console.warn('[初始化] 警告: 链接检测导航按钮不存在');
    }

    if (navSettingsBtn) {
      navSettingsBtn.addEventListener('click', () => navigateTo('settings'));
    } else {
      console.warn('[初始化] 警告: 设置导航按钮不存在');
    }

    // Bind settings events (带空值检查)
    // 为所有设置输入框绑定自动保存事件
    const settingsInputs = [
      weiboCookieEl,
      r2AccountIdEl,
      r2KeyIdEl,
      r2SecretKeyEl,
      r2BucketEl,
      r2PathEl,
      r2PublicDomainEl,
      webdavUrlEl,
      webdavUsernameEl,
      webdavPasswordEl,
      webdavRemotePathEl,
      nowcoderCookieEl,
      qiyuTokenEl
    ];
    
    settingsInputs.forEach(input => {
      if (input) {
        // 对于文本输入框和密码框，使用 blur 事件
        if (input.type === 'text' || input.type === 'password' || input.tagName === 'TEXTAREA') {
          input.addEventListener('blur', () => {
            handleAutoSave().catch(err => {
              console.error('[初始化] 自动保存失败:', err);
            });
          });
        }
      }
    });
    
    // 输出格式单选按钮已删除，不再需要绑定事件

    // 链接前缀配置事件绑定
    initPrefixEventListeners();

    // 可用图床复选框事件绑定
    Object.values(availableServiceCheckboxes).forEach(checkbox => {
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          handleAutoSave().catch(err => {
            console.error('[初始化] 保存可用图床配置失败:', err);
          });
        });
      }
    });

    if (testCookieBtn) {
      testCookieBtn.addEventListener('click', () => {
        testWeiboConnection().catch(err => {
          console.error('[初始化] 测试Cookie失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: Cookie测试按钮不存在');
    }
    
    if (testR2Btn) {
      testR2Btn.addEventListener('click', () => {
        testR2Connection().catch(err => {
          console.error('[初始化] 测试R2连接失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: R2测试按钮不存在');
    }
    
    if (testWebdavBtn) {
      testWebdavBtn.addEventListener('click', () => {
        testWebDAVConnection().catch(err => {
          console.error('[初始化] 测试WebDAV连接失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: WebDAV测试按钮不存在');
    }
    
    if (loginWithWebviewBtn) {
      loginWithWebviewBtn.addEventListener('click', () => {
        openWebviewLoginWindow('weibo').catch(err => {
          console.error('[初始化] 打开微博登录窗口失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: WebView登录按钮不存在');
    }

    // 牛客登录按钮事件绑定
    const loginNowcoderBtn = document.getElementById('login-nowcoder-btn');
    if (loginNowcoderBtn) {
      loginNowcoderBtn.addEventListener('click', () => {
        openWebviewLoginWindow('nowcoder').catch(err => {
          console.error('[初始化] 打开牛客登录窗口失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 牛客登录按钮不存在（可能设置页面未加载）');
    }

    // 牛客Cookie测试按钮事件绑定
    const testNowcoderCookieBtn = document.getElementById('test-nowcoder-cookie-btn');
    if (testNowcoderCookieBtn) {
      testNowcoderCookieBtn.addEventListener('click', () => {
        testNowcoderConnection().catch(err => {
          console.error('[初始化] 测试牛客Cookie失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 牛客Cookie测试按钮不存在');
    }

    // Bind history events (带空值检查)
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', () => {
        clearHistory().catch(err => {
          console.error('[初始化] 清空历史失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 清空历史按钮不存在');
    }

    // 批量操作按钮事件绑定
    const selectAllCheckbox = document.getElementById('select-all-history') as HTMLInputElement | null;
    const thSelectAllCheckbox = document.getElementById('th-select-all') as HTMLInputElement | null;
    const bulkCopyBtn = document.getElementById('bulk-copy-btn');
    const bulkExportBtn = document.getElementById('bulk-export-btn');
    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');

    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        toggleSelectAll(checked);
        if (thSelectAllCheckbox) thSelectAllCheckbox.checked = checked;
      });
    }

    if (thSelectAllCheckbox) {
      thSelectAllCheckbox.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        toggleSelectAll(checked);
        if (selectAllCheckbox) selectAllCheckbox.checked = checked;
      });
    }

    if (bulkCopyBtn) {
      bulkCopyBtn.addEventListener('click', () => {
        bulkCopyLinks().catch(err => {
          console.error('[批量操作] 批量复制失败:', err);
        });
      });
    }

    if (bulkExportBtn) {
      bulkExportBtn.addEventListener('click', () => {
        bulkExportJSON().catch(err => {
          console.error('[批量操作] 批量导出失败:', err);
        });
      });
    }

    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener('click', () => {
        bulkDeleteRecords().catch(err => {
          console.error('[批量操作] 批量删除失败:', err);
        });
      });
    }

    // 导出和同步功能已移至备份视图，这里不再绑定事件
    
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        applySearchFilter().catch(err => {
          console.error('[初始化] 应用搜索过滤失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 搜索输入框不存在');
    }

    // Initialize file drop listeners
    initializeUpload().catch(err => {
      console.error('[初始化] 初始化上传监听器失败:', err);
    });

    // Listen for backend navigation events
    listen('navigate-to', (event) => {
      try {
        const page = event.payload as 'settings' | 'history';
        console.log('[初始化] 收到导航事件:', page);
        navigateTo(page);
      } catch (error) {
        console.error('[初始化] 处理导航事件失败:', error);
      }
    }).catch(err => {
      console.error('[初始化] 设置导航监听器失败:', err);
    });

    // Start on the upload view
    navigateTo('upload');
    
    // 设置Cookie更新监听器
    setupCookieListener().catch(err => {
      console.error('[初始化] 设置Cookie监听器失败:', err);
    });
    
    // 初始化自定义标题栏
    initTitleBar();

    // 初始化备份视图 Vue 组件
    if (backupView) {
      try {
        const backupApp = createApp(BackupView);
        backupApp.mount(backupView);
        console.log('[初始化] ✓ 备份视图 Vue 组件已挂载');
      } catch (error) {
        console.error('[初始化] 挂载备份视图失败:', error);
      }
    } else {
      console.warn('[初始化] 警告: 备份视图元素不存在');
    }

    // 初始化链接检测视图事件监听
    initLinkCheckerEvents();

    // ========================================
    // GALLERY VIEW EVENT LISTENERS (浏览视图事件监听)
    // ========================================

    // 视图切换按钮
    viewModeTableBtn?.addEventListener('click', () => {
      switchViewMode('table');
    });

    viewModeGridBtn?.addEventListener('click', () => {
      switchViewMode('grid');
    });

    // 图床筛选器
    imageBedFilter?.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      const value = select.value as ServiceType | 'all';
      applyImageBedFilter(value);
    });

    // Lightbox 事件
    lightboxClose?.addEventListener('click', closeLightbox);
    lightboxPrev?.addEventListener('click', () => navigateLightbox(-1));
    lightboxNext?.addEventListener('click', () => navigateLightbox(1));
    lightboxCopyBtn?.addEventListener('click', lightboxCopyLink);
    lightboxDeleteBtn?.addEventListener('click', lightboxDelete);

    // Lightbox overlay 点击关闭
    lightboxModal?.querySelector('.lightbox-overlay')?.addEventListener('click', closeLightbox);

    // Context Menu 事件
    ctxPreview?.addEventListener('click', contextMenuPreview);
    ctxCopyLink?.addEventListener('click', contextMenuCopyLink);
    ctxDelete?.addEventListener('click', contextMenuDelete);

    // 点击页面其他地方隐藏右键菜单
    document.addEventListener('contextmenu', (e) => {
      // 如果不是在gallery-item上右键，隐藏菜单
      const target = e.target as HTMLElement;
      if (!target.closest('.gallery-item')) {
        hideContextMenu();
      }
    });

    // 加载视图偏好
    loadViewModePreference().catch(err => {
      console.error('[初始化] 加载视图偏好失败:', err);
    });

    console.log('[初始化] ✓ 应用初始化完成');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[初始化] 应用初始化失败:', error);
    alert(`应用初始化失败: ${errorMsg}\n\n请刷新页面或联系开发者。`);
  }
}

// 当 DOM 加载完成时初始化应用
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('[DOMContentLoaded] DOM 加载完成，开始初始化...');
    initialize();
    
    // ✅ 窗口显示控制：等待应用初始化完成后再显示窗口
    // 可选：稍微延迟几十毫秒，确保 CSS 渲染也完全就绪（解决部分微弱的闪烁）
    setTimeout(async () => {
      try {
        // 显式调用显示窗口
        await appWindow.show();
        // 显式将窗口置顶（防止启动时在后台）
        await appWindow.setFocus();
        console.log('[App] 窗口启动并显示');
      } catch (e) {
        console.error('[App] 显示窗口失败:', e);
      }
    }, 50); // 50ms 的延迟通常人眼无感，但能确保渲染稳定
  } catch (error) {
    console.error('[DOMContentLoaded] 初始化失败:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    alert(`应用初始化失败: ${errorMsg}\n\n请刷新页面或联系开发者。`);
    
    // 即使初始化失败，也尝试显示窗口，让用户看到错误信息
    try {
      await appWindow.show();
      await appWindow.setFocus();
    } catch (e) {
      console.error('[App] 显示窗口失败:', e);
    }
  }
});