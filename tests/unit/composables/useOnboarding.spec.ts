import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const m = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  readFreshConfig: vi.fn(),
  applyConfigPatch: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ loadConfig: m.loadConfig }) }));
vi.mock('@/store/instances', () => ({ readFreshConfig: m.readFreshConfig }));
vi.mock('@/composables/upload/useUploadController', () => ({ useUploadController: () => ({ applyConfigPatch: m.applyConfigPatch }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: m.toastError }) }));

import { useOnboarding } from '@/composables/useOnboarding';

function config(patch: Partial<UserConfig> = {}): UserConfig {
  return { ...structuredClone(DEFAULT_CONFIG), ...patch };
}

/** 跑一遍调用方传给 applyConfigPatch 的改法，看它把配置改成什么 */
function lastPatched(base: UserConfig): UserConfig {
  const patch = m.applyConfigPatch.mock.calls.at(-1)?.[0] as (c: UserConfig) => UserConfig;
  return patch(base);
}

describe('useOnboarding', () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.applyConfigPatch.mockResolvedValue(undefined);
    const api = useOnboarding();
    api.isVisible.value = false;
    api.stepIndex.value = 0;
  });

  it('启动时没完成过引导就弹出，从第 1 步开始，京东默认勾选', async () => {
    m.loadConfig.mockResolvedValue(config());
    const api = useOnboarding();
    await api.checkAndShow();
    expect(api.isVisible.value).toBe(true);
    expect(api.stepIndex.value).toBe(0);
    expect(api.choice.value.hosts).toEqual({ jd: true, qiyu: false });
  });

  it('完成过引导就不弹', async () => {
    m.loadConfig.mockResolvedValue(config({ onboardingCompleted: true }));
    const api = useOnboarding();
    await api.checkAndShow();
    expect(api.isVisible.value).toBe(false);
  });

  it('从设置重新打开：照当前配置勾选，回到第 1 步', async () => {
    m.readFreshConfig.mockResolvedValue(config({ onboardingCompleted: true, availableServices: ['qiyu'], enabledServices: ['qiyu'] }));
    const api = useOnboarding();
    api.stepIndex.value = 2;
    await api.reopen();
    expect(api.isVisible.value).toBe(true);
    expect(api.stepIndex.value).toBe(0);
    expect(api.choice.value.hosts).toEqual({ jd: false, qiyu: true });
  });

  it('下一步 / 上一步不越过首尾', async () => {
    m.loadConfig.mockResolvedValue(config());
    const api = useOnboarding();
    await api.checkAndShow();
    api.back();
    expect(api.stepIndex.value).toBe(0);
    api.next();
    api.next();
    api.next();
    expect(api.stepIndex.value).toBe(2);
    api.back();
    expect(api.stepIndex.value).toBe(1);
  });

  it('「开始使用」把勾选与格式一次写进同一份配置并关闭', async () => {
    m.loadConfig.mockResolvedValue(config());
    const api = useOnboarding();
    await api.checkAndShow();
    api.setHost('qiyu', true);
    api.setFormat('markdown');
    await expect(api.finish()).resolves.toBe(true);
    expect(m.applyConfigPatch).toHaveBeenCalledTimes(1);
    const saved = lastPatched(config());
    expect(saved.enabledServices).toEqual(['jd', 'qiyu']);
    expect(saved.linkOutput?.defaultFormat).toBe('markdown');
    expect(saved.publicServiceRiskAccepted).toBe(true);
    expect(saved.onboardingCompleted).toBe(true);
    expect(api.isVisible.value).toBe(false);
  });

  it('连点「开始使用」只写一次', async () => {
    m.loadConfig.mockResolvedValue(config());
    let release!: () => void;
    m.applyConfigPatch.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const api = useOnboarding();
    await api.checkAndShow();
    const first = api.finish();
    expect(api.saving.value).toBe(true);
    await expect(api.finish()).resolves.toBe(false);
    release();
    await first;
    expect(m.applyConfigPatch).toHaveBeenCalledTimes(1);
    expect(api.saving.value).toBe(false);
  });

  it('保存失败：弹窗留着、选择不丢，通知写原因与处理办法', async () => {
    m.loadConfig.mockResolvedValue(config());
    m.applyConfigPatch.mockRejectedValueOnce(new Error('磁盘已满'));
    const api = useOnboarding();
    await api.checkAndShow();
    api.setHost('qiyu', true);
    await expect(api.finish()).resolves.toBe(false);
    expect(api.isVisible.value).toBe(true);
    expect(api.choice.value.hosts.qiyu).toBe(true);
    expect(m.toastError).toHaveBeenCalledWith('设置未保存', '磁盘已满，请重试');
  });

  it('「跳过」只标记已完成，不动图床与格式', async () => {
    m.loadConfig.mockResolvedValue(config());
    const api = useOnboarding();
    await api.checkAndShow();
    api.setHost('qiyu', true);
    await api.skip();
    expect(api.isVisible.value).toBe(false);
    const base = config();
    expect(lastPatched(base)).toEqual({ ...base, onboardingCompleted: true });
  });

  it('「开始使用」保存中按 Esc / 跳过不起作用，免得把刚选的覆盖掉', async () => {
    m.loadConfig.mockResolvedValue(config());
    let release!: () => void;
    m.applyConfigPatch.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const api = useOnboarding();
    await api.checkAndShow();
    const finishing = api.finish();
    await api.skip();
    expect(api.isVisible.value).toBe(true);
    release();
    await finishing;
    expect(m.applyConfigPatch).toHaveBeenCalledTimes(1);
  });

  it('重新打开时读不出配置：不打开，通知写原因与处理办法', async () => {
    m.readFreshConfig.mockRejectedValue(new Error('配置文件被占用'));
    const api = useOnboarding();
    await api.reopen();
    expect(api.isVisible.value).toBe(false);
    expect(m.toastError).toHaveBeenCalledWith('无法打开新手引导', '配置文件被占用，请重试');
  });

  it('重新打开后「跳过」只关闭，不再写配置', async () => {
    m.readFreshConfig.mockResolvedValue(config({ onboardingCompleted: true }));
    const api = useOnboarding();
    await api.reopen();
    await api.skip();
    expect(api.isVisible.value).toBe(false);
    expect(m.applyConfigPatch).not.toHaveBeenCalled();
  });
});
