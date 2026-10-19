import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { HOST_CATALOG } from '@/views/hosts/hostCatalog';
import {
  ONBOARDING_STEPS,
  STARTER_HOSTS,
  applyChoice,
  initialChoice,
  laterHostCount,
  stepButtons,
  uploadWays,
} from '@/components/onboarding/onboardingModel';

function config(patch: Partial<UserConfig> = {}): UserConfig {
  return { ...structuredClone(DEFAULT_CONFIG), ...patch };
}

describe('onboardingModel · 步骤', () => {
  it('三步：欢迎 → 选图床 → 怎么传', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'hosts', 'howto']);
  });

  it('欢迎页只有「下一步」，没有「上一步」；最后一步是「开始使用」', () => {
    expect(stepButtons(0)).toEqual({ back: false, next: '下一步' });
    expect(stepButtons(1)).toEqual({ back: true, next: '下一步' });
    expect(stepButtons(2)).toEqual({ back: true, next: '开始使用' });
  });
});

describe('onboardingModel · 初始勾选', () => {
  it('第一次启动：京东默认勾选，七鱼不勾，格式跟随配置', () => {
    const choice = initialChoice(config(), true);
    expect(choice.hosts).toEqual({ jd: true, qiyu: false });
    expect(choice.format).toBe('url');
  });

  it('重新打开：照当前配置，已停用的京东不再默认勾上', () => {
    const current = config({ availableServices: ['jd', 'qiyu'], enabledServices: ['qiyu'], linkOutput: { ...DEFAULT_CONFIG.linkOutput!, defaultFormat: 'markdown' } });
    expect(initialChoice(current, false)).toEqual({ hosts: { jd: false, qiyu: true }, format: 'markdown' });
  });

  it('只在「启用」里、不在「已添加」里的图床不算勾选', () => {
    const current = config({ availableServices: [], enabledServices: ['qiyu'] });
    expect(initialChoice(current, false).hosts.qiyu).toBe(false);
  });
});

describe('onboardingModel · 写进配置', () => {
  it('勾上的图床加进「已添加」与「启用」，记下已确认风险，标记引导已完成', () => {
    const next = applyChoice(config(), { hosts: { jd: true, qiyu: true }, format: 'markdown' });
    expect(next.availableServices).toEqual(expect.arrayContaining(['jd', 'qiyu']));
    expect(next.enabledServices).toEqual(['jd', 'qiyu']);
    expect(next.publicServiceRiskAccepted).toBe(true);
    expect(next.linkOutput?.defaultFormat).toBe('markdown');
    expect(next.onboardingCompleted).toBe(true);
  });

  it('取消勾选 = 停用：移出「启用」，保留在「已添加」里；其他图床不动', () => {
    const current = config({ availableServices: ['jd', 'r2'], enabledServices: ['r2', 'jd'], publicServiceRiskAccepted: true });
    const next = applyChoice(current, { hosts: { jd: false, qiyu: false }, format: 'url' });
    expect(next.enabledServices).toEqual(['r2']);
    expect(next.availableServices).toEqual(['jd', 'r2']);
    expect(next.publicServiceRiskAccepted).toBe(true);
  });

  it('一个都不勾：不记风险确认，也不新增图床', () => {
    const next = applyChoice(config(), { hosts: { jd: false, qiyu: false }, format: 'url' });
    expect(next.publicServiceRiskAccepted).toBe(false);
    expect(next.enabledServices).toEqual([]);
    expect(next.availableServices).not.toContain('jd');
  });

  it('已启用的图床再次勾选不重复', () => {
    const current = config({ availableServices: ['jd'], enabledServices: ['jd'] });
    expect(applyChoice(current, { hosts: { jd: true, qiyu: false }, format: 'url' }).enabledServices).toEqual(['jd']);
  });

  it('当前是 HTML 等其他格式、没点格式时原样保留，链接输出的其他设置不丢', () => {
    const current = config({ linkOutput: { ...DEFAULT_CONFIG.linkOutput!, defaultFormat: 'html', copyFromService: 'r2' } });
    const next = applyChoice(current, initialChoice(current, false));
    expect(next.linkOutput).toEqual(current.linkOutput);
  });

  it('不改传入的配置对象', () => {
    const current = config();
    const snapshot = structuredClone(current);
    applyChoice(current, { hosts: { jd: true, qiyu: true }, format: 'markdown' });
    expect(current).toEqual(snapshot);
  });
});

describe('onboardingModel · 文案', () => {
  it('免配置图床是京东、七鱼，说明照设计稿', () => {
    expect(STARTER_HOSTS).toEqual([
      { id: 'jd', name: '京东', desc: '免配置 · 国内速度快' },
      { id: 'qiyu', name: '七鱼', desc: '免配置 · Token 自动获取' },
    ]);
  });

  it('「稍后添加」的图床数 = 目录里除免配置以外的（设计稿写 16 种）', () => {
    expect(laterHostCount()).toBe(HOST_CATALOG.length - 2);
    expect(laterHostCount()).toBe(16);
  });

  it('Windows：Ctrl+V、录好的全局快捷键、托盘菜单', () => {
    expect(uploadWays('windows', 'CommandOrControl+Shift+C').map((w) => [w.title, w.body])).toEqual([
      ['拖入窗口', '任意页面均可'],
      ['按 Ctrl+V 粘贴', '粘贴截图或已复制的图片'],
      ['在任意程序中按 Ctrl+Shift+C', '无需打开窗口，上传剪贴板中的图片'],
      ['托盘菜单', '上传、切换图床与链接格式'],
    ]);
  });

  it('macOS：⌘V、⇧⌘C、菜单栏菜单', () => {
    const titles = uploadWays('macos', 'CommandOrControl+Shift+C').map((w) => w.title);
    expect(titles).toEqual(['拖入窗口', '按 ⌘V 粘贴', '在任意程序中按 ⇧⌘C', '菜单栏菜单']);
  });

  it('全局快捷键关闭或没录时，第三项改为去设置里开启', () => {
    const way = uploadWays('windows', '')[2];
    expect(way).toMatchObject({ title: '全局快捷键', body: '在 设置 › 快捷键 中开启后，无需打开窗口即可上传剪贴板中的图片' });
  });
});
