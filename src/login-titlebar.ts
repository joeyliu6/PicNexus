import { getCurrentWindow } from '@tauri-apps/api/window';

const params = new URLSearchParams(window.location.search);
const name = params.get('name') || '';
const theme = params.get('theme') === 'light' ? 'light' : 'dark';

const serviceName = document.getElementById('serviceName');
if (serviceName) {
  serviceName.textContent = name;
}

// class 名沿用全项目的 `<主题>-theme` 约定（见 useLoginTheme.ts / preload-theme.js），
// 别退回裸 `light`——这个窗口自成一体，写错了不会报错，只会让照约定改样式的人扑空
document.documentElement.classList.add(`${theme}-theme`);

document.getElementById('closeBtn')?.addEventListener('click', async () => {
  await getCurrentWindow().close();
});
