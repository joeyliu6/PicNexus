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

const ButtonStub = defineComponent({
  name: 'Button',
  props: { label: { type: String, default: '' } },
  template: '<button :data-label="label"><slot />{{ label }}</button>',
});

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

  it('加密失败时不写入 profile，也不丢掉用户输入的草稿', async () => {
    vi.mocked(WebDAVClient.encryptPassword).mockRejectedValueOnce(new Error('加密失败'));
    const { wrapper, config } = mountConfig();

    const field = passwordField(wrapper);
    await field.get('input').setValue('nas-pw');
    await field.get('input').trigger('blur');
    await nextTick();
    await nextTick();

    expect(config.value.profiles[0].passwordEncrypted).toBeUndefined();
    // 抹掉刚输入的内容是二次伤害——草稿要留着让用户能重试
    expect(passwordField(wrapper).props('modelValue')).toBe('nas-pw');
  });
});

// 表单其余部分：跟着密码一起被 useWebDAVProfileEditor 重写过，一并钉住
describe('WebDAVConfigCollapsible 表单与配置管理', () => {
  /** InputText 在 DOM 里的顺序：名称、URL、用户名、密码、远程路径 */
  const NAME = 0, URL = 1, USERNAME = 2, REMOTE_PATH = 4;

  function inputAt(wrapper: ReturnType<typeof mountConfig>['wrapper'], index: number) {
    return wrapper.findAllComponents(InputTextStub)[index];
  }

  it('折叠头部可以展开收起', async () => {
    const { wrapper } = mountConfig({
      profiles: [makeProfile({ passwordEncrypted: 'cipher(x)' })],
    });

    const root = wrapper.get('.webdav-collapsible');
    const before = root.classes().includes('expanded');
    await wrapper.get('.card-header').trigger('click');
    expect(root.classes().includes('expanded')).toBe(!before);
  });

  it('改名称/URL/用户名/远程路径都会回写并触发保存', async () => {
    const { wrapper, config } = mountConfig();

    await inputAt(wrapper, NAME).get('input').setValue('群晖 NAS');
    await inputAt(wrapper, URL).get('input').setValue('https://nas.local/dav');
    await inputAt(wrapper, USERNAME).get('input').setValue('admin');
    await inputAt(wrapper, REMOTE_PATH).get('input').setValue('/backup/');
    await inputAt(wrapper, REMOTE_PATH).get('input').trigger('blur');
    await nextTick();

    expect(config.value.profiles[0]).toMatchObject({
      name: '群晖 NAS',
      url: 'https://nas.local/dav',
      username: 'admin',
      remotePath: '/backup/',
    });
    expect(wrapper.emitted('save')).toBeTruthy();
  });

  it('非回环的 HTTP 地址会给出 HTTPS 提示', async () => {
    const { wrapper } = mountConfig({
      profiles: [makeProfile({ url: 'http://dav.example.com/dav' })],
    });

    expect(wrapper.get('.field-hint').text()).toContain('HTTP 仅保留给本机回环服务');
  });

  it('点测试连接同时触发保存和测试', async () => {
    const { wrapper } = mountConfig({
      profiles: [makeProfile({ passwordEncrypted: 'cipher(x)' })],
    });

    await wrapper.get('[data-label="测试连接"]').trigger('click');

    expect(wrapper.emitted('save')).toBeTruthy();
    expect(wrapper.emitted('test')).toHaveLength(1);
  });

  it('配置没填全时测试连接按钮不可用', () => {
    const { wrapper } = mountConfig({ profiles: [makeProfile({ username: '' })] });

    expect(wrapper.getComponent(ButtonStub).props('label')).toBe('测试连接');
    expect(wrapper.findComponent(ButtonStub).attributes('disabled')).toBeDefined();
  });

  it('切换 tab 会换 activeId', async () => {
    const { wrapper, config } = mountConfig({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2', name: '公司' })],
      activeId: 'dav-1',
    });

    await wrapper.findAll('.tab-btn')[1].trigger('click');

    expect(config.value.activeId).toBe('dav-2');
  });

  it('加号新建一份空配置并切过去', async () => {
    const { wrapper, config } = mountConfig();

    await wrapper.get('.add-btn').trigger('click');

    expect(config.value.profiles).toHaveLength(2);
    expect(config.value.activeId).toBe(config.value.profiles[1].id);
  });

  it('删除配置走确认后生效', async () => {
    const { wrapper, config } = mountConfig({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2' })],
    });

    await wrapper.get('[data-label="删除配置"]').trigger('click');

    expect(config.value.profiles).toHaveLength(1);
    expect(config.value.profiles[0].id).toBe('dav-2');
  });

  it('一个配置都没有时显示空状态，可从这里新建', async () => {
    const { wrapper, config } = mountConfig({ profiles: [], activeId: null });

    expect(wrapper.get('.empty-webdav').text()).toContain('尚未配置 WebDAV 连接');

    await wrapper.get('[data-label="添加配置"]').trigger('click');
    expect(config.value.profiles).toHaveLength(1);
  });
});
