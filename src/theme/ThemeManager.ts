import { Store } from '../store';
import type { UserConfig, ThemeMode } from '../config/types';

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
    this.stopSystemListener();

    if (mode === 'auto') {
      this.startSystemListener();
    }

    const effective = this.resolveEffectiveTheme(mode);
    this.applyThemeClass(effective);

    this.config.theme = {
      mode,
      enableTransitions: false,
      transitionDuration: this.config.theme?.transitionDuration || 300
    };

    try {
      await this.store.set('config', this.config);
      await this.store.save();
    } catch (error) {
      console.error('Failed to save theme configuration:', error);
    }
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
