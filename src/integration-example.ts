/**
 * 集成示例：如何在 main.ts 中使用新的多图床架构
 *
 * ⚠️ 注意：此示例文件使用已弃用的 UploadOrchestrator API
 * 实际项目请参考 main.ts 中使用的 MultiServiceUploader
 * 此文件保留作为 API 迁移参考
 *
 * @deprecated 请使用 MultiServiceUploader 替代 UploadOrchestrator
 * @ts-nocheck - 此文件为示例代码，暂时忽略类型检查
 */

import { initializeUploaders } from './uploaders';
import { UploadOrchestrator } from './core';
import { UserConfig } from './config/types';
import { Store } from './store';

// ============================================
// 步骤 1: 在应用启动时初始化上传器
// ============================================
// 在 main.ts 的 DOMContentLoaded 事件中调用

document.addEventListener('DOMContentLoaded', async () => {
  // 注册所有上传器（微博、R2等）
  initializeUploaders();

  console.log('应用已启动，上传器已注册');

  // ... 其他初始化代码
});

// ============================================
// 步骤 2: 创建上传调度器实例
// ============================================
const uploadOrchestrator = new UploadOrchestrator();

// ============================================
// 步骤 3: 替换原有的上传函数
// ============================================
// 原有代码（旧架构）：
// import { handleFileUpload } from './coreLogic';
// await handleFileUpload(filePath, config);

// 新代码（新架构）：
async function handleUpload(filePath: string) {
  try {
    // 1. 读取配置
    const configStore = new Store('.settings.dat');
    const config = await configStore.get<UserConfig>('config');

    if (!config) {
      throw new Error('未找到配置');
    }

    // 2. 显示进度（可选）
    let progressBar: HTMLElement | null = null;
    const onProgress = (percent: number) => {
      if (!progressBar) {
        progressBar = document.querySelector('#upload-progress');
      }
      if (progressBar) {
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = `${percent}%`;
      }
      console.log(`上传进度: ${percent}%`);
    };

    // 3. 执行上传
    const historyItem = await uploadOrchestrator.uploadFile(
      filePath,
      config,
      onProgress
    );

    console.log('上传成功！', historyItem);

    // 4. 更新 UI（可选）
    // updateHistoryUI(historyItem);

    return historyItem;
  } catch (error) {
    console.error('上传失败:', error);
    throw error;
  }
}

// ============================================
// 步骤 4: 示例 - 处理拖放上传
// ============================================
function setupDragDrop() {
  const dropZone = document.querySelector('#drop-zone');

  if (dropZone) {
    dropZone.addEventListener('drop', async (e: DragEvent) => {
      e.preventDefault();

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        try {
          // 使用新架构上传
          await handleUpload(file.path);
        } catch (error) {
          console.error(`上传文件失败: ${file.name}`, error);
        }
      }
    });
  }
}

// ============================================
// 步骤 5: 示例 - 处理文件选择上传
// ============================================
function setupFileSelector() {
  const fileInput = document.querySelector('#file-input') as HTMLInputElement;
  const uploadButton = document.querySelector('#upload-button');

  if (uploadButton && fileInput) {
    uploadButton.addEventListener('click', async () => {
      const files = fileInput.files;
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        try {
          await handleUpload(file.path);
        } catch (error) {
          console.error(`上传文件失败: ${file.name}`, error);
        }
      }
    });
  }
}

// ============================================
// 步骤 6: 配置管理示例
// ============================================
async function saveConfig(newConfig: Partial<UserConfig>) {
  const configStore = new Store('.settings.dat');
  const currentConfig = await configStore.get<UserConfig>('config');

  const updatedConfig: UserConfig = {
    ...currentConfig,
    ...newConfig
  };

  await configStore.set('config', updatedConfig);
  await configStore.save();

  console.log('配置已保存', updatedConfig);
}

// 示例：切换到 R2 作为主力图床
async function switchToR2() {
  await saveConfig({
    primaryService: 'r2'
  });
}

// 示例：启用备份到微博
async function enableWeiboBackup() {
  await saveConfig({
    backup: {
      enabled: true,
      services: ['weibo']
    }
  });
}

// ============================================
// 步骤 7: 历史记录显示示例
// ============================================
async function loadHistory() {
  const historyStore = new Store('history.dat');
  const history = await historyStore.get<any[]>('uploads', []);

  const historyList = document.querySelector('#history-list');
  if (!historyList) return;

  historyList.innerHTML = '';

  for (const item of history) {
    const row = document.createElement('tr');

    // 服务标识
    const serviceCell = document.createElement('td');
    const serviceBadge = document.createElement('span');
    serviceBadge.className = `service-badge service-${item.primaryService}`;
    serviceBadge.textContent = getServiceName(item.primaryService);
    serviceCell.appendChild(serviceBadge);

    // 文件名
    const fileCell = document.createElement('td');
    fileCell.textContent = item.localFileName;

    // 链接
    const linkCell = document.createElement('td');
    const copyButton = document.createElement('button');
    copyButton.textContent = '复制链接';
    copyButton.onclick = () => {
      navigator.clipboard.writeText(item.generatedLink);
    };
    linkCell.appendChild(copyButton);

    row.appendChild(serviceCell);
    row.appendChild(fileCell);
    row.appendChild(linkCell);

    historyList.appendChild(row);
  }
}

function getServiceName(serviceId: string): string {
  const names: Record<string, string> = {
    'weibo': '微博',
    'r2': 'R2',
    'nami': '纳米',
    'jd': '京东',
    'tcl': 'TCL',
    'nowcoder': '牛客'
  };
  return names[serviceId] || serviceId;
}

// ============================================
// 导出供 main.ts 使用
// ============================================
export {
  handleUpload,
  setupDragDrop,
  setupFileSelector,
  saveConfig,
  loadHistory
};
