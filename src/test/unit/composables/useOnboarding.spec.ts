import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadConfigMock = vi.fn();
const saveConfigMock = vi.fn();
const configRef = { value: { onboardingCompleted: false } as any };

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: configRef,
    loadConfig: loadConfigMock,
    saveConfig: saveConfigMock,
  }),
}));

import { useOnboarding } from '../../../composables/useOnboarding';

describe('useOnboarding', () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    saveConfigMock.mockReset();
    // 复位共享状态
    const { isVisible, currentStep } = useOnboarding();
    isVisible.value = false;
    currentStep.value = 0;
  });

  it('totalSteps=3', () => {
    const api = useOnboarding();
    expect(api.totalSteps).toBe(3);
  });

  it('checkAndShow - onboardingCompleted=false → 显示', async () => {
    loadConfigMock.mockResolvedValue({ onboardingCompleted: false });
    const api = useOnboarding();
    await api.checkAndShow();
    expect(api.isVisible.value).toBe(true);
    expect(api.currentStep.value).toBe(0);
  });

  it('checkAndShow - onboardingCompleted=true → 不显示', async () => {
    loadConfigMock.mockResolvedValue({ onboardingCompleted: true });
    const api = useOnboarding();
    await api.checkAndShow();
    expect(api.isVisible.value).toBe(false);
  });

  it('complete 隐藏并写入 onboardingCompleted', async () => {
    const api = useOnboarding();
    api.isVisible.value = true;
    api.currentStep.value = 2;
    await api.complete();
    expect(api.isVisible.value).toBe(false);
    expect(api.currentStep.value).toBe(0);
    expect(saveConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingCompleted: true }),
      true,
    );
  });

  it('reopen 重置步骤并显示', () => {
    const api = useOnboarding();
    api.currentStep.value = 2;
    api.reopen();
    expect(api.isVisible.value).toBe(true);
    expect(api.currentStep.value).toBe(0);
  });

  it('nextStep 递增到上限不越界', () => {
    const api = useOnboarding();
    api.currentStep.value = 0;
    api.nextStep();
    expect(api.currentStep.value).toBe(1);
    api.nextStep();
    expect(api.currentStep.value).toBe(2);
    api.nextStep();
    expect(api.currentStep.value).toBe(2);
  });

  it('prevStep 递减到 0 不越界', () => {
    const api = useOnboarding();
    api.currentStep.value = 2;
    api.prevStep();
    expect(api.currentStep.value).toBe(1);
    api.prevStep();
    expect(api.currentStep.value).toBe(0);
    api.prevStep();
    expect(api.currentStep.value).toBe(0);
  });
});
