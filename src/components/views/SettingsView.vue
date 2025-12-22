<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/tauri';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { save, open } from '@tauri-apps/api/dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/api/fs';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Divider from 'primevue/divider';
import Tag from 'primevue/tag';
import Card from 'primevue/card';
import Message from 'primevue/message';
import { useToast } from '../../composables/useToast';
import { useThemeManager } from '../../composables/useTheme';
import { useConfigManager } from '../../composables/useConfig';
import { useHistoryManager, invalidateCache } from '../../composables/useHistory';
import { Store } from '../../store';
import { WebDAVClient } from '../../utils/webdav';
import type { ThemeMode, UserConfig, ServiceType, HistoryItem } from '../../config/types';
import { DEFAULT_CONFIG, DEFAULT_PREFIXES, PRIVATE_SERVICES, PUBLIC_SERVICES, migrateConfig } from '../../config/types';

const toast = useToast();
const { currentTheme, setTheme } = useThemeManager();
const configManager = useConfigManager();
const historyManager = useHistoryManager();

// 清空历史记录
const handleClearHistory = async () => {
  await historyManager.clearHistory();
};

// Cookie 监听器清理函数
const cookieUnlisten = ref<UnlistenFn | null>(null);

// --- 导航状态管理 ---
type SettingsTab = 'general' | 'r2' | 'builtin' | 'cookie_auth' | 'links' | 'webdav' | 'backup';
const activeTab = ref<SettingsTab>('general');

const tabs = [
  { id: 'general', label: '常规设置', icon: 'pi pi-cog' },
  { type: 'separator' },
  { type: 'label', label: '私有图床' },
  { id: 'r2', label: 'Cloudflare R2', icon: 'pi pi-cloud' },
  { type: 'separator' },
  { type: 'label', label: '公共图床' },
  { id: 'builtin', label: '开箱即用', icon: 'pi pi-box' },
  { id: 'cookie_auth', label: 'Cookie 认证', icon: 'pi pi-key' },
  { type: 'separator' },
  { type: 'label', label: '高级' },
  { id: 'links', label: '链接前缀', icon: 'pi pi-link' },
  { id: 'webdav', label: 'WebDAV 配置', icon: 'pi pi-sync' },
  { id: 'backup', label: '备份与同步', icon: 'pi pi-database' },
];

// --- 基础数据与逻辑 (复用原有逻辑) ---
// 主题
const themeOptions = [
  { label: '亮色模式', value: 'light', icon: 'pi pi-sun' },
  { label: '深色模式', value: 'dark', icon: 'pi pi-moon' }
];

const handleThemeChange = async (mode: ThemeMode) => {
  try {
    await setTheme(mode);
    toast.success('已切换', `当前主题：${mode === 'light' ? '亮色' : '深色'}`);
  } catch (e) { toast.error('失败', String(e)); }
};

// 表单数据
const formData = ref({
  weiboCookie: '',
  r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '' },
  nowcoder: { cookie: '' },
  zhihu: { cookie: '' },
  nami: { cookie: '' },
  webdav: { url: '', username: '', password: '', remotePath: '/WeiboDR/history.json' },
  linkPrefixEnabled: true,
  selectedPrefixIndex: 0,
  linkPrefixList: [...DEFAULT_PREFIXES]
});

// 服务列表
const availableServices = ref<ServiceType[]>(['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami']);
const serviceNames: Record<ServiceType, string> = {
  weibo: '微博', r2: 'R2', tcl: 'TCL', jd: '京东', nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
};

// 测试状态
const testingConnections = ref<Record<string, boolean>>({ weibo: false, r2: false, nowcoder: false, zhihu: false, nami: false, webdav: false });

// 七鱼可用性检测（完整检测：实际获取 Token）
const qiyuAvailable = ref(false);
const isCheckingQiyu = ref(false);
const checkQiyuAvailability = async () => {
  isCheckingQiyu.value = true;
  try { qiyuAvailable.value = await invoke('check_qiyu_available'); }
  catch (e) { qiyuAvailable.value = false; }
  finally { isCheckingQiyu.value = false; }
};

// 京东可用性检测
const jdAvailable = ref(false);
const isCheckingJd = ref(false);
const checkJdAvailable = async () => {
  isCheckingJd.value = true;
  try { jdAvailable.value = await invoke('check_jd_available'); }
  catch (e) { jdAvailable.value = false; }
  finally { isCheckingJd.value = false; }
};

// TCL 可用性检测
const tclAvailable = ref(false);
const isCheckingTcl = ref(false);
const checkTclAvailable = async () => {
  isCheckingTcl.value = true;
  try { tclAvailable.value = await invoke('check_tcl_available'); }
  catch (e) { tclAvailable.value = false; }
  finally { isCheckingTcl.value = false; }
};

// 可用性检测冷却机制（防止频繁切换页面导致过度检测）
const lastCheckTime = ref(0);
const CHECK_COOLDOWN = 5 * 60 * 1000; // 5 分钟冷却

const checkAllAvailabilityWithCooldown = async () => {
  const now = Date.now();
  if (now - lastCheckTime.value < CHECK_COOLDOWN) {
    console.log('[可用性检测] 冷却中，跳过自动检测');
    return;
  }

  lastCheckTime.value = now;
  await Promise.all([
    checkQiyuAvailability(),
    checkJdAvailable(),
    checkTclAvailable()
  ]);
};

// 加载配置
const loadSettings = async () => {
  try {
    const cfg = await configManager.loadConfig();
    // 映射逻辑 (保持原有逻辑不变)
    formData.value.weiboCookie = cfg.services?.weibo?.cookie || '';

    // 修改点 1: R2 配置改为逐字段赋值，确保默认空字符串
    formData.value.r2 = {
      accountId: cfg.services?.r2?.accountId || '',
      accessKeyId: cfg.services?.r2?.accessKeyId || '',
      secretAccessKey: cfg.services?.r2?.secretAccessKey || '',
      bucketName: cfg.services?.r2?.bucketName || '',
      path: cfg.services?.r2?.path || '',
      publicDomain: cfg.services?.r2?.publicDomain || ''
    };

    formData.value.nowcoder.cookie = cfg.services?.nowcoder?.cookie || '';
    formData.value.zhihu.cookie = cfg.services?.zhihu?.cookie || '';
    formData.value.nami.cookie = cfg.services?.nami?.cookie || '';
    formData.value.webdav = { ...formData.value.webdav, ...cfg.webdav };
    if (cfg.availableServices) availableServices.value = [...cfg.availableServices];
    if (cfg.linkPrefixConfig) {
      formData.value.linkPrefixEnabled = cfg.linkPrefixConfig.enabled;
      formData.value.selectedPrefixIndex = cfg.linkPrefixConfig.selectedIndex;
      formData.value.linkPrefixList = [...cfg.linkPrefixConfig.prefixList];
    }
  } catch (e) { console.error(e); }
};

// 自动保存
const saveSettings = async (silent = false) => {
  try {
    const currentConfig = configManager.config.value;
    const updatedConfig: UserConfig = {
      ...currentConfig,
      availableServices: [...availableServices.value],
      services: {
        ...currentConfig.services,
        weibo: { enabled: currentConfig.services?.weibo?.enabled ?? false, cookie: formData.value.weiboCookie.trim() },
        r2: { ...currentConfig.services?.r2, ...formData.value.r2, enabled: currentConfig.services?.r2?.enabled ?? false },
        nowcoder: { enabled: currentConfig.services?.nowcoder?.enabled ?? false, cookie: formData.value.nowcoder.cookie.trim() },
        zhihu: { enabled: currentConfig.services?.zhihu?.enabled ?? false, cookie: formData.value.zhihu.cookie.trim() },
        nami: { enabled: currentConfig.services?.nami?.enabled ?? false, cookie: formData.value.nami.cookie.trim(), authToken: '' }
      },
      webdav: { ...formData.value.webdav },
      linkPrefixConfig: {
        enabled: formData.value.linkPrefixEnabled,
        selectedIndex: formData.value.selectedPrefixIndex,
        prefixList: formData.value.linkPrefixList.filter(p => p.trim() !== '')
      }
    };
    // 特殊处理 Nami AuthToken
    const tokenMatch = updatedConfig.services?.nami?.cookie?.match(/Auth-Token=([^;]+)/);
    if (tokenMatch && updatedConfig.services?.nami) updatedConfig.services.nami.authToken = tokenMatch[1];

    await configManager.saveConfig(updatedConfig, silent);
  } catch (e) { console.error(e); }
};

// 测试连接 Wrapper
const testConn = async (key: string, fn: () => Promise<any>) => {
  testingConnections.value[key] = true;
  try {
    const res = await fn();
    res.success ? toast.success('成功', res.message) : toast.error('失败', res.message);
  } finally { testingConnections.value[key] = false; }
};

// 具体测试方法
const actions = {
  weibo: () => testConn('weibo', () => configManager.testWeiboConnection(formData.value.weiboCookie)),
  r2: () => testConn('r2', () => configManager.testR2Connection(formData.value.r2)),
  nowcoder: () => testConn('nowcoder', () => configManager.testNowcoderConnection(formData.value.nowcoder.cookie)),
  zhihu: () => testConn('zhihu', () => configManager.testZhihuConnection(formData.value.zhihu.cookie)),
  nami: () => testConn('nami', () => configManager.testNamiConnection(formData.value.nami.cookie)),
  webdav: () => testConn('webdav', () => configManager.testWebDAVConnection(formData.value.webdav)),
  login: (svc: ServiceType) => configManager.openCookieWebView(svc)
};

// 前缀管理
const addPrefix = () => { formData.value.linkPrefixList.push(''); formData.value.selectedPrefixIndex = formData.value.linkPrefixList.length - 1; };
const removePrefix = (idx: number) => {
  if (formData.value.linkPrefixList.length <= 1) return;
  formData.value.linkPrefixList.splice(idx, 1);
  if (formData.value.selectedPrefixIndex >= formData.value.linkPrefixList.length) formData.value.selectedPrefixIndex = 0;
  saveSettings();
};

// 修改点 2: 添加恢复默认前缀功能
const resetToDefaultPrefixes = () => {
  formData.value.linkPrefixList = [...DEFAULT_PREFIXES];
  formData.value.selectedPrefixIndex = 0;
  saveSettings();
  toast.success('已恢复', '前缀列表已恢复为默认值');
};

// ========== 备份与同步功能 ==========
// 存储实例
const configStore = new Store('.settings.dat');
const historyStore = new Store('.history.dat');

// 同步状态
const settingsSyncStatus = ref('状态: 未同步');
const historySyncStatus = ref('状态: 未同步');

/**
 * 获取当前时间的 HH:mm 格式字符串
 */
function getCurrentTimeString(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

// 按钮加载状态
const exportSettingsLoading = ref(false);
const importSettingsLoading = ref(false);
const uploadSettingsLoading = ref(false);
const downloadSettingsLoading = ref(false);
const exportHistoryLoading = ref(false);
const importHistoryLoading = ref(false);
const uploadHistoryLoading = ref(false);
const downloadHistoryLoading = ref(false);

// 历史记录上传菜单状态
const uploadHistoryMenuVisible = ref(false);
const uploadHistoryDropdownRef = ref<HTMLElement | null>(null);

// 配置下载菜单状态
const downloadSettingsMenuVisible = ref(false);
const downloadSettingsDropdownRef = ref<HTMLElement | null>(null);

// 历史记录下载菜单状态
const downloadHistoryMenuVisible = ref(false);
const downloadHistoryDropdownRef = ref<HTMLElement | null>(null);

// 切换历史记录上传菜单
const toggleUploadHistoryMenu = () => {
  const willOpen = !uploadHistoryMenuVisible.value;
  // 关闭其他菜单
  downloadSettingsMenuVisible.value = false;
  downloadHistoryMenuVisible.value = false;
  uploadHistoryMenuVisible.value = willOpen;
};

// 切换配置下载菜单
const toggleDownloadSettingsMenu = () => {
  const willOpen = !downloadSettingsMenuVisible.value;
  // 关闭其他菜单
  uploadHistoryMenuVisible.value = false;
  downloadHistoryMenuVisible.value = false;
  downloadSettingsMenuVisible.value = willOpen;
};

// 切换历史记录下载菜单
const toggleDownloadHistoryMenu = () => {
  const willOpen = !downloadHistoryMenuVisible.value;
  // 关闭其他菜单
  uploadHistoryMenuVisible.value = false;
  downloadSettingsMenuVisible.value = false;
  downloadHistoryMenuVisible.value = willOpen;
};

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

    settingsSyncStatus.value = `状态: 已同步 ${getCurrentTimeString()}`;
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
 * 从云端下载配置 - 覆盖本地
 * 完全使用云端配置替换本地配置
 */
async function downloadSettingsOverwrite() {
  downloadSettingsMenuVisible.value = false;

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

    settingsSyncStatus.value = `状态: 已同步 ${getCurrentTimeString()}`;
    toast.success('配置已从云端恢复（覆盖本地）');

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
 * 从云端下载配置 - 合并（保留本地 WebDAV 配置）
 * 保留本地的 WebDAV 连接信息，其他配置用云端的
 */
async function downloadSettingsMerge() {
  downloadSettingsMenuVisible.value = false;

  try {
    downloadSettingsLoading.value = true;
    settingsSyncStatus.value = '状态: 合并中...';

    const currentConfig = await configStore.get<UserConfig>('config');
    if (!currentConfig || !currentConfig.webdav) {
      throw new Error('WebDAV 配置不完整，请先在设置中配置 WebDAV');
    }

    if (!currentConfig.webdav.url || !currentConfig.webdav.username || !currentConfig.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }

    const client = new WebDAVClient(currentConfig.webdav);

    let remotePath = currentConfig.webdav.remotePath || '/WeiboDR/settings.json';
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

    // 合并配置：保留本地 WebDAV 配置，其他用云端的
    const mergedConfig: UserConfig = {
      ...importedConfig,
      webdav: currentConfig.webdav  // 保留本地 WebDAV 配置
    };

    await configStore.set('config', mergedConfig);
    await configStore.save();

    settingsSyncStatus.value = `状态: 已同步 ${getCurrentTimeString()}`;
    toast.success('配置已从云端恢复（保留本地 WebDAV）');

    setTimeout(() => {
      toast.info('请刷新页面以使配置生效');
    }, 1000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 合并下载配置失败:', error);
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

    // 使缓存失效，让其他视图在下次激活时重新加载
    invalidateCache();

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

    historySyncStatus.value = `状态: 已同步 (${items.length} 条) ${getCurrentTimeString()}`;
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
 * 智能合并上传历史记录
 * 流程：下载云端 -> 与本地合并 -> 上传合并结果
 */
async function uploadHistoryMerge() {
  uploadHistoryMenuVisible.value = false;

  try {
    uploadHistoryLoading.value = true;
    historySyncStatus.value = '状态: 合并中...';

    const config = await configStore.get<UserConfig>('config');
    if (!config || !config.webdav) {
      throw new Error('WebDAV 配置不完整，请先在设置中配置 WebDAV');
    }

    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }

    const localItems = await historyStore.get<HistoryItem[]>('uploads') || [];
    if (localItems.length === 0) {
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

    // 1. 尝试下载云端数据
    let cloudItems: HistoryItem[] = [];
    try {
      const content = await client.getFile(remotePath);
      if (content) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          cloudItems = parsed;
        }
      }
    } catch (e) {
      // 云端文件不存在或解析失败，使用空数组
      console.log('[备份] 云端文件不存在或无法解析，将进行全量上传');
    }

    // 2. 合并本地和云端数据
    const itemMap = new Map<string, HistoryItem>();

    // 先添加云端数据
    cloudItems.forEach(item => {
      if (item.id) {
        itemMap.set(item.id, item);
      }
    });

    // 再用本地数据覆盖（本地优先，基于时间戳）
    localItems.forEach(item => {
      if (item.id) {
        const existing = itemMap.get(item.id);
        // 如果本地记录更新或云端不存在，使用本地记录
        if (!existing || (item.timestamp && item.timestamp > (existing.timestamp || 0))) {
          itemMap.set(item.id, item);
        }
      } else {
        // 没有 ID 的记录，生成一个并添加
        item.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        itemMap.set(item.id, item);
      }
    });

    // 3. 排序并上传
    const mergedItems = Array.from(itemMap.values());
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const jsonContent = JSON.stringify(mergedItems, null, 2);
    await client.putFile(remotePath, jsonContent);

    const newCount = mergedItems.length - cloudItems.length;
    historySyncStatus.value = `状态: 已同步 (${mergedItems.length} 条) ${getCurrentTimeString()}`;
    toast.success(
      `合并上传完成：共 ${mergedItems.length} 条记录`,
      newCount > 0 ? `新增 ${newCount} 条到云端` : '云端数据已是最新'
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 智能合并上传失败:', error);
    historySyncStatus.value = '状态: 同步失败';
    toast.error('上传失败', errorMsg);
  } finally {
    uploadHistoryLoading.value = false;
  }
}

/**
 * 仅上传本地新增的历史记录
 * 只上传云端不存在的记录，保留云端原有数据
 */
async function uploadHistoryIncremental() {
  uploadHistoryMenuVisible.value = false;

  try {
    uploadHistoryLoading.value = true;
    historySyncStatus.value = '状态: 检查增量...';

    const config = await configStore.get<UserConfig>('config');
    if (!config || !config.webdav) {
      throw new Error('WebDAV 配置不完整，请先在设置中配置 WebDAV');
    }

    if (!config.webdav.url || !config.webdav.username || !config.webdav.password) {
      throw new Error('WebDAV 配置不完整，请检查设置');
    }

    const localItems = await historyStore.get<HistoryItem[]>('uploads') || [];
    if (localItems.length === 0) {
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

    // 1. 下载云端数据获取已存在的 ID
    let cloudItems: HistoryItem[] = [];
    const cloudIdSet = new Set<string>();

    try {
      const content = await client.getFile(remotePath);
      if (content) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          cloudItems = parsed;
          cloudItems.forEach(item => {
            if (item.id) cloudIdSet.add(item.id);
          });
        }
      }
    } catch (e) {
      // 云端文件不存在，视为空
      console.log('[备份] 云端文件不存在，将进行全量上传');
    }

    // 2. 找出本地有但云端没有的记录
    const newItems = localItems.filter(item => item.id && !cloudIdSet.has(item.id));

    if (newItems.length === 0) {
      historySyncStatus.value = `状态: 已同步 (${cloudItems.length} 条) ${getCurrentTimeString()}`;
      toast.info('无需上传', '本地没有新增的记录');
      return;
    }

    // 3. 合并云端数据和新增数据
    const mergedItems = [...cloudItems, ...newItems];
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const jsonContent = JSON.stringify(mergedItems, null, 2);
    await client.putFile(remotePath, jsonContent);

    historySyncStatus.value = `状态: 已同步 (${mergedItems.length} 条) ${getCurrentTimeString()}`;
    toast.success(
      `增量上传完成`,
      `新增 ${newItems.length} 条记录到云端，共 ${mergedItems.length} 条`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 增量上传失败:', error);
    historySyncStatus.value = '状态: 同步失败';
    toast.error('上传失败', errorMsg);
  } finally {
    uploadHistoryLoading.value = false;
  }
}

/**
 * 从云端下载历史记录 - 覆盖本地
 * 完全使用云端数据替换本地历史记录
 */
async function downloadHistoryOverwrite() {
  downloadHistoryMenuVisible.value = false;

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

    // 直接覆盖本地数据
    await historyStore.set('uploads', cloudItems);
    await historyStore.save();

    // 使缓存失效，让其他视图在下次激活时重新加载
    invalidateCache();

    historySyncStatus.value = `状态: 已同步 (${cloudItems.length} 条) ${getCurrentTimeString()}`;
    toast.success(`下载完成：共 ${cloudItems.length} 条记录（覆盖本地）`);
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

/**
 * 从云端下载历史记录 - 智能合并
 * 与本地记录合并，保留更新的版本
 */
async function downloadHistoryMerge() {
  downloadHistoryMenuVisible.value = false;

  try {
    downloadHistoryLoading.value = true;
    historySyncStatus.value = '状态: 合并中...';

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
      if (item.id) {
        itemMap.set(item.id, item);
      }
    });

    cloudItems.forEach(item => {
      if (item.id) {
        const existing = itemMap.get(item.id);
        if (!existing || (item.timestamp && item.timestamp > (existing.timestamp || 0))) {
          itemMap.set(item.id, item);
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

    // 使缓存失效，让其他视图在下次激活时重新加载
    invalidateCache();

    const addedCount = mergedItems.length - currentItems.length;
    historySyncStatus.value = `状态: 已同步 (${mergedItems.length} 条) ${getCurrentTimeString()}`;
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

// 点击外部关闭下拉菜单
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as Node;

  // 关闭历史记录上传菜单
  if (uploadHistoryMenuVisible.value && uploadHistoryDropdownRef.value) {
    if (!uploadHistoryDropdownRef.value.contains(target)) {
      uploadHistoryMenuVisible.value = false;
    }
  }

  // 关闭配置下载菜单
  if (downloadSettingsMenuVisible.value && downloadSettingsDropdownRef.value) {
    if (!downloadSettingsDropdownRef.value.contains(target)) {
      downloadSettingsMenuVisible.value = false;
    }
  }

  // 关闭历史记录下载菜单
  if (downloadHistoryMenuVisible.value && downloadHistoryDropdownRef.value) {
    if (!downloadHistoryDropdownRef.value.contains(target)) {
      downloadHistoryMenuVisible.value = false;
    }
  }
};

// 监听 Cookie 更新
onMounted(async () => {
  await loadSettings();
  // 带冷却的可用性检测（5分钟内不重复检测）
  await checkAllAvailabilityWithCooldown();
  cookieUnlisten.value = await configManager.setupCookieListener(async (sid, cookie) => {
    if (sid === 'weibo') formData.value.weiboCookie = cookie;
    else if (['nowcoder', 'zhihu', 'nami'].includes(sid)) (formData.value as any)[sid].cookie = cookie;
    await saveSettings(true); // 静默保存，不显示"保存成功"提示
  });

  // 添加点击外部关闭菜单监听
  document.addEventListener('click', handleClickOutside);
});

// 组件卸载时清理监听器
onUnmounted(() => {
  if (cookieUnlisten.value) {
    cookieUnlisten.value();
    cookieUnlisten.value = null;
  }

  // 移除点击外部关闭菜单监听
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="sidebar-header">设置</div>
      <div class="nav-list">
        <template v-for="(item, index) in tabs" :key="index">
          <div v-if="item.type === 'separator'" class="nav-separator"></div>
          <div v-else-if="item.type === 'label'" class="nav-label">{{ item.label }}</div>
          <button
            v-else
            class="nav-item"
            :class="{ active: activeTab === item.id }"
            @click="activeTab = item.id as SettingsTab"
          >
            <i :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </button>
        </template>
      </div>

      <div class="sidebar-footer">
        <span class="version-text">WeiboDR v3.0.0</span>
      </div>
    </div>

    <div class="settings-content">

      <div v-if="activeTab === 'general'" class="settings-section">
        <div class="section-header">
          <h2>常规设置</h2>
          <p class="section-desc">管理应用外观与启用的服务模块。</p>
        </div>

        <div class="form-group">
          <label class="group-label">外观主题</label>
          <div class="theme-options">
            <div
              v-for="opt in themeOptions" :key="opt.value"
              class="theme-card"
              :class="{ active: currentTheme === opt.value }"
              @click="handleThemeChange(opt.value as ThemeMode)"
            >
              <i :class="opt.icon"></i>
              <span>{{ opt.label }}</span>
            </div>
          </div>
        </div>

        <Divider />

        <div class="form-group">
          <label class="group-label">启用的图床服务</label>
          <p class="helper-text">勾选要在"上传界面"显示的服务。</p>

          <div class="service-group-section">
            <div class="service-group-title">私有图床</div>
            <div class="service-toggles-grid">
              <div
                v-for="svc in PRIVATE_SERVICES"
                :key="svc"
                class="toggle-chip"
              >
                <Checkbox :inputId="'svc-'+svc" v-model="availableServices" :value="svc" @change="saveSettings" />
                <label :for="'svc-'+svc">{{ serviceNames[svc] }}</label>
              </div>
            </div>
          </div>

          <div class="service-group-section">
            <div class="service-group-title">公共图床</div>
            <div class="service-toggles-grid">
              <div
                v-for="svc in PUBLIC_SERVICES"
                :key="svc"
                class="toggle-chip"
              >
                <Checkbox :inputId="'svc-'+svc" v-model="availableServices" :value="svc" @change="saveSettings" />
                <label :for="'svc-'+svc">{{ serviceNames[svc] }}</label>
              </div>
            </div>
          </div>
        </div>

        <Divider />

        <div class="form-group">
          <label class="group-label">数据管理</label>
          <p class="helper-text">管理上传历史记录。</p>
          <Button
            label="清空历史记录"
            icon="pi pi-trash"
            severity="danger"
            outlined
            @click="handleClearHistory"
          />
        </div>
      </div>

      <div v-if="activeTab === 'r2'" class="settings-section">
        <div class="section-header">
          <h2>Cloudflare R2</h2>
          <p class="section-desc">配置 S3 兼容的高速存储，用于数据备份与分发。</p>
        </div>

        <div class="form-grid">
            <div class="form-item">
                <label>Account ID</label>
                <InputText v-model="formData.r2.accountId" @blur="saveSettings" class="w-full" />
            </div>
            <div class="form-item">
                <label>Bucket Name</label>
                <InputText v-model="formData.r2.bucketName" @blur="saveSettings" class="w-full" />
            </div>
            <div class="form-item">
                <label>Access Key ID</label>
                <Password v-model="formData.r2.accessKeyId" @blur="saveSettings" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item">
                <label>Secret Access Key</label>
                <Password v-model="formData.r2.secretAccessKey" @blur="saveSettings" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item span-full">
                <label>自定义路径 (Optional)</label>
                <InputText v-model="formData.r2.path" @blur="saveSettings" placeholder="e.g. blog/images/" class="w-full" />
            </div>
            <div class="form-item span-full">
                <label>公开访问域名 (Public Domain)</label>
                <InputText v-model="formData.r2.publicDomain" @blur="saveSettings" placeholder="https://images.example.com" class="w-full" />
            </div>
        </div>

        <div class="actions-row mt-4">
            <Button label="测试 R2 连接" icon="pi pi-check" @click="actions.r2" :loading="testingConnections.r2" severity="secondary" outlined size="small" />
        </div>
      </div>

      <div v-if="activeTab === 'builtin'" class="settings-section">
        <div class="section-header">
          <h2>开箱即用</h2>
          <p class="section-desc">无需配置，直接使用的图床服务。</p>
        </div>

        <div class="service-cards-row">
          <div class="service-card-flat">
            <div class="sc-content">
              <h3>京东图床</h3>
              <p>速度极快，CDN 全球分发。最大支持 15MB。</p>
              <div class="service-status">
                <Tag
                  :value="isCheckingJd ? '检测中' : (jdAvailable ? '可用' : '不可用')"
                  :severity="isCheckingJd ? 'info' : (jdAvailable ? 'success' : 'danger')"
                  :icon="isCheckingJd ? 'pi pi-spin pi-spinner' : undefined"
                  class="clickable-tag"
                  @click="!isCheckingJd && checkJdAvailable()"
                />
              </div>
            </div>
          </div>
          <div class="service-card-flat">
            <div class="sc-content">
              <h3>TCL 图床</h3>
              <p>无需配置，直接使用。支持多种格式。</p>
              <div class="service-status">
                <Tag :value="isCheckingTcl ? '检测中' : (tclAvailable ? '可用' : '不可用')" :severity="isCheckingTcl ? 'info' : (tclAvailable ? 'success' : 'danger')" />
                <Button label="检测" icon="pi pi-refresh" @click="checkTclAvailable" :loading="isCheckingTcl" text size="small" />
              </div>
            </div>
          </div>
          <div class="service-card-flat">
            <div class="sc-content">
              <h3>七鱼图床</h3>
              <p>基于网易七鱼客服系统，Token 自动获取。</p>
              <div class="service-status">
                <Tag :value="isCheckingQiyu ? '检测中' : (qiyuAvailable ? '可用' : '不可用')" :severity="isCheckingQiyu ? 'info' : (qiyuAvailable ? 'success' : 'danger')" />
                <Button label="检测" icon="pi pi-refresh" @click="checkQiyuAvailability" :loading="isCheckingQiyu" text size="small" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'cookie_auth'" class="settings-section">
        <div class="section-header">
          <h2>Cookie 认证</h2>
          <p class="section-desc">需要提供 Cookie 的图床服务。</p>
        </div>

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>微博图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('weibo')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.weibo" :loading="testingConnections.weibo" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.weiboCookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="SUB=...; (粘贴完整 Cookie)" />
        </div>

        <Divider />

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>知乎图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('zhihu')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.zhihu" :loading="testingConnections.zhihu" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.zhihu.cookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="知乎 Cookie..." />
        </div>

        <Divider />

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>牛客图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('nowcoder')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.nowcoder" :loading="testingConnections.nowcoder" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.nowcoder.cookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="牛客 Cookie..." />
        </div>

        <Divider />

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>纳米图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('nami')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.nami" :loading="testingConnections.nami" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.nami.cookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="纳米 Cookie..." />
        </div>
      </div>

      <div v-if="activeTab === 'links'" class="settings-section">
        <div class="section-header">
          <h2>链接前缀</h2>
          <p class="section-desc">为微博图片添加代理前缀以绕过防盗链限制。</p>
        </div>

        <div class="form-group mb-4">
            <div class="flex items-center gap-2">
                <Checkbox v-model="formData.linkPrefixEnabled" :binary="true" inputId="prefix-enable" @change="saveSettings" />
                <label for="prefix-enable" class="font-medium cursor-pointer">启用链接前缀</label>
            </div>
        </div>

        <div v-if="formData.linkPrefixEnabled" class="prefix-list">
            <div v-for="(_prefix, idx) in formData.linkPrefixList" :key="idx" class="prefix-row">
                <RadioButton v-model="formData.selectedPrefixIndex" :value="idx" :inputId="'p-'+idx" @change="saveSettings()" />
                <InputText v-model="formData.linkPrefixList[idx]" @blur="saveSettings()" class="flex-1" />
                <Button icon="pi pi-trash" @click="removePrefix(idx)" text severity="danger" :disabled="formData.linkPrefixList.length <= 1"/>
            </div>
            <Button label="添加新前缀" icon="pi pi-plus" @click="addPrefix" outlined class="w-full mt-2" size="small" />
            <!-- 修改点 3: 添加恢复默认前缀按钮 -->
            <Button
              label="恢复默认前缀"
              icon="pi pi-refresh"
              @click="resetToDefaultPrefixes"
              outlined
              severity="secondary"
              size="small"
              class="w-full mt-2"
            />
        </div>
      </div>

      <div v-if="activeTab === 'webdav'" class="settings-section">
        <div class="section-header">
          <h2>WebDAV 配置</h2>
          <p class="section-desc">配置 WebDAV 服务器连接，用于云端备份与同步。</p>
        </div>

        <div class="form-grid">
            <div class="form-item span-full">
                <label>服务器 URL</label>
                <InputText v-model="formData.webdav.url" @blur="saveSettings" placeholder="https://dav.example.com/" class="w-full" />
            </div>
            <div class="form-item">
                <label>用户名</label>
                <InputText v-model="formData.webdav.username" @blur="saveSettings" class="w-full" />
            </div>
            <div class="form-item">
                <label>密码 / 应用授权码</label>
                <Password v-model="formData.webdav.password" @blur="saveSettings" :feedback="false" toggleMask class="w-full" />
            </div>
            <div class="form-item span-full">
                <label>远程路径</label>
                <InputText v-model="formData.webdav.remotePath" @blur="saveSettings" class="w-full" />
                <small class="helper-text">例如: /WeiboDR/history.json</small>
            </div>
        </div>

        <div class="actions-row mt-4">
            <Button label="测试 WebDAV 连接" icon="pi pi-check" @click="actions.webdav" :loading="testingConnections.webdav" severity="secondary" outlined size="small" />
        </div>
      </div>

      <div v-if="activeTab === 'backup'" class="settings-section">
        <div class="section-header">
          <h2>备份与同步</h2>
          <p class="section-desc">导出/导入配置和历史记录，支持本地文件和 WebDAV 云端同步。</p>
        </div>

        <!-- 配置文件 -->
        <div class="sub-section">
          <h3>配置文件</h3>
          <p class="helper-text">包含 Cookie、存储桶密钥、WebDAV 凭证等敏感信息。</p>

          <div class="backup-group">
            <span class="backup-group-label">本地备份</span>
            <div class="backup-actions">
              <Button
                @click="exportSettingsLocal"
                :loading="exportSettingsLoading"
                icon="pi pi-upload"
                label="导出"
                outlined
                size="small"
              />
              <Button
                @click="importSettingsLocal"
                :loading="importSettingsLoading"
                icon="pi pi-download"
                label="导入"
                outlined
                size="small"
              />
            </div>
          </div>

          <div class="backup-group">
            <span class="backup-group-label">WebDAV 云端</span>
            <div class="backup-actions">
              <Button
                @click="uploadSettingsCloud"
                :loading="uploadSettingsLoading"
                icon="pi pi-cloud-upload"
                label="上传"
                size="small"
              />
              <!-- 配置文件下载下拉菜单 -->
              <div class="upload-dropdown-wrapper" ref="downloadSettingsDropdownRef">
                <Button
                  @click.stop="toggleDownloadSettingsMenu"
                  :loading="downloadSettingsLoading"
                  icon="pi pi-cloud-download"
                  label="下载"
                  size="small"
                />
                <Transition name="dropdown">
                  <div v-if="downloadSettingsMenuVisible" class="upload-menu">
                    <button class="upload-menu-item" @click="downloadSettingsMerge">
                      <i class="pi pi-sync"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">合并下载</span>
                        <span class="menu-item-desc">保留本地 WebDAV 配置，其他用云端</span>
                      </div>
                    </button>
                    <button class="upload-menu-item" @click="downloadSettingsOverwrite">
                      <i class="pi pi-download"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">覆盖本地</span>
                        <span class="menu-item-desc">完全使用云端配置替换本地</span>
                      </div>
                    </button>
                  </div>
                </Transition>
              </div>
            </div>
            <span class="backup-status">{{ settingsSyncStatus }}</span>
          </div>
        </div>

        <!-- 历史记录 -->
        <div class="sub-section">
          <h3>历史记录</h3>
          <p class="helper-text">包含所有已上传图片的链接和元数据。</p>

          <div class="backup-group">
            <span class="backup-group-label">本地备份</span>
            <div class="backup-actions">
              <Button
                @click="exportHistoryLocal"
                :loading="exportHistoryLoading"
                icon="pi pi-upload"
                label="导出"
                outlined
                size="small"
              />
              <Button
                @click="importHistoryLocal"
                :loading="importHistoryLoading"
                icon="pi pi-download"
                label="导入"
                outlined
                size="small"
              />
            </div>
          </div>

          <div class="backup-group">
            <span class="backup-group-label">WebDAV 云端</span>
            <div class="backup-actions">
              <!-- 历史记录上传下拉菜单 -->
              <div class="upload-dropdown-wrapper" ref="uploadHistoryDropdownRef">
                <Button
                  @click.stop="toggleUploadHistoryMenu"
                  :loading="uploadHistoryLoading"
                  icon="pi pi-cloud-upload"
                  label="上传"
                  size="small"
                />
                <Transition name="dropdown">
                  <div v-if="uploadHistoryMenuVisible" class="upload-menu">
                    <button class="upload-menu-item" @click="uploadHistoryMerge">
                      <i class="pi pi-sync"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">合并上传</span>
                        <span class="menu-item-desc">下载云端数据，与本地合并后上传</span>
                      </div>
                    </button>
                    <button class="upload-menu-item" @click="uploadHistoryIncremental">
                      <i class="pi pi-plus"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">仅上传本地新增</span>
                        <span class="menu-item-desc">只上传云端没有的记录</span>
                      </div>
                    </button>
                  </div>
                </Transition>
              </div>
              <!-- 历史记录下载下拉菜单 -->
              <div class="upload-dropdown-wrapper" ref="downloadHistoryDropdownRef">
                <Button
                  @click.stop="toggleDownloadHistoryMenu"
                  :loading="downloadHistoryLoading"
                  icon="pi pi-cloud-download"
                  label="下载"
                  size="small"
                />
                <Transition name="dropdown">
                  <div v-if="downloadHistoryMenuVisible" class="upload-menu">
                    <button class="upload-menu-item" @click="downloadHistoryMerge">
                      <i class="pi pi-sync"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">合并下载</span>
                        <span class="menu-item-desc">与本地记录合并，保留更新的版本</span>
                      </div>
                    </button>
                    <button class="upload-menu-item" @click="downloadHistoryOverwrite">
                      <i class="pi pi-download"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">覆盖本地</span>
                        <span class="menu-item-desc">完全使用云端记录替换本地</span>
                      </div>
                    </button>
                  </div>
                </Transition>
              </div>
            </div>
            <span class="backup-status">{{ historySyncStatus }}</span>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* 布局容器 */
.settings-layout {
  display: flex;
  height: 100%;
  background-color: var(--bg-app);
  overflow: hidden;
}

/* === 侧边栏导航 === */
.settings-sidebar {
  width: 240px;
  background-color: var(--bg-card);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}

.nav-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.nav-item:hover {
  background-color: var(--hover-overlay-subtle);
  color: var(--text-primary);
}

.nav-item.active {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--primary);
  font-weight: 600;
}

.nav-item i {
  font-size: 16px;
}

.nav-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  padding: 16px 12px 6px;
  letter-spacing: 0.05em;
}

.nav-separator {
  height: 1px;
  background-color: var(--border-subtle);
  margin: 8px 12px;
  opacity: 0.5;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--border-subtle);
  text-align: center;
}

.version-text {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* === 内容区域 === */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
  max-width: 800px; /* 限制内容最大宽度以保证可读性 */
}

.settings-section {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

.section-header {
  margin-bottom: 32px;
}

.section-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* 表单通用样式 */
.form-group {
  margin-bottom: 24px;
}

.group-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.helper-text {
  font-size: 13px;
  color: var(--text-muted);
  margin: -4px 0 12px 0;
}

/* Grid Layout for Forms */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-item.span-full {
  grid-column: 1 / -1;
}

.form-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

/* 主题卡片 */
.theme-options {
  display: flex;
  gap: 16px;
}

.theme-card {
  flex: 1;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background-color: var(--bg-card);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.theme-card:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.theme-card.active {
  border-color: var(--primary);
  background-color: rgba(59, 130, 246, 0.05);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--primary);
}

/* Service Toggles */
.service-toggles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.toggle-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-chip:hover {
  border-color: var(--text-muted);
}

.toggle-chip label {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
}

/* Info Blocks & Flat Cards */
.info-block {
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.info-block.warning {
  background-color: rgba(234, 179, 8, 0.1);
  color: var(--warning);
  border: 1px solid rgba(234, 179, 8, 0.2);
}

.info-block.success {
  background-color: rgba(16, 185, 129, 0.1);
  color: var(--success);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.info-block.danger {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.service-card-flat {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 16px;
  align-items: flex-start;
}

.sc-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--bg-input);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 20px;
  flex-shrink: 0;
}

.sc-content h3 {
  margin: 0 0 4px 0;
  font-size: 15px;
  color: var(--text-primary);
}

.sc-content p {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

/* 子章节 */
.sub-section {
  margin-bottom: 24px;
}

.sub-section h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
}

/* 链接前缀 */
.prefix-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prefix-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Utility */
.w-full { width: 100%; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.mb-2 { margin-bottom: 8px; }
.mb-4 { margin-bottom: 16px; }
.gap-2 { gap: 8px; }
.mono-input { font-family: var(--font-mono); font-size: 13px; }
.flex { display: flex; }
.flex-1 { flex: 1; }
.justify-between { justify-content: space-between; }
.items-center { align-items: center; }
.text-muted { color: var(--text-muted); }
.font-medium { font-weight: 500; }
.cursor-pointer { cursor: pointer; }

/* Actions */
.actions-row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.actions-mini {
  display: flex;
  gap: 4px;
}

/* 服务分组样式（常规设置中的启用选择器） */
.service-group-section {
  margin-bottom: 16px;
}

.service-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

/* 公共图床配置页分组样式 */
.public-group {
  margin-bottom: 8px;
}

.public-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.public-group-header i {
  color: var(--primary);
}

.service-cards-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.service-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

/* ========== 备份与同步样式 ========== */
.sub-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-section h3 i {
  color: var(--primary);
  font-size: 14px;
}

.backup-group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.backup-group:last-child {
  border-bottom: none;
}

.backup-group-label {
  width: 100px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.backup-actions {
  display: flex;
  gap: 8px;
}

.backup-status {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

/* ========== 历史记录上传下拉菜单 ========== */
.upload-dropdown-wrapper {
  position: relative;
  display: inline-block;
}

.upload-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 260px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.upload-menu-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.upload-menu-item:hover {
  background: var(--hover-overlay-subtle);
}

.upload-menu-item:first-child {
  border-bottom: 1px solid var(--border-subtle);
}

.upload-menu-item i {
  font-size: 16px;
  color: var(--primary);
  margin-top: 2px;
  flex-shrink: 0;
}

.menu-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item-title {
  font-size: 13px;
  font-weight: 500;
}

.menu-item-desc {
  font-size: 11px;
  color: var(--text-muted);
}

/* 下拉菜单过渡动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Password 组件眼睛图标放入框内 */
:deep(.p-password) {
  position: relative;
  display: flex;
  width: 100%;
}

:deep(.p-password .p-password-input) {
  width: 100%;
  padding-right: 40px; /* 为眼睛图标留出空间 */
}

:deep(.p-password .p-password-toggle-mask-btn) {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

:deep(.p-password .p-password-toggle-mask-btn:hover) {
  color: var(--text-main);
}
</style>
