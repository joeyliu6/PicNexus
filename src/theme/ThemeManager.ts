import type { Store } from '@/store';
import type { UserConfig, ThemeMode } from '@/config/types';
import { createLogger } from '@/utils/logger';

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

    // 先落盘，成功后再改 DOM / 切换监听。避免"DOM 已切到新主题但
    // 磁盘写入失败"，下次启动读旧 config 恢复旧主题导致抽搐。
    // 写的是磁盘上的最新配置：手里的 this.config 可能是旧副本（云同步、导入配置直接写 store、
    // 不发 config-updated），整份写回会把那些改动盖掉。
    let latest: UserConfig | null = null;
    try {
      latest = await this.store.get<UserConfig>('config');
    } catch (error) {
      log.warn('读取最新配置失败，按手里的副本写主题', error);
    }
    const base = latest ?? this.config;
    const nextConfigTheme = {
      ...base.theme,
      mode,
      enableTransitions: false,
      transitionDuration: base.theme?.transitionDuration || 300,
    };
    const previousConfig = this.config;
    this.config = { ...base, theme: nextConfigTheme };
    try {
      await this.store.set('config', this.config);
      await this.store.save();
    } catch (error) {
      // 回滚内存 config，保持与磁盘一致
      this.config = { ...previousConfig, theme: { ...nextConfigTheme, mode: previousMode } };
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

    // 换色的这一帧全应用不放过渡（pn-base.css 的 .pn-theme-switching）：带颜色过渡的元素会慢半拍，
    // 深色第一帧侧栏字还是深灰、压在深底上看不见；先按新主题把样式算完，下一帧再放开过渡
    root.classList.add('pn-theme-switching');
    // --pn-* 令牌按 data-theme 切深浅色（tokens.css）
    root.dataset.theme = effective;
    void root.offsetHeight;
    requestAnimationFrame(() => root.classList.remove('pn-theme-switching'));

    const mode = this.config.theme?.mode || 'auto';
    // 存值沿用「light-theme / dark-theme / auto」，首屏的 public/preload-theme.js 按它先写 data-theme
    localStorage.setItem('picnexus-theme', mode === 'auto' ? 'auto' : `${effective}-theme`);
  }

}
