// 运行平台识别
// 界面按三个桌面平台换窗口按钮、侧栏材质、中文字体和快捷键写法；布局与文案三平台一致。

export type OsInfo = 'Windows' | 'macOS' | 'Linux' | 'Unknown';
export type UiPlatform = 'windows' | 'macos' | 'linux';

/** 'darwin' 里含 'win'，所以必须先判 mac */
export function normalizeOsInfo(platform: string | null | undefined): OsInfo {
  const value = (platform || '').toLowerCase();

  if (value.includes('mac') || value.includes('darwin')) return 'macOS';
  if (value.includes('win')) return 'Windows';
  if (value.includes('linux')) return 'Linux';
  return 'Unknown';
}

export function readOsInfo(): OsInfo {
  if (typeof navigator === 'undefined') return 'Unknown';

  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };
  return normalizeOsInfo(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

/** 识别不出来时按 Windows 画（与令牌的默认侧栏底色一致） */
export function uiPlatform(os: OsInfo = readOsInfo()): UiPlatform {
  if (os === 'macOS') return 'macos';
  if (os === 'Linux') return 'linux';
  return 'windows';
}
