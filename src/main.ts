// src/main.ts
import { listen } from '@tauri-apps/api/event';
import { handleFileUpload } from './coreLogic';
import { Store } from './store';
import { UserConfig } from './config';
import { WebviewWindow } from '@tauri-apps/api/window';

// 初始化配置存储
const configStore = new Store('.settings.dat');

// DOM 元素
const dropZone = document.getElementById('drop-zone')!;
const dropMessage = document.getElementById('drop-message')!;
const statusMessage = document.getElementById('status-message')!;
const loadingSpinner = document.getElementById('loading-spinner')!;

// 1. 处理拖拽事件
listen('tauri://file-drop', async (event) => {
  const filePaths = event.payload as string[];
  console.log('Dropped files:', filePaths);

  // **** (关键) 从存储中加载配置 ****
  let config = await configStore.get<UserConfig>('config');
  if (!config) {
    statusMessage.textContent = '⚠️ 错误：请先设置 Cookie！';
    // 尝试打开设置窗口
    try {
      const settingsWindow = WebviewWindow.getByLabel('settings');
      await settingsWindow?.show();
      await settingsWindow?.setFocus();
    } catch (e) {
      console.error('无法打开设置窗口:', e);
    }
    return;
  }
  if (!config.weiboCookie) {
    statusMessage.textContent = '⚠️ 错误：Cookie 为空，请在设置中配置！';
    try {
      const settingsWindow = WebviewWindow.getByLabel('settings');
      await settingsWindow?.show();
      await settingsWindow?.setFocus();
    } catch (e) {
      console.error('无法打开设置窗口:', e);
    }
    return;
  }

  // 显示加载动画
  dropMessage.classList.add('hidden');
  loadingSpinner.classList.remove('hidden');
  statusMessage.textContent = `开始上传 ${filePaths.length} 个文件...`;

  for (const path of filePaths) {
    try {
      // 传递真实的配置
      await handleFileUpload(path, config); 
    } catch (error) {
      console.error('Upload failed for file:', path, error);
    }
  }

  // 全部处理完毕
  dropMessage.classList.remove('hidden');
  loadingSpinner.classList.add('hidden');
  statusMessage.textContent = '拖拽文件到此处上传';
});

// 2. 处理拖拽高亮
listen('tauri://file-drop-hover', () => {
  dropZone.classList.add('drag-over');
});

listen('tauri://file-drop-cancelled', () => {
  dropZone.classList.remove('drag-over');
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
});

