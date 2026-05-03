import { ref, readonly } from 'vue';
import { ThemeManager } from '../theme/ThemeManager';
import { DEFAULT_CONFIG, type UserConfig, type ThemeMode } from '../config/types';
import { configStore } from '../store/instances';
import { createLogger } from '../utils/logger';

const log = createLogger('ThemeManager');
let themeManager: ThemeManager | null = null;
const themeMode = ref<ThemeMode>('auto');
const effectiveTheme = ref<'light' | 'dark'>('dark');
const isInitialized = ref(false);

export function useThemeManager() {
  const initializeTheme = async (): Promise<void> => {
    try {
      const config = await configStore.get<UserConfig>('config');
      const effectiveConfig = config ?? DEFAULT_CONFIG;

      themeManager = new ThemeManager(effectiveConfig, configStore);

      themeManager.setOnSystemThemeChange((theme) => {
        effectiveTheme.value = theme;
      });

      themeManager.initialize();
      themeMode.value = themeManager.getCurrentTheme();
      effectiveTheme.value = themeManager.getEffectiveTheme();
      isInitialized.value = true;
    } catch (error) {
      log.error('Initialization failed:', error);
      themeMode.value = 'auto';
      effectiveTheme.value = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  };

  const toggleTheme = async (): Promise<void> => {
    if (!themeManager) return;

    try {
      await themeManager.toggleTheme();
      themeMode.value = themeManager.getCurrentTheme();
      effectiveTheme.value = themeManager.getEffectiveTheme();
    } catch (error) {
      log.error('Failed to toggle theme:', error);
    }
  };

  const setTheme = async (mode: ThemeMode): Promise<void> => {
    if (!themeManager) return;

    try {
      await themeManager.setTheme(mode);
      themeMode.value = mode;
      effectiveTheme.value = themeManager.getEffectiveTheme();
    } catch (error) {
      log.error('Failed to set theme:', error);
    }
  };

  const updateConfig = (config: UserConfig): void => {
    if (!themeManager) return;
    themeManager.updateConfig(config);
    themeMode.value = themeManager.getCurrentTheme();
    effectiveTheme.value = themeManager.getEffectiveTheme();
  };

  return {
    get themeManager() {
      return themeManager;
    },

    /** 用户选择的模式（'light' | 'dark' | 'auto'） */
    currentTheme: readonly(themeMode),

    /** 实际生效的主题（'light' | 'dark'），用于 CSS 类绑定 */
    effectiveTheme: readonly(effectiveTheme),

    isInitialized: readonly(isInitialized),

    initializeTheme,
    toggleTheme,
    setTheme,
    updateConfig
  };
}
