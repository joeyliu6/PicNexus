// src/main.ts
import { listen } from '@tauri-apps/api/event';

import { Store } from './store';
import { UserConfig, HistoryItem, FailedItem, DEFAULT_CONFIG } from './config';
import { handleFileUpload } from './coreLogic';
import { emit } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/api/clipboard';
import { save } from '@tauri-apps/api/dialog';
import { writeTextFile } from '@tauri-apps/api/fs';
import { getClient, ResponseType, Body } from '@tauri-apps/api/http';

// --- STORES ---
const configStore = new Store('.settings.dat');
const historyStore = new Store('.history.dat');
const retryStore = new Store('.retry.dat');

// --- DOM ELEMENTS ---
// Views
const uploadView = document.getElementById('upload-view')!;
const historyView = document.getElementById('history-view')!;
const settingsView = document.getElementById('settings-view')!;
const failedView = document.getElementById('failed-view')!;
const views = [uploadView, historyView, settingsView, failedView];

// Navigation
const navUploadBtn = document.getElementById('nav-upload')!;
const navHistoryBtn = document.getElementById('nav-history')!;
const navFailedBtn = document.getElementById('nav-failed')!;
const navSettingsBtn = document.getElementById('nav-settings')!;
const navButtons = [navUploadBtn, navHistoryBtn, navFailedBtn, navSettingsBtn];

// Upload View Elements
const dropZone = document.getElementById('drop-zone')!;
const dropMessage = document.getElementById('drop-message')!;
const statusMessage = document.getElementById('status-message')!;
const loadingSpinner = document.getElementById('loading-spinner')!;

// Settings View Elements
const weiboCookieEl = document.getElementById('weibo-cookie') as HTMLTextAreaElement;
const testCookieBtn = document.getElementById('test-cookie-btn') as HTMLButtonElement;
const cookieStatusEl = document.getElementById('cookie-status')!;
const allowUserAccountEl = document.getElementById('allow-user-account') as HTMLInputElement;
const weiboUsernameEl = document.getElementById('weibo-username') as HTMLInputElement;
const weiboPasswordEl = document.getElementById('weibo-password') as HTMLInputElement;
const r2AccountIdEl = document.getElementById('r2-account-id') as HTMLInputElement;
const r2KeyIdEl = document.getElementById('r2-key-id') as HTMLInputElement;
const r2SecretKeyEl = document.getElementById('r2-secret-key') as HTMLInputElement;
const r2BucketEl = document.getElementById('r2-bucket') as HTMLInputElement;
const r2PathEl = document.getElementById('r2-path') as HTMLInputElement;
const r2PublicDomainEl = document.getElementById('r2-public-domain') as HTMLInputElement;
const baiduPrefixEl = document.getElementById('baidu-prefix') as HTMLInputElement;
const webdavUrlEl = document.getElementById('webdav-url') as HTMLInputElement;
const webdavUsernameEl = document.getElementById('webdav-username') as HTMLInputElement;
const webdavPasswordEl = document.getElementById('webdav-password') as HTMLInputElement;
const webdavRemotePathEl = document.getElementById('webdav-remote-path') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const saveStatusEl = document.getElementById('save-status')!;

// History View Elements
const historyBody = document.getElementById('history-body')!;
const clearHistoryBtn = document.getElementById('clear-history-btn')!;
const exportJsonBtn = document.getElementById('export-json-btn')!;
const syncWebdavBtn = document.getElementById('sync-webdav-btn')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const historyStatusMessageEl = document.querySelector('#history-view #status-message') as HTMLElement;

// Failed View Elements
const failedBody = document.getElementById('failed-body')!;
const retryAllBtn = document.getElementById('retry-all-btn')!;
const clearAllFailedBtn = document.getElementById('clear-all-failed-btn')!;
const badgeEl = document.getElementById('badge')!;


// --- VIEW ROUTING ---
function navigateTo(viewId: 'upload' | 'history' | 'settings' | 'failed') {
  // Deactivate all views and buttons
  views.forEach(v => v.classList.remove('active'));
  navButtons.forEach(b => b.classList.remove('active'));

  // Activate the target view and button
  const targetView = document.getElementById(`${viewId}-view`);
  const targetNavBtn = document.getElementById(`nav-${viewId}`);

  if (targetView && targetNavBtn) {
    targetView.classList.add('active');
    targetNavBtn.classList.add('active');
  }

  // Load data for view if necessary
  if (viewId === 'history') {
    loadHistory();
  } else if (viewId === 'settings') {
    loadSettings();
  } else if (viewId === 'failed') {
    loadFailedQueue();
  }
}

// --- UPLOAD LOGIC (from main.ts) ---
async function initializeUpload() {
    listen('tauri://file-drop', async (event) => {
        const filePaths = event.payload as string[];
        console.log('Dropped files:', filePaths);
      
        let config = await configStore.get<UserConfig>('config');
        if (!config || !config.weiboCookie) {
          statusMessage.textContent = '⚠️ 错误：请先在设置中配置微博 Cookie！';
          navigateTo('settings');
          return;
        }
      
        dropMessage.classList.add('hidden');
        loadingSpinner.classList.remove('hidden');
        statusMessage.textContent = `开始上传 ${filePaths.length} 个文件...`;
      
        for (const path of filePaths) {
          try {
            await handleFileUpload(path, config); 
          } catch (error) {
            console.error('Upload failed for file:', path, error);
          }
        }
      
        dropMessage.classList.remove('hidden');
        loadingSpinner.classList.add('hidden');
        statusMessage.textContent = '拖拽文件到此处上传';
      });
      
      listen('tauri://file-drop-hover', () => {
        dropZone.classList.add('drag-over');
      });
      
      listen('tauri://file-drop-cancelled', () => {
        dropZone.classList.remove('drag-over');
      });
      
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => e.preventDefault());
}


// --- SETTINGS LOGIC (from settings.ts) ---
async function loadSettings() {
    let config = await configStore.get<UserConfig>('config');
    if (!config) {
      config = DEFAULT_CONFIG;
    }
  
    weiboCookieEl.value = config.weiboCookie || '';
    
    // 加载账号密码配置
    if (config.account) {
      allowUserAccountEl.checked = config.account.allowUserAccount || false;
      weiboUsernameEl.value = config.account.username || '';
      weiboPasswordEl.value = config.account.password || '';
      weiboUsernameEl.disabled = !allowUserAccountEl.checked;
      weiboPasswordEl.disabled = !allowUserAccountEl.checked;
    } else {
      allowUserAccountEl.checked = false;
      weiboUsernameEl.value = '';
      weiboPasswordEl.value = '';
      weiboUsernameEl.disabled = true;
      weiboPasswordEl.disabled = true;
    }
    
    r2AccountIdEl.value = config.r2.accountId || '';
    r2KeyIdEl.value = config.r2.accessKeyId || '';
    r2SecretKeyEl.value = config.r2.secretAccessKey || '';
    r2BucketEl.value = config.r2.bucketName || '';
    r2PathEl.value = config.r2.path || '';
    r2PublicDomainEl.value = config.r2.publicDomain || '';
    baiduPrefixEl.value = config.baiduPrefix || DEFAULT_CONFIG.baiduPrefix;
    
    if (config.webdav) {
      webdavUrlEl.value = config.webdav.url || '';
      webdavUsernameEl.value = config.webdav.username || '';
      webdavPasswordEl.value = config.webdav.password || '';
      webdavRemotePathEl.value = config.webdav.remotePath || DEFAULT_CONFIG.webdav.remotePath;
    } else {
      webdavUrlEl.value = '';
      webdavUsernameEl.value = '';
      webdavPasswordEl.value = '';
      webdavRemotePathEl.value = DEFAULT_CONFIG.webdav.remotePath;
    }
    
    const format = config.outputFormat || 'baidu';
    (document.getElementById(`format-${format}`) as HTMLInputElement).checked = true;
}
  
async function saveSettings() {
    saveStatusEl.textContent = '保存中...';
    const format = 
      (document.querySelector('input[name="output-format"]:checked') as HTMLInputElement)?.value 
      || 'baidu';
  
    if (format === 'r2' && !r2PublicDomainEl.value.trim()) {
      saveStatusEl.textContent = '❌ 当输出格式为 R2 时，公开访问域名不能为空！';
      return;
    }
  
    const config: UserConfig = {
      weiboCookie: weiboCookieEl.value.trim(),
      r2: {
        accountId: r2AccountIdEl.value.trim(),
        accessKeyId: r2KeyIdEl.value.trim(),
        secretAccessKey: r2SecretKeyEl.value.trim(),
        bucketName: r2BucketEl.value.trim(),
        path: r2PathEl.value.trim(),
        publicDomain: r2PublicDomainEl.value.trim(),
      },
      baiduPrefix: baiduPrefixEl.value.trim(),
      outputFormat: format as UserConfig['outputFormat'],
      webdav: {
        url: webdavUrlEl.value.trim(),
        username: webdavUsernameEl.value.trim(),
        password: webdavPasswordEl.value.trim(),
        remotePath: webdavRemotePathEl.value.trim() || DEFAULT_CONFIG.webdav.remotePath,
      },
      account: {
        allowUserAccount: allowUserAccountEl.checked,
        username: weiboUsernameEl.value.trim(),
        password: weiboPasswordEl.value.trim(),
      },
    };
  
    try {
      await configStore.set('config', config);
      await configStore.save();
      saveStatusEl.textContent = '✅ 已保存！';
      
      setTimeout(() => {
        saveStatusEl.textContent = '';
      }, 2000);
  
    } catch (err) {
      saveStatusEl.textContent = `❌ 保存失败: ${err}`;
    }
}

async function testWeiboConnection() {
    const cookie = weiboCookieEl.value.trim();
    if (!cookie) {
      cookieStatusEl.textContent = '❌ Cookie 不能为空！';
      cookieStatusEl.style.color = 'red';
      return;
    }
  
    cookieStatusEl.textContent = '⏳ 测试中...';
    cookieStatusEl.style.color = 'yellow';
  
    try {
      const client = await getClient();
      const response = await client.get<{ code: string }>(
        'https://weibo.com/aj/onoff/getstatus?sid=0',
        {
          responseType: ResponseType.JSON,
          headers: { 
            Cookie: cookie,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' 
          }
        }
      );
  
      if (!response.ok) {
        cookieStatusEl.textContent = `❌ 测试失败 (HTTP 错误: ${response.status})`;
        cookieStatusEl.style.color = 'red';
        return;
      }
  
      if (response.data && response.data.code === '100000') {
        cookieStatusEl.textContent = '✅ Cookie 有效！ (已登录)';
        cookieStatusEl.style.color = 'lightgreen';
      } else {
        cookieStatusEl.textContent = '❌ Cookie 无效或已过期 (返回码非 100000)';
        cookieStatusEl.style.color = 'red';
      }
    } catch (err: any) {
      const errorStr = err?.toString() || String(err) || '';
      const errorMsg = err?.message || errorStr || '';
      const fullError = (errorMsg + ' ' + errorStr).toLowerCase();
      
      console.error('Cookie 测试错误详情:', err);
  
      let displayMessage = '';
      if (fullError.includes('json') || fullError.includes('parse')) {
        displayMessage = '❌ 测试失败: Cookie 完全无效或格式错误 (无法解析响应)';
      } else if (fullError.includes('network') || fullError.includes('fetch') || fullError.includes('connection')) {
        displayMessage = '❌ 测试失败: 请检查您的网络连接或防火墙设置';
      } else {
        const shortError = errorMsg || errorStr || '未知错误';
        const truncatedError = shortError.length > 100 ? shortError.substring(0, 100) + '...' : shortError;
        displayMessage = `❌ 测试失败: ${truncatedError}`;
      }
      
      cookieStatusEl.textContent = displayMessage;
      cookieStatusEl.style.color = 'red';
    }
}


// --- HISTORY LOGIC (from history.ts) ---
let allHistoryItems: HistoryItem[] = [];

async function deleteHistoryItem(itemId: string) {
    if (!confirm('您确定要从本地历史记录中删除此条目吗？此操作不会删除已上传到微博的图片。')) {
      return;
    }
  
    try {
      historyStatusMessageEl.textContent = '删除中...';
      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      const filteredItems = items.filter(item => item.id !== itemId);
      await historyStore.set('uploads', filteredItems);
      await historyStore.save();
      historyStatusMessageEl.textContent = '已删除。';
      loadHistory();
    } catch (err) {
      historyStatusMessageEl.textContent = `删除失败: ${err}`;
      console.error('删除历史记录失败:', err);
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
  
      historyBody.appendChild(tr);
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
      historyStatusMessageEl.textContent = '清空中...';
      await historyStore.clear();
      await historyStore.save();
      historyStatusMessageEl.textContent = '已清空。';
      loadHistory();
    } catch (err) {
      historyStatusMessageEl.textContent = `清空失败: ${err}`;
    }
}

async function exportToJson() {
    try {
      historyStatusMessageEl.textContent = '准备导出...';
      const items = await historyStore.get<HistoryItem[]>('uploads') || [];
      if (items.length === 0) {
        historyStatusMessageEl.textContent = '没有可导出的历史记录。';
        return;
      }
      const jsonContent = JSON.stringify(items, null, 2);
      const filePath = await save({
        defaultPath: 'weibo_dr_export.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (!filePath) {
        historyStatusMessageEl.textContent = '已取消导出。';
        return;
      }
      await writeTextFile(filePath, jsonContent);
      historyStatusMessageEl.textContent = `✅ 已导出 ${items.length} 条记录到 ${filePath}`;
    } catch (err) {
      historyStatusMessageEl.textContent = `导出失败: ${err}`;
      console.error('导出失败:', err);
    }
}

async function syncToWebDAV() {
    try {
      historyStatusMessageEl.textContent = '同步中...';
      const config = await configStore.get<UserConfig>('config');
      if (!config || !config.webdav || !config.webdav.url || !config.webdav.username || !config.webdav.password || !config.webdav.remotePath) {
        historyStatusMessageEl.textContent = '❌ WebDAV 配置不完整，请检查设置。';
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
          'Authorization': `Basic ${auth}`
        }
      });
      if (response.ok) {
        historyStatusMessageEl.textContent = `✅ 已同步 ${items.length} 条记录到 WebDAV`;
      } else {
        historyStatusMessageEl.textContent = `❌ 同步失败: HTTP ${response.status}`;
      }
    } catch (err: any) {
      historyStatusMessageEl.textContent = `❌ 同步失败: ${err.message || err}`;
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
    failedBody.appendChild(tr);
  }
}

async function updateFailedBadge(count: number) {
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
function initialize() {
    // Bind navigation events
    navUploadBtn.addEventListener('click', () => navigateTo('upload'));
    navHistoryBtn.addEventListener('click', () => navigateTo('history'));
    navFailedBtn.addEventListener('click', () => navigateTo('failed'));
    navSettingsBtn.addEventListener('click', () => navigateTo('settings'));

    // Bind settings events
    saveBtn.addEventListener('click', saveSettings);
    testCookieBtn.addEventListener('click', testWeiboConnection);
    weiboCookieEl.addEventListener('blur', saveSettings);
    
    // 账号密码复选框启用/禁用逻辑
    allowUserAccountEl.addEventListener('change', () => {
      weiboUsernameEl.disabled = !allowUserAccountEl.checked;
      weiboPasswordEl.disabled = !allowUserAccountEl.checked;
    });

    // Bind history events
    clearHistoryBtn.addEventListener('click', clearHistory);
    exportJsonBtn.addEventListener('click', exportToJson);
    syncWebdavBtn.addEventListener('click', syncToWebDAV);
    searchInput.addEventListener('input', applySearchFilter);
    
    // Bind failed queue events
    retryAllBtn.addEventListener('click', retryAllFailed);
    clearAllFailedBtn.addEventListener('click', clearAllFailed);

    // Initialize file drop listeners
    initializeUpload();

    // Listen for backend navigation events
    listen('navigate-to', (event) => {
        const page = event.payload as 'settings' | 'history';
        navigateTo(page);
    });
    
    // Listen for failed count updates
    listen('update-failed-count', async (event) => {
      const count = event.payload as number;
      await updateFailedBadge(count);
    });

    // Start on the upload view
    navigateTo('upload');
    
    // 初始化失败队列角标
    loadFailedQueue();
}

document.addEventListener('DOMContentLoaded', initialize);