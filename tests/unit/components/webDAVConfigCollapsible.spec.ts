import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import type { WebDAVConfig, WebDAVProfile } from '@/config/types';

// mock 的是真实存在的模块导出。a322dba 的教训：spec 曾经伪造了两个 Rust 侧
// 从未实现的 Tauri 命令，测试全绿而生产每次保存都静默清空备份密码。
vi.mock('@/utils/webdav', () => ({
  WebDAVClient: {
    encryptPassword: vi.fn(async (password: string) => `cipher(${password})`),
    decryptPassword: vi.fn(async (encrypted: string) => {
      if (encrypted === 'bad-cipher') return ''; // 真实实现吞掉错误返回空串
      return encrypted.replace(/^cipher\((.*)\)$/, '$1');
    }),
  },
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmDelete: vi.fn((_m: string, onConfirm: () => void) => onConfirm()),
  }),
}));

import WebDAVConfigCollapsible from '@/components/settings/backup/WebDAVConfigCollapsible.vue';
import SensitiveField from '@/components/common/SensitiveField.vue';
import { WebDAVClient } from '@/utils/webdav';

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

const ButtonStub = defineComponent({ name: 'Button', template: '<button><slot /></button>' });

function makeProfile(over: Partial<WebDAVProfile> = {}): WebDAVProfile {
  return {
    id: 'dav-1',
    name: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    username: 'me',
    remotePath: '/PicNexus/',
    ...over,
  } as WebDAVProfile;
}

/** 把 v-model 闭环接起来，才测得出"改完之后读到的是新值" */
function mountConfig(initial: Partial<WebDAVConfig> = {}) {
  const config = ref<WebDAVConfig>({
    profiles: [makeProfile()],
    activeId: 'dav-1',
    ...initial,
  });

  const wrapper = mountWithDefaults(WebDAVConfigCollapsible, {
    props: {
      modelValue: config.value,
      testing: false,
      'onUpdate:modelValue': (next: WebDAVConfig) => {
        config.value = next;
        wrapper.setProps({ modelValue: next });
      },
    },
    global: { stubs: { InputText: InputTextStub, Button: ButtonStub } },
  });

  return { wrapper, config };
}

function passwordField(wrapper: ReturnType<typeof mountConfig>['wrapper']) {
  return wrapper.getComponent(SensitiveField);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WebDAVConfigCollapsible 备份密码（密文常驻、明文按需）', () => {
  it('已保存密码时输入框为空、挂「已保存」芯片', () => {
    const { wrapper } = mountConfig({
      profiles: [makeProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    const field = passwordField(wrapper);
    expect(field.props('modelValue')).toBe('');
    expect(field.props('hasStoredValue')).toBe(true);
    expect(field.props('placeholder')).toBe('留空则不修改');
    expect(wrapper.findAll('.saved-chip')).toHaveLength(1);
  });

  it('没存过密码时不挂芯片，眼睛按钮禁用', () => {
    const { wrapper } = mountConfig();

    const field = passwordField(wrapper);
    expect(field.props('hasStoredValue')).toBe(false);
    expect(field.props('revealStored')).toBeNull();
    expect(field.props('placeholder')).toBe('输入 WebDAV 密码');
    expect(wrapper.findAll('.saved-chip')).toHaveLength(0);
  });

  it('渲染时不解密，点眼睛才解密', async () => {
    const { wrapper } = mountConfig({
      profiles: [makeProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    // 加载即解密就等于明文常驻内存，正是这次要拆掉的东西
    expect(WebDAVClient.decryptPassword).not.toHaveBeenCalled();

    const field = passwordField(wrapper);
    await field.get('button').trigger('click');
    await nextTick();

    expect(WebDAVClient.decryptPassword).toHaveBeenCalledWith('cipher(nas-pw)');
    expect(field.get('input').element.value).toBe('nas-pw');
  });

  it('揭示态失焦不重新加密写回 —— 看一眼不等于改一次', async () => {
    const { wrapper, config } = mountConfig({
      profiles: [makeProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    const field = passwordField(wrapper);
    await field.get('button').trigger('click');
    await nextTick();
    await field.get('input').trigger('blur');
    await nextTick();

    expect(WebDAVClient.encryptPassword).not.toHaveBeenCalled();
    expect(config.value.profiles[0].passwordEncrypted).toBe('cipher(nas-pw)');
    expect(field.emitted('update:modelValue')).toBeUndefined();
  });

  it('输入新密码失焦后加密落到 passwordEncrypted，明文不进 profile', async () => {
    const { wrapper, config } = mountConfig();

    const field = passwordField(wrapper);
    await field.get('input').setValue('nas-pw');
    await field.get('input').trigger('blur');
    await nextTick();
    await nextTick();

    expect(WebDAVClient.encryptPassword).toHaveBeenCalledWith('nas-pw');
    expect(config.value.profiles[0].passwordEncrypted).toBe('cipher(nas-pw)');
    expect(config.value.profiles[0].password).toBe('');
    expect(wrapper.emitted('save')).toBeTruthy();
  });

  it('留空失焦不动已保存的密码 —— a322dba 的原始缺陷', async () => {
    const { wrapper, config } = mountConfig({
      profiles: [makeProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    const field = passwordField(wrapper);
    await field.get('input').trigger('blur');
    await nextTick();

    expect(WebDAVClient.encryptPassword).not.toHaveBeenCalled();
    expect(config.value.profiles[0].passwordEncrypted).toBe('cipher(nas-pw)');
  });

  it('改密码会顶掉老配置里遗留的明文', async () => {
    const { wrapper, config } = mountConfig({
      profiles: [makeProfile({ password: '老明文' })],
    });

    // 遗留明文也算"已存过"，用户看得到自己存了东西
    expect(passwordField(wrapper).props('hasStoredValue')).toBe(true);

    const field = passwordField(wrapper);
    await field.get('input').setValue('新密码');
    await field.get('input').trigger('blur');
    await nextTick();
    await nextTick();

    expect(config.value.profiles[0].passwordEncrypted).toBe('cipher(新密码)');
    // 留着的话保存时会被重新加密，把新密文顶掉
    expect(config.value.profiles[0].password).toBe('');
  });

  it('遗留明文可以直接揭示，不走解密', async () => {
    const { wrapper } = mountConfig({ profiles: [makeProfile({ password: '老明文' })] });

    const field = passwordField(wrapper);
    await field.get('button').trigger('click');
    await nextTick();

    expect(field.get('input').element.value).toBe('老明文');
    expect(WebDAVClient.decryptPassword).not.toHaveBeenCalled();
  });

  it('解密失败时不进入展示态，也不把空串当成密码显示', async () => {
    const { wrapper } = mountConfig({
      profiles: [makeProfile({ passwordEncrypted: 'bad-cipher' })],
    });

    const field = passwordField(wrapper);
    await field.get('button').trigger('click');
    await nextTick();

    expect(field.get('input').element.value).toBe('');
    // 展示态是 readonly 的；没进去就还是可编辑的空输入框
    expect(field.get('input').attributes('readonly')).toBeUndefined();
  });
});
