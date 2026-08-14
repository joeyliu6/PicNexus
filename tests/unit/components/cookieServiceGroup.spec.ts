import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import CookieServiceGroup from '@/components/settings/hosting/CookieServiceGroup.vue';
import SensitiveField from '@/components/common/SensitiveField.vue';

const HostingCardStub = defineComponent({
  name: 'HostingCard',
  props: ['id'],
  template: '<div class="hosting-card" :data-id="id"><slot /><slot name="extra" /></div>',
});

const SectionStub = defineComponent({ name: 'SectionStub', template: '<div />' });

const InputTextStub = defineComponent({
  name: 'InputText',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'blur'],
  template: '<input :value="modelValue" @blur="$emit(\'blur\', $event)" />',
});

const TextareaStub = defineComponent({
  name: 'Textarea',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'blur'],
  methods: {
    onInput(event: Event) {
      this.$emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
    },
  },
  template: '<textarea :value="modelValue" @input="onInput" @blur="$emit(\'blur\', $event)" />',
});

/** 模板里六个服务的渲染顺序 */
const SERVICES = ['weibo', 'zhihu', 'nowcoder', 'nami', 'bilibili', 'chaoxing'] as const;

function makeCookieFormData(over: Record<string, { cookie: string }> = {}) {
  return {
    weibo: { cookie: '' },
    zhihu: { cookie: '' },
    nowcoder: { cookie: '' },
    nami: { cookie: '' },
    bilibili: { cookie: '' },
    chaoxing: { cookie: '' },
    ...over,
  };
}

function mountGroup(cookieFormData = makeCookieFormData()) {
  const wrapper = mountWithDefaults(CookieServiceGroup, {
    props: {
      cookieFormData,
      testingConnections: {},
      healthStatusMap: {},
      healthTooltipMap: {},
      refreshingServiceIds: new Set<string>(),
      linkPrefixEnabled: false,
      prefixList: [],
      selectedPrefixIndex: 0,
    },
    global: {
      stubs: {
        HostingCard: HostingCardStub,
        WeiboLinkPrefixSection: SectionStub,
        ZhihuSourceSection: SectionStub,
        InputText: InputTextStub,
        Textarea: TextareaStub,
      },
    },
  });

  return { wrapper, cookieFormData };
}

/** 取某个服务卡片里的 Cookie 字段（每张卡第一个 SensitiveField） */
function cookieField(wrapper: ReturnType<typeof mountGroup>['wrapper'], id: string) {
  const card = wrapper.findAll('.hosting-card').find(c => c.attributes('data-id') === id);
  return wrapper.findAllComponents(SensitiveField).find(f => card?.element.contains(f.element));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CookieServiceGroup 敏感字段', () => {
  it('六个服务各渲染一个多行 Cookie 字段', () => {
    const { wrapper } = mountGroup();

    for (const id of SERVICES) {
      const field = cookieField(wrapper, id);
      expect(field, `缺少 ${id} 的 Cookie 字段`).toBeTruthy();
      expect(field?.props('multiline')).toBe(true);
    }
  });

  it('已保存的 Cookie 不回填 textarea，改用「已保存」芯片表示', () => {
    const { wrapper } = mountGroup(makeCookieFormData({ zhihu: { cookie: 'SUB=stored' } }));

    const field = cookieField(wrapper, 'zhihu');
    expect(field?.props('modelValue')).toBe('');
    expect(field?.props('hasStoredValue')).toBe(true);
    expect(field?.get('textarea').element.value).toBe('');

    expect(wrapper.findAll('.saved-chip')).toHaveLength(1);
  });

  it('点眼睛才取回已保存的 Cookie —— multiline 也要能看到', async () => {
    const { wrapper } = mountGroup(makeCookieFormData({ zhihu: { cookie: 'SUB=stored' } }));
    const field = cookieField(wrapper, 'zhihu');

    await field?.get('button').trigger('click');
    await nextTick();

    expect(field?.get('textarea').element.value).toBe('SUB=stored');
  });

  it('揭示态失焦不触发保存 —— 看一眼不等于改一次', async () => {
    const { wrapper } = mountGroup(makeCookieFormData({ zhihu: { cookie: 'SUB=stored' } }));
    const field = cookieField(wrapper, 'zhihu');

    await field?.get('button').trigger('click');
    await nextTick();
    await field?.get('textarea').trigger('blur');
    await nextTick();

    expect(field?.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('输入新 Cookie 失焦后写回 formData 并触发保存', async () => {
    const { wrapper, cookieFormData } = mountGroup();
    const field = cookieField(wrapper, 'bilibili');

    await field?.get('textarea').setValue('SESSDATA=new');
    await field?.get('textarea').trigger('blur');
    await nextTick();

    expect(cookieFormData.bilibili.cookie).toBe('SESSDATA=new');
    expect(cookieFormData.weibo.cookie).toBe('');
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('留空失焦不改动已保存的 Cookie', async () => {
    const { wrapper, cookieFormData } = mountGroup(
      makeCookieFormData({ nowcoder: { cookie: 'keep-me' } }),
    );
    const field = cookieField(wrapper, 'nowcoder');

    await field?.get('textarea').trigger('blur');
    await nextTick();

    expect(cookieFormData.nowcoder.cookie).toBe('keep-me');
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('纳米的 Auth-Token 只在点眼睛后显示，且不进 modelValue', async () => {
    const { wrapper } = mountGroup(
      makeCookieFormData({ nami: { cookie: 'sid=1; Auth-Token=nami-token-xyz; other=2' } }),
    );

    const namiCard = wrapper.findAll('.hosting-card').find(c => c.attributes('data-id') === 'nami');
    const fields = wrapper
      .findAllComponents(SensitiveField)
      .filter(f => namiCard?.element.contains(f.element));

    // 第一个是 Cookie，第二个是派生出来的 Auth-Token
    expect(fields).toHaveLength(2);
    const tokenField = fields[1];
    expect(tokenField.props('modelValue')).toBe('');
    expect(tokenField.props('hasStoredValue')).toBe(true);

    await tokenField.get('button').trigger('click');
    await nextTick();

    expect(tokenField.get('input').element.value).toBe('nami-token-xyz');
    expect(tokenField.emitted('update:modelValue')).toBeUndefined();
  });

  it('纳米 Cookie 里没有 token 时不渲染 Auth-Token 字段', () => {
    const { wrapper } = mountGroup(makeCookieFormData({ nami: { cookie: 'unrelated=1' } }));

    const namiCard = wrapper.findAll('.hosting-card').find(c => c.attributes('data-id') === 'nami');
    const fields = wrapper
      .findAllComponents(SensitiveField)
      .filter(f => namiCard?.element.contains(f.element));

    expect(fields).toHaveLength(1);
  });
});
