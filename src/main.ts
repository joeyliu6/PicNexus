// src/main.ts
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { dialog } from '@tauri-apps/api';

import { Store } from './store';
import { UserConfig, HistoryItem, FailedItem, DEFAULT_CONFIG } from './config';
import { handleFileUpload, processUpload } from './coreLogic';
import { emit } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/api/clipboard';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { getClient, ResponseType, Body } from '@tauri-apps/api/http';
import { WebviewWindow } from '@tauri-apps/api/window';
import { UploadQueueManager } from './uploadQueue';
import { R2Manager } from './r2-manager';

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
const retryStore = new Store('.retry.dat');

// --- UPLOAD QUEUE MANAGER ---
let uploadQueueManager: UploadQueueManager | null = null;

// --- R2 MANAGER ---
let r2Manager: R2Manager | null = null;

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
const failedView = getElement<HTMLElement>('failed-view', '失败视图');
const r2ManagerView = getElement<HTMLElement>('r2-manager-view', 'R2管理视图');
const views = [uploadView, historyView, settingsView, failedView, r2ManagerView].filter((v): v is HTMLElement => v !== null);

// Navigation
const navUploadBtn = getElement<HTMLButtonElement>('nav-upload', '上传导航按钮');
const navHistoryBtn = getElement<HTMLButtonElement>('nav-history', '历史导航按钮');
const navFailedBtn = getElement<HTMLButtonElement>('nav-failed', '失败导航按钮');
const navR2ManagerBtn = getElement<HTMLButtonElement>('nav-r2-manager', 'R2管理导航按钮');
const navSettingsBtn = getElement<HTMLButtonElement>('nav-settings', '设置导航按钮');
const navButtons = [navUploadBtn, navHistoryBtn, navFailedBtn, navR2ManagerBtn, navSettingsBtn].filter((b): b is HTMLButtonElement => b !== null);

// Upload View Elements
const dropZoneHeader = getElement<HTMLElement>('drop-zone-header', '拖放区域头部');
const dropMessage = getElement<HTMLElement>('drop-message', '拖放消息');
const fileInput = getElement<HTMLInputElement>('file-input', '文件选择输入框');
const uploadR2Toggle = getElement<HTMLInputElement>('upload-view-toggle-r2', 'R2上传开关');
const uploadQueueList = getElement<HTMLElement>('upload-queue-list', '上传队列列表');

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

// History View Elements
const historyBody = getElement<HTMLElement>('history-body', '历史记录表格体');
const clearHistoryBtn = getElement<HTMLButtonElement>('clear-history-btn', '清空历史按钮');
const exportJsonBtn = getElement<HTMLButtonElement>('export-json-btn', '导出JSON按钮');
const syncWebdavBtn = getElement<HTMLButtonElement>('sync-webdav-btn', '同步WebDAV按钮');
const searchInput = getElement<HTMLInputElement>('search-input', '搜索输入框');
const historyStatusMessageEl = queryElement<HTMLElement>('#history-view #status-message', '历史状态消息');

// Failed View Elements
const failedBody = getElement<HTMLElement>('failed-body', '失败记录表格体');
const retryAllBtn = getElement<HTMLButtonElement>('retry-all-btn', '重试全部按钮');
const clearAllFailedBtn = getElement<HTMLButtonElement>('clear-all-failed-btn', '清空失败按钮');
const badgeEl = getElement<HTMLElement>('badge', '失败角标');


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
      await dialog.message(
        `文件类型不支持：${fileName} 不是一个有效的图片格式，已自动跳过。`,
        { title: '文件类型验证', type: 'warning' }
      );
      console.warn(`[文件验证] 跳过不支持的文件类型: ${fileName}`);
    }
  }

  return { valid, invalid };
}

/**
 * 并发处理上传队列
 * @param filePaths 文件路径列表
 * @param config 用户配置
 * @param uploadToR2 是否上传到R2
 * @param maxConcurrent 最大并发数（默认3）
 */
async function processUploadQueue(
  filePaths: string[],
  config: UserConfig,
  uploadToR2: boolean,
  maxConcurrent: number = 3
): Promise<void> {
  if (!uploadQueueManager) {
    console.error('[并发上传] 上传队列管理器未初始化');
    return;
  }

  console.log(`[并发上传] 开始处理 ${filePaths.length} 个文件，最大并发数: ${maxConcurrent}`);

  // 为每个文件创建队列项
  const uploadTasks = filePaths.map(filePath => {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const itemId = uploadQueueManager!.addFile(filePath, fileName, uploadToR2);
    
    return async () => {
      const onProgress = uploadQueueManager!.createProgressCallback(itemId);
      try {
        await processUpload(filePath, config, { uploadToR2 }, onProgress);
      } catch (error) {
        console.error(`[并发上传] 文件上传异常: ${fileName}`, error);
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

// --- VIEW ROUTING ---
/**
 * 导航到指定视图
 * @param viewId 视图 ID ('upload' | 'history' | 'settings' | 'failed')
 */
function navigateTo(viewId: 'upload' | 'history' | 'settings' | 'failed' | 'r2-manager'): void {
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
          if (saveStatusEl) {
            saveStatusEl.textContent = `❌ 加载失败: ${err instanceof Error ? err.message : String(err)}`;
          }
        });
      } else if (viewId === 'failed') {
        loadFailedQueue().catch(err => {
          console.error('[导航] 加载失败队列失败:', err);
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
            // 如果已经初始化，刷新配置并重新加载
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
            await dialog.message('读取配置失败，请重试', { title: '错误', type: 'error' });
            return;
          }
          
          // 验证配置
          if (!config || !config.weiboCookie || config.weiboCookie.trim().length === 0) {
            console.warn('[上传] 未配置微博 Cookie');
            await dialog.message('请先在设置中配置微博 Cookie！', { title: '配置缺失', type: 'warning' });
            navigateTo('settings');
            return;
          }
        
          // 文件类型验证（PRD 1.2）
          const { valid, invalid } = await filterValidFiles(filePaths);
          
          if (valid.length === 0) {
            console.warn('[上传] 没有有效的图片文件');
            return;
          }
          
          console.log(`[上传] 有效文件: ${valid.length}个，无效文件: ${invalid.length}个`);
          
          // 获取R2上传选项
          const uploadToR2 = uploadR2Toggle?.checked ?? false;
          console.log(`[上传] R2上传选项: ${uploadToR2 ? '启用' : '禁用'}`);
          
          // 并发处理上传队列
          await processUploadQueue(valid, config, uploadToR2);
          
          console.log('[上传] 上传队列处理完成');
        } catch (error) {
          console.error('[上传] 文件处理失败:', error);
          const errorMsg = error instanceof Error ? error.message : String(error);
          await dialog.message(`上传失败: ${errorMsg}`, { title: '错误', type: 'error' });
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
        dropZoneHeader.addEventListener('click', () => {
          fileInput?.click();
        });
      }
      
      // 文件输入框变化事件
      if (fileInput) {
        fileInput.addEventListener('change', async (event) => {
          const target = event.target as HTMLInputElement;
          if (target.files && target.files.length > 0) {
            const filePaths = Array.from(target.files).map(file => file.path || '');
            await handleFiles(filePaths);
            // 清空输入框，允许重复选择同一文件
            target.value = '';
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
          
          config.weiboCookie = cookie.trim();
          
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
      if (saveStatusEl) {
        saveStatusEl.textContent = '⚠️ 读取配置失败，已使用默认值';
      }
    }
  
    // 填充表单元素（带空值检查）
    try {
      if (weiboCookieEl) weiboCookieEl.value = config.weiboCookie || '';
      if (r2AccountIdEl) r2AccountIdEl.value = config.r2?.accountId || '';
      if (r2KeyIdEl) r2KeyIdEl.value = config.r2?.accessKeyId || '';
      if (r2SecretKeyEl) r2SecretKeyEl.value = config.r2?.secretAccessKey || '';
      if (r2BucketEl) r2BucketEl.value = config.r2?.bucketName || '';
      if (r2PathEl) r2PathEl.value = config.r2?.path || '';
      if (r2PublicDomainEl) r2PublicDomainEl.value = config.r2?.publicDomain || '';
      if (baiduPrefixEl) baiduPrefixEl.value = config.baiduPrefix || DEFAULT_CONFIG.baiduPrefix;
      
      // WebDAV 配置
      if (config.webdav) {
        if (webdavUrlEl) webdavUrlEl.value = config.webdav.url || '';
        if (webdavUsernameEl) webdavUsernameEl.value = config.webdav.username || '';
        if (webdavPasswordEl) webdavPasswordEl.value = config.webdav.password || '';
        if (webdavRemotePathEl) webdavRemotePathEl.value = config.webdav.remotePath || DEFAULT_CONFIG.webdav.remotePath;
      } else {
        if (webdavUrlEl) webdavUrlEl.value = '';
        if (webdavUsernameEl) webdavUsernameEl.value = '';
        if (webdavPasswordEl) webdavPasswordEl.value = '';
        if (webdavRemotePathEl) webdavRemotePathEl.value = DEFAULT_CONFIG.webdav.remotePath;
      }
      
      // 输出格式
      const format = config.outputFormat || 'baidu';
      const formatRadio = getElement<HTMLInputElement>(`format-${format}`, `输出格式单选按钮(${format})`);
      if (formatRadio) {
        formatRadio.checked = true;
      } else {
        console.warn(`[设置] 警告: 找不到格式单选按钮: format-${format}`);
      }
      
      console.log('[设置] ✓ 设置已填充到UI');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[设置] 填充UI失败:', error);
      if (saveStatusEl) {
        saveStatusEl.textContent = `❌ 加载失败: ${errorMsg}`;
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[设置] 加载设置失败:', error);
    if (saveStatusEl) {
      saveStatusEl.textContent = `❌ 加载失败: ${errorMsg}`;
    }
  }
}
  
/**
 * 保存设置（已弃用 - 现在使用 handleAutoSave）
 * 从 UI 表单中读取配置并保存到存储
 * 此函数保留以备将来需要手动触发保存的场景
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function saveSettings(): Promise<void> {
  try {
    console.log('[设置] 开始保存设置...');
    
    // 显示保存状态
    if (saveStatusEl) {
      saveStatusEl.textContent = '保存中...';
    }
    
    // 读取输出格式
    let format: string = 'baidu';
    try {
      const formatRadio = document.querySelector('input[name="output-format"]:checked') as HTMLInputElement;
      format = formatRadio?.value || 'baidu';
    } catch (error) {
      console.warn('[设置] 读取输出格式失败，使用默认值 baidu:', error);
    }
  
    // 验证必填字段
    if (format === 'r2' && r2PublicDomainEl && !r2PublicDomainEl.value.trim()) {
      const errorMsg = '❌ 当输出格式为 R2 时，公开访问域名不能为空！';
      console.warn('[设置] 验证失败:', errorMsg);
      if (saveStatusEl) {
        saveStatusEl.textContent = errorMsg;
      }
      return;
    }
  
    // 构建配置对象（带空值检查）
    const config: UserConfig = {
      weiboCookie: weiboCookieEl?.value.trim() || '',
      r2: {
        accountId: r2AccountIdEl?.value.trim() || '',
        accessKeyId: r2KeyIdEl?.value.trim() || '',
        secretAccessKey: r2SecretKeyEl?.value.trim() || '',
        bucketName: r2BucketEl?.value.trim() || '',
        path: r2PathEl?.value.trim() || '',
        publicDomain: r2PublicDomainEl?.value.trim() || '',
      },
      baiduPrefix: baiduPrefixEl?.value.trim() || DEFAULT_CONFIG.baiduPrefix,
      outputFormat: format as UserConfig['outputFormat'],
      webdav: {
        url: webdavUrlEl?.value.trim() || '',
        username: webdavUsernameEl?.value.trim() || '',
        password: webdavPasswordEl?.value.trim() || '',
        remotePath: webdavRemotePathEl?.value.trim() || DEFAULT_CONFIG.webdav.remotePath,
      },
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
 * 自动保存设置（无需手动点击保存按钮）
 * 在用户修改表单后自动触发
 */
async function handleAutoSave(): Promise<void> {
  try {
    console.log('[自动保存] 触发自动保存...');
    
    // 显示保存状态
    if (saveStatusEl) {
      saveStatusEl.textContent = '保存中...';
      saveStatusEl.style.color = 'orange';
    }
    
    // 读取输出格式
    let format: string = 'baidu';
    try {
      const formatRadio = document.querySelector('input[name="output-format"]:checked') as HTMLInputElement;
      format = formatRadio?.value || 'baidu';
    } catch (error) {
      console.warn('[自动保存] 读取输出格式失败，使用默认值 baidu:', error);
    }
  
    // 验证必填字段
    if (format === 'r2' && r2PublicDomainEl && !r2PublicDomainEl.value.trim()) {
      const errorMsg = '⚠️ 当输出格式为 R2 时，公开访问域名不能为空！';
      console.warn('[自动保存] 验证失败:', errorMsg);
      if (saveStatusEl) {
        saveStatusEl.textContent = errorMsg;
        saveStatusEl.style.color = 'red';
        setTimeout(() => {
          if (saveStatusEl) {
            saveStatusEl.textContent = '';
          }
        }, 3000);
      }
      return;
    }
  
    // 构建配置对象（带空值检查）
    const config: UserConfig = {
      weiboCookie: weiboCookieEl?.value.trim() || '',
      r2: {
        accountId: r2AccountIdEl?.value.trim() || '',
        accessKeyId: r2KeyIdEl?.value.trim() || '',
        secretAccessKey: r2SecretKeyEl?.value.trim() || '',
        bucketName: r2BucketEl?.value.trim() || '',
        path: r2PathEl?.value.trim() || '',
        publicDomain: r2PublicDomainEl?.value.trim() || '',
      },
      baiduPrefix: baiduPrefixEl?.value.trim() || DEFAULT_CONFIG.baiduPrefix,
      outputFormat: format as UserConfig['outputFormat'],
      webdav: {
        url: webdavUrlEl?.value.trim() || '',
        username: webdavUsernameEl?.value.trim() || '',
        password: webdavPasswordEl?.value.trim() || '',
        remotePath: webdavRemotePathEl?.value.trim() || DEFAULT_CONFIG.webdav.remotePath,
      },
    };
  
    // 保存到存储
    try {
      await configStore.set('config', config);
      await configStore.save();
      console.log('[自动保存] ✓ 配置自动保存成功');
      
      if (saveStatusEl) {
        saveStatusEl.textContent = '✓ 已自动保存';
        saveStatusEl.style.color = 'lightgreen';
        
        setTimeout(() => {
          if (saveStatusEl) {
            saveStatusEl.textContent = '';
          }
        }, 2000);
      }
    } catch (saveError) {
      const errorMsg = saveError instanceof Error ? saveError.message : String(saveError);
      console.error('[自动保存] 保存配置失败:', saveError);
      if (saveStatusEl) {
        saveStatusEl.textContent = `✗ 保存失败: ${errorMsg}`;
        saveStatusEl.style.color = 'red';
      }
      throw saveError;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[自动保存] 自动保存失败:', error);
    if (saveStatusEl) {
      saveStatusEl.textContent = `✗ 保存失败: ${errorMsg}`;
      saveStatusEl.style.color = 'red';
    }
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
      remotePath: webdavRemotePathEl?.value.trim() || DEFAULT_CONFIG.webdav.remotePath,
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
    
    const confirmed = confirm('您确定要从本地历史记录中删除此条目吗？此操作不会删除已上传到微博的图片。');
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
    if (item.id && item.localFileName && item.generatedLink) {
      return item as HistoryItem;
    }
    return {
      id: item.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: item.timestamp || Date.now(),
      localFileName: item.localFileName || item.fileName || '未知文件',
      weiboPid: item.weiboPid || '',
      generatedLink: item.generatedLink || item.link || '',
      r2Key: item.r2Key || null,
    };
}

function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

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

async function renderHistoryTable(items: HistoryItem[]) {
    if (!historyBody) {
      console.error('[历史记录] historyBody 不存在，无法渲染表格');
      return;
    }
    
    historyBody.innerHTML = '';
  
    if (items.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888;">暂无历史记录</td></tr>';
      return;
    }
  
    for (const item of items) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', item.id);
      tr.setAttribute('data-filename', item.localFileName.toLowerCase());
  
      const tdPreview = document.createElement('td');
      const img = document.createElement('img');
      img.style.width = '50px';
      img.style.height = '50px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '4px';
      img.alt = item.localFileName;
      img.src = await getPreviewUrl(item.weiboPid);
      img.onerror = () => { img.style.display = 'none'; };
      tdPreview.appendChild(img);
      tr.appendChild(tdPreview);
  
      const tdName = document.createElement('td');
      tdName.textContent = item.localFileName;
      tdName.title = item.localFileName;
      tr.appendChild(tdName);
  
      const tdLink = document.createElement('td');
      const link = document.createElement('a');
      link.href = item.generatedLink;
      link.target = '_blank';
      link.textContent = item.generatedLink;
      link.title = item.generatedLink;
      tdLink.appendChild(link);
      tr.appendChild(tdLink);
  
      const tdTime = document.createElement('td');
      tdTime.textContent = formatTimestamp(item.timestamp);
      tr.appendChild(tdTime);
  
      const tdAction = document.createElement('td');
      const copyBtn = document.createElement('button');
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', async () => {
        try {
          await writeText(item.generatedLink);
          copyBtn.textContent = '已复制!';
          setTimeout(() => (copyBtn.textContent = '复制'), 1500);
        } catch (err) {
          copyBtn.textContent = '失败!';
        }
      });
      tdAction.appendChild(copyBtn);
      tr.appendChild(tdAction);
  
      const tdDelete = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = '删除此记录';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.style.border = 'none';
      deleteBtn.style.background = 'transparent';
      deleteBtn.style.fontSize = '16px';
      deleteBtn.addEventListener('click', () => deleteHistoryItem(item.id));
      tdDelete.appendChild(deleteBtn);
      tr.appendChild(tdDelete);
  
      if (historyBody) {
        historyBody.appendChild(tr);
      }
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
    const needsSave = items.some(item => !item.id || !item.localFileName || !item.generatedLink);
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
    if (!confirm('确定要清空所有上传历史记录吗？此操作不可撤销。')) {
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
      const webdavUrl = url.endsWith('/') ? url + remotePath.substring(1) : url + remotePath;
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

// --- FAILED QUEUE LOGIC (v2.1) ---
async function loadFailedQueue() {
  try {
    const items = await retryStore.get<FailedItem[]>('failed') || [];
    renderFailedTable(items);
    updateFailedBadge(items.length);
  } catch (err) {
    console.error('加载失败队列失败:', err);
    renderFailedTable([]);
  }
}

async function renderFailedTable(items: FailedItem[]) {
  if (!failedBody) {
    console.error('[失败队列] failedBody 不存在，无法渲染表格');
    return;
  }
  
  failedBody.innerHTML = '';
  
  if (items.length === 0) {
    failedBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #888;">暂无失败记录</td></tr>';
    return;
  }
  
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-id', item.id);
    
    const tdName = document.createElement('td');
    const name = item.filePath.split(/[/\\]/).pop() || item.filePath;
    tdName.textContent = name;
    tdName.title = item.filePath;
    tr.appendChild(tdName);
    
    const tdError = document.createElement('td');
    tdError.textContent = item.errorMessage;
    tdError.title = item.errorMessage;
    tr.appendChild(tdError);
    
    const tdAction = document.createElement('td');
    const retryBtn = document.createElement('button');
    retryBtn.textContent = '重试';
    retryBtn.addEventListener('click', async () => {
      await retryFailedItem(item.id);
    });
    tdAction.appendChild(retryBtn);
    
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '移除';
    removeBtn.style.marginLeft = '10px';
    removeBtn.addEventListener('click', async () => {
      await removeFailedItem(item.id);
    });
    tdAction.appendChild(removeBtn);
    
    tr.appendChild(tdAction);
    if (failedBody) {
      failedBody.appendChild(tr);
    }
  }
}

async function updateFailedBadge(count: number) {
  if (!badgeEl) {
    console.warn('[失败队列] badgeEl 不存在，无法更新角标');
    return;
  }
  
  if (count > 0) {
    badgeEl.textContent = count.toString();
    badgeEl.style.display = 'inline-block';
  } else {
    badgeEl.style.display = 'none';
  }
}

async function retryFailedItem(itemId: string) {
  try {
    const items = await retryStore.get<FailedItem[]>('failed') || [];
    const item = items.find(i => i.id === itemId);
    if (!item) {
      return;
    }
    
    const result = await handleFileUpload(item.filePath, item.configSnapshot);
    if (result.status === 'success') {
      // 从失败队列中移除
      const newItems = items.filter(i => i.id !== itemId);
      await retryStore.set('failed', newItems);
      await retryStore.save();
      await loadFailedQueue();
      await emit('update-failed-count', newItems.length);
    }
  } catch (err) {
    console.error('重试失败:', err);
  }
}

async function removeFailedItem(itemId: string) {
  try {
    const items = await retryStore.get<FailedItem[]>('failed') || [];
    const newItems = items.filter(i => i.id !== itemId);
    await retryStore.set('failed', newItems);
    await retryStore.save();
    await loadFailedQueue();
    await emit('update-failed-count', newItems.length);
  } catch (err) {
    console.error('移除失败项失败:', err);
  }
}

async function retryAllFailed() {
  try {
    const items = await retryStore.get<FailedItem[]>('failed') || [];
    if (items.length === 0) {
      return;
    }
    
    for (const item of items) {
      const result = await handleFileUpload(item.filePath, item.configSnapshot);
      if (result.status === 'success') {
        // 从失败队列中移除
        const currentItems = await retryStore.get<FailedItem[]>('failed') || [];
        const newItems = currentItems.filter(i => i.id !== item.id);
        await retryStore.set('failed', newItems);
        await retryStore.save();
      }
    }
    
    await loadFailedQueue();
    const remainingItems = await retryStore.get<FailedItem[]>('failed') || [];
    await emit('update-failed-count', remainingItems.length);
  } catch (err) {
    console.error('全部重试失败:', err);
  }
}

async function clearAllFailed() {
  if (!confirm('确定要清除所有失败记录吗？')) {
    return;
  }
  try {
    await retryStore.clear();
    await retryStore.save();
    await loadFailedQueue();
    await emit('update-failed-count', 0);
  } catch (err) {
    console.error('清除失败队列失败:', err);
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
    
    if (navFailedBtn) {
      navFailedBtn.addEventListener('click', () => navigateTo('failed'));
    } else {
      console.warn('[初始化] 警告: 失败导航按钮不存在');
    }
    
    if (navR2ManagerBtn) {
      navR2ManagerBtn.addEventListener('click', () => navigateTo('r2-manager'));
    } else {
      console.warn('[初始化] 警告: R2管理导航按钮不存在');
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
    
    // 为输出格式单选按钮绑定自动保存事件
    const formatRadios = document.querySelectorAll('input[name="output-format"]');
    formatRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        handleAutoSave().catch(err => {
          console.error('[初始化] 自动保存失败:', err);
        });
      });
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
    
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        exportToJson().catch(err => {
          console.error('[初始化] 导出JSON失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 导出JSON按钮不存在');
    }
    
    if (syncWebdavBtn) {
      syncWebdavBtn.addEventListener('click', () => {
        syncToWebDAV().catch(err => {
          console.error('[初始化] 同步WebDAV失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 同步WebDAV按钮不存在');
    }
    
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        applySearchFilter().catch(err => {
          console.error('[初始化] 应用搜索过滤失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 搜索输入框不存在');
    }
    
    // Bind failed queue events (带空值检查)
    if (retryAllBtn) {
      retryAllBtn.addEventListener('click', () => {
        retryAllFailed().catch(err => {
          console.error('[初始化] 重试全部失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 重试全部按钮不存在');
    }
    
    if (clearAllFailedBtn) {
      clearAllFailedBtn.addEventListener('click', () => {
        clearAllFailed().catch(err => {
          console.error('[初始化] 清空失败队列失败:', err);
        });
      });
    } else {
      console.warn('[初始化] 警告: 清空失败按钮不存在');
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
    
    // Listen for failed count updates
    listen('update-failed-count', async (event) => {
      try {
        const count = event.payload as number;
        console.log('[初始化] 收到失败计数更新:', count);
        await updateFailedBadge(count);
      } catch (error) {
        console.error('[初始化] 更新失败角标失败:', error);
      }
    }).catch(err => {
      console.error('[初始化] 设置失败计数监听器失败:', err);
    });

    // Start on the upload view
    navigateTo('upload');
    
    // 初始化失败队列角标
    loadFailedQueue().catch(err => {
      console.error('[初始化] 加载失败队列失败:', err);
    });
    
    // 设置Cookie更新监听器
    setupCookieListener().catch(err => {
      console.error('[初始化] 设置Cookie监听器失败:', err);
    });
    
    console.log('[初始化] ✓ 应用初始化完成');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[初始化] 应用初始化失败:', error);
    alert(`应用初始化失败: ${errorMsg}\n\n请刷新页面或联系开发者。`);
  }
}

// 当 DOM 加载完成时初始化应用
document.addEventListener('DOMContentLoaded', () => {
  try {
    console.log('[DOMContentLoaded] DOM 加载完成，开始初始化...');
    initialize();
  } catch (error) {
    console.error('[DOMContentLoaded] 初始化失败:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    alert(`应用初始化失败: ${errorMsg}\n\n请刷新页面或联系开发者。`);
  }
});