<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { invoke } from '@tauri-apps/api/tauri';
import Card from 'primevue/card';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import Checkbox from 'primevue/checkbox';
import SelectButton from 'primevue/selectbutton';
import RadioButton from 'primevue/radiobutton';
import Message from 'primevue/message';
import Divider from 'primevue/divider';
import { useToast } from '../../composables/useToast';
import { useThemeManager } from '../../composables/useTheme';
import { useConfigManager } from '../../composables/useConfig';
import type { ThemeMode, UserConfig, ServiceType } from '../../config/types';
import { DEFAULT_PREFIXES, getActivePrefix } from '../../config/types';

const toast = useToast();
const { currentTheme, setTheme } = useThemeManager();
const configManager = useConfigManager();

// 主题选项
const themeOptions = ref([
  { label: '亮色', value: 'light' as ThemeMode, icon: 'pi pi-sun' },
  { label: '深色', value: 'dark' as ThemeMode, icon: 'pi pi-moon' }
]);

// 当前选中的主题
const selectedTheme = ref<ThemeMode>(currentTheme.value);

// 主题切换处理
const handleThemeChange = async (value: ThemeMode) => {
  try {
    await setTheme(value);
    selectedTheme.value = value;
    toast.success('主题已切换', `已切换到${value === 'light' ? '亮色' : '深色'}主题`);
  } catch (error) {
    toast.error('主题切换失败', String(error));
  }
};

// 本地表单数据（用于 v-model 绑定）
const formData = ref({
  weiboCookie: '',
  r2: {
    accountId: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    path: '',
    publicDomain: ''
  },
  nowcoder: {
    cookie: ''
  },
  zhihu: {
    cookie: ''
  },
  nami: {
    cookie: ''
  },
  webdav: {
    url: '',
    username: '',
    password: '',
    remotePath: '/WeiboDR/history.json'
  },
  linkPrefixEnabled: true,
  selectedPrefixIndex: 0,
  linkPrefixList: [...DEFAULT_PREFIXES]
});

// 可用图床列表（控制上传界面显示哪些图床）
const availableServices = ref<ServiceType[]>([
  'weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami'
]);

// 图床名称映射
const serviceNames: Record<ServiceType, string> = {
  weibo: '微博图床',
  r2: 'Cloudflare R2',
  tcl: 'TCL 图床',
  jd: '京东图床',
  nowcoder: '牛客图床',
  qiyu: '七鱼图床',
  zhihu: '知乎图床',
  nami: '纳米图床'
};

// 测试连接按钮加载状态
const testingConnections = ref<Record<string, boolean>>({
  weibo: false,
  r2: false,
  nowcoder: false,
  zhihu: false,
  nami: false,
  webdav: false
});

// 七鱼 Chrome 检测状态
const qiyuChromeInstalled = ref<boolean>(false);
const isCheckingChrome = ref<boolean>(false);

// Chrome 状态颜色（绿色=已安装，红色=未安装）
const chromeStatusColor = computed(() => {
  if (qiyuChromeInstalled.value) return '#22c55e'; // 绿色
  return '#ef4444'; // 红色
});

// Chrome 状态文本
const chromeStatusText = computed(() => {
  if (qiyuChromeInstalled.value) return '已检测到 Chrome/Edge ✓';
  return '未检测到 Chrome/Edge';
});

// 检测 Chrome/Edge 是否安装
async function checkQiyuChrome(): Promise<void> {
  isCheckingChrome.value = true;
  try {
    console.log('[七鱼] 正在检测 Chrome/Edge 浏览器...');
    qiyuChromeInstalled.value = await invoke<boolean>('check_chrome_installed');
    console.log('[七鱼] Chrome 检测结果:', qiyuChromeInstalled.value);
  } catch (error) {
    console.error('[七鱼] Chrome 检测失败:', error);
    qiyuChromeInstalled.value = false;
  } finally {
    isCheckingChrome.value = false;
  }
}

// 加载配置
const loadSettings = async () => {
  try {
    const loadedConfig = await configManager.loadConfig();

    // 填充表单数据
    formData.value.weiboCookie = loadedConfig.services?.weibo?.cookie || '';
    formData.value.r2.accountId = loadedConfig.services?.r2?.accountId || '';
    formData.value.r2.accessKeyId = loadedConfig.services?.r2?.accessKeyId || '';
    formData.value.r2.secretAccessKey = loadedConfig.services?.r2?.secretAccessKey || '';
    formData.value.r2.bucketName = loadedConfig.services?.r2?.bucketName || '';
    formData.value.r2.path = loadedConfig.services?.r2?.path || '';
    formData.value.r2.publicDomain = loadedConfig.services?.r2?.publicDomain || '';
    formData.value.nowcoder.cookie = loadedConfig.services?.nowcoder?.cookie || '';
    formData.value.zhihu.cookie = loadedConfig.services?.zhihu?.cookie || '';
    formData.value.nami.cookie = loadedConfig.services?.nami?.cookie || '';
    formData.value.webdav.url = loadedConfig.webdav?.url || '';
    formData.value.webdav.username = loadedConfig.webdav?.username || '';
    formData.value.webdav.password = loadedConfig.webdav?.password || '';
    formData.value.webdav.remotePath = loadedConfig.webdav?.remotePath || '/WeiboDR/history.json';

    // 加载可用图床列表
    if (loadedConfig.availableServices && loadedConfig.availableServices.length > 0) {
      availableServices.value = [...loadedConfig.availableServices];
    }

    // 加载链接前缀配置
    if (loadedConfig.linkPrefixConfig) {
      formData.value.linkPrefixEnabled = loadedConfig.linkPrefixConfig.enabled;
      formData.value.selectedPrefixIndex = loadedConfig.linkPrefixConfig.selectedIndex;
      formData.value.linkPrefixList = [...loadedConfig.linkPrefixConfig.prefixList];
    } else {
      // 兼容旧配置
      formData.value.linkPrefixList = [...DEFAULT_PREFIXES];
      formData.value.linkPrefixEnabled = true;
      formData.value.selectedPrefixIndex = 0;
    }

    console.log('[SettingsView] 配置已加载到表单');
  } catch (error) {
    console.error('[SettingsView] 加载配置失败:', error);
  }
};

// 保存配置（自动保存，失去焦点时触发）
const saveSettings = async () => {
  try {
    // 构建完整的配置对象
    const currentConfig = configManager.config.value;

    const updatedConfig: UserConfig = {
      ...currentConfig,
      availableServices: [...availableServices.value],
      services: {
        ...currentConfig.services,
        weibo: {
          enabled: currentConfig.services?.weibo?.enabled ?? false,
          cookie: formData.value.weiboCookie.trim()
        },
        r2: {
          enabled: currentConfig.services?.r2?.enabled ?? false,
          accountId: formData.value.r2.accountId.trim(),
          accessKeyId: formData.value.r2.accessKeyId.trim(),
          secretAccessKey: formData.value.r2.secretAccessKey.trim(),
          bucketName: formData.value.r2.bucketName.trim(),
          path: formData.value.r2.path.trim(),
          publicDomain: formData.value.r2.publicDomain.trim()
        },
        tcl: currentConfig.services?.tcl || { enabled: false },
        jd: currentConfig.services?.jd || { enabled: false },
        nowcoder: {
          enabled: currentConfig.services?.nowcoder?.enabled ?? false,
          cookie: formData.value.nowcoder.cookie.trim()
        },
        qiyu: currentConfig.services?.qiyu || { enabled: false },
        zhihu: {
          enabled: currentConfig.services?.zhihu?.enabled ?? false,
          cookie: formData.value.zhihu.cookie.trim()
        },
        nami: (() => {
          const cookie = formData.value.nami.cookie.trim();
          // 从 Cookie 中提取 Auth-Token
          const authTokenMatch = cookie.match(/Auth-Token=([^;]+)/);
          const extractedAuthToken = authTokenMatch ? authTokenMatch[1] : '';
          return {
            enabled: currentConfig.services?.nami?.enabled ?? false,
            cookie: cookie,
            authToken: extractedAuthToken || currentConfig.services?.nami?.authToken || ''
          };
        })()
      },
      webdav: {
        url: formData.value.webdav.url.trim(),
        username: formData.value.webdav.username.trim(),
        password: formData.value.webdav.password.trim(),
        remotePath: formData.value.webdav.remotePath.trim()
      },
      linkPrefixConfig: {
        enabled: formData.value.linkPrefixEnabled,
        selectedIndex: formData.value.selectedPrefixIndex,
        prefixList: formData.value.linkPrefixList.filter(p => p.trim() !== '')
      }
    };

    await configManager.saveConfig(updatedConfig);
    console.log('[SettingsView] 配置已自动保存');
  } catch (error) {
    console.error('[SettingsView] 保存配置失败:', error);
  }
};

// 测试连接函数
const testWeiboConnection = async () => {
  testingConnections.value.weibo = true;
  try {
    const result = await configManager.testWeiboConnection(formData.value.weiboCookie);
    if (result.success) {
      toast.success('测试成功', result.message);
    } else {
      toast.error('测试失败', result.message);
    }
  } finally {
    testingConnections.value.weibo = false;
  }
};

const testR2Connection = async () => {
  testingConnections.value.r2 = true;
  try {
    const result = await configManager.testR2Connection({
      accountId: formData.value.r2.accountId,
      accessKeyId: formData.value.r2.accessKeyId,
      secretAccessKey: formData.value.r2.secretAccessKey,
      bucketName: formData.value.r2.bucketName,
      path: formData.value.r2.path,
      publicDomain: formData.value.r2.publicDomain
    });
    if (result.success) {
      toast.success('测试成功', result.message);
    } else {
      toast.error('测试失败', result.message);
    }
  } finally {
    testingConnections.value.r2 = false;
  }
};

const testNowcoderConnection = async () => {
  testingConnections.value.nowcoder = true;
  try {
    const result = await configManager.testNowcoderConnection(formData.value.nowcoder.cookie);
    if (result.success) {
      toast.success('测试成功', result.message);
    } else {
      toast.error('测试失败', result.message);
    }
  } finally {
    testingConnections.value.nowcoder = false;
  }
};

const testZhihuConnection = async () => {
  testingConnections.value.zhihu = true;
  try {
    const result = await configManager.testZhihuConnection(formData.value.zhihu.cookie);
    if (result.success) {
      toast.success('测试成功', result.message);
    } else {
      toast.error('测试失败', result.message);
    }
  } finally {
    testingConnections.value.zhihu = false;
  }
};

const testNamiConnection = async () => {
  testingConnections.value.nami = true;
  try {
    const result = await configManager.testNamiConnection(formData.value.nami.cookie);
    if (result.success) {
      toast.success('测试成功', result.message);
    } else {
      toast.error('测试失败', result.message);
    }
  } finally {
    testingConnections.value.nami = false;
  }
};

const testWebdavConnection = async () => {
  testingConnections.value.webdav = true;
  try {
    const result = await configManager.testWebDAVConnection({
      url: formData.value.webdav.url,
      username: formData.value.webdav.username,
      password: formData.value.webdav.password,
      remotePath: formData.value.webdav.remotePath
    });
    if (result.success) {
      toast.success('测试成功', result.message);
    } else {
      toast.error('测试失败', result.message);
    }
  } finally {
    testingConnections.value.webdav = false;
  }
};

// 自动获取 Cookie 函数
const loginWithWebview = async () => {
  await configManager.openCookieWebView('weibo' as ServiceType);
};

const loginNowcoder = async () => {
  await configManager.openCookieWebView('nowcoder' as ServiceType);
};

const loginZhihu = async () => {
  await configManager.openCookieWebView('zhihu' as ServiceType);
};

const loginNami = async () => {
  await configManager.openCookieWebView('nami' as ServiceType);
};

// 链接前缀管理函数
const addCustomPrefix = async () => {
  formData.value.linkPrefixList.push('');
  formData.value.selectedPrefixIndex = formData.value.linkPrefixList.length - 1;
  await saveSettings();
};

const removePrefix = async (index: number) => {
  if (formData.value.linkPrefixList.length <= 1) {
    toast.warn('至少保留一个前缀', '不能删除最后一个前缀');
    return;
  }

  formData.value.linkPrefixList.splice(index, 1);

  // 调整选中索引
  if (formData.value.selectedPrefixIndex >= formData.value.linkPrefixList.length) {
    formData.value.selectedPrefixIndex = formData.value.linkPrefixList.length - 1;
  }

  await saveSettings();
  toast.success('删除成功', '前缀已删除');
};

const resetToDefaultPrefixes = async () => {
  formData.value.linkPrefixList = [...DEFAULT_PREFIXES];
  formData.value.selectedPrefixIndex = 0;
  await saveSettings();
  toast.success('恢复成功', '已恢复为默认前缀');
};

// Cookie 更新处理
const handleCookieUpdate = async (serviceId: string, cookie: string) => {
  console.log(`[SettingsView] 处理 ${serviceId} Cookie 更新`);

  // 更新对应的表单字段
  switch (serviceId) {
    case 'weibo':
      formData.value.weiboCookie = cookie;
      break;
    case 'nowcoder':
      formData.value.nowcoder.cookie = cookie;
      break;
    case 'zhihu':
      formData.value.zhihu.cookie = cookie;
      break;
    case 'nami':
      formData.value.nami.cookie = cookie;
      break;
    default:
      console.warn(`[SettingsView] 未知的服务类型: ${serviceId}`);
      return;
  }

  // 自动保存配置
  await saveSettings();
};

onMounted(async () => {
  // 加载配置
  await loadSettings();

  // 检测七鱼图床所需的 Chrome/Edge 浏览器
  await checkQiyuChrome();

  // 设置 Cookie 更新监听器
  await configManager.setupCookieListener(handleCookieUpdate);
  console.log('[SettingsView] Cookie 监听器已设置');
});
</script>

<template>
  <div class="settings-view">
    <div class="settings-container">
      <h1 class="settings-title">设置</h1>

      <!-- 主题设置 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-palette"></i>
            <span>外观主题</span>
          </div>
        </template>
        <template #content>
          <div class="theme-selector-container">
            <SelectButton
              v-model="selectedTheme"
              @update:modelValue="handleThemeChange"
              :options="themeOptions"
              optionLabel="label"
              optionValue="value"
              class="theme-selector"
            >
              <template #option="slotProps">
                <div class="theme-option">
                  <i :class="slotProps.option.icon"></i>
                  <span>{{ slotProps.option.label }}</span>
                </div>
              </template>
            </SelectButton>
            <p class="hint">选择您偏好的界面主题，设置会自动保存</p>
          </div>
        </template>
      </Card>

      <Divider />

      <!-- 微博 Cookie 配置 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-user"></i>
            <span>微博 Cookie</span>
            <span class="required-badge">必填</span>
          </div>
        </template>
        <template #content>
          <p class="card-description">用于 m.weibo.cn 接口。这是项目成功的关键。</p>

          <div class="button-group">
            <Button
              label="自动获取Cookie"
              icon="pi pi-globe"
              @click="loginWithWebview"
              outlined
              class="flex-1"
            />
            <Button
              :label="testingConnections.weibo ? '测试中...' : '测试连接'"
              icon="pi pi-check-circle"
              @click="testWeiboConnection"
              :loading="testingConnections.weibo"
              outlined
              class="flex-1"
            />
          </div>

          <Textarea
            v-model="formData.weiboCookie"
            @blur="saveSettings"
            rows="5"
            placeholder="在此粘贴从 m.weibo.cn 获取的完整 Cookie 字符串...或点击上方'自动获取Cookie'按钮"
            class="w-full"
          />
        </template>
      </Card>

      <!-- Cloudflare R2 配置 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-cloud"></i>
            <span>Cloudflare R2 配置</span>
            <span class="optional-badge">可选</span>
          </div>
        </template>
        <template #content>
          <p class="card-description">微博上传成功后,将图片异步备份到 R2。</p>

          <div class="form-field">
            <label for="r2-account-id">R2 账户 ID (Account ID)</label>
            <InputText
              id="r2-account-id"
              v-model="formData.r2.accountId"
              @blur="saveSettings"
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="r2-key-id">R2 访问密钥 ID (Access Key ID)</label>
            <Password
              id="r2-key-id"
              v-model="formData.r2.accessKeyId"
              @blur="saveSettings"
              :feedback="false"
              toggleMask
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="r2-secret-key">R2 访问密钥 (Secret Access Key)</label>
            <Password
              id="r2-secret-key"
              v-model="formData.r2.secretAccessKey"
              @blur="saveSettings"
              :feedback="false"
              toggleMask
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="r2-bucket">R2 存储桶名称 (Bucket Name)</label>
            <InputText
              id="r2-bucket"
              v-model="formData.r2.bucketName"
              @blur="saveSettings"
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="r2-path">R2 自定义路径 (Optional Path)</label>
            <InputText
              id="r2-path"
              v-model="formData.r2.path"
              @blur="saveSettings"
              placeholder="例如: blog/images/ (留空则为根目录)"
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="r2-public-domain">R2 公开访问域名 (Public Domain)</label>
            <InputText
              id="r2-public-domain"
              v-model="formData.r2.publicDomain"
              @blur="saveSettings"
              placeholder="例如: https://images.example.com (末尾不要加 /)"
              class="w-full"
            />
          </div>

          <Button
            :label="testingConnections.r2 ? '测试中...' : '测试 R2 连接'"
            icon="pi pi-check-circle"
            @click="testR2Connection"
            :loading="testingConnections.r2"
            outlined
          />
        </template>
      </Card>

      <!-- TCL 图床 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-image"></i>
            <span>TCL 图床</span>
          </div>
        </template>
        <template #content>
          <Message severity="success" :closable="false">
            TCL 图床无需配置，开箱即用
          </Message>
          <Message severity="info" :closable="false">
            支持格式：JPG、JPEG、PNG、GIF
          </Message>
          <Message severity="warn" :closable="false">
            注意：TCL 为第三方免费服务，稳定性无保障
          </Message>
        </template>
      </Card>

      <!-- 京东图床 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-image"></i>
            <span>京东图床</span>
          </div>
        </template>
        <template #content>
          <Message severity="success" :closable="false">
            京东图床无需配置，开箱即用
          </Message>
          <Message severity="info" :closable="false">
            支持格式：JPG、JPEG、PNG、GIF，文件大小限制：15MB
          </Message>
          <Message severity="warn" :closable="false">
            注意：京东为第三方免费服务，稳定性无保障
          </Message>
        </template>
      </Card>

      <!-- 七鱼图床 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-image"></i>
            <span>七鱼图床</span>
          </div>
        </template>
        <template #content>
          <Message severity="success" :closable="false">
            七鱼图床无需手动配置 Token，通过浏览器自动获取
          </Message>
          <Message severity="info" :closable="false">
            使用前提：系统需要安装 Chrome 或 Edge 浏览器
          </Message>

          <!-- Chrome 检测状态 -->
          <div class="chrome-status-container">
            <div class="status-row">
              <span class="status-label">浏览器检测状态：</span>
              <div class="status-indicator">
                <div
                  class="status-dot"
                  :style="{ background: chromeStatusColor }"
                ></div>
                <span>{{ chromeStatusText }}</span>
              </div>
            </div>
            <Button
              label="重新检测"
              icon="pi pi-refresh"
              @click="checkQiyuChrome"
              :loading="isCheckingChrome"
              size="small"
              outlined
            />
          </div>

          <Message v-if="!qiyuChromeInstalled" severity="warn" :closable="false">
            未检测到 Chrome/Edge，七鱼图床将无法使用
          </Message>
        </template>
      </Card>

      <!-- 牛客图床 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-image"></i>
            <span>牛客图床</span>
          </div>
        </template>
        <template #content>
          <Message severity="info" :closable="false">
            支持格式：JPG、JPEG、PNG、GIF
          </Message>
          <Message severity="warn" :closable="false">
            注意：牛客为第三方服务，需要 Cookie 认证，稳定性无保障
          </Message>

          <div class="button-group">
            <Button
              label="自动获取Cookie"
              icon="pi pi-globe"
              @click="loginNowcoder"
              outlined
              class="flex-1"
            />
            <Button
              :label="testingConnections.nowcoder ? '测试中...' : '测试连接'"
              icon="pi pi-check-circle"
              @click="testNowcoderConnection"
              :loading="testingConnections.nowcoder"
              outlined
              class="flex-1"
            />
          </div>

          <div class="form-field">
            <label for="nowcoder-cookie">牛客 Cookie</label>
            <Textarea
              id="nowcoder-cookie"
              v-model="formData.nowcoder.cookie"
              @blur="saveSettings"
              rows="4"
              placeholder="请输入牛客网 Cookie...&#10;需要包含 NOWCODERUID 和 t 字段"
              class="w-full"
            />
            <p class="hint">
              💡 提示：点击上方"自动获取Cookie"按钮，或手动复制：登录 nowcoder.com 后，在浏览器开发者工具 (F12) → Network → 任意请求 → Headers → Cookie 中复制
            </p>
          </div>
        </template>
      </Card>

      <!-- 知乎图床 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-image"></i>
            <span>知乎图床</span>
          </div>
        </template>
        <template #content>
          <Message severity="info" :closable="false">
            支持格式：JPG、JPEG、PNG、GIF、WebP
          </Message>
          <Message severity="warn" :closable="false">
            注意：知乎为第三方服务，需要 Cookie 认证，稳定性无保障
          </Message>

          <div class="button-group">
            <Button
              label="自动获取Cookie"
              icon="pi pi-globe"
              @click="loginZhihu"
              outlined
              class="flex-1"
            />
            <Button
              :label="testingConnections.zhihu ? '测试中...' : '测试连接'"
              icon="pi pi-check-circle"
              @click="testZhihuConnection"
              :loading="testingConnections.zhihu"
              outlined
              class="flex-1"
            />
          </div>

          <div class="form-field">
            <label for="zhihu-cookie">知乎 Cookie</label>
            <Textarea
              id="zhihu-cookie"
              v-model="formData.zhihu.cookie"
              @blur="saveSettings"
              rows="4"
              placeholder="请输入知乎 Cookie...&#10;需要包含 z_c0 字段"
              class="w-full"
            />
            <p class="hint">
              💡 提示：点击上方"自动获取Cookie"按钮，或手动复制：登录 zhihu.com 后，在浏览器开发者工具 (F12) → Network → 任意请求 → Headers → Cookie 中复制
            </p>
          </div>
        </template>
      </Card>

      <!-- 纳米图床 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-image"></i>
            <span>纳米图床</span>
          </div>
        </template>
        <template #content>
          <Message severity="info" :closable="false">
            支持格式：JPG、JPEG、PNG、GIF、WebP、BMP
          </Message>
          <Message severity="warn" :closable="false">
            注意：纳米为第三方服务，需要 Cookie 认证，稳定性无保障
          </Message>

          <div class="button-group">
            <Button
              label="自动获取Cookie"
              icon="pi pi-globe"
              @click="loginNami"
              outlined
              class="flex-1"
            />
            <Button
              :label="testingConnections.nami ? '测试中...' : '测试连接'"
              icon="pi pi-check-circle"
              @click="testNamiConnection"
              :loading="testingConnections.nami"
              outlined
              class="flex-1"
            />
          </div>

          <div class="form-field">
            <label for="nami-cookie">纳米 Cookie</label>
            <Textarea
              id="nami-cookie"
              v-model="formData.nami.cookie"
              @blur="saveSettings"
              rows="4"
              placeholder="请输入纳米 Cookie...&#10;需要包含 Auth-Token 字段"
              class="w-full"
            />
            <p class="hint">
              💡 提示：点击上方"自动获取Cookie"按钮，登录后会自动获取 Cookie 和 Auth-Token
            </p>
          </div>
        </template>
      </Card>

      <!-- 微博链接前缀配置 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-link"></i>
            <span>微博链接前缀配置</span>
            <span class="optional-badge">可选</span>
          </div>
        </template>

        <template #content>
          <Message severity="info" :closable="false">
            链接前缀用于解决微博图片防盗链问题。启用后，复制的链接会自动添加代理前缀。
          </Message>

          <!-- 启用/禁用开关 -->
          <div class="form-field">
            <div class="field-checkbox">
              <Checkbox
                v-model="formData.linkPrefixEnabled"
                inputId="link-prefix-enabled"
                :binary="true"
                @change="saveSettings"
              />
              <label for="link-prefix-enabled" class="checkbox-label">启用链接前缀</label>
            </div>
          </div>

          <!-- 前缀列表管理 -->
          <div v-if="formData.linkPrefixEnabled" class="prefix-manager">
            <h3 class="prefix-manager-title">前缀列表</h3>

            <!-- 前缀选择（单选） -->
            <div
              v-for="(prefix, index) in formData.linkPrefixList"
              :key="index"
              class="prefix-item"
            >
              <RadioButton
                v-model="formData.selectedPrefixIndex"
                :inputId="`prefix-${index}`"
                :value="index"
                @change="saveSettings"
              />
              <InputText
                v-model="formData.linkPrefixList[index]"
                class="prefix-input"
                placeholder="输入前缀 URL..."
                @blur="saveSettings"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                rounded
                @click="removePrefix(index)"
                :disabled="formData.linkPrefixList.length <= 1"
                v-tooltip.top="'删除此前缀'"
              />
            </div>

            <!-- 添加新前缀按钮 -->
            <Button
              label="添加自定义前缀"
              icon="pi pi-plus"
              outlined
              @click="addCustomPrefix"
              class="add-prefix-btn"
            />

            <!-- 恢复默认按钮 -->
            <Button
              label="恢复默认前缀"
              icon="pi pi-refresh"
              severity="secondary"
              outlined
              @click="resetToDefaultPrefixes"
              class="reset-prefix-btn"
            />
          </div>
        </template>
      </Card>

      <!-- 支持的图床 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-eye"></i>
            <span>支持的图床</span>
          </div>
        </template>
        <template #content>
          <p class="card-description">选择在上传界面显示的图床，取消勾选的图床不会出现在上传选项中。</p>

          <div class="available-services-grid">
            <div
              v-for="service in (['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami'] as ServiceType[])"
              :key="service"
              class="service-toggle-item"
            >
              <Checkbox
                :inputId="`available-${service}`"
                v-model="availableServices"
                :value="service"
                @change="saveSettings"
              />
              <label :for="`available-${service}`" class="service-toggle-label">
                {{ serviceNames[service] }}
              </label>
            </div>
          </div>
        </template>
      </Card>

      <Divider />

      <!-- WebDAV 配置 -->
      <Card class="settings-card">
        <template #title>
          <div class="card-title">
            <i class="pi pi-sync"></i>
            <span>WebDAV 配置</span>
            <span class="optional-badge">可选</span>
          </div>
        </template>
        <template #content>
          <p class="card-description">配置后，每次上传成功会自动将历史记录同步到 WebDAV（例如：坚果云）。</p>

          <div class="form-field">
            <label for="webdav-url">WebDAV URL</label>
            <InputText
              id="webdav-url"
              v-model="formData.webdav.url"
              @blur="saveSettings"
              placeholder="例如: https://dav.jianguoyun.com/dav/"
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="webdav-username">WebDAV 用户名</label>
            <InputText
              id="webdav-username"
              v-model="formData.webdav.username"
              @blur="saveSettings"
              placeholder="通常是邮箱"
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="webdav-password">WebDAV 密码</label>
            <Password
              id="webdav-password"
              v-model="formData.webdav.password"
              @blur="saveSettings"
              :feedback="false"
              toggleMask
              placeholder="通常是应用的授权码"
              class="w-full"
            />
          </div>

          <div class="form-field">
            <label for="webdav-remote-path">
              远程路径
              <span class="hint-inline">(将覆盖同名文件)</span>
            </label>
            <InputText
              id="webdav-remote-path"
              v-model="formData.webdav.remotePath"
              @blur="saveSettings"
              placeholder="例如: /WeiboDR/history.json 或 /WeiboDR/"
              class="w-full"
            />
            <p class="hint">
              💡 提示：支持完整路径（如 /path/history.json）或目录（如 /path/，自动存为 history.json）。同步将覆盖旧文件。
            </p>
          </div>

          <Button
            :label="testingConnections.webdav ? '测试中...' : '测试 WebDAV 连接'"
            icon="pi pi-check-circle"
            @click="testWebdavConnection"
            :loading="testingConnections.webdav"
            outlined
          />
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px;
  background: var(--bg-app);
}

.settings-container {
  max-width: 900px;
  margin: 0 auto;
}

.settings-title {
  font-size: 2rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 24px 0;
}

.settings-card {
  margin-bottom: 20px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.card-title i {
  color: var(--primary);
  font-size: 1.5rem;
}

.required-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  background: var(--error);
  color: var(--text-on-error);
  border-radius: 12px;
  font-weight: 500;
}

.optional-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  background: var(--text-muted);
  color: var(--text-on-muted);
  border-radius: 12px;
  font-weight: 500;
}

.card-description {
  color: var(--text-secondary);
  margin: 0 0 16px 0;
  font-size: 0.95rem;
}

.form-field {
  margin-bottom: 16px;
}

.form-field label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.hint-inline {
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 400;
}

.hint {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-top: 6px;
  line-height: 1.5;
}

.button-group {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.flex-1 {
  flex: 1;
}

.w-full {
  width: 100%;
}

/* 主题选择器样式 */
.theme-selector-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.theme-selector {
  width: fit-content;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
}

.theme-option i {
  font-size: 1.1rem;
}

/* 链接前缀管理样式 */
.field-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
}

.checkbox-label {
  cursor: pointer;
  font-weight: 500;
  color: var(--text-primary);
  user-select: none;
}

.prefix-manager {
  margin-top: 16px;
}

.prefix-manager-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
}

.prefix-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.prefix-input {
  flex: 1;
}

.add-prefix-btn {
  width: 100%;
  margin-top: 8px;
  margin-bottom: 8px;
}

.reset-prefix-btn {
  width: 100%;
}

/* 可用图床网格布局 */
.available-services-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.service-toggle-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  transition: all 0.2s ease;
  cursor: pointer;
}

.service-toggle-item:hover {
  background: var(--bg-input);
  border-color: var(--primary);
}

.service-toggle-label {
  cursor: pointer;
  font-size: 0.95rem;
  color: var(--text-primary);
  user-select: none;
  flex: 1;
}

/* PrimeVue Message 组件间距 */
:deep(.p-message) {
  margin-bottom: 12px;
}

:deep(.p-message:last-child) {
  margin-bottom: 0;
}

/* PrimeVue Password 组件全宽 */
:deep(.p-password) {
  width: 100%;
}

:deep(.p-password-input) {
  width: 100%;
}

/* 滚动条样式 */
.settings-view::-webkit-scrollbar {
  width: 8px;
}

.settings-view::-webkit-scrollbar-track {
  background: var(--bg-input);
}

.settings-view::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.settings-view::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* 七鱼 Chrome 检测状态样式 */
.chrome-status-container {
  margin-top: 16px;
  padding: 12px;
  background: var(--surface-ground);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-label {
  font-weight: 500;
  color: var(--text-color);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  transition: background-color 0.3s;
}
</style>
