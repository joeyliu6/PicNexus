import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';

// mock 的是真实存在的模块导出：secureStorage 单例的 encrypt / decrypt
vi.mock('@/security/crypto', () => ({
  secureStorage: {
    encrypt: vi.fn(async (text: string) => `cipher(${text})`),
    decrypt: vi.fn(async (blob: string) => {
      if (blob === 'bad-cipher') throw new Error('数据损坏或密钥不匹配');
      return blob.replace(/^cipher\((.*)\)$/, '$1');
    }),
  },
}));

import PrivateStorageGroup from '@/components/settings/hosting/PrivateStorageGroup.vue';
import SensitiveField from '@/components/common/SensitiveField.vue';
import { secureStorage } from '@/security/crypto';
import { makeCustomS3Id } from '@/config/types';

const HostingCardStub = defineComponent({
  name: 'HostingCard',
  props: ['id'],
  template:
    '<div class="hosting-card" :data-id="id"><slot /><slot name="actions-right" /></div>',
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

function makePrivateFormData() {
  return {
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '' },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '', s3AccessKey: '', s3SecretKey: '' },
  };
}

function makeWebDAVProfile(over: Record<string, unknown> = {}) {
  return {
    id: 'dav-1',
    name: '家里的 NAS',
    url: 'https://dav.example.com/dav',
    username: 'me',
    remotePath: 'images/',
    publicDomain: 'https://cdn.example.com',
    ...over,
  };
}

function makeCustomS3Profile(over: Record<string, unknown> = {}) {
  return {
    id: 's3-1',
    name: '我的 MinIO',
    endpoint: 'https://s3.example.com',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'us-east-1',
    bucket: 'pics',
    path: '',
    publicDomain: '',
    ...over,
  };
}

/**
 * 注意：privateFormData 是普通对象，Vue 的 props 只做浅响应，
 * 挂载后再改嵌套属性不会触发重渲染。要预置的值必须在 mount 之前塞进去。
 */
function mountGroup(over: Record<string, unknown> = {}, seed?: (fd: ReturnType<typeof makePrivateFormData>) => void) {
  const privateFormData = makePrivateFormData();
  seed?.(privateFormData);

  const wrapper = mountWithDefaults(PrivateStorageGroup, {
    props: {
      privateFormData,
      customS3Profiles: [],
      webdavProfiles: [],
      testingConnections: {},
      healthStatusMap: {},
      healthTooltipMap: {},
      refreshingServiceIds: new Set<string>(),
      ...over,
    },
    global: {
      stubs: { HostingCard: HostingCardStub, InputText: InputTextStub },
    },
  });

  return { wrapper, privateFormData };
}

/** 取某张卡片里的第 n 个 SensitiveField */
function fieldsInCard(wrapper: ReturnType<typeof mountGroup>['wrapper'], cardId: string) {
  const card = wrapper.findAll('.hosting-card').find(c => c.attributes('data-id') === cardId);
  return wrapper
    .findAllComponents(SensitiveField)
    .filter(f => card?.element.contains(f.element));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// 这一组钉住的是 9267de7 已发布的行为，重构到共享 composable 时不得改变
describe('PrivateStorageGroup · WebDAV 图床密码（已发布契约）', () => {
  it('已保存密码时输入框为空、挂「已保存」芯片、占位文案为留空则不修改', () => {
    const { wrapper } = mountGroup({
      webdavProfiles: [makeWebDAVProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    const [field] = fieldsInCard(wrapper, 'webdav:dav-1');
    expect(field.props('modelValue')).toBe('');
    expect(field.props('hasStoredValue')).toBe(true);
    expect(field.props('placeholder')).toBe('留空则不修改');
    expect(wrapper.findAll('.saved-chip')).toHaveLength(1);
  });

  it('没存过密码时不挂芯片，眼睛按钮禁用', () => {
    const { wrapper } = mountGroup({ webdavProfiles: [makeWebDAVProfile()] });

    const [field] = fieldsInCard(wrapper, 'webdav:dav-1');
    expect(field.props('hasStoredValue')).toBe(false);
    expect(field.props('revealStored')).toBeNull();
    expect(field.props('placeholder')).toBe('输入 WebDAV 密码');
    expect(wrapper.findAll('.saved-chip')).toHaveLength(0);
  });

  it('渲染时不解密，点眼睛才解密', async () => {
    const { wrapper } = mountGroup({
      webdavProfiles: [makeWebDAVProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    expect(secureStorage.decrypt).not.toHaveBeenCalled();

    const [field] = fieldsInCard(wrapper, 'webdav:dav-1');
    await field.get('button').trigger('click');
    await nextTick();

    expect(secureStorage.decrypt).toHaveBeenCalledWith('cipher(nas-pw)');
    expect(field.get('input').element.value).toBe('nas-pw');
  });

  it('揭示态失焦不重新加密写回 —— 看一眼不等于改一次', async () => {
    const { wrapper } = mountGroup({
      webdavProfiles: [makeWebDAVProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    const [field] = fieldsInCard(wrapper, 'webdav:dav-1');
    await field.get('button').trigger('click');
    await nextTick();
    await field.get('input').trigger('blur');
    await nextTick();

    expect(secureStorage.encrypt).not.toHaveBeenCalled();
    expect(wrapper.emitted('updateWebdav')).toBeUndefined();
    expect(field.emitted('update:modelValue')).toBeUndefined();
  });

  it('输入新密码失焦后加密并 emit updateWebdav + save', async () => {
    const { wrapper } = mountGroup({ webdavProfiles: [makeWebDAVProfile()] });

    const [field] = fieldsInCard(wrapper, 'webdav:dav-1');
    await field.get('input').setValue('new-pw');
    await field.get('input').trigger('blur');
    await nextTick();
    await nextTick();

    expect(secureStorage.encrypt).toHaveBeenCalledWith('new-pw');
    const updated = wrapper.emitted('updateWebdav')?.[0]?.[0] as Record<string, unknown>;
    expect(updated.passwordEncrypted).toBe('cipher(new-pw)');
    // 明文绝不落进 profile
    expect(updated.password).toBeUndefined();
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('留空失焦不改动已保存的密码', async () => {
    const { wrapper } = mountGroup({
      webdavProfiles: [makeWebDAVProfile({ passwordEncrypted: 'cipher(nas-pw)' })],
    });

    const [field] = fieldsInCard(wrapper, 'webdav:dav-1');
    await field.get('input').trigger('blur');
    await nextTick();

    expect(secureStorage.encrypt).not.toHaveBeenCalled();
    expect(wrapper.emitted('updateWebdav')).toBeUndefined();
  });

  it('解密失败时不进入展示态', async () => {
    const { wrapper } = mountGroup({
      webdavProfiles: [makeWebDAVProfile({ passwordEncrypted: 'bad-cipher' })],
    });

    const [field] = fieldsInCard(wrapper, 'webdav:dav-1');
    await field.get('button').trigger('click');
    await nextTick();

    expect(field.get('input').element.value).toBe('');
    expect(field.get('input').attributes('readonly')).toBeUndefined();
  });

  it('多个 WebDAV profile 的密码草稿互不串', async () => {
    const { wrapper } = mountGroup({
      webdavProfiles: [
        makeWebDAVProfile({ id: 'dav-1' }),
        makeWebDAVProfile({ id: 'dav-2', name: '公司 NAS' }),
      ],
    });

    const [first] = fieldsInCard(wrapper, 'webdav:dav-1');
    const [second] = fieldsInCard(wrapper, 'webdav:dav-2');

    await first.get('input').setValue('pw-one');
    await nextTick();

    expect(second.props('modelValue')).toBe('');
  });
});

describe('PrivateStorageGroup · 内置 S3 密钥', () => {
  // r2 的 password 字段依次是 accessKeyId、secretAccessKey
  it('已保存的密钥不回填输入框，改用「已保存」芯片表示', () => {
    const { wrapper } = mountGroup({}, fd => { fd.r2.accessKeyId = 'AKIA-stored'; });

    const [accessKeyId, secretAccessKey] = fieldsInCard(wrapper, 'r2');

    expect(accessKeyId.props('modelValue')).toBe('');
    expect(accessKeyId.get('input').element.value).toBe('');
    expect(accessKeyId.props('hasStoredValue')).toBe(true);
    expect(accessKeyId.props('placeholder')).toBe('留空则不修改');

    // 没存过的那个不挂芯片，占位保持原文案
    expect(secretAccessKey.props('hasStoredValue')).toBe(false);
    expect(secretAccessKey.props('revealStored')).toBeNull();
    expect(secretAccessKey.props('placeholder')).toBe('输入 Secret Access Key');

    expect(wrapper.findAll('.saved-chip')).toHaveLength(1);
  });

  it('点眼睛取回明文，且不经过解密 —— 这类字段本来就是明文', async () => {
    const { wrapper } = mountGroup({}, fd => { fd.r2.accessKeyId = 'AKIA-stored'; });

    const [accessKeyId] = fieldsInCard(wrapper, 'r2');
    await accessKeyId.get('button').trigger('click');
    await nextTick();

    expect(accessKeyId.get('input').element.value).toBe('AKIA-stored');
    expect(secureStorage.decrypt).not.toHaveBeenCalled();
  });

  it('输入新密钥失焦后写回 formData 并触发保存', async () => {
    const { wrapper, privateFormData } = mountGroup();

    const [, secretAccessKey] = fieldsInCard(wrapper, 'r2');
    await secretAccessKey.get('input').setValue('secret-new');
    await secretAccessKey.get('input').trigger('blur');
    await nextTick();

    expect(privateFormData.r2.secretAccessKey).toBe('secret-new');
    expect(privateFormData.r2.accessKeyId).toBe('');
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('留空失焦不改动已保存的密钥', async () => {
    const { wrapper, privateFormData } = mountGroup({}, fd => { fd.qiniu.accessKey = 'keep-me'; });

    const [accessKey] = fieldsInCard(wrapper, 'qiniu');
    await accessKey.get('input').trigger('blur');
    await nextTick();

    expect(privateFormData.qiniu.accessKey).toBe('keep-me');
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('揭示态失焦不写回 —— 看一眼不等于改一次', async () => {
    const { wrapper, privateFormData } = mountGroup({}, fd => {
      fd.aliyun.accessKeyId = 'LTAI-stored';
    });

    const [accessKeyId] = fieldsInCard(wrapper, 'aliyun');
    await accessKeyId.get('button').trigger('click');
    await nextTick();
    await accessKeyId.get('input').trigger('blur');
    await nextTick();

    expect(privateFormData.aliyun.accessKeyId).toBe('LTAI-stored');
    expect(accessKeyId.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('非密码字段照旧直接回填，不走草稿', () => {
    const { wrapper } = mountGroup({}, fd => { fd.tencent.region = 'ap-guangzhou'; });

    const card = wrapper.findAll('.hosting-card').find(c => c.attributes('data-id') === 'tencent');
    const regionInput = card?.findAll('input').find(i => i.element.value === 'ap-guangzhou');
    expect(regionInput).toBeTruthy();
  });

  it('五个内置服务的密码字段全部接上草稿机', () => {
    const { wrapper } = mountGroup();

    // r2/tencent/aliyun/qiniu 各 2 个；upyun 4 个 —— 它有两套凭证：
    // operator/password 走 REST（编辑器/CLI），s3AccessKey/s3SecretKey 走 S3（GUI 上传）
    const counts = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'].map(
      id => fieldsInCard(wrapper, id).length,
    );
    expect(counts).toEqual([2, 2, 2, 2, 4]);
  });
});

describe('PrivateStorageGroup · 自定义 S3 密钥', () => {
  const cardId = makeCustomS3Id('s3-1');

  it('已保存的密钥不回填，挂「已保存」芯片', () => {
    const { wrapper } = mountGroup({
      customS3Profiles: [makeCustomS3Profile({ accessKeyId: 'AKIA-stored' })],
    });

    const [accessKeyId] = fieldsInCard(wrapper, cardId);
    expect(accessKeyId.props('modelValue')).toBe('');
    expect(accessKeyId.props('hasStoredValue')).toBe(true);
    expect(wrapper.findAll('.saved-chip')).toHaveLength(1);
  });

  it('输入新密钥失焦后 emit updateCustomS3 + save', async () => {
    const { wrapper } = mountGroup({
      customS3Profiles: [makeCustomS3Profile()],
    });

    const [accessKeyId] = fieldsInCard(wrapper, cardId);
    await accessKeyId.get('input').setValue('AKIA-new');
    await accessKeyId.get('input').trigger('blur');
    await nextTick();

    const updated = wrapper.emitted('updateCustomS3')?.[0]?.[0] as Record<string, unknown>;
    expect(updated.accessKeyId).toBe('AKIA-new');
    expect(updated.id).toBe('s3-1');
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('点眼睛取回已保存的明文密钥', async () => {
    const { wrapper } = mountGroup({
      customS3Profiles: [makeCustomS3Profile({ secretAccessKey: 'sk-stored' })],
    });

    const [, secretAccessKey] = fieldsInCard(wrapper, cardId);
    await secretAccessKey.get('button').trigger('click');
    await nextTick();

    expect(secretAccessKey.get('input').element.value).toBe('sk-stored');
  });

  it('两个自定义 S3 配置的草稿互不串', async () => {
    const { wrapper } = mountGroup({
      customS3Profiles: [
        makeCustomS3Profile({ id: 's3-1' }),
        makeCustomS3Profile({ id: 's3-2', name: '另一个' }),
      ],
    });

    const [firstKey] = fieldsInCard(wrapper, makeCustomS3Id('s3-1'));
    const [secondKey] = fieldsInCard(wrapper, makeCustomS3Id('s3-2'));

    await firstKey.get('input').setValue('only-first');
    await nextTick();

    expect(secondKey.props('modelValue')).toBe('');
  });
});

// 又拍云的 S3 凭证说明有四行，摊在字段下方会把后面的字段挤开，
// 且紧贴着下一个 label，容易被读成下一个字段的说明——所以收进 label 右侧的图标。
describe('PrivateStorageGroup · 长说明收进 label 图标', () => {
  function upyunCard() {
    const { wrapper } = mountGroup();
    const card = wrapper.findAll('.hosting-card').find(c => c.attributes('data-id') === 'upyun');
    if (!card) throw new Error('没找到又拍云卡片');
    return card;
  }

  it('S3 AccessKey 的长说明挂在图标的 tooltip 上', () => {
    const icon = upyunCard().find('.field-info-icon');

    expect(icon.exists()).toBe(true);
    expect(icon.attributes('data-tooltip')).toContain('与上面的操作员账号密码是两回事');
    // 说明同时进 aria-label，否则读屏用户拿不到这段信息
    expect(icon.attributes('aria-label')).toContain('与上面的操作员账号密码是两回事');
    // 可聚焦，键盘用户才触发得了 tooltip
    expect(icon.attributes('tabindex')).toBe('0');
  });

  it('同一段说明不再留在字段下方', () => {
    const texts = upyunCard().findAll('.field-hint').map(h => h.text());

    expect(texts.some(t => t.includes('与上面的操作员账号密码是两回事'))).toBe(false);
  });

  it('短说明仍然常驻显示，没被一起藏起来', () => {
    const texts = upyunCard().findAll('.field-hint').map(h => h.text());

    expect(texts.some(t => t.includes('建议填 HTTPS'))).toBe(true);
  });
});
