<script setup lang="ts">
import { ref } from 'vue';
import { Store } from '../store';
import { UserConfig, HistoryItem, DEFAULT_CONFIG } from '../config';
import { migrateConfig } from '../config/types';
import { WebDAVClient } from '../utils/webdav';
import { save, open } from '@tauri-apps/api/dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/api/fs';

// PrimeVue 组件导入
import Card from 'primevue/card';
import Button from 'primevue/button';
import Message from 'primevue/message';
import Divider from 'primevue/divider';
import { useToast } from '../composables/useToast';

// 使用 PrimeVue Toast
const toast = useToast();

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
      toast.warn('已取消导出');
      return;
    }

    await writeTextFile(filePath, jsonContent);
    toast.success('配置已导出到本地文件');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导出配置失败:', error);
    toast.error('导出失败', errorMsg);
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
      toast.warn('已取消导入');
      return;
    }

    const content = await readTextFile(filePath);
    let importedConfig = JSON.parse(content) as UserConfig;

    importedConfig = migrateConfig(importedConfig);

    const currentConfig = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

    const shouldOverwriteWebDAV = await new Promise<boolean>((resolve) => {
      const confirmed = confirm(
        '是否同时覆盖 WebDAV 连接信息？\n\n' +
        '如果选择"取消"，将保留当前的 WebDAV 配置，只导入其他配置项（R2、Cookie 等）。'
      );
      resolve(confirmed);
    });

    const mergedConfig: UserConfig = {
      ...importedConfig,
      webdav: shouldOverwriteWebDAV ? importedConfig.webdav : currentConfig.webdav
    };

    await configStore.set('config', mergedConfig);
    await configStore.save();

    toast.success('配置已从本地文件导入');

    setTimeout(() => {
      toast.info('部分配置可能需要刷新页面后生效');
    }, 1000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导入配置失败:', error);

    if (errorMsg.includes('JSON')) {
      toast.error('导入失败', 'JSON 格式错误，请检查文件格式');
    } else {
      toast.error('导入失败', errorMsg);
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

    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }

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

    let remotePath = config.webdav.remotePath || '/WeiboDR/settings.json';
    if (remotePath.endsWith('/')) {
      remotePath += 'settings.json';
    } else if (!remotePath.toLowerCase().endsWith('.json')) {
      remotePath += '/settings.json';
    } else if (remotePath.toLowerCase().endsWith('history.json')) {
      remotePath = remotePath.replace(/history\.json$/i, 'settings.json');
    }

    const jsonContent = JSON.stringify(config, null, 2);
    await client.putFile(remotePath, jsonContent);

    settingsSyncStatus.value = '状态: 已同步';
    toast.success('配置已上传到云端');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 上传配置失败:', error);
    settingsSyncStatus.value = '状态: 同步失败';
    toast.error('上传失败', errorMsg);
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

    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }

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
    importedConfig = migrateConfig(importedConfig);

    await configStore.set('config', importedConfig);
    await configStore.save();

    settingsSyncStatus.value = '状态: 已同步';
    toast.success('配置已从云端恢复');

    setTimeout(() => {
      toast.info('请刷新页面以使配置生效');
    }, 1000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 下载配置失败:', error);
    settingsSyncStatus.value = '状态: 同步失败';

    if (errorMsg.includes('不存在')) {
      toast.error('云端配置文件不存在');
    } else if (errorMsg.includes('JSON')) {
      toast.error('下载失败', 'JSON 格式错误');
    } else {
      toast.error('下载失败', errorMsg);
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
      toast.warn('没有可导出的历史记录');
      return;
    }

    const jsonContent = JSON.stringify(items, null, 2);

    const filePath = await save({
      defaultPath: 'weibo_dr_history.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!filePath) {
      toast.warn('已取消导出');
      return;
    }

    await writeTextFile(filePath, jsonContent);
    toast.success(`已导出 ${items.length} 条记录到本地文件`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导出历史记录失败:', error);
    toast.error('导出失败', errorMsg);
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
      toast.warn('已取消导入');
      return;
    }

    const content = await readTextFile(filePath);
    const importedItems = JSON.parse(content) as HistoryItem[];

    if (!Array.isArray(importedItems)) {
      throw new Error('JSON 格式错误：期望数组格式');
    }

    const currentItems = await historyStore.get<HistoryItem[]>('uploads') || [];

    const itemMap = new Map<string, HistoryItem>();

    currentItems.forEach(item => {
      if (item.id) {
        itemMap.set(item.id, item);
      }
    });

    importedItems.forEach(item => {
      if (item.id) {
        itemMap.set(item.id, item);
      } else {
        item.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        itemMap.set(item.id, item);
      }
    });

    const mergedItems = Array.from(itemMap.values());
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    await historyStore.set('uploads', mergedItems);
    await historyStore.save();

    const addedCount = mergedItems.length - currentItems.length;
    toast.success(
      `导入完成：共 ${mergedItems.length} 条记录`,
      `新增 ${addedCount} 条，去重 ${importedItems.length - addedCount} 条`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导入历史记录失败:', error);

    if (errorMsg.includes('JSON')) {
      toast.error('导入失败', 'JSON 格式错误，请检查文件格式');
    } else {
      toast.error('导入失败', errorMsg);
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

    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }

    const items = await historyStore.get<HistoryItem[]>('uploads') || [];
    if (items.length === 0) {
      toast.warn('没有可上传的历史记录');
      historySyncStatus.value = '状态: 无记录';
      return;
    }

    const client = new WebDAVClient(config.webdav);

    let remotePath = config.webdav.remotePath || '/WeiboDR/history.json';
    if (remotePath.endsWith('/')) {
      remotePath += 'history.json';
    } else if (!remotePath.toLowerCase().endsWith('.json')) {
      remotePath += '/history.json';
    }

    const jsonContent = JSON.stringify(items, null, 2);
    await client.putFile(remotePath, jsonContent);

    historySyncStatus.value = `状态: 已同步 (${items.length} 条)`;
    toast.success(`已上传 ${items.length} 条记录到云端`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 上传历史记录失败:', error);
    historySyncStatus.value = '状态: 同步失败';
    toast.error('上传失败', errorMsg);
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

    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }

    const client = new WebDAVClient(config.webdav);

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

    const currentItems = await historyStore.get<HistoryItem[]>('uploads') || [];

    const itemMap = new Map<string, HistoryItem>();

    currentItems.forEach(item => {
      const key = item.id || item.weiboPid || '';
      if (key) {
        itemMap.set(key, item);
      }
    });

    cloudItems.forEach(item => {
      const key = item.id || item.weiboPid || '';
      if (key) {
        const existing = itemMap.get(key);
        if (!existing || (item.timestamp && item.timestamp > (existing.timestamp || 0))) {
          itemMap.set(key, item);
        }
      } else {
        item.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        itemMap.set(item.id, item);
      }
    });

    const mergedItems = Array.from(itemMap.values());
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    await historyStore.set('uploads', mergedItems);
    await historyStore.save();

    const addedCount = mergedItems.length - currentItems.length;
    historySyncStatus.value = `状态: 已同步 (${mergedItems.length} 条)`;
    toast.success(
      `下载完成：共 ${mergedItems.length} 条记录`,
      `新增 ${addedCount} 条，合并 ${cloudItems.length - addedCount} 条`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 下载历史记录失败:', error);
    historySyncStatus.value = '状态: 同步失败';

    if (errorMsg.includes('不存在')) {
      toast.error('云端历史记录文件不存在');
    } else if (errorMsg.includes('JSON')) {
      toast.error('下载失败', 'JSON 格式错误');
    } else {
      toast.error('下载失败', errorMsg);
    }
  } finally {
    downloadHistoryLoading.value = false;
  }
}
</script>

<template>
  <div class="backup-view">
    <div class="container">
      <h1>备份与同步中心</h1>

      <!-- 软件配置卡片 -->
      <Card class="card-section">
        <template #title>
          <div class="card-title">
            <i class="pi pi-cog"></i>
            软件配置 (Settings)
          </div>
        </template>
        <template #content>
          <p class="desc">包含微博 Cookie、R2 密钥、WebDAV 凭证等敏感信息。</p>

          <Divider align="left">
            <span class="divider-label">本地备份</span>
          </Divider>

          <div class="btn-row">
            <Button
              @click="exportSettingsLocal"
              :loading="exportSettingsLoading"
              icon="pi pi-upload"
              label="导出到本地文件"
              outlined
            />
            <Button
              @click="importSettingsLocal"
              :loading="importSettingsLoading"
              icon="pi pi-download"
              label="从本地文件导入"
              outlined
            />
          </div>

          <Divider align="left">
            <span class="divider-label">WebDAV 云端同步</span>
          </Divider>

          <Message :closable="false" class="status-message">
            {{ settingsSyncStatus }}
          </Message>

          <div class="btn-row">
            <Button
              @click="uploadSettingsCloud"
              :loading="uploadSettingsLoading"
              icon="pi pi-cloud-upload"
              label="上传配置到云端"
            />
            <Button
              @click="downloadSettingsCloud"
              :loading="downloadSettingsLoading"
              icon="pi pi-cloud-download"
              label="从云端恢复配置"
            />
          </div>
        </template>
      </Card>

      <!-- 历史记录卡片 -->
      <Card class="card-section">
        <template #title>
          <div class="card-title">
            <i class="pi pi-history"></i>
            历史记录 (History)
          </div>
        </template>
        <template #content>
          <p class="desc">包含所有已上传图片的链接和元数据。</p>

          <Divider align="left">
            <span class="divider-label">本地备份</span>
          </Divider>

          <div class="btn-row">
            <Button
              @click="exportHistoryLocal"
              :loading="exportHistoryLoading"
              icon="pi pi-upload"
              label="导出 JSON"
              outlined
            />
            <Button
              @click="importHistoryLocal"
              :loading="importHistoryLoading"
              icon="pi pi-download"
              label="导入 JSON"
              outlined
            />
          </div>

          <Divider align="left">
            <span class="divider-label">WebDAV 云端同步</span>
          </Divider>

          <Message :closable="false" class="status-message">
            {{ historySyncStatus }}
          </Message>

          <div class="btn-row">
            <Button
              @click="uploadHistoryCloud"
              :loading="uploadHistoryLoading"
              icon="pi pi-cloud-upload"
              label="上传记录到云端"
            />
            <Button
              @click="downloadHistoryCloud"
              :loading="downloadHistoryLoading"
              icon="pi pi-cloud-download"
              label="从云端下载记录"
            />
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.backup-view {
  width: 100%;
  height: 100%;
  padding: 20px;
}

.container {
  max-width: 850px;
  margin: 0 auto;
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
  margin-bottom: 24px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

.card-title i {
  color: var(--primary);
}

.desc {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin-bottom: 16px;
  line-height: var(--leading-relaxed);
}

.divider-label {
  color: var(--text-secondary);
  font-weight: var(--weight-medium);
  font-size: var(--text-sm);
}

.btn-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.btn-row > button {
  flex: 1;
  min-width: 160px;
}

.status-message {
  margin: 12px 0;
}
</style>
