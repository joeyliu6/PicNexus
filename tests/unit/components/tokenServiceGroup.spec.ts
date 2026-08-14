import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import TokenServiceGroup from '@/components/settings/hosting/TokenServiceGroup.vue';
import SensitiveField from '@/components/common/SensitiveField.vue';

const HostingCardStub = defineComponent({
  name: 'HostingCard',
  template: '<div class="hosting-card"><slot /><slot name="extra" /></div>',
});

const GithubProxySectionStub = defineComponent({
  name: 'GithubProxySection',
  template: '<div class="github-proxy" />',
});

const InputTextStub = defineComponent({
  name: 'InputText',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'blur'],
  methods: {
    onInput(event: Event) {
      this.$emit('update:modelValue', (event.target as HTMLInputElement).value);
    },
  },
  template: '<input :value="modelValue" @input="onInput" @blur="$emit(\'blur\', $event)" />',
});

/** 模板里 SensitiveField 的出现顺序 */
const FIELD = {
  smmsToken: 0,
  githubToken: 1,
  imgurClientId: 2,
  imgurClientSecret: 3,
} as const;

function makeFormData(over: Record<string, unknown> = {}) {
  return {
    smms: { token: '' },
    github: { token: '', owner: '', repo: '', branch: 'main', path: '' },
    imgur: { clientId: '', clientSecret: '' },
    ...over,
  };
}

function mountGroup(tokenFormData = makeFormData()) {
  const wrapper = mountWithDefaults(TokenServiceGroup, {
    props: {
      tokenFormData,
      testingConnections: {},
      healthStatusMap: {},
      healthTooltipMap: {},
      refreshingServiceIds: new Set<string>(),
    },
    global: {
      stubs: {
        HostingCard: HostingCardStub,
        GithubProxySection: GithubProxySectionStub,
        InputText: InputTextStub,
      },
    },
  });

  return { wrapper, tokenFormData };
}

function fieldAt(wrapper: ReturnType<typeof mountGroup>['wrapper'], index: number) {
  return wrapper.findAllComponents(SensitiveField)[index];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TokenServiceGroup 敏感字段', () => {
  it('渲染四个敏感字段', () => {
    const { wrapper } = mountGroup();
    expect(wrapper.findAllComponents(SensitiveField)).toHaveLength(4);
  });

  it('已保存的 token 不回填输入框，改用「已保存」芯片表示', () => {
    const { wrapper } = mountGroup(makeFormData({ smms: { token: 'tok-stored' } }));

    const field = fieldAt(wrapper, FIELD.smmsToken);
    // 界面只显示「有没有」，不显示「是什么」
    expect(field.props('modelValue')).toBe('');
    expect(field.props('hasStoredValue')).toBe(true);
    expect(field.get('input').element.value).toBe('');

    expect(wrapper.findAll('.saved-chip')).toHaveLength(1);
    expect(field.props('placeholder')).toBe('留空则不修改');
  });

  it('没存过的字段不显示芯片，眼睛按钮禁用', () => {
    const { wrapper } = mountGroup();

    expect(wrapper.findAll('.saved-chip')).toHaveLength(0);

    const field = fieldAt(wrapper, FIELD.smmsToken);
    expect(field.props('hasStoredValue')).toBe(false);
    expect(field.props('revealStored')).toBeNull();
    expect(field.get('button').attributes('disabled')).toBeDefined();
  });

  it('点眼睛才取回已保存的明文', async () => {
    const { wrapper } = mountGroup(makeFormData({ smms: { token: 'tok-stored' } }));
    const field = fieldAt(wrapper, FIELD.smmsToken);

    await field.get('button').trigger('click');
    await nextTick();

    expect(field.get('input').element.value).toBe('tok-stored');
  });

  it('揭示态失焦不触发保存 —— 看一眼不等于改一次', async () => {
    const { wrapper } = mountGroup(makeFormData({ smms: { token: 'tok-stored' } }));
    const field = fieldAt(wrapper, FIELD.smmsToken);

    await field.get('button').trigger('click');
    await nextTick();
    await field.get('input').trigger('blur');
    await nextTick();

    // 明文若流回 modelValue，这里就会冒出一次 save，把"查看"变成"重新写回"
    expect(field.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('输入新值失焦后写回 formData 并触发保存', async () => {
    const { wrapper, tokenFormData } = mountGroup();
    const field = fieldAt(wrapper, FIELD.githubToken);

    await field.get('input').setValue('ghp_new');
    await field.get('input').trigger('blur');
    await nextTick();

    expect(tokenFormData.github.token).toBe('ghp_new');
    expect(wrapper.emitted('save')).toHaveLength(1);
    // 草稿提交后即清空，明文不常驻
    expect(field.props('modelValue')).toBe('');
  });

  it('留空失焦不改动已保存的值', async () => {
    const { wrapper, tokenFormData } = mountGroup(
      makeFormData({ smms: { token: 'tok-stored' } }),
    );
    const field = fieldAt(wrapper, FIELD.smmsToken);

    await field.get('input').trigger('blur');
    await nextTick();

    expect(tokenFormData.smms.token).toBe('tok-stored');
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('四个字段各自独立，互不串值', async () => {
    const { wrapper, tokenFormData } = mountGroup();

    await fieldAt(wrapper, FIELD.imgurClientId).get('input').setValue('client-id');
    await fieldAt(wrapper, FIELD.imgurClientId).get('input').trigger('blur');
    await nextTick();

    expect(tokenFormData.imgur.clientId).toBe('client-id');
    expect(tokenFormData.imgur.clientSecret).toBe('');
    expect(fieldAt(wrapper, FIELD.imgurClientSecret).props('hasStoredValue')).toBe(false);
  });
});
