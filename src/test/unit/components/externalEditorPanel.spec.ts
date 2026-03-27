import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import ExternalEditorPanel from '../../../components/settings/ExternalEditorPanel.vue';

const healthStatusMap = ref<Record<string, string>>({});
const healthTooltipMap = ref<Record<string, string>>({});
const selectorTop = ref(100);
const selectorBottom = ref(300);

vi.mock('@vueuse/core', () => ({
  onClickOutside: vi.fn(),
  useElementBounding: () => ({
    top: selectorTop,
    bottom: selectorBottom,
  }),
}));

vi.mock('../../../composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    healthStatusMap,
    healthTooltipMap,
  }),
}));

const ToggleSwitchStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<button class="toggle-switch-stub" @click="$emit(\'update:modelValue\', !modelValue)" />',
};

const ButtonStub = {
  props: ['label'],
  emits: ['click'],
  template: '<button class="button-stub" @click="$emit(\'click\')">{{ label }}</button>',
};

const tooltipDirective = {
  mounted: () => {},
};

const flush = async () => {
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
};

describe('ExternalEditorPanel', () => {
  beforeEach(() => {
    healthStatusMap.value = {
      jd: 'verified',
      smms: 'pending',
      github: 'unconfigured',
      qiyu: 'unconfigured',
      r2: 'unconfigured',
      tencent: 'unconfigured',
      aliyun: 'unconfigured',
      qiniu: 'unconfigured',
      upyun: 'unconfigured',
      imgur: 'unconfigured',
      weibo: 'unconfigured',
      bilibili: 'unconfigured',
      zhihu: 'unconfigured',
      nowcoder: 'unconfigured',
      chaoxing: 'unconfigured',
      nami: 'unconfigured',
    };
    healthTooltipMap.value = Object.fromEntries(
      Object.keys(healthStatusMap.value).map((key) => [key, '状态说明']),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  it('shows only configured services in dropdown', async () => {
    const wrapper = mount(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: false,
          typoraEnabled: false,
          port: 36799,
          typoraService: null,
          obsidianService: null,
        },
      },
      global: {
        stubs: {
          ToggleSwitch: ToggleSwitchStub,
          Button: ButtonStub,
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    await wrapper.findAll('.card-header')[0].trigger('click');
    await flush();

    await wrapper.get('.service-trigger').trigger('click');
    await flush();

    const items = wrapper.findAll('.service-item').map((node) => node.text());
    expect(items).toEqual(expect.arrayContaining(['京东图床', 'SM.MS']));
    expect(items.join(' ')).not.toContain('GitHub');
  });

  it('validates port range and only emits valid port updates', async () => {
    const wrapper = mount(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: true,
          typoraEnabled: false,
          port: 36799,
          typoraService: 'jd',
          obsidianService: 'jd',
        },
      },
      global: {
        stubs: {
          ToggleSwitch: ToggleSwitchStub,
          Button: ButtonStub,
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    await wrapper.findAll('.card-header')[1].trigger('click');
    await flush();

    const input = wrapper.get('.port-input');
    await input.setValue('80');
    await input.trigger('input');
    await flush();

    expect(wrapper.find('.port-error').text()).toContain('1024-65535');
    const updates = (wrapper.emitted('update:editorServer') ?? []) as Array<[Record<string, unknown>]>;
    const invalidUpdates = updates.some(([payload]) => payload.port === 80);
    expect(invalidUpdates).toBe(false);

    await input.setValue('36800');
    await input.trigger('input');
    await flush();

    const allUpdates = (wrapper.emitted('update:editorServer') ?? []) as Array<[Record<string, unknown>]>;
    const validUpdates = allUpdates.some(([payload]) => payload.port === 36800);
    expect(validUpdates).toBe(true);
  });

  it('maps runtime status to unconfigured/ready text from /status', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({ ready: false }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ready: true, serviceName: '京东图床' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: true,
          typoraEnabled: false,
          port: 36799,
          typoraService: 'jd',
          obsidianService: 'jd',
        },
      },
      global: {
        stubs: {
          ToggleSwitch: ToggleSwitchStub,
          Button: ButtonStub,
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    await vi.advanceTimersByTimeAsync(1500);
    await nextTick();
    expect(wrapper.text()).toContain('未配置图床');

    const detectBtn = wrapper.findAll('button').find((node) => node.text().includes('检测'));
    expect(detectBtn).toBeTruthy();
    await detectBtn!.trigger('click');
    await vi.advanceTimersByTimeAsync(1500);
    await nextTick();

    expect(wrapper.text()).toContain('就绪');

    vi.useRealTimers();
  });
});
