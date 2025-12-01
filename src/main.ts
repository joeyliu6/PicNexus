// src/main.ts
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { dialog } from '@tauri-apps/api';

import { Store } from './store';
import { UserConfig, HistoryItem, DEFAULT_CONFIG, ServiceType } from './config/types';
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
const views = [uploadView, historyView, settingsView, r2ManagerView, backupView].filter((v): v is HTMLElement => v !== null);

// Navigation
const navUploadBtn = getElement<HTMLButtonElement>('nav-upload', '上传导航按钮');
const navHistoryBtn = getElement<HTMLButtonElement>('nav-history', '历史导航按钮');
const navR2ManagerBtn = getElement<HTMLButtonElement>('nav-r2-manager', 'R2管理导航按钮');
const navBackupBtn = getElement<HTMLButtonElement>('nav-backup', '备份导航按钮');
const navSettingsBtn = getElement<HTMLButtonElement>('nav-settings', '设置导航按钮');
const navButtons = [navUploadBtn, navHistoryBtn, navR2ManagerBtn, navBackupBtn, navSettingsBtn].filter((b): b is HTMLButtonElement => b !== null);

// Upload View Elements
const dropZoneHeader = getElement<HTMLElement>('drop-zone-header', '拖放区域头部');
// Service checkboxes
const serviceCheckboxes = {
  weibo: document.querySelector<HTMLInputElement>('input[data-service="weibo"]'),
  r2: document.querySelector<HTMLInputElement>('input[data-service="r2"]'),
  tcl: document.querySelector<HTMLInputElement>('input[data-service="tcl"]')
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
const baiduPrefixEl = getElement<HTMLInputElement>('baidu-prefix', '百度前缀输入框');
const webdavUrlEl = getElement<HTMLInputElement>('webdav-url', 'WebDAV URL输入框');
const webdavUsernameEl = getElement<HTMLInputElement>('webdav-username', 'WebDAV用户名输入框');
const webdavPasswordEl = getElement<HTMLInputElement>('webdav-password', 'WebDAV密码输入框');
const webdavRemotePathEl = getElement<HTMLInputElement>('webdav-remote-path', 'WebDAV远程路径输入框');
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
 * @param viewId 视图 ID ('upload' | 'history' | 'settings' | 'r2-manager' | 'backup')
 */
function navigateTo(viewId: 'upload' | 'history' | 'settings' | 'r2-manager' | 'backup'): void {
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

          // 从复选框读取启用的图床服务列表
          const enabledServices: ServiceType[] = [];
          if (serviceCheckboxes.weibo?.checked) enabledServices.push('weibo');
          if (serviceCheckboxes.r2?.checked) enabledServices.push('r2');
          if (serviceCheckboxes.tcl?.checked) enabledServices.push('tcl');

          if (enabledServices.length === 0) {
            console.warn('[上传] 没有勾选任何图床');
            await showAlertModal('请至少勾选一个图床服务！', '配置缺失');
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


// --- LOGIN WINDOW LOGIC ---
/**
 * 打开 WebView 登录窗口
 * 允许用户通过官方微博登录页面获取 Cookie
 */
async function openWebviewLoginWindow(): Promise<void> {
  try {
    console.log('[WebView登录窗口] 开始打开官方登录窗口');
    
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
    
    // 创建新的Cookie获取窗口
    try {
      const loginWindow = new WebviewWindow('login-webview', {
        url: '/login-webview.html',
        title: '微博登录 - 自动获取Cookie',
        width: 500,
        height: 800,
        resizable: true,
        center: true,
        alwaysOnTop: false,
        decorations: true,
        transparent: false,
      });
      
      loginWindow.once('tauri://created', () => {
        console.log('[WebView登录窗口] ✓ 窗口创建成功');
      });
      
      loginWindow.once('tauri://error', (e) => {
        console.error('[WebView登录窗口] 窗口创建失败:', e);
        const errorMsg = e && typeof e === 'object' && 'payload' in e ? String(e.payload) : String(e);
        if (cookieStatusEl) {
          cookieStatusEl.textContent = `❌ 打开登录窗口失败: ${errorMsg}`;
          cookieStatusEl.style.color = 'red';
        } else {
          alert(`打开登录窗口失败: ${errorMsg}`);
        }
      });
    } catch (createError) {
      const errorMsg = createError instanceof Error ? createError.message : String(createError);
      console.error('[WebView登录窗口] 创建窗口异常:', createError);
      if (cookieStatusEl) {
        cookieStatusEl.textContent = `❌ 创建登录窗口失败: ${errorMsg}`;
        cookieStatusEl.style.color = 'red';
      } else {
        alert(`创建登录窗口失败: ${errorMsg}`);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[WebView登录窗口] 打开窗口异常:', error);
    if (cookieStatusEl) {
      cookieStatusEl.textContent = `❌ 打开登录窗口失败: ${errorMsg}`;
      cookieStatusEl.style.color = 'red';
    } else {
      alert(`打开登录窗口失败: ${errorMsg}`);
    }
  }
}


/**
 * 设置 Cookie 更新监听器
 * 监听来自登录窗口的 Cookie 更新事件
 */
async function setupCookieListener(): Promise<void> {
  try {
    await listen<string>('cookie-updated', async (event) => {
      try {
        console.log('[Cookie更新] 收到Cookie更新事件，长度:', event.payload?.length || 0);
        
        const cookie = event.payload;
        
        // 验证 Cookie
        if (!cookie || typeof cookie !== 'string' || cookie.trim().length === 0) {
          console.error('[Cookie更新] Cookie为空或无效:', typeof cookie);
          if (cookieStatusEl) {
            cookieStatusEl.textContent = '❌ 接收到的 Cookie 无效';
            cookieStatusEl.style.color = 'red';
          }
          return;
        }
        
        try {
          // 更新UI
          if (weiboCookieEl) {
            weiboCookieEl.value = cookie.trim();
            console.log('[Cookie更新] ✓ UI已更新');
          } else {
            console.warn('[Cookie更新] 警告: weiboCookieEl 不存在，无法更新UI');
          }
          
          // 保存到存储
          let config: UserConfig;
          try {
            const existingConfig = await configStore.get<UserConfig>('config');
            config = existingConfig || DEFAULT_CONFIG;
          } catch (getError) {
            console.warn('[Cookie更新] 读取现有配置失败，使用默认配置:', getError);
            config = DEFAULT_CONFIG;
          }
          
          // 迁移到新配置结构
          if (!config.services) {
            config.services = {};
          }
          if (!config.services.weibo) {
            config.services.weibo = { enabled: true, cookie: '' };
          }
          config.services.weibo.cookie = cookie.trim();

          try {
            await configStore.set('config', config);
            await configStore.save();
            console.log('[Cookie更新] ✓ Cookie已保存到存储');
          } catch (saveError) {
            throw new Error(`保存配置失败: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
          }
          
          // 显示成功提示
          if (cookieStatusEl) {
            cookieStatusEl.textContent = '✅ Cookie已自动填充并保存！';
            cookieStatusEl.style.color = 'lightgreen';
            
            setTimeout(() => {
              if (cookieStatusEl) {
                cookieStatusEl.textContent = '';
              }
            }, 3000);
          }
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('[Cookie更新] 保存Cookie失败:', error);
          if (cookieStatusEl) {
            cookieStatusEl.textContent = `❌ 保存失败: ${errorMsg}`;
            cookieStatusEl.style.color = 'red';
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Cookie更新] 处理Cookie更新事件失败:', error);
        if (cookieStatusEl) {
          cookieStatusEl.textContent = `❌ 处理失败: ${errorMsg}`;
          cookieStatusEl.style.color = 'red';
        }
      }
    });
    
    console.log('[Cookie更新] ✓ 监听器已设置');
  } catch (error) {
    console.error('[Cookie更新] 设置监听器失败:', error);
    // 不抛出错误，避免阻塞应用启动
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
      if (baiduPrefixEl) baiduPrefixEl.value = config.baiduPrefix || DEFAULT_CONFIG.baiduPrefix || 'https://image.baidu.com/search/down?thumburl=';
      
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
      baiduPrefix: baiduPrefixEl?.value.trim() || DEFAULT_CONFIG.baiduPrefix
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
      baiduPrefix: baiduPrefixEl?.value.trim() || DEFAULT_CONFIG.baiduPrefix
    };

    // 保存到存储
    try {
      await configStore.set('config', config);
      await configStore.save();
      console.log('[自动保存] ✓ 配置自动保存成功');

      // 3. 显示成功状态
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
            nami: '纳米',
            jd: '京东',
            nowcoder: '牛客'
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
        // 创建链接选择下拉框
        const linkSelector = document.createElement('select');
        linkSelector.className = 'link-selector';
        linkSelector.title = '选择要复制的链接';

        item.results.forEach(serviceResult => {
          if (serviceResult.status === 'success' && serviceResult.result?.url) {
            const option = document.createElement('option');
            option.value = serviceResult.result.url;

            const serviceNames: Record<ServiceType, string> = {
              weibo: '微博',
              r2: 'R2',
              tcl: 'TCL',
              nami: '纳米',
              jd: '京东',
              nowcoder: '牛客'
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
          const link = document.createElement('a');
          link.href = item.generatedLink;
          link.target = '_blank';
          link.textContent = item.generatedLink;
          link.title = item.generatedLink;
          link.className = 'history-link';
          tdLink.appendChild(link);
        } else if (linkSelector.options.length > 1) {
          tdLink.appendChild(linkSelector);
        } else {
          tdLink.textContent = '无可用链接';
        }
      } else {
        // 旧数据兼容
        const link = document.createElement('a');
        link.href = item.generatedLink;
        link.target = '_blank';
        link.textContent = item.generatedLink;
        link.title = item.generatedLink;
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
      nami: '纳米',
      jd: '京东',
      nowcoder: '牛客'
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
    await applySearchFilter();
}

async function applySearchFilter() {
    if (!searchInput) {
      console.warn('[历史记录] searchInput 不存在，无法应用过滤');
      return;
    }
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    if (!searchTerm) {
      await renderHistoryTable(allHistoryItems);
      return;
    }
    const filtered = allHistoryItems.filter(item => 
      item.localFileName.toLowerCase().includes(searchTerm)
    );
    await renderHistoryTable(filtered);
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
 * 加载并更新服务复选框状态
 */
async function loadServiceCheckboxStates(): Promise<void> {
  try {
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

    // 加载保存的选择状态
    const enabledServices = config.enabledServices || ['tcl'];
    if (serviceCheckboxes.weibo) {
      serviceCheckboxes.weibo.checked = enabledServices.includes('weibo');
      updateServiceStatus('weibo', config);
    }
    if (serviceCheckboxes.r2) {
      serviceCheckboxes.r2.checked = enabledServices.includes('r2');
      updateServiceStatus('r2', config);
    }
    if (serviceCheckboxes.tcl) {
      serviceCheckboxes.tcl.checked = enabledServices.includes('tcl');
      // TCL always ready
    }

    console.log('[服务复选框] 已加载状态:', enabledServices);
  } catch (error) {
    console.error('[服务复选框] 加载状态失败:', error);
  }
}

/**
 * 更新服务配置状态徽章
 */
function updateServiceStatus(serviceId: ServiceType, config: UserConfig): void {
  const statusEl = document.querySelector<HTMLElement>(`.service-config-status[data-service="${serviceId}"]`);
  if (!statusEl) return;

  // 确保 config.services 存在
  if (!config.services) {
    console.warn('[服务状态] 配置中缺少 services 字段');
    config.services = {};
  }

  let isConfigured = false;
  let statusText = '';

  if (serviceId === 'weibo') {
    const weiboConfig = config.services.weibo;
    isConfigured = !!weiboConfig?.cookie && weiboConfig.cookie.trim().length > 0;
    statusText = isConfigured ? '已配置' : '未配置';
    statusEl.className = `service-config-status ${isConfigured ? 'ready' : 'not-ready'}`;
  } else if (serviceId === 'r2') {
    const r2Config = config.services.r2;
    isConfigured = !!(
      r2Config?.accountId &&
      r2Config.accessKeyId &&
      r2Config.secretAccessKey &&
      r2Config.bucketName
    );
    statusText = isConfigured ? '已配置' : '未配置';
    statusEl.className = `service-config-status ${isConfigured ? 'ready' : 'not-ready'}`;
  } else if (serviceId === 'tcl') {
    statusEl.className = 'service-config-status ready';
    statusText = '开箱即用';
  }

  statusEl.textContent = statusText;

  // 如果未配置，禁用复选框
  const checkbox = serviceCheckboxes[serviceId as keyof typeof serviceCheckboxes];
  if (checkbox && serviceId !== 'tcl') {
    if (!isConfigured) {
      checkbox.disabled = true;
      checkbox.checked = false;
      const label = checkbox.closest('label');
      if (label) label.classList.add('disabled');
    } else {
      checkbox.disabled = false;
      const label = checkbox.closest('label');
      if (label) label.classList.remove('disabled');
    }
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

    // 加载服务复选框状态
    loadServiceCheckboxStates().catch(err => {
      console.error('[初始化] 加载服务复选框状态失败:', err);
    });

    // 绑定服务复选框变化事件
    Object.entries(serviceCheckboxes).forEach(([_serviceId, checkbox]) => {
      if (checkbox) {
        checkbox.addEventListener('change', () => {
          const label = checkbox.closest('label');
          if (label) {
            if (checkbox.checked) {
              label.classList.add('checked');
            } else {
              label.classList.remove('checked');
            }
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
      baiduPrefixEl,
      webdavUrlEl,
      webdavUsernameEl,
      webdavPasswordEl,
      webdavRemotePathEl
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
        openWebviewLoginWindow().catch(err => {
          console.error('[初始化] 打开登录窗口失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: WebView登录按钮不存在');
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