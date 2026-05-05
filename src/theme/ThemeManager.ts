import { Store } from '../store';
import type { UserConfig, ThemeMode } from '../config/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ThemeManager');

type EffectiveTheme = 'light' | 'dark';

export class ThemeManager {
  private config: UserConfig;
  private store: Store;
  private mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private systemChangeHandler: (() => void) | null = null;
  private onSystemThemeChange: ((theme: EffectiveTheme) => void) | null = null;

  constructor(config: UserConfig, store: Store) {
    this.config = config;
    this.store = store;
  }

  initialize(): void {
    const mode = this.config.theme?.mode || 'auto';

    if (mode === 'auto') {
      this.startSystemListener();
    }

    this.applyThemeClass(this.resolveEffectiveTheme(mode));
  }

  async toggleTheme(): Promise<void> {
    const currentMode = this.config.theme?.mode || 'auto';
    const modes: ThemeMode[] = ['light', 'dark', 'auto'];
    const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
    await this.setTheme(modes[nextIndex]);
  }

  async setTheme(mode: ThemeMode): Promise<void> {
    const previousMode = this.config.theme?.mode || 'auto';
    const nextConfigTheme = {
      mode,
      enableTransitions: false,
      transitionDuration: this.config.theme?.transitionDuration || 300,
    };

    // 先落盘，成功后再改 DOM / 切换监听。避免"DOM 已切到新主题但
    // 磁盘写入失败"，下次启动读旧 config 恢复旧主题导致抽搐。
    this.config.theme = nextConfigTheme;
    try {
      await this.store.set('config', this.config);
      await this.store.save();
    } catch (error) {
      // 回滚内存 config，保持与磁盘一致
      this.config.theme = { ...nextConfigTheme, mode: previousMode };
      log.error('保存主题配置失败，已回滚', error);
      throw error;
    }

    this.stopSystemListener();
    if (mode === 'auto') {
      this.startSystemListener();
    }
    this.applyThemeClass(this.resolveEffectiveTheme(mode));
  }

  /**
   * 注册系统主题变化回调（供 composable 监听）
   */
  setOnSystemThemeChange(callback: ((theme: EffectiveTheme) => void) | null): void {
    this.onSystemThemeChange = callback;
  }

  getCurrentTheme(): ThemeMode {
    return this.config.theme?.mode || 'auto';
  }

  getEffectiveTheme(): EffectiveTheme {
    return this.resolveEffectiveTheme(this.getCurrentTheme());
  }

  updateConfig(config: UserConfig): void {
    this.config = config;
    const mode = this.config.theme?.mode || 'auto';
    this.stopSystemListener();
    if (mode === 'auto') {
      this.startSystemListener();
    }
    this.applyThemeClass(this.resolveEffectiveTheme(mode));
  }

  destroy(): void {
    this.stopSystemListener();
  }

  private resolveEffectiveTheme(mode: ThemeMode): EffectiveTheme {
    if (mode === 'auto') {
      return this.mediaQuery.matches ? 'dark' : 'light';
    }
    return mode;
  }

  private startSystemListener(): void {
    this.stopSystemListener();

    this.systemChangeHandler = () => {
      const effective = this.resolveEffectiveTheme('auto');
      this.applyThemeClass(effective);
      this.onSystemThemeChange?.(effective);
    };

    this.mediaQuery.addEventListener('change', this.systemChangeHandler);
  }

  private stopSystemListener(): void {
    if (this.systemChangeHandler) {
      this.mediaQuery.removeEventListener('change', this.systemChangeHandler);
      this.systemChangeHandler = null;
    }
  }

  private applyThemeClass(effective: EffectiveTheme): void {
    const root = document.documentElement;

    root.classList.toggle('dark-theme', effective === 'dark');
    root.classList.toggle('light-theme', effective === 'light');

    const mode = this.config.theme?.mode || 'auto';
    localStorage.setItem('picnexus-theme', mode === 'auto' ? 'auto' : `${effective}-theme`);
  }

}
