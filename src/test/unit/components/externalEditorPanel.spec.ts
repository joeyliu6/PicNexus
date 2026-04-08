import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import ExternalEditorPanel from '../../../components/settings/ExternalEditorPanel.vue';

const healthStatusMap = ref<Record<string, string>>({});
const healthTooltipMap = ref<Record<string, string>>({});
const selectorTop = ref(100);
const selectorBottom = ref(300);

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>();
  return {
    ...actual,
    onClickOutside: vi.fn(),
    useElementBounding: () => ({
      top: selectorTop,
      bottom: selectorBottom,
    }),
    useResizeObserver: vi.fn(),
  };
});

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

  it('configuredServices only includes non-unconfigured services', async () => {
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
          ServiceSelectorDropdown: {
            props: ['configuredServices'],
            template: '<div class="selector-stub">{{ configuredServices.map(s => s.label).join(",") }}</div>',
          },
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    await flush();

    // jd=verified, smms=pending → 这两个应该出现；github=unconfigured → 不出现
    const selectorText = wrapper.findAll('.selector-stub').map((n) => n.text()).join(',');
    expect(selectorText).toContain('京东图床');
    expect(selectorText).toContain('SM.MS');
    expect(selectorText).not.toContain('GitHub');
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
          ServiceSelectorDropdown: { template: '<div />' },
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    // 展开 Obsidian 卡片
    await wrapper.findAll('.card-header')[1].trigger('click');
    await flush();

    const input = wrapper.get('.port-input');
    await input.setValue('80');
    await input.trigger('input');
    await flush();

    // 端口错误信息显示在 .test-error 元素中
    expect(wrapper.find('.test-error').text()).toContain('1024-65535');
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

  it('connection test shows warning/success based on /status response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ app: 'PicNexus', ready: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ app: 'PicNexus', ready: true, serviceName: '京东图床' }),
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
          ServiceSelectorDropdown: { template: '<div />' },
        },
        directives: {
          tooltip: tooltipDirective,
        },
      },
    });

    // 展开 Obsidian 卡片
    await wrapper.findAll('.card-header')[1].trigger('click');
    await flush();

    // 点击测试连接按钮 — 第一次返回 ready: false
    const testBtn = wrapper.find('.test-connection-btn');
    await testBtn.trigger('click');
    await flush();

    expect(wrapper.text()).toContain('未选择图床');

    // 再次点击 — 第二次返回 ready: true
    await testBtn.trigger('click');
    await flush();

    expect(wrapper.text()).toContain('连接正常');
  });
});
