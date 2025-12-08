<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { invoke } from '@tauri-apps/api/tauri';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Divider from 'primevue/divider';
import Tag from 'primevue/tag';
import { useToast } from '../../composables/useToast';
import { useThemeManager } from '../../composables/useTheme';
import { useConfigManager } from '../../composables/useConfig';
import type { ThemeMode, UserConfig, ServiceType } from '../../config/types';
import { DEFAULT_PREFIXES } from '../../config/types';

const toast = useToast();
const { currentTheme, setTheme } = useThemeManager();
const configManager = useConfigManager();

// --- 导航状态管理 ---
type SettingsTab = 'general' | 'weibo' | 'r2' | 'third_party' | 'builtin' | 'links' | 'webdav';
const activeTab = ref<SettingsTab>('general');

const tabs = [
  { id: 'general', label: '常规设置', icon: 'pi pi-cog' },
  { type: 'separator' },
  { type: 'label', label: '核心图床' },
  { id: 'weibo', label: '微博图床', icon: 'pi pi-star' },
  { id: 'r2', label: 'Cloudflare R2', icon: 'pi pi-cloud' },
  { type: 'separator' },
  { type: 'label', label: '其他服务' },
  { id: 'builtin', label: '内置图床', icon: 'pi pi-box' },
  { id: 'third_party', label: '第三方图床', icon: 'pi pi-globe' },
  { type: 'separator' },
  { type: 'label', label: '高级' },
  { id: 'links', label: '链接前缀', icon: 'pi pi-link' },
  { id: 'webdav', label: 'WebDAV 同步', icon: 'pi pi-sync' },
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

// 七鱼 Chrome 检测
const qiyuChromeInstalled = ref(false);
const isCheckingChrome = ref(false);
const checkQiyuChrome = async () => {
  isCheckingChrome.value = true;
  try { qiyuChromeInstalled.value = await invoke('check_chrome_installed'); }
  catch (e) { qiyuChromeInstalled.value = false; }
  finally { isCheckingChrome.value = false; }
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
const saveSettings = async () => {
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

    await configManager.saveConfig(updatedConfig);
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
const addPrefix = () => { formData.value.linkPrefixList.push(''); formData.value.selectedPrefixIndex = formData.value.linkPrefixList.length - 1; saveSettings(); };
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

// 监听 Cookie 更新
onMounted(async () => {
  await loadSettings();
  await checkQiyuChrome();
  await configManager.setupCookieListener(async (sid, cookie) => {
    if (sid === 'weibo') formData.value.weiboCookie = cookie;
    else if (['nowcoder', 'zhihu', 'nami'].includes(sid)) (formData.value as any)[sid].cookie = cookie;
    await saveSettings();
    toast.success('Cookie 已更新', `已自动捕获 ${serviceNames[sid as ServiceType]} Cookie`);
  });
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
          <div class="service-toggles-grid">
            <div
              v-for="svc in (['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami'] as ServiceType[])"
              :key="svc"
              class="toggle-chip"
            >
              <Checkbox :inputId="'svc-'+svc" v-model="availableServices" :value="svc" @change="saveSettings" />
              <label :for="'svc-'+svc">{{ serviceNames[svc] }}</label>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'weibo'" class="settings-section">
        <div class="section-header">
          <h2>微博图床</h2>
          <p class="section-desc">m.weibo.cn 接口配置。这是项目最核心的图床服务。</p>
        </div>

        <div class="info-block warning">
            <i class="pi pi-exclamation-circle"></i>
            <div>Cookie 有效期通常为 30 天，过期后请重新获取。</div>
        </div>

        <div class="form-group">
            <label>Cookie</label>
            <Textarea
                v-model="formData.weiboCookie"
                @blur="saveSettings"
                rows="6"
                class="mono-input w-full"
                placeholder="SUB=...; (粘贴完整 Cookie)"
            />
        </div>

        <div class="actions-row">
            <Button label="自动获取 Cookie" icon="pi pi-globe" @click="actions.login('weibo')" size="small" />
            <Button label="测试连接" icon="pi pi-check" @click="actions.weibo" :loading="testingConnections.weibo" severity="secondary" outlined size="small" />
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
                <Password v-model="formData.r2.accessKeyId" @blur="saveSettings" :feedback="false" toggleMask class="w-full" />
            </div>
            <div class="form-item">
                <label>Secret Access Key</label>
                <Password v-model="formData.r2.secretAccessKey" @blur="saveSettings" :feedback="false" toggleMask class="w-full" />
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
          <h2>内置图床</h2>
          <p class="section-desc">开箱即用的免费图床服务，无需复杂配置。</p>
        </div>

        <div class="service-card-flat">
            <div class="sc-icon"><i class="pi pi-image"></i></div>
            <div class="sc-content">
                <h3>TCL 图床</h3>
                <p>无需配置，直接使用。支持 JPG/PNG/GIF。</p>
                <Tag value="开箱即用" severity="success" />
            </div>
        </div>

        <div class="service-card-flat">
            <div class="sc-icon"><i class="pi pi-shopping-bag"></i></div>
            <div class="sc-content">
                <h3>京东图床</h3>
                <p>速度极快，CDN 全球分发。最大支持 15MB。</p>
                <Tag value="推荐" severity="info" />
            </div>
        </div>
      </div>

      <div v-if="activeTab === 'third_party'" class="settings-section">
        <div class="section-header">
          <h2>第三方图床</h2>
          <p class="section-desc">利用第三方平台的接口进行上传，需提供 Cookie。</p>
        </div>

        <div class="sub-section">
            <h3>七鱼图床</h3>
            <div class="info-block" :class="qiyuChromeInstalled ? 'success' : 'danger'">
                <i class="pi" :class="qiyuChromeInstalled ? 'pi-check-circle' : 'pi-times-circle'"></i>
                <div>
                    {{ qiyuChromeInstalled ? '已检测到 Chrome/Edge 浏览器，功能正常。' : '未检测到 Chrome/Edge，无法自动获取 Token。' }}
                </div>
                <Button v-if="!qiyuChromeInstalled" label="重试" @click="checkQiyuChrome" :loading="isCheckingChrome" size="small" text />
            </div>
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
            <Textarea v-model="formData.nowcoder.cookie" @blur="saveSettings" rows="2" class="mono-input w-full" placeholder="牛客 Cookie..." />
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
            <Textarea v-model="formData.zhihu.cookie" @blur="saveSettings" rows="2" class="mono-input w-full" placeholder="知乎 Cookie..." />
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
            <Textarea v-model="formData.nami.cookie" @blur="saveSettings" rows="2" class="mono-input w-full" placeholder="纳米 Cookie..." />
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
                <RadioButton v-model="formData.selectedPrefixIndex" :value="idx" :inputId="'p-'+idx" @change="saveSettings" />
                <InputText v-model="formData.linkPrefixList[idx]" @blur="saveSettings" class="flex-1" />
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
          <h2>WebDAV 同步</h2>
          <p class="section-desc">自动将上传历史记录同步到坚果云、Nextcloud 等服务。</p>
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
</style>
