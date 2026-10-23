<script setup lang="ts">
// 新手引导（Onboarding.dc.html O01–O03，交接说明 8.7）：640×580 大弹窗，三步——欢迎 → 选图床 → 怎么传。
// 底栏：左「跳过」、中间三个圆点、右「上一步」「下一步 / 开始使用」，按钮高 32（设计稿）。
// 「开始使用」写入选择并回到首页；「跳过」与 Esc 不写选择；点遮罩不关，免得误点丢掉选择。
import { computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import PnButton from '@/components/pn/PnButton.vue';
import { useOnboarding } from '@/composables/useOnboarding';
import { useUploadController } from '@/composables/upload/useUploadController';
import { uiPlatform } from '@/utils/platform';
import OnboardingWelcome from './OnboardingWelcome.vue';
import OnboardingHosts from './OnboardingHosts.vue';
import OnboardingHowTo from './OnboardingHowTo.vue';
import { ONBOARDING_STEPS, stepButtons } from './onboardingModel';

const router = useRouter();
const upload = useUploadController();
const onboarding = useOnboarding();
const { isVisible, stepIndex, choice, saving } = onboarding;

const platform = uiPlatform();
const step = computed(() => ONBOARDING_STEPS[stepIndex.value]);
const buttons = computed(() => stepButtons(stepIndex.value));
/** 关掉全局快捷键时不提组合键（与首页、托盘一致） */
const hotkey = computed(() => {
  const shortcut = upload.config.value.globalShortcut;
  return shortcut?.enabled === false ? '' : (shortcut?.uploadClipboard ?? '');
});

async function onNext(): Promise<void> {
  if (step.value !== 'howto') {
    onboarding.next();
    return;
  }
  if (await onboarding.finish()) await router.push('/home');
}

/** 打开时焦点落在「下一步」（Reka 默认落在第一个按钮「跳过」，回车就跳过了） */
function onOpenAutoFocus(event: Event): void {
  const next = document.querySelector<HTMLElement>('.onboarding [data-autofocus]');
  if (!next) return;
  event.preventDefault();
  next.focus();
}

/** 回到第 1 步时「上一步」消失，焦点交给「下一步」，免得掉到弹窗外 */
async function onBack(): Promise<void> {
  onboarding.back();
  if (buttons.value.back) return;
  await nextTick();
  document.querySelector<HTMLElement>('.onboarding [data-autofocus]')?.focus();
}

function onEscape(event: KeyboardEvent): void {
  event.preventDefault();
  void onboarding.skip();
}
</script>

<template>
  <DialogRoot :open="isVisible">
    <DialogPortal>
      <DialogOverlay class="pn-dialog-overlay" />
      <DialogContent
        class="pn-layer onboarding"
        :aria-describedby="undefined"
        @open-auto-focus="onOpenAutoFocus"
        @escape-key-down="onEscape"
        @pointer-down-outside="(event: Event) => event.preventDefault()"
        @interact-outside="(event: Event) => event.preventDefault()"
      >
        <DialogTitle class="onboarding__sr">新手引导</DialogTitle>
        <div class="onboarding__body">
          <OnboardingWelcome v-if="step === 'welcome'" />
          <OnboardingHosts v-else-if="step === 'hosts'" :hosts="choice.hosts" @toggle="onboarding.setHost" />
          <OnboardingHowTo v-else :format="choice.format" :platform="platform" :hotkey="hotkey" @update:format="onboarding.setFormat" />
        </div>
        <div class="onboarding__foot">
          <PnButton variant="ghost" class="onboarding__skip" :disabled="saving" @click="onboarding.skip()">跳过</PnButton>
          <div class="onboarding__dots" :aria-label="`第 ${stepIndex + 1} 步，共 ${ONBOARDING_STEPS.length} 步`" role="img">
            <span v-for="(name, i) in ONBOARDING_STEPS" :key="name" class="onboarding__dot" :class="{ 'onboarding__dot--on': i === stepIndex }" />
          </div>
          <PnButton v-if="buttons.back" variant="secondary" :disabled="saving" @click="onBack">上一步</PnButton>
          <PnButton variant="primary" class="onboarding__next" data-autofocus :loading="saving" @click="onNext">{{ buttons.next }}</PnButton>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<!-- 传送到 body，用不带 scoped 的类名 -->
<style>
.onboarding {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: var(--pn-z-dialog);
  display: flex;
  flex-direction: column;
  width: var(--pn-size-onboarding-w);
  height: var(--pn-size-onboarding-h);
  max-width: calc(100vw - var(--pn-space-32));
  max-height: calc(100vh - var(--pn-space-16));
  box-sizing: border-box;
  overflow: hidden;
  border-radius: var(--pn-radius-dialog);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e4);
  color: var(--pn-text1);
  transform: translate(-50%, -50%);
}

.onboarding[data-state='open'] { animation: pn-dialog-in var(--pn-dur-expressive) var(--pn-ease-in); }

/* 关闭时与遮罩一起退场（缩到 0.98 并淡出，ease-out、比进场快 30%），不先一下消失；Reka 等这段动画播完才移除 */
.onboarding[data-state='closed'] { animation: pn-dialog-out calc(var(--pn-dur-expressive) * 0.7) var(--pn-ease-out) forwards; }

@media (prefers-reduced-motion: reduce) {
  .onboarding[data-state='open'] { animation: pn-dialog-fade var(--pn-dur-fade-expressive) var(--pn-ease-in); }
  .onboarding[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-fade-expressive) * 0.7) var(--pn-ease-out) forwards; }
}

.onboarding__sr {
  position: absolute;
  width: var(--pn-space-1);
  height: var(--pn-space-1);
  overflow: hidden;
  clip-path: inset(50%);
}

.onboarding__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}

/* 换到另一步：新一步的内容原地淡入（不做位移；上一步直接让位，不会叠在一起或空一帧） */
.onboarding__body > * { animation: pn-dialog-fade var(--pn-dur-fast) var(--pn-ease-in); }

.onboarding__foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-button-sm-x);
  height: var(--pn-size-onboarding-foot);
  padding: 0 var(--pn-space-24);
}

/* 比 PnButton 自带的变体样式多一层类名，才盖得住（设计稿：跳过 灰字、左右 10；下一步 左右 16） */
.onboarding__foot .onboarding__skip { padding: 0 var(--pn-space-button-sm-x); color: var(--pn-text2); }
.onboarding__foot .onboarding__next { padding: 0 var(--pn-space-16); }

.onboarding__dots {
  display: flex;
  flex: 1;
  justify-content: center;
  gap: var(--pn-space-6);
}

.onboarding__dot {
  width: var(--pn-size-onboarding-dot);
  height: var(--pn-size-onboarding-dot);
  border-radius: var(--pn-radius-onboarding-dot);
  background: var(--pn-border-strong);
  transition: width var(--pn-dur-standard) var(--pn-ease-in), background-color var(--pn-dur-standard) var(--pn-ease-in);
}

.onboarding__dot--on { width: var(--pn-size-onboarding-dot-on); background: var(--pn-text1); }

@media (prefers-reduced-motion: reduce) {
  .onboarding__dot { transition: none; }
}
</style>
