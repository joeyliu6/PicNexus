import { Store } from '../store';
import type { UserConfig } from '../config/types';

/**
 * 登录窗口主题初始化
 * 从配置文件读取主题设置并应用到 DOM
 */
export async function initLoginTheme(): Promise<'light' | 'dark'> {
  try {
    const configStore = new Store('.settings.dat');
    const config = await configStore.get<UserConfig>('config');
    const themeMode = config?.theme?.mode || 'dark';

    // 应用主题类到 html 元素
    document.documentElement.classList.remove('dark-theme', 'light-theme');
    document.documentElement.classList.add(`${themeMode}-theme`);

    console.log('[LoginWebview] Theme initialized:', themeMode);
    return themeMode;
  } catch (error) {
    console.error('[LoginWebview] Theme init failed:', error);
    // 失败时使用深色主题作为默认
    document.documentElement.classList.add('dark-theme');
    return 'dark';
  }
}
