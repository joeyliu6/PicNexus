<script setup lang="ts">
import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useOnboarding } from '../../composables/useOnboarding';
import WelcomeStep from './steps/WelcomeStep.vue';
import UploadStep from './steps/UploadStep.vue';
import ServicesStep from './steps/ServicesStep.vue';
import ReadyStep from './steps/ReadyStep.vue';

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
    :style="{ width: '520px' }"
    :pt="{
      root: { class: 'onboarding-dialog' },
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
        <ServicesStep v-else-if="currentStep === 2" key="services" />
        <ReadyStep v-else key="ready" />
      </Transition>
    </div>

    <template #footer>
      <div class="onboarding-footer">
        <Button
          label="跳过引导"
          text
          severity="secondary"
          size="small"
          @click="complete"
        />
        <div class="footer-actions">
          <Button
            v-if="!isFirstStep"
            label="上一步"
            outlined
            severity="secondary"
            size="small"
            @click="prevStep"
          />
          <Button
            :label="isLastStep ? '开始使用' : '下一步'"
            size="small"
            @click="handleNext"
          />
        </div>
      </div>
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
  gap: 8px;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-subtle);
  transition: background 0.2s, transform 0.2s;
}

.step-dot.active {
  background: var(--primary);
  transform: scale(1.25);
}

.step-dot.done {
  background: var(--primary);
  opacity: 0.5;
}

.onboarding-body {
  padding: 8px 0 16px;
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.footer-actions {
  display: flex;
  gap: 8px;
}

.step-fade-enter-active,
.step-fade-leave-active {
  transition: opacity 0.15s ease;
}

.step-fade-enter-from,
.step-fade-leave-to {
  opacity: 0;
}
</style>

<style>
.onboarding-dialog {
  border-radius: 16px !important;
  overflow: hidden;
}

.onboarding-dialog .p-dialog-header {
  padding: 20px 24px 0 !important;
  border-bottom: none !important;
}

.onboarding-dialog .p-dialog-content {
  padding: 0 24px !important;
}

.onboarding-dialog .p-dialog-footer {
  padding: 0 24px 20px !important;
  border-top: none !important;
}
</style>
