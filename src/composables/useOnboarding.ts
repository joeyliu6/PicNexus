// 新手引导的状态（O01–O03）：显示与否、第几步、勾了什么。步骤规则在 onboardingModel；
// 写配置走上传控制器（与首页「上传到」、托盘同一个入口），「开始使用」只保存一次。
// 状态是模块级单例：App.vue 启动时 checkAndShow，设置 › 关于「重新查看新手引导」调 reopen。

import { ref } from 'vue';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { useConfigManager } from './useConfig';
import { useToast } from './useToast';
import { useUploadController } from './upload/useUploadController';
import { readFreshConfig } from '@/store/instances';
import type { LinkFormat } from '@/utils/linkFormatter';
import { createLogger } from '@/utils/logger';
import { getErrorMessage } from '@/types/errors';
import {
  ONBOARDING_STEPS,
  applyChoice,
  initialChoice,
  type OnboardingChoice,
  type StarterHostId,
} from '@/components/onboarding/onboardingModel';

const log = createLogger('Onboarding');

const isVisible = ref(false);
const stepIndex = ref(0);
const choice = ref<OnboardingChoice>(initialChoice(DEFAULT_CONFIG, true));
const saving = ref(false);
/** 启动时自动弹出的那一次：「跳过」也要记下已完成，下次不再弹 */
let firstRun = false;

function open(config: UserConfig, isFirstRun: boolean): void {
  firstRun = isFirstRun;
  choice.value = initialChoice(config, isFirstRun);
  stepIndex.value = 0;
  isVisible.value = true;
}

export function useOnboarding() {
  const { loadConfig } = useConfigManager();

  async function checkAndShow(): Promise<void> {
    const loaded = await loadConfig();
    if (!loaded.onboardingCompleted) open(loaded, true);
  }

  async function reopen(): Promise<void> {
    try {
      open((await readFreshConfig()) ?? DEFAULT_CONFIG, false);
    } catch (error) {
      log.error('重新打开新手引导失败', error);
      useToast().error('无法打开新手引导', `${getErrorMessage(error)}，请重试`);
    }
  }

  function next(): void {
    if (stepIndex.value < ONBOARDING_STEPS.length - 1) stepIndex.value++;
  }

  /** 「开始使用」保存中不退回：否则弹窗先跳回上一步再关掉 */
  function back(): void {
    if (saving.value) return;
    if (stepIndex.value > 0) stepIndex.value--;
  }

  function setHost(id: StarterHostId, on: boolean): void {
    choice.value = { ...choice.value, hosts: { ...choice.value.hosts, [id]: on } };
  }

  function setFormat(format: LinkFormat): void {
    choice.value = { ...choice.value, format };
  }

  /** 「开始使用」：成功返回 true（调用方回到首页）；保存失败弹窗留着，选择不丢 */
  async function finish(): Promise<boolean> {
    if (saving.value) return false;
    saving.value = true;
    const picked = choice.value;
    try {
      await useUploadController().applyConfigPatch((config) => applyChoice(config, picked));
      isVisible.value = false;
      return true;
    } catch (error) {
      log.error('引导设置保存失败', error);
      useToast().error('设置未保存', `${getErrorMessage(error)}，请重试`);
      return false;
    } finally {
      saving.value = false;
    }
  }

  /** 「跳过」/ Esc：不写图床与格式；第一次弹出时只记下已完成。「开始使用」保存中不起作用，免得覆盖刚选的 */
  async function skip(): Promise<void> {
    if (saving.value) return;
    isVisible.value = false;
    if (!firstRun) return;
    try {
      await useUploadController().applyConfigPatch((config) => ({ ...config, onboardingCompleted: true }));
    } catch (error) {
      // 没记上只是下次启动再弹一次
      log.warn('记录引导已完成失败', error);
    }
  }

  return { isVisible, stepIndex, choice, saving, checkAndShow, reopen, next, back, setHost, setFormat, finish, skip };
}
