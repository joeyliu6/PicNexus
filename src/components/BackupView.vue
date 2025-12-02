<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Store } from '../store';
import { UserConfig, HistoryItem, DEFAULT_CONFIG } from '../config';
import { migrateConfig } from '../config/types';
import { WebDAVClient } from '../utils/webdav';
import { save, open } from '@tauri-apps/api/dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/api/fs';
// 使用全局 window.showToast
declare global {
  interface Window {
    showToast?: (message: string, type?: 'success' | 'error' | 'loading', duration?: number) => void;
  }
}

const showToast = (message: string, type: 'success' | 'error' | 'loading' = 'success', duration: number = 2000) => {
  if (window.showToast) {
    window.showToast(message, type, duration);
  } else {
    console.log(`[Toast] ${type}: ${message}`);
  }
};

// 存储实例
const configStore = new Store('.settings.dat');
const historyStore = new Store('.history.dat');

// 状态
const settingsSyncStatus = ref('状态: 未同步');
const historySyncStatus = ref('状态: 未同步');

// 按钮加载状态
const exportSettingsLoading = ref(false);
const importSettingsLoading = ref(false);
const uploadSettingsLoading = ref(false);
const downloadSettingsLoading = ref(false);
const exportHistoryLoading = ref(false);
const importHistoryLoading = ref(false);
const uploadHistoryLoading = ref(false);
const downloadHistoryLoading = ref(false);

/**
 * 导出配置到本地文件
 */
async function exportSettingsLocal() {
  try {
    exportSettingsLoading.value = true;
    
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
    const jsonContent = JSON.stringify(config, null, 2);
    
    const filePath = await save({
      defaultPath: 'weibo_dr_settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    
    if (!filePath) {
      showToast('已取消导出', 'error', 2000);
      return;
    }
    
    await writeTextFile(filePath, jsonContent);
    showToast('配置已导出到本地文件', 'success', 3000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导出配置失败:', error);
    showToast(`导出失败: ${errorMsg}`, 'error', 4000);
  } finally {
    exportSettingsLoading.value = false;
  }
}

/**
 * 从本地文件导入配置
 */
async function importSettingsLocal() {
  try {
    importSettingsLoading.value = true;
    
    const filePath = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false
    });
    
    if (!filePath || Array.isArray(filePath)) {
      showToast('已取消导入', 'error', 2000);
      return;
    }
    
    const content = await readTextFile(filePath);
    let importedConfig = JSON.parse(content) as UserConfig;

    // 迁移旧配置格式（如 baiduPrefix -> linkPrefixConfig）
    importedConfig = migrateConfig(importedConfig);

    // 获取当前配置（保留 WebDAV 配置）
    const currentConfig = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;
    
    // 询问是否覆盖 WebDAV 配置
    const shouldOverwriteWebDAV = await new Promise<boolean>((resolve) => {
      const confirmed = confirm(
        '是否同时覆盖 WebDAV 连接信息？\n\n' +
        '如果选择"取消"，将保留当前的 WebDAV 配置，只导入其他配置项（R2、Cookie 等）。'
      );
      resolve(confirmed);
    });
    
    // 合并配置
    const mergedConfig: UserConfig = {
      ...importedConfig,
      // 如果不覆盖 WebDAV，保留当前配置
      webdav: shouldOverwriteWebDAV ? importedConfig.webdav : currentConfig.webdav
    };
    
    await configStore.set('config', mergedConfig);
    await configStore.save();
    
    showToast('配置已从本地文件导入', 'success', 3000);
    
    // 提示用户可能需要刷新页面
    setTimeout(() => {
      showToast('提示：部分配置可能需要刷新页面后生效', 'loading', 3000);
    }, 1000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导入配置失败:', error);
    
    if (errorMsg.includes('JSON')) {
      showToast('导入失败: JSON 格式错误，请检查文件格式', 'error', 4000);
    } else {
      showToast(`导入失败: ${errorMsg}`, 'error', 4000);
    }
  } finally {
    importSettingsLoading.value = false;
  }
}

/**
 * 上传配置到云端 (WebDAV)
 */
async function uploadSettingsCloud() {
  try {
    uploadSettingsLoading.value = true;
    settingsSyncStatus.value = '状态: 上传中...';
    
    const config = await configStore.get<UserConfig>('config');
    if (!config || !config.webdav) {
      throw new Error('WebDAV 配置不完整，请先在设置中配置 WebDAV');
    }
    
    // 验证 WebDAV 配置
    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }
    
    // 警告：配置文件包含敏感信息
    const confirmed = confirm(
      '⚠️ 安全提示\n\n' +
      '配置文件包含敏感凭证（Cookie、R2 密钥、WebDAV 密码等），将以明文形式上传到您的私有网盘。\n\n' +
      '请确保：\n' +
      '1. 您的 WebDAV 服务器是可信的\n' +
      '2. 您的网盘账户安全可靠\n' +
      '3. 网络连接是安全的\n\n' +
      '是否继续上传？'
    );
    
    if (!confirmed) {
      settingsSyncStatus.value = '状态: 已取消';
      return;
    }
    
    const client = new WebDAVClient(config.webdav);
    
    // 构建远程路径
    let remotePath = config.webdav.remotePath || '/WeiboDR/settings.json';
    if (remotePath.endsWith('/')) {
      remotePath += 'settings.json';
    } else if (!remotePath.toLowerCase().endsWith('.json')) {
      // 如果路径是目录，追加文件名
      remotePath += '/settings.json';
    } else if (remotePath.toLowerCase().endsWith('history.json')) {
      // 如果路径是 history.json，替换为 settings.json
      remotePath = remotePath.replace(/history\.json$/i, 'settings.json');
    }
    
    const jsonContent = JSON.stringify(config, null, 2);
    await client.putFile(remotePath, jsonContent);
    
    settingsSyncStatus.value = '状态: 已同步';
    showToast('配置已上传到云端', 'success', 3000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 上传配置失败:', error);
    settingsSyncStatus.value = '状态: 同步失败';
    showToast(`上传失败: ${errorMsg}`, 'error', 4000);
  } finally {
    uploadSettingsLoading.value = false;
  }
}

/**
 * 从云端下载配置 (WebDAV)
 */
async function downloadSettingsCloud() {
  try {
    downloadSettingsLoading.value = true;
    settingsSyncStatus.value = '状态: 下载中...';
    
    const config = await configStore.get<UserConfig>('config');
    if (!config || !config.webdav) {
      throw new Error('WebDAV 配置不完整，请先在设置中配置 WebDAV');
    }
    
    // 验证 WebDAV 配置
    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }
    
    // 确认覆盖
    const confirmed = confirm(
      '⚠️ 警告\n\n' +
      '从云端下载配置将覆盖当前的本地配置。\n\n' +
      '注意：如果云端配置中的 WebDAV 信息与当前不同，下载后可能会断开当前连接。\n\n' +
      '是否继续下载？'
    );
    
    if (!confirmed) {
      settingsSyncStatus.value = '状态: 已取消';
      return;
    }
    
    const client = new WebDAVClient(config.webdav);
    
    // 构建远程路径
    let remotePath = config.webdav.remotePath || '/WeiboDR/settings.json';
    if (remotePath.endsWith('/')) {
      remotePath += 'settings.json';
    } else if (!remotePath.toLowerCase().endsWith('.json')) {
      remotePath += '/settings.json';
    } else if (remotePath.toLowerCase().endsWith('history.json')) {
      remotePath = remotePath.replace(/history\.json$/i, 'settings.json');
    }
    
    const content = await client.getFile(remotePath);
    
    if (!content) {
      throw new Error('云端配置文件不存在');
    }
    
    let importedConfig = JSON.parse(content) as UserConfig;

    // 迁移旧配置格式（如 baiduPrefix -> linkPrefixConfig）
    importedConfig = migrateConfig(importedConfig);

    // 保存配置
    await configStore.set('config', importedConfig);
    await configStore.save();

    settingsSyncStatus.value = '状态: 已同步';
    showToast('配置已从云端恢复', 'success', 3000);
    
    // 提示用户刷新页面
    setTimeout(() => {
      showToast('提示：请刷新页面以使配置生效', 'loading', 3000);
    }, 1000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 下载配置失败:', error);
    settingsSyncStatus.value = '状态: 同步失败';
    
    if (errorMsg.includes('不存在')) {
      showToast('云端配置文件不存在', 'error', 4000);
    } else if (errorMsg.includes('JSON')) {
      showToast('下载失败: JSON 格式错误', 'error', 4000);
    } else {
      showToast(`下载失败: ${errorMsg}`, 'error', 4000);
    }
  } finally {
    downloadSettingsLoading.value = false;
  }
}

/**
 * 导出历史记录到本地文件
 */
async function exportHistoryLocal() {
  try {
    exportHistoryLoading.value = true;
    
    const items = await historyStore.get<HistoryItem[]>('uploads') || [];
    if (items.length === 0) {
      showToast('没有可导出的历史记录', 'error', 3000);
      return;
    }
    
    const jsonContent = JSON.stringify(items, null, 2);
    
    const filePath = await save({
      defaultPath: 'weibo_dr_history.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    
    if (!filePath) {
      showToast('已取消导出', 'error', 2000);
      return;
    }
    
    await writeTextFile(filePath, jsonContent);
    showToast(`已导出 ${items.length} 条记录到本地文件`, 'success', 3000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导出历史记录失败:', error);
    showToast(`导出失败: ${errorMsg}`, 'error', 4000);
  } finally {
    exportHistoryLoading.value = false;
  }
}

/**
 * 从本地文件导入历史记录（合并）
 */
async function importHistoryLocal() {
  try {
    importHistoryLoading.value = true;
    
    const filePath = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false
    });
    
    if (!filePath || Array.isArray(filePath)) {
      showToast('已取消导入', 'error', 2000);
      return;
    }
    
    const content = await readTextFile(filePath);
    const importedItems = JSON.parse(content) as HistoryItem[];
    
    if (!Array.isArray(importedItems)) {
      throw new Error('JSON 格式错误：期望数组格式');
    }
    
    // 读取当前历史记录
    const currentItems = await historyStore.get<HistoryItem[]>('uploads') || [];
    
    // 合并并去重（根据 id 去重）
    const itemMap = new Map<string, HistoryItem>();
    
    // 先添加当前记录
    currentItems.forEach(item => {
      if (item.id) {
        itemMap.set(item.id, item);
      }
    });
    
    // 再添加导入的记录（会覆盖相同 id 的记录）
    importedItems.forEach(item => {
      if (item.id) {
        itemMap.set(item.id, item);
      } else {
        // 如果没有 id，生成一个
        item.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        itemMap.set(item.id, item);
      }
    });
    
    const mergedItems = Array.from(itemMap.values());
    
    // 按时间戳排序（最新的在前）
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    await historyStore.set('uploads', mergedItems);
    await historyStore.save();
    
    const addedCount = mergedItems.length - currentItems.length;
    showToast(
      `导入完成：共 ${mergedItems.length} 条记录（新增 ${addedCount} 条，去重 ${importedItems.length - addedCount} 条）`,
      'success',
      4000
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导入历史记录失败:', error);
    
    if (errorMsg.includes('JSON')) {
      showToast('导入失败: JSON 格式错误，请检查文件格式', 'error', 4000);
    } else {
      showToast(`导入失败: ${errorMsg}`, 'error', 4000);
    }
  } finally {
    importHistoryLoading.value = false;
  }
}

/**
 * 上传历史记录到云端 (WebDAV)
 */
async function uploadHistoryCloud() {
  try {
    uploadHistoryLoading.value = true;
    historySyncStatus.value = '状态: 上传中...';
    
    const config = await configStore.get<UserConfig>('config');
    if (!config || !config.webdav) {
      throw new Error('WebDAV 配置不完整，请先在设置中配置 WebDAV');
    }
    
    // 验证 WebDAV 配置
    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }
    
    const items = await historyStore.get<HistoryItem[]>('uploads') || [];
    if (items.length === 0) {
      showToast('没有可上传的历史记录', 'error', 3000);
      historySyncStatus.value = '状态: 无记录';
      return;
    }
    
    const client = new WebDAVClient(config.webdav);
    
    // 构建远程路径
    let remotePath = config.webdav.remotePath || '/WeiboDR/history.json';
    if (remotePath.endsWith('/')) {
      remotePath += 'history.json';
    } else if (!remotePath.toLowerCase().endsWith('.json')) {
      remotePath += '/history.json';
    }
    
    const jsonContent = JSON.stringify(items, null, 2);
    await client.putFile(remotePath, jsonContent);
    
    historySyncStatus.value = `状态: 已同步 (${items.length} 条)`;
    showToast(`已上传 ${items.length} 条记录到云端`, 'success', 3000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 上传历史记录失败:', error);
    historySyncStatus.value = '状态: 同步失败';
    showToast(`上传失败: ${errorMsg}`, 'error', 4000);
  } finally {
    uploadHistoryLoading.value = false;
  }
}

/**
 * 从云端下载历史记录 (WebDAV) - 智能合并
 */
async function downloadHistoryCloud() {
  try {
    downloadHistoryLoading.value = true;
    historySyncStatus.value = '状态: 下载中...';
    
    const config = await configStore.get<UserConfig>('config');
    if (!config || !config.webdav) {
      throw new Error('WebDAV 配置不完整，请先在设置中配置 WebDAV');
    }
    
    // 验证 WebDAV 配置
    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }
    
    const client = new WebDAVClient(config.webdav);
    
    // 构建远程路径
    let remotePath = config.webdav.remotePath || '/WeiboDR/history.json';
    if (remotePath.endsWith('/')) {
      remotePath += 'history.json';
    } else if (!remotePath.toLowerCase().endsWith('.json')) {
      remotePath += '/history.json';
    }
    
    const content = await client.getFile(remotePath);
    
    if (!content) {
      throw new Error('云端历史记录文件不存在');
    }
    
    const cloudItems = JSON.parse(content) as HistoryItem[];
    
    if (!Array.isArray(cloudItems)) {
      throw new Error('云端数据格式错误：期望数组格式');
    }
    
    // 读取当前历史记录
    const currentItems = await historyStore.get<HistoryItem[]>('uploads') || [];
    
    // 智能合并：并集去重（根据 id 或 weiboPid 去重）
    const itemMap = new Map<string, HistoryItem>();
    
    // 先添加当前记录
    currentItems.forEach(item => {
      const key = item.id || item.weiboPid || '';
      if (key) {
        itemMap.set(key, item);
      }
    });
    
    // 再添加云端记录（会覆盖相同 id/pid 的记录，保留时间戳较新的）
    cloudItems.forEach(item => {
      const key = item.id || item.weiboPid || '';
      if (key) {
        const existing = itemMap.get(key);
        // 如果云端记录更新，则使用云端记录
        if (!existing || (item.timestamp && item.timestamp > (existing.timestamp || 0))) {
          itemMap.set(key, item);
        }
      } else {
        // 如果没有 id 和 pid，生成一个 id
        item.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        itemMap.set(item.id, item);
      }
    });
    
    const mergedItems = Array.from(itemMap.values());
    
    // 按时间戳排序（最新的在前）
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    await historyStore.set('uploads', mergedItems);
    await historyStore.save();
    
    const addedCount = mergedItems.length - currentItems.length;
    historySyncStatus.value = `状态: 已同步 (${mergedItems.length} 条)`;
    showToast(
      `下载完成：共 ${mergedItems.length} 条记录（新增 ${addedCount} 条，合并 ${cloudItems.length - addedCount} 条）`,
      'success',
      4000
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 下载历史记录失败:', error);
    historySyncStatus.value = '状态: 同步失败';
    
    if (errorMsg.includes('不存在')) {
      showToast('云端历史记录文件不存在', 'error', 4000);
    } else if (errorMsg.includes('JSON')) {
      showToast('下载失败: JSON 格式错误', 'error', 4000);
    } else {
      showToast(`下载失败: ${errorMsg}`, 'error', 4000);
    }
  } finally {
    downloadHistoryLoading.value = false;
  }
}

// 组件挂载时检查同步状态
onMounted(async () => {
  // 可以在这里检查最后一次同步时间等
  // 暂时保持默认状态
});
</script>

<template>
  <div class="backup-view">
    <div class="container">
      <h1>备份与同步中心</h1>
      
      <!-- 软件配置卡片 -->
      <div class="card-section">
        <h2>
          <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.39a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          软件配置 (Settings)
        </h2>
        <p class="desc">包含微博 Cookie、R2 密钥、WebDAV 凭证等敏感信息。</p>
        
        <div class="action-group">
          <h3>本地备份</h3>
          <div class="btn-row">
            <button 
              @click="exportSettingsLocal" 
              :disabled="exportSettingsLoading"
              class="backup-btn"
            >
              <svg v-if="!exportSettingsLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              导出到本地文件
            </button>
            <button 
              @click="importSettingsLocal" 
              :disabled="importSettingsLoading"
              class="backup-btn"
            >
              <svg v-if="!importSettingsLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              从本地文件导入
            </button>
          </div>
        </div>
        
        <div class="action-group">
          <h3>WebDAV 云端同步</h3>
          <div class="status-indicator">{{ settingsSyncStatus }}</div>
          <div class="btn-row">
            <button 
              @click="uploadSettingsCloud" 
              :disabled="uploadSettingsLoading"
              class="backup-btn backup-btn-primary"
            >
              <svg v-if="!uploadSettingsLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              上传配置到云端
            </button>
            <button 
              @click="downloadSettingsCloud" 
              :disabled="downloadSettingsLoading"
              class="backup-btn backup-btn-primary"
            >
              <svg v-if="!downloadSettingsLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              从云端恢复配置
            </button>
          </div>
        </div>
      </div>
      
      <!-- 历史记录卡片 -->
      <div class="card-section">
        <h2>
          <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3h18v18H3zM3 9h18M9 3v18"/>
          </svg>
          历史记录 (History)
        </h2>
        <p class="desc">包含所有已上传图片的链接和元数据。</p>
        
        <div class="action-group">
          <h3>本地备份</h3>
          <div class="btn-row">
            <button 
              @click="exportHistoryLocal" 
              :disabled="exportHistoryLoading"
              class="backup-btn"
            >
              <svg v-if="!exportHistoryLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              导出 JSON
            </button>
            <button 
              @click="importHistoryLocal" 
              :disabled="importHistoryLoading"
              class="backup-btn"
            >
              <svg v-if="!importHistoryLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              导入 JSON
            </button>
          </div>
        </div>
        
        <div class="action-group">
          <h3>WebDAV 云端同步</h3>
          <div class="status-indicator">{{ historySyncStatus }}</div>
          <div class="btn-row">
            <button 
              @click="uploadHistoryCloud" 
              :disabled="uploadHistoryLoading"
              class="backup-btn backup-btn-primary"
            >
              <svg v-if="!uploadHistoryLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              上传记录到云端
            </button>
            <button 
              @click="downloadHistoryCloud" 
              :disabled="downloadHistoryLoading"
              class="backup-btn backup-btn-primary"
            >
              <svg v-if="!downloadHistoryLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              从云端下载记录
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backup-view {
  width: 100%;
  height: 100%;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 0;
}

h1 {
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 10px;
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  margin-bottom: 30px;
}

.card-section {
  background-color: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-card);
}

.card-section h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.section-icon {
  width: 20px;
  height: 20px;
  color: var(--primary);
  flex-shrink: 0;
}

.desc {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0 0 20px 0;
  line-height: var(--leading-relaxed);
}

.action-group {
  margin-bottom: 24px;
}

.action-group:last-child {
  margin-bottom: 0;
}

.action-group h3 {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  margin: 0 0 12px 0;
}

.btn-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.backup-btn {
  flex: 1;
  min-width: 160px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid var(--border-subtle);
  background: rgba(51, 65, 85, 0.2);
  color: var(--text-primary);
  position: relative;
  overflow: hidden;
}

.backup-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  transition: left 0.5s;
}

.backup-btn:hover::before {
  left: 100%;
}

.backup-btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
  color: var(--primary);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}

.backup-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: rgba(51, 65, 85, 0.1);
}

.backup-btn svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.backup-btn-primary {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
  color: var(--primary);
}

.backup-btn-primary:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.25);
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 6px 12px;
  background: rgba(51, 65, 85, 0.2);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(51, 65, 85, 0.3);
  border-radius: 6px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>

