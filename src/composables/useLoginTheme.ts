import { createLogger } from '../utils/logger';

const log = createLogger('LoginWebview');

export async function initLoginTheme(): Promise<'light' | 'dark'> {
  try {
    const requestedTheme = new URLSearchParams(window.location.search).get('theme');
    const effective = requestedTheme === 'light' || requestedTheme === 'dark'
      ? requestedTheme
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    document.documentElement.classList.remove('dark-theme', 'light-theme');
    document.documentElement.classList.add(`${effective}-theme`);

    log.info('Theme initialized:', effective);
    return effective;
  } catch (error) {
    log.error('Theme init failed:', error);
    const fallback = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.classList.add(`${fallback}-theme`);
    return fallback;
  }
}
