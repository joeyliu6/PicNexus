// 新手引导的步骤规则（Onboarding.dc.html O01–O03，交接说明 8.7）。只算数据，不碰界面与存储：
// 欢迎 → 选图床（京东默认勾选，勾选即视为确认公共图床风险）→ 怎么传（四种上传方式 + 默认格式）。
// 引导里选的图床与格式，和首页「上传到」、托盘、设置页是同一份配置（availableServices / enabledServices / linkOutput）。

import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import type { LinkFormat } from '@/utils/linkFormatter';
import { formatShortcut } from '@/utils/shortcutText';
import type { UiPlatform } from '@/utils/platform';
import { HOST_CATALOG } from '@/views/hosts/hostCatalog';

export const ONBOARDING_STEPS = ['welcome', 'hosts', 'howto'] as const;

export type StarterHostId = 'jd' | 'qiyu';

/** 免配置、勾选即可用的图床（设计稿 starters） */
export const STARTER_HOSTS: ReadonlyArray<{ id: StarterHostId; name: string; desc: string }> = [
  { id: 'jd', name: '京东', desc: '免配置 · 国内速度快' },
  { id: 'qiyu', name: '七鱼', desc: '免配置 · Token 自动获取' },
];

export interface OnboardingChoice {
  hosts: Record<StarterHostId, boolean>;
  /** 第 3 步只给 URL / Markdown 两个选项；当前是其他格式且没点时原样保留 */
  format: LinkFormat;
}

export function stepButtons(index: number): { back: boolean; next: '下一步' | '开始使用' } {
  return { back: index > 0, next: index >= ONBOARDING_STEPS.length - 1 ? '开始使用' : '下一步' };
}

function isEnabled(config: UserConfig, id: string): boolean {
  return (config.availableServices ?? []).includes(id) && (config.enabledServices ?? []).includes(id);
}

/** firstRun = 启动时自动弹出（还没完成过引导）：京东默认勾选；从设置重新打开时照当前配置 */
export function initialChoice(config: UserConfig, firstRun: boolean): OnboardingChoice {
  return {
    hosts: {
      jd: isEnabled(config, 'jd') || firstRun,
      qiyu: isEnabled(config, 'qiyu'),
    },
    format: config.linkOutput?.defaultFormat ?? DEFAULT_CONFIG.linkOutput!.defaultFormat,
  };
}

/**
 * 「开始使用」写进配置：勾上的加进「已添加」并启用；没勾的停用（留在「已添加」里，与首页取消勾选相同）。
 * 勾了任意一个就记下已确认公共图床风险（勾选处写着风险说明）；同时标记引导已完成。
 */
export function applyChoice(config: UserConfig, choice: OnboardingChoice): UserConfig {
  const checked = STARTER_HOSTS.filter((host) => choice.hosts[host.id]).map((host) => host.id as string);
  const unchecked = new Set(STARTER_HOSTS.filter((host) => !choice.hosts[host.id]).map((host) => host.id as string));
  const add = (list: string[] | undefined) => [...new Set([...(list ?? []), ...checked])];
  return {
    ...config,
    availableServices: add(config.availableServices),
    enabledServices: add(config.enabledServices).filter((id) => !unchecked.has(id)),
    publicServiceRiskAccepted: checked.length > 0 || !!config.publicServiceRiskAccepted,
    linkOutput: { ...DEFAULT_CONFIG.linkOutput!, ...(config.linkOutput ?? {}), defaultFormat: choice.format },
    onboardingCompleted: true,
  };
}

/** 「微博、GitHub、Cloudflare R2、WebDAV 等 N 种图床」：目录里除免配置以外的 */
export function laterHostCount(): number {
  return HOST_CATALOG.length - STARTER_HOSTS.length;
}

export interface UploadWay {
  title: string;
  body: string;
  /** 24×24 线条图标的路径（设计稿 ways[].icon） */
  icon: string;
}

/** hotkey = 全局快捷键「上传剪贴板图片」的加速键；关闭或没录时传空串 */
export function uploadWays(platform: UiPlatform, hotkey: string): UploadWay[] {
  const mac = platform === 'macos';
  const keys = hotkey ? formatShortcut(hotkey, platform) : '';
  return [
    { title: '拖入窗口', body: '任意页面均可', icon: 'M12 4v12M7 11l5 5 5-5M5 20h14' },
    {
      title: `按 ${mac ? '⌘' : 'Ctrl+'}V 粘贴`,
      body: '粘贴截图或已复制的图片',
      icon: 'M9 3h6v4H9zM16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2',
    },
    keys
      ? { title: `在任意程序中按 ${keys}`, body: '无需打开窗口，上传剪贴板中的图片', icon: 'M4 7h16v10H4zM8 11h.01M12 11h.01M16 11h.01M8 14h8' }
      : { title: '全局快捷键', body: '在 设置 › 快捷键 中开启后，无需打开窗口即可上传剪贴板中的图片', icon: 'M4 7h16v10H4zM8 11h.01M12 11h.01M16 11h.01M8 14h8' },
    { title: `${mac ? '菜单栏' : '托盘'}菜单`, body: '上传、切换图床与链接格式', icon: 'M3 17h18M7 13l5-6 5 6' },
  ];
}
