import type { UserConfig } from '../config/types';
import { configStore } from '../store/instances';
import { createLogger } from '../utils/logger';

const log = createLogger('LoginWebview');

export async function initLoginTheme(): Promise<'light' | 'dark'> {
  try {
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

    log.info('Theme initialized:', effective, `(mode: ${themeMode})`);
    return effective;
  } catch (error) {
    log.error('Theme init failed:', error);
    const fallback = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.classList.add(`${fallback}-theme`);
    return fallback;
  }
}
