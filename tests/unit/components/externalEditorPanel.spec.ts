import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';

// TyporaCard 用 useToast 做剪贴板失败提示；单测无 PrimeVue ToastService 上下文，
// 直接 mock 成 no-op 避免 mount 时抛 "No PrimeVue Toast provided"
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    show: vi.fn(), clear: vi.fn(),
    showConfig: vi.fn(),
  }),
}));

import ExternalEditorPanel from '@/components/settings/ExternalEditorPanel.vue';

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

vi.mock('@/composables/useServiceHealth', () => ({
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
    const wrapper = mountWithDefaults(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: false,
          typoraEnabled: false,
          cliEnabled: true,
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
    const wrapper = mountWithDefaults(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: true,
          typoraEnabled: false,
          cliEnabled: true,
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
    await input.trigger('blur');
    await flush();

    const allUpdates = (wrapper.emitted('update:editorServer') ?? []) as Array<[Record<string, unknown>]>;
    const validUpdates = allUpdates.some(([payload]) => payload.port === 36800);
    expect(validUpdates).toBe(true);
  });

  it('explains the complete BRAT and official installation flow without exposing internal auth', async () => {
    const wrapper = mountWithDefaults(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: true,
          typoraEnabled: false,
          cliEnabled: true,
          port: 36799,
          typoraService: 'jd',
          obsidianService: 'jd',
          authToken: 'secret-token',
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

    const text = wrapper.text();
    expect(text).toContain('关闭「受限模式」');
    expect(text).toContain('BRAT');
    expect(text).toContain('Add beta plugin');
    expect(text).toContain('joeyliu6/picnexus-obsidian');
    expect(text).toContain('启用 PicNexus');
    expect(text).toContain('上架后可直接搜索 PicNexus 安装');
    expect(text).toContain('保持端口');
    expect(text).toContain('测试连接');
    expect(text).not.toContain('Token');
    expect(wrapper.find('.guide-link').attributes('href')).toBe(
      'https://github.com/joeyliu6/PicNexus/blob/main/docs/reference/guides/obsidian-plugin-installation.md',
    );
    expect(wrapper.find('.auth-token-text').exists()).toBe(false);
    expect(wrapper.find('.auth-icon-btn').exists()).toBe(false);
    expect(wrapper.find('.pi-copy').exists()).toBe(false);
    expect(wrapper.find('.pi-refresh').exists()).toBe(false);
  });

  it('shows Typora profile command without CLI summary text', async () => {
    const wrapper = mountWithDefaults(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: false,
          typoraEnabled: true,
          cliEnabled: true,
          port: 36799,
          typoraService: 'jd',
          obsidianService: null,
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

    // 展开 Typora 卡片
    await wrapper.findAll('.card-header')[0].trigger('click');
    await flush();

    const text = wrapper.text();
    expect(text).toContain('--profile typora');
    expect(text).not.toContain('CLI 开启');
    expect(text).not.toContain('CLI 关闭');
    expect(text).not.toContain('--service <图床名>');
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

    const wrapper = mountWithDefaults(ExternalEditorPanel, {
      props: {
        editorServer: {
          enabled: true,
          typoraEnabled: false,
          cliEnabled: true,
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
