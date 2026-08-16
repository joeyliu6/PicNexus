import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import type { WebDAVConfig, WebDAVProfile } from '@/config/types';
import { useWebDAVProfileEditor } from '@/composables/settings/useWebDAVProfileEditor';

function makeProfile(over: Partial<WebDAVProfile> = {}): WebDAVProfile {
  return {
    id: 'dav-1',
    name: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    username: 'me',
    password: 'secret',
    remotePath: '/PicNexus/',
    ...over,
  } as WebDAVProfile;
}

/**
 * 把 config 放进 ref，onUpdate 回写——模拟父组件的 v-model 闭环。
 * 不这么做的话就测不出"改完之后读到的是新值"。
 */
function setup(initial: Partial<WebDAVConfig> = {}, testing = false) {
  const config = ref<WebDAVConfig>({
    profiles: [makeProfile()],
    activeId: 'dav-1',
    ...initial,
  });
  const onSave = vi.fn();
  const confirmDelete = vi.fn((_message: string, onConfirm: () => void) => onConfirm());

  const editor = useWebDAVProfileEditor({
    config: () => config.value,
    testing: () => testing,
    onUpdate: next => { config.value = next; },
    onSave,
    confirmDelete,
  });

  return { editor, config, onSave, confirmDelete };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWebDAVProfileEditor · 派生状态', () => {
  it('activeProfile 按 activeId 解析，找不到时为 null', () => {
    const { editor } = setup();
    expect(editor.activeProfile.value?.id).toBe('dav-1');

    const missing = setup({ activeId: 'nope' });
    expect(missing.editor.activeProfile.value).toBeNull();

    const empty = setup({ profiles: [], activeId: null });
    expect(empty.editor.activeProfile.value).toBeNull();
  });

  it('hasValidConfig 接受明文或密文任一形式的密码', () => {
    expect(setup().editor.hasValidConfig.value).toBe(true);

    const encrypted = setup({
      profiles: [makeProfile({ password: '', passwordEncrypted: 'cipher(x)' })],
    });
    expect(encrypted.editor.hasValidConfig.value).toBe(true);

    const noPassword = setup({ profiles: [makeProfile({ password: '' })] });
    expect(noPassword.editor.hasValidConfig.value).toBe(false);

    const noUrl = setup({ profiles: [makeProfile({ url: '' })] });
    expect(noUrl.editor.hasValidConfig.value).toBe(false);

    const noUser = setup({ profiles: [makeProfile({ username: '' })] });
    expect(noUser.editor.hasValidConfig.value).toBe(false);

    const noProfile = setup({ profiles: [], activeId: null });
    expect(noProfile.editor.hasValidConfig.value).toBe(false);
  });

  it('shouldAutoExpand 只在没配置好时为真', () => {
    expect(setup().editor.shouldAutoExpand.value).toBe(false);
    expect(setup({ profiles: [], activeId: null }).editor.shouldAutoExpand.value).toBe(true);
    expect(setup({ activeId: null }).editor.shouldAutoExpand.value).toBe(true);
    expect(
      setup({ profiles: [makeProfile({ password: '' })] }).editor.shouldAutoExpand.value,
    ).toBe(true);
  });

  it('statusLabel / statusClass 覆盖五种状态', () => {
    expect(setup({}, true).editor.statusLabel.value).toBe('验证中...');
    expect(setup({}, true).editor.statusClass.value).toBe('status-testing');

    const disabled = setup({ profiles: [], activeId: null });
    expect(disabled.editor.statusLabel.value).toBe('未启用');
    expect(disabled.editor.statusClass.value).toBe('status-disabled');

    const needsConfig = setup({ profiles: [makeProfile({ password: '' })] });
    expect(needsConfig.editor.statusLabel.value).toBe('需配置');
    expect(needsConfig.editor.statusClass.value).toBe('status-warning');

    const ok = setup({ profiles: [makeProfile({ connectionStatus: 'success' })] });
    expect(ok.editor.statusLabel.value).toBe('已连接');
    expect(ok.editor.statusClass.value).toBe('status-success');

    const failed = setup({ profiles: [makeProfile({ connectionStatus: 'failed' })] });
    expect(failed.editor.statusLabel.value).toBe('连接失败');
    expect(failed.editor.statusClass.value).toBe('status-error');

    const pending = setup();
    expect(pending.editor.statusLabel.value).toBe('待验证');
    expect(pending.editor.statusClass.value).toBe('status-warning');
  });

  it('securityHint 只对非回环的 HTTP 地址告警', () => {
    const warned = '外部 WebDAV 请使用 HTTPS；HTTP 仅保留给本机回环服务。';
    const normal = '外部 WebDAV 请使用 HTTPS；本机服务可使用 localhost / 127.0.0.1。';

    expect(setup({ profiles: [makeProfile({ url: 'http://192.168.1.10:5005/dav' })] })
      .editor.securityHint.value).toBe(warned);

    expect(setup({ profiles: [makeProfile({ url: 'http://localhost:5005/dav' })] })
      .editor.securityHint.value).toBe(normal);
    expect(setup({ profiles: [makeProfile({ url: 'http://127.0.0.1/dav' })] })
      .editor.securityHint.value).toBe(normal);
    expect(setup().editor.securityHint.value).toBe(normal);
    expect(setup({ profiles: [], activeId: null }).editor.securityHint.value).toBe(normal);
  });
});

describe('useWebDAVProfileEditor · 编辑动作', () => {
  it('updateActiveProfileField 只改当前 profile', () => {
    const { editor, config } = setup({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2', name: '公司' })],
      activeId: 'dav-1',
    });

    editor.updateActiveProfileField('username', 'changed');

    expect(config.value.profiles[0].username).toBe('changed');
    expect(config.value.profiles[1].username).toBe('me');
  });

  it('改连接参数会作废已有的「已连接」状态', () => {
    const { editor, config } = setup({
      profiles: [makeProfile({ connectionStatus: 'success' })],
    });

    editor.updateActiveProfileField('url', 'https://other.example.com/dav');

    // 地址都换了，上次的验证结果不能再算数
    expect(config.value.profiles[0].connectionStatus).toBeUndefined();
  });

  it('改非连接参数保留「已连接」状态', () => {
    const { editor, config } = setup({
      profiles: [makeProfile({ connectionStatus: 'success' })],
    });

    editor.updateActiveProfileField('name', '改个名字');

    expect(config.value.profiles[0].connectionStatus).toBe('success');
    expect(config.value.profiles[0].name).toBe('改个名字');
  });

  it('连接失败状态不会被改字段清掉', () => {
    const { editor, config } = setup({
      profiles: [makeProfile({ connectionStatus: 'failed' })],
    });

    editor.updateActiveProfileField('url', 'https://retry.example.com/dav');

    expect(config.value.profiles[0].connectionStatus).toBe('failed');
  });

  it('没有当前 profile 时 updateActiveProfileField 是空操作', () => {
    const { editor, config } = setup({ profiles: [], activeId: null });
    const before = config.value;

    editor.updateActiveProfileField('url', 'https://x.example.com');

    expect(config.value).toBe(before);
  });

  it('setProfilePassword 写密文的同时清掉残留明文', () => {
    const { editor, config } = setup({
      profiles: [makeProfile({ password: '老明文', passwordEncrypted: 'cipher(老明文)' })],
    });

    editor.setProfilePassword('dav-1', 'cipher(新密码)');

    expect(config.value.profiles[0].passwordEncrypted).toBe('cipher(新密码)');
    // 不清的话，保存时 encryptBackupProfiles 会拿残留明文重新加密，把新密文顶掉
    expect(config.value.profiles[0].password).toBe('');
  });

  it('setProfilePassword 作废「已连接」状态', () => {
    const { editor, config } = setup({
      profiles: [makeProfile({ connectionStatus: 'success' })],
    });

    editor.setProfilePassword('dav-1', 'cipher(新密码)');

    expect(config.value.profiles[0].connectionStatus).toBeUndefined();
  });

  it('setProfilePassword 只动指定的那一个 profile', () => {
    const { editor, config } = setup({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2', password: '别人的' })],
      activeId: 'dav-1',
    });

    editor.setProfilePassword('dav-1', 'cipher(新密码)');

    expect(config.value.profiles[1].password).toBe('别人的');
    expect(config.value.profiles[1].passwordEncrypted).toBeUndefined();
  });

  /**
   * 这条是本函数改收 profileId 的全部理由：加密走 IPC 是异步的，而 blur 早于 click，
   * 「A 改完密码顺手点 B 的 tab」时密文算完 activeId 已经指向 B。
   * 按 activeId 写的旧实现会把 A 的新密码存进 B。
   */
  it('setProfilePassword 认参数不认 activeId —— activeId 已切走也照样写给原目标', () => {
    const { editor, config } = setup({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2', password: '别人的' })],
      activeId: 'dav-2',   // 用户已经切到 dav-2 了
    });

    editor.setProfilePassword('dav-1', 'cipher(A 的新密码)');

    expect(config.value.profiles[0].passwordEncrypted).toBe('cipher(A 的新密码)');
    expect(config.value.profiles[1].passwordEncrypted).toBeUndefined();
    expect(config.value.profiles[1].password).toBe('别人的');
  });

  it('目标 profile 不存在时 setProfilePassword 是空操作并返回 false', () => {
    const { editor, config } = setup({ profiles: [], activeId: null });
    const before = config.value;

    expect(editor.setProfilePassword('dav-1', 'cipher(x)')).toBe(false);
    expect(config.value).toBe(before);
  });

  it('switchProfile 切 activeId 并触发保存', () => {
    const { editor, config, onSave } = setup({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2' })],
    });

    editor.switchProfile('dav-2');

    expect(config.value.activeId).toBe('dav-2');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('addProfile 追加一条空配置并切过去', () => {
    const { editor, config, onSave } = setup();

    editor.addProfile();

    expect(config.value.profiles).toHaveLength(2);
    const added = config.value.profiles[1];
    // 现存的「坚果云」不匹配自动命名格式，所以自动名从 1 开始
    expect(added.name).toBe('新配置 1');
    expect(added.url).toBe('');
    expect(added.username).toBe('');
    expect(added.password).toBe('');
    expect(added.remotePath).toBe('/PicNexus/');
    expect(config.value.activeId).toBe(added.id);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  /**
   * 旧的 `profiles.length + 1` 在这里会又生成一个「新配置 2」：tab 上只显示名字，
   * 两个同名 tab 用户没有任何办法分辨自己在改哪一个。
   */
  it('addProfile 按现存最大序号递增，删掉中间项后不撞名', () => {
    const { editor, config } = setup({
      profiles: [
        makeProfile({ id: 'dav-1', name: '新配置 1' }),
        makeProfile({ id: 'dav-3', name: '新配置 3' }),
      ],
    });

    editor.addProfile();

    expect(config.value.profiles[2].name).toBe('新配置 4');
  });

  it('deleteProfile 先确认再删', () => {
    const { editor, config, confirmDelete } = setup({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2', name: '公司' })],
    });

    editor.deleteProfile('dav-2');

    expect(confirmDelete).toHaveBeenCalledWith(
      '确定要删除「公司」吗？此操作不可撤销。',
      expect.any(Function),
    );
    expect(config.value.profiles).toHaveLength(1);
  });

  it('用户取消确认时不删除', () => {
    const config = ref<WebDAVConfig>({ profiles: [makeProfile()], activeId: 'dav-1' });
    const editor = useWebDAVProfileEditor({
      config: () => config.value,
      testing: () => false,
      onUpdate: next => { config.value = next; },
      onSave: vi.fn(),
      confirmDelete: vi.fn(), // 不调用回调 = 用户点了取消
    });

    editor.deleteProfile('dav-1');

    expect(config.value.profiles).toHaveLength(1);
  });

  it('删掉当前配置后 activeId 落到剩下的第一条', () => {
    const { editor, config } = setup({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2' })],
      activeId: 'dav-1',
    });

    editor.deleteProfile('dav-1');

    expect(config.value.activeId).toBe('dav-2');
  });

  it('删掉最后一条配置后 activeId 置空', () => {
    const { editor, config } = setup();

    editor.deleteProfile('dav-1');

    expect(config.value.profiles).toHaveLength(0);
    expect(config.value.activeId).toBe('');
  });

  it('删掉非当前配置不动 activeId', () => {
    const { editor, config } = setup({
      profiles: [makeProfile(), makeProfile({ id: 'dav-2' })],
      activeId: 'dav-1',
    });

    editor.deleteProfile('dav-2');

    expect(config.value.activeId).toBe('dav-1');
  });

  it('无名配置在确认文案里显示为「此配置」', () => {
    const { editor, confirmDelete } = setup({ profiles: [makeProfile({ name: '' })] });

    editor.deleteProfile('dav-1');

    expect(confirmDelete).toHaveBeenCalledWith(
      '确定要删除「此配置」吗？此操作不可撤销。',
      expect.any(Function),
    );
  });
});
