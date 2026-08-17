<script setup lang="ts">
import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useOnboarding } from '../../composables/useOnboarding';
import WelcomeStep from './steps/WelcomeStep.vue';
import UploadStep from './steps/UploadStep.vue';
import ServicesStep from './steps/ServicesStep.vue';

const {
  isVisible,
  currentStep,
  totalSteps,
  complete,
  nextStep,
  prevStep,
} = useOnboarding();

const isFirstStep = computed(() => currentStep.value === 0);
const isLastStep = computed(() => currentStep.value === totalSteps - 1);

function handleNext() {
  if (isLastStep.value) {
    complete();
  } else {
    nextStep();
  }
}
</script>

<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :closable="false"
    :draggable="false"
    :style="{ width: 'var(--dialog-width-md)' }"
    :pt="{
      root: { class: 'app-dialog onboarding-dialog' },
      mask: { class: 'onboarding-mask' },
    }"
  >
    <template #header>
      <div class="onboarding-header">
        <div class="step-indicators">
          <span
            v-for="i in totalSteps"
            :key="i"
            class="step-dot"
            :class="{ active: currentStep === i - 1, done: currentStep > i - 1 }"
          />
        </div>
      </div>
    </template>

    <div class="onboarding-body">
      <Transition name="step-fade" mode="out-in">
        <WelcomeStep v-if="currentStep === 0" key="welcome" />
        <UploadStep v-else-if="currentStep === 1" key="upload" />
        <ServicesStep v-else key="services" />
      </Transition>
    </div>

    <template #footer>
      <Button
        label="跳过引导"
        text
        severity="secondary"
        class="dialog-btn-secondary"
        @click="complete"
      />
      <Button
        v-if="!isFirstStep"
        label="上一步"
        outlined
        severity="secondary"
        class="dialog-btn-reject"
        @click="prevStep"
      />
      <Button
        :label="isLastStep ? '开始使用' : '下一步'"
        class="dialog-btn-accept"
        @click="handleNext"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.onboarding-header {
  width: 100%;
  display: flex;
  justify-content: center;
}

.step-indicators {
  display: flex;
  gap: var(--space-xs-sm);
  align-items: center;
}

.step-dot {
  width: 8px;
  height: 6px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 全圆角药丸形，无对应 radius token */
  border-radius: 9999px;
  background: var(--border-subtle);
  transition: all var(--duration-medium) var(--ease-overshoot);
}

.step-dot.active {
  width: 28px;
  background: var(--primary);
}

.step-dot.done {
  background: var(--primary);
  opacity: 0.4;
}

.onboarding-body {
  width: 100%;
  padding: var(--space-sm) 0 var(--space-lg);
  min-height: 340px;
  max-height: min(520px, calc(100vh - 180px));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden auto;
}

/* 底栏布局与按钮规格由 .app-dialog 统一提供（"跳过引导"用 .dialog-btn-secondary，
   自带 margin-right:auto 顶到左侧），见 src/styles/app.css 第 3 节 */

.step-fade-enter-active,
.step-fade-leave-active {
  transition: opacity var(--duration-normal) ease, transform var(--duration-normal) ease;
}

.step-fade-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.step-fade-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
</style>

<style>
/* 外壳（圆角/背景/阴影/头尾内边距/按钮规格）由 .app-dialog 统一提供。
   这里只写引导弹窗的差异：正文自带上下留白且需要自行滚动，故取消内容区默认内边距。 */
.onboarding-dialog .p-dialog-content {
  padding: 0 var(--space-xl) !important;
  overflow: hidden !important;
}
</style>
