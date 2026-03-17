import { ref } from 'vue';
import { useConfigManager } from './useConfig';

const TOTAL_STEPS = 4;

const isVisible = ref(false);
const currentStep = ref(0);

export function useOnboarding() {
  const { config, loadConfig, saveConfig } = useConfigManager();

  async function checkAndShow(): Promise<void> {
    const loaded = await loadConfig();
    if (!loaded.onboardingCompleted) {
      currentStep.value = 0;
      isVisible.value = true;
    }
  }

  async function complete(): Promise<void> {
    isVisible.value = false;
    currentStep.value = 0;
    await saveConfig({ ...config.value, onboardingCompleted: true }, true);
  }

  function reopen(): void {
    currentStep.value = 0;
    isVisible.value = true;
  }

  function nextStep(): void {
    if (currentStep.value < TOTAL_STEPS - 1) {
      currentStep.value++;
    }
  }

  function prevStep(): void {
    if (currentStep.value > 0) {
      currentStep.value--;
    }
  }

  return {
    isVisible,
    currentStep,
    totalSteps: TOTAL_STEPS,
    checkAndShow,
    complete,
    reopen,
    nextStep,
    prevStep,
  };
}
