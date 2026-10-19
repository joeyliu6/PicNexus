import { getCurrentWindow } from '@tauri-apps/api/window';
import { joinCjk } from '@/utils/cjkSpacing';
import { uiPlatform } from '@/utils/platform';

const params = new URLSearchParams(window.location.search);
const name = params.get('name') || '';
const theme = params.get('theme') === 'light' ? 'light' : 'dark';

const serviceName = document.getElementById('serviceName');
if (serviceName) {
  // CookieWindow.dc.html 的标题：「微博登录」
  serviceName.textContent = joinCjk(name, '登录');
}

// 主题与平台写成 data-theme / data-platform，和主窗口同一套（见 useLoginTheme.ts / preload-theme.js）
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.platform = uiPlatform();

document.getElementById('closeBtn')?.addEventListener('click', async () => {
  await getCurrentWindow().close();
});
