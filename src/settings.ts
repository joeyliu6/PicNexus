// src/settings.ts
import { Store } from './store';
import { ResponseType, getClient } from '@tauri-apps/api/http';
import { appWindow } from '@tauri-apps/api/window';
import { UserConfig, DEFAULT_CONFIG } from './config';

// 初始化安全存储
// .settings.dat 会被加密存储在 Tauri 的应用数据目录中
const configStore = new Store('.settings.dat');

// DOM 元素
const weiboCookieEl = document.getElementById('weibo-cookie') as HTMLTextAreaElement;
const testCookieBtn = document.getElementById('test-cookie-btn') as HTMLButtonElement;
const cookieStatusEl = document.getElementById('cookie-status')!;

const r2AccountIdEl = document.getElementById('r2-account-id') as HTMLInputElement;
const r2KeyIdEl = document.getElementById('r2-key-id') as HTMLInputElement;
const r2SecretKeyEl = document.getElementById('r2-secret-key') as HTMLInputElement;
const r2BucketEl = document.getElementById('r2-bucket') as HTMLInputElement;
const r2PathEl = document.getElementById('r2-path') as HTMLInputElement;
const r2PublicDomainEl = document.getElementById('r2-public-domain') as HTMLInputElement;

const baiduPrefixEl = document.getElementById('baidu-prefix') as HTMLInputElement;

const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const saveStatusEl = document.getElementById('save-status')!;

// 加载配置并填充表单
async function loadSettings() {
  let config = await configStore.get<UserConfig>('config');
  if (!config) {
    config = DEFAULT_CONFIG;
  }

  weiboCookieEl.value = config.weiboCookie || '';
  r2AccountIdEl.value = config.r2.accountId || '';
  r2KeyIdEl.value = config.r2.accessKeyId || '';
  r2SecretKeyEl.value = config.r2.secretAccessKey || '';
  r2BucketEl.value = config.r2.bucketName || '';
  r2PathEl.value = config.r2.path || '';
  r2PublicDomainEl.value = config.r2.publicDomain || '';
  baiduPrefixEl.value = config.baiduPrefix || DEFAULT_CONFIG.baiduPrefix;
  
  // 设置单选框
  const format = config.outputFormat || 'baidu';
  (document.getElementById(`format-${format}`) as HTMLInputElement).checked = true;
}

// 保存表单数据到存储
async function saveSettings() {
  saveStatusEl.textContent = '保存中...';
  const format = 
    (document.querySelector('input[name="output-format"]:checked') as HTMLInputElement)?.value 
    || 'baidu';

  // 校验 R2 公开域名
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
  };

  try {
    await configStore.set('config', config);
    await configStore.save(); // 确保写入磁盘
    saveStatusEl.textContent = '✅ 已保存！';
    
    // 延迟后关闭窗口
    setTimeout(() => {
      appWindow.close();
    }, 1000);

  } catch (err) {
    saveStatusEl.textContent = `❌ 保存失败: ${err}`;
  }
}

// 测试 Cookie (PRD 3.2)
// 逻辑基于 weibo-picture-store/src/scripts/weibo/author.ts
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
    // 提取错误信息
    const errorStr = err?.toString() || String(err) || '';
    const errorMsg = err?.message || errorStr || '';
    const fullError = (errorMsg + ' ' + errorStr).toLowerCase();
    
    console.error('Cookie 测试错误详情:', err); // 保持在控制台打印完整错误

    // 根据错误类型显示更详细的错误信息
    let displayMessage = '';
    
    if (fullError.includes('json') || fullError.includes('parse')) {
      displayMessage = '❌ 测试失败: Cookie 完全无效或格式错误 (无法解析响应)';
    } else if (fullError.includes('network') || fullError.includes('fetch') || fullError.includes('connection')) {
      displayMessage = '❌ 测试失败: 请检查您的网络连接或防火墙设置';
    } else if (fullError.includes('timeout') || fullError.includes('timed out')) {
      displayMessage = '❌ 测试失败: 请求超时，请检查网络连接';
    } else if (fullError.includes('cors') || fullError.includes('cross-origin')) {
      displayMessage = '❌ 测试失败: CORS 跨域错误';
    } else if (fullError.includes('ssl') || fullError.includes('certificate') || fullError.includes('tls')) {
      displayMessage = '❌ 测试失败: SSL/TLS 证书错误';
    } else if (fullError.includes('403') || fullError.includes('forbidden')) {
      displayMessage = '❌ 测试失败: 访问被拒绝 (403)，Cookie 可能无效';
    } else if (fullError.includes('401') || fullError.includes('unauthorized')) {
      displayMessage = '❌ 测试失败: 未授权 (401)，Cookie 已过期或无效';
    } else {
      // 显示原始错误信息的一部分（最多 100 个字符）
      const shortError = errorMsg || errorStr || '未知错误';
      const truncatedError = shortError.length > 100 ? shortError.substring(0, 100) + '...' : shortError;
      displayMessage = `❌ 测试失败: ${truncatedError}`;
    }
    
    cookieStatusEl.textContent = displayMessage;
    cookieStatusEl.style.color = 'red';
  }
}

// 绑定事件
saveBtn.addEventListener('click', saveSettings);
testCookieBtn.addEventListener('click', testWeiboConnection);

// 初始加载
loadSettings();

