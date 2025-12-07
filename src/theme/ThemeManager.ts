// src/theme/ThemeManager.ts
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
    const enableTransitions = this.config.theme?.enableTransitions ?? true;

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
   * 应用主题到 DOM
   * @param mode 主题模式
   * @param withTransition 是否启用过渡动画
   */
  private async applyTheme(mode: ThemeMode, withTransition: boolean): Promise<void> {
    // 防止并发切换
    if (this.isTransitioning) {
      return;
    }

    const root = document.documentElement;
    const duration = this.config.theme?.transitionDuration || 200;

    // 如果启用过渡动画
    if (withTransition) {
      this.isTransitioning = true;

      // 添加 GPU 加速提示，优化渲染性能
      root.style.willChange = 'background-color';

      // 设置过渡持续时间
      root.style.setProperty('--theme-transition-duration', `${duration}ms`);

      // 添加过渡类
      root.classList.add('theme-transitioning');

      // 切换主题类（在过渡开始时立即切换）
      if (mode === 'dark') {
        root.classList.add('dark-theme');
        root.classList.remove('light-theme');
      } else {
        root.classList.add('light-theme');
        root.classList.remove('dark-theme');
      }

      // 延迟后移除过渡类并清理 GPU 资源
      setTimeout(() => {
        root.classList.remove('theme-transitioning');
        root.style.willChange = 'auto'; // 清理 GPU 资源，避免内存浪费
        this.isTransitioning = false;
      }, duration);
    } else {
      // 无过渡时直接切换
      if (mode === 'dark') {
        root.classList.add('dark-theme');
        root.classList.remove('light-theme');
      } else {
        root.classList.add('light-theme');
        root.classList.remove('dark-theme');
      }
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
