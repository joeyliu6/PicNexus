import { Store } from '../store';
import type { UserConfig } from '../config/types';

export async function initLoginTheme(): Promise<'light' | 'dark'> {
  try {
    const configStore = new Store('.settings.dat');
    const config = await configStore.get<UserConfig>('config');
    const themeMode = config?.theme?.mode || 'auto';

    let effective: 'light' | 'dark';
    if (themeMode === 'auto') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      effective = themeMode;
    }

    document.documentElement.classList.remove('dark-theme', 'light-theme');
    document.documentElement.classList.add(`${effective}-theme`);

    console.log('[LoginWebview] Theme initialized:', effective, `(mode: ${themeMode})`);
    return effective;
  } catch (error) {
    console.error('[LoginWebview] Theme init failed:', error);
    const fallback = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.classList.add(`${fallback}-theme`);
    return fallback;
  }
}
