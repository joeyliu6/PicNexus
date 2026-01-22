// 主题管理 Composable

import { ref, readonly } from 'vue';
import { ThemeManager } from '../theme/ThemeManager';
import { Store } from '../store';
import { DEFAULT_CONFIG, type UserConfig, type ThemeMode } from '../config/types';

// 全局状态
const configStore = new Store('.settings.dat');
let themeManager: ThemeManager | null = null;
const currentTheme = ref<ThemeMode>('dark');
const isInitialized = ref(false);

/**
 * 主题管理 Composable
 * 提供主题切换和状态管理功能
 */
export function useThemeManager() {
  /**
   * 初始化主题管理器
   * @param playTransition 是否播放过渡动画，默认为 false
   */
  const initializeTheme = async (playTransition = false): Promise<void> => {
    try {
      const config = await configStore.get<UserConfig>('config');
      const effectiveConfig = config ?? DEFAULT_CONFIG;

      themeManager = new ThemeManager(effectiveConfig, configStore);
      await themeManager.initialize(playTransition);
      currentTheme.value = themeManager.getCurrentTheme();
      isInitialized.value = true;
    } catch (error) {
      console.error('[ThemeManager] Initialization failed:', error);
      currentTheme.value = 'dark';
    }
  };

  /**
   * 切换主题模式（亮色 ↔ 深色）
   */
  const toggleTheme = async (): Promise<void> => {
    if (!themeManager) {
      console.warn('[ThemeManager] Not initialized, cannot toggle theme');
      return;
    }

    try {
      await themeManager.toggleTheme();
      currentTheme.value = themeManager.getCurrentTheme();
    } catch (error) {
      console.error('[ThemeManager] Failed to toggle theme:', error);
    }
  };

  /**
   * 设置主题模式
   * @param mode 主题模式（'light' 或 'dark'）
   */
  const setTheme = async (mode: ThemeMode): Promise<void> => {
    if (!themeManager) {
      console.warn('[ThemeManager] Not initialized, cannot set theme');
      return;
    }

    try {
      await themeManager.setTheme(mode);
      currentTheme.value = mode;
    } catch (error) {
      console.error('[ThemeManager] Failed to set theme:', error);
    }
  };

  /**
   * 更新主题管理器的配置引用
   * @param config 新的配置对象
   */
  const updateConfig = (config: UserConfig): void => {
    if (themeManager) {
      themeManager.updateConfig(config);
    }
  };

  return {
    // 主题管理器实例（只读）- 注意：初始化前可能为 null
    get themeManager() {
      return themeManager;
    },

    // 当前主题模式（只读）
    currentTheme: readonly(currentTheme),

    // 是否已初始化（只读）
    isInitialized: readonly(isInitialized),

    // 方法
    initializeTheme,
    toggleTheme,
    setTheme,
    updateConfig
  };
}
