// 主题管理器 - 负责主题切换和持久化

import { Store } from '../store';
import type { UserConfig, ThemeMode } from '../config/types';

/**
 * 主题管理器类
 * 负责应用主题切换、过渡动画和配置持久化
 */
export class ThemeManager {
  private config: UserConfig;
  private store: Store;
  private isTransitioning = false;

  constructor(config: UserConfig, store: Store) {
    this.config = config;
    this.store = store;
  }

  /**
   * 初始化主题（应用启动时调用）
   * @param playTransition 是否播放过渡动画，默认为 false
   */
  async initialize(playTransition = false): Promise<void> {
    const theme = this.config.theme || {
      mode: 'dark',
      enableTransitions: true,
      transitionDuration: 300
    };

    await this.applyTheme(theme.mode, playTransition);
  }

  /**
   * 切换主题模式（亮色 ↔ 深色）
   */
  async toggleTheme(): Promise<void> {
    const currentMode = this.config.theme?.mode || 'dark';
    const newMode: ThemeMode = currentMode === 'dark' ? 'light' : 'dark';
    await this.setTheme(newMode);
  }

  /**
   * 设置主题模式
   * @param mode 主题模式（'light' 或 'dark'）
   */
  async setTheme(mode: ThemeMode): Promise<void> {
    const enableTransitions = false;  // 强制禁用过渡

    // 应用主题到 DOM
    await this.applyTheme(mode, enableTransitions);

    // 更新配置
    this.config.theme = {
      mode,
      enableTransitions,
      transitionDuration: this.config.theme?.transitionDuration || 300
    };

    // 持久化到存储
    try {
      await this.store.set('config', this.config);
      await this.store.save();
    } catch (error) {
      console.error('Failed to save theme configuration:', error);
    }
  }

  /**
   * 应用主题类到 DOM 元素
   */
  private applyThemeClass(mode: ThemeMode): void {
    const root = document.documentElement;
    root.classList.toggle('dark-theme', mode === 'dark');
    root.classList.toggle('light-theme', mode === 'light');
    localStorage.setItem('picnexus-theme', `${mode}-theme`);
  }

  /**
   * 应用主题到 DOM
   * @param mode 主题模式
   * @param withTransition 是否启用过渡动画
   */
  private async applyTheme(mode: ThemeMode, withTransition: boolean): Promise<void> {
    if (this.isTransitioning) {
      return;
    }

    const root = document.documentElement;
    const duration = this.config.theme?.transitionDuration || 200;

    if (withTransition) {
      this.isTransitioning = true;
      root.style.willChange = 'background-color';
      root.style.setProperty('--theme-transition-duration', `${duration}ms`);
      root.classList.add('theme-transitioning');

      this.applyThemeClass(mode);

      setTimeout(() => {
        root.classList.remove('theme-transitioning');
        root.style.willChange = 'auto';
        this.isTransitioning = false;
      }, duration);
    } else {
      this.applyThemeClass(mode);
    }
  }

  /**
   * 获取当前主题模式
   * @returns 当前主题模式（'light' 或 'dark'）
   */
  getCurrentTheme(): ThemeMode {
    return this.config.theme?.mode || 'dark';
  }

  /**
   * 更新配置引用
   * @param config 新的配置对象
   */
  updateConfig(config: UserConfig): void {
    this.config = config;
  }
}
