import { getCurrentWindow } from '@tauri-apps/api/window';

const params = new URLSearchParams(window.location.search);
const name = params.get('name') || '';
const theme = params.get('theme') || 'dark';

const serviceName = document.getElementById('serviceName');
if (serviceName) {
  serviceName.textContent = name;
}

if (theme === 'light') {
  document.documentElement.classList.add('light');
}

document.getElementById('closeBtn')?.addEventListener('click', async () => {
  await getCurrentWindow().close();
});
