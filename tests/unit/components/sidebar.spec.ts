import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import Sidebar from '@/components/layout/Sidebar.vue';

const mockState = vi.hoisted(() => ({
  hasAvailableUpdate: undefined as any,
}));

vi.mock('@/composables/useAutoUpdate', () => ({
  useAutoUpdate: () => ({
    hasAvailableUpdate: mockState.hasAvailableUpdate,
  }),
}));

const ButtonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  props: ['label', 'icon'],
  emits: ['click'],
  template: `
    <button class="button-stub" :class="$attrs.class" @click="$emit('click')">
      <i v-if="icon" :class="icon"></i>
      <span>{{ label }}</span>
    </button>
  `,
});

function mountSidebar() {
  return mountWithDefaults(Sidebar, {
    global: {
      stubs: {
        Button: ButtonStub,
      },
    },
  });
}

describe('Sidebar update badge', () => {
  beforeEach(() => {
    mockState.hasAvailableUpdate = ref(false);
  });

  it('shows the update badge on settings when an update is available', () => {
    mockState.hasAvailableUpdate = ref(true);

    const wrapper = mountSidebar();
    const settingsButton = wrapper.findAll('.button-stub')[3];

    expect(settingsButton.classes()).toContain('has-update-badge');
  });

  it('does not show the update badge when no update is available', () => {
    const wrapper = mountSidebar();
    const settingsButton = wrapper.findAll('.button-stub')[3];

    expect(settingsButton.classes()).not.toContain('has-update-badge');
  });
});
