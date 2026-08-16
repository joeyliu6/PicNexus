// useStorageProfiles 测试
// 覆盖：默认命名不撞名、新建即写入可用列表、删除前置校验（至少保留一个图床）、
//      编辑器绑定清理、按 id 就地更新

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useStorageProfiles } from '@/composables/settings/useStorageProfiles';
import type { SettingsFormData } from '@/composables/settings/settingsFormTypes';

function setup(overrides: Partial<SettingsFormData> = {}, available: string[] = ['jd', 'weibo']) {
  const formData = ref({
    custom_s3_profiles: [],
    webdav_profiles: [],
    editorServer: { typoraService: '', obsidianService: '' },
    ...overrides,
  } as unknown as SettingsFormData);

  const availableServices = ref(available);
  const saveSettings = vi.fn();
  const showConfig = vi.fn();
  const confirmDialog = vi.fn().mockResolvedValue(true);
  let idSeq = 0;

  const api = useStorageProfiles({
    formData,
    availableServices,
    saveSettings,
    toast: { showConfig },
    confirmDialog,
    generateId: () => `id-${++idSeq}`,
  });

  return { api, formData, availableServices, saveSettings, showConfig, confirmDialog };
}

describe('新建 profile', () => {
  it('WebDAV 新建带上默认目录与默认链接模板', () => {
    const { api, formData, saveSettings } = setup();

    const compositeId = api.addWebdavProfile();

    expect(compositeId).toBe('webdav:id-1');
    expect(formData.value.webdav_profiles[0]).toMatchObject({
      id: 'id-1',
      name: 'WebDAV 1',
      remotePath: 'images/',
      publicUrlTemplate: '{domain}/{path}',
      passwordEncrypted: '',
    });
    expect(saveSettings).toHaveBeenCalled();
  });

  it('用现存最大序号 + 1 命名，删掉中间项后不撞名', () => {
    const { api, formData } = setup({
      webdav_profiles: [
        { id: 'a', name: 'WebDAV 1' },
        { id: 'c', name: 'WebDAV 3' },
      ],
    } as unknown as Partial<SettingsFormData>);

    api.addWebdavProfile();

    expect(formData.value.webdav_profiles[2].name).toBe('WebDAV 4');
  });

  it('自定义名称不参与序号计算', () => {
    const { api, formData } = setup({
      webdav_profiles: [{ id: 'a', name: '家里的 NAS' }],
    } as unknown as Partial<SettingsFormData>);

    api.addWebdavProfile();

    expect(formData.value.webdav_profiles[1].name).toBe('WebDAV 1');
  });

  // Why: 新建路径以前只 push profile 不写 availableServices，用户建好并填全凭证后
  //   上传界面依然看不到这个图床，必须回设置页手动点亮芯片。
  it('WebDAV 新建即写入可用列表，删除时再对称摘掉', async () => {
    const { api, availableServices } = setup();

    const compositeId = api.addWebdavProfile();

    expect(compositeId).toBe('webdav:id-1');
    expect(availableServices.value).toEqual(['jd', 'weibo', 'webdav:id-1']);

    await api.deleteWebdavProfile('id-1');

    expect(availableServices.value).toEqual(['jd', 'weibo']);
  });

  it('自定义 S3 新建即写入可用列表，删除时再对称摘掉', async () => {
    const { api, availableServices } = setup();

    const compositeId = api.addCustomS3Profile();

    expect(compositeId).toBe('custom_s3:id-1');
    expect(availableServices.value).toEqual(['jd', 'weibo', 'custom_s3:id-1']);

    await api.deleteCustomS3Profile('id-1');

    expect(availableServices.value).toEqual(['jd', 'weibo']);
  });

  it('复合 ID 已在可用列表时不重复写入', () => {
    const { api, availableServices } = setup({}, ['jd', 'webdav:id-1']);

    api.addWebdavProfile();

    expect(availableServices.value).toEqual(['jd', 'webdav:id-1']);
  });
});

describe('删除 profile', () => {
  it('删除时同步摘掉可用列表与编辑器绑定', async () => {
    const { api, formData, availableServices, confirmDialog } = setup(
      {
        webdav_profiles: [{ id: 'nas', name: 'NAS' }],
        editorServer: { typoraService: 'webdav:nas', obsidianService: 'webdav:nas' },
      } as unknown as Partial<SettingsFormData>,
      ['jd', 'webdav:nas'],
    );

    await api.deleteWebdavProfile('nas');

    expect(confirmDialog).toHaveBeenCalled();
    expect(formData.value.webdav_profiles).toEqual([]);
    expect(availableServices.value).toEqual(['jd']);
    expect(formData.value.editorServer.typoraService).toBe('');
    expect(formData.value.editorServer.obsidianService).toBe('');
  });

  it('是唯一启用图床时拒绝删除并提示，不弹确认框', async () => {
    const { api, formData, showConfig, confirmDialog } = setup(
      { webdav_profiles: [{ id: 'nas', name: 'NAS' }] } as unknown as Partial<SettingsFormData>,
      ['webdav:nas'],
    );

    await api.deleteWebdavProfile('nas');

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(showConfig).toHaveBeenCalledWith('warn', expect.objectContaining({ summary: '至少保留一个图床' }));
    expect(formData.value.webdav_profiles).toHaveLength(1);
  });

  it('用户取消确认时不删除', async () => {
    const { api, formData, confirmDialog } = setup(
      { webdav_profiles: [{ id: 'nas', name: 'NAS' }] } as unknown as Partial<SettingsFormData>,
      ['jd', 'webdav:nas'],
    );
    confirmDialog.mockResolvedValueOnce(false);

    await api.deleteWebdavProfile('nas');

    expect(formData.value.webdav_profiles).toHaveLength(1);
  });

  it('删除 custom_s3 走同一套前置校验', async () => {
    const { api, formData, availableServices } = setup(
      { custom_s3_profiles: [{ id: 'minio', name: 'MinIO' }] } as unknown as Partial<SettingsFormData>,
      ['jd', 'custom_s3:minio'],
    );

    await api.deleteCustomS3Profile('minio');

    expect(formData.value.custom_s3_profiles).toEqual([]);
    expect(availableServices.value).toEqual(['jd']);
  });
});

describe('更新 profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('按 id 就地替换', () => {
    const { api, formData, saveSettings } = setup({
      webdav_profiles: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    } as unknown as Partial<SettingsFormData>);

    api.updateWebdavProfile({ id: 'b', name: 'B2' } as never);

    expect(formData.value.webdav_profiles[1]).toMatchObject({ id: 'b', name: 'B2' });
    expect(formData.value.webdav_profiles[0]).toMatchObject({ id: 'a', name: 'A' });
    expect(saveSettings).toHaveBeenCalled();
  });

  it('id 不存在时不新增条目', () => {
    const { api, formData } = setup({
      webdav_profiles: [{ id: 'a', name: 'A' }],
    } as unknown as Partial<SettingsFormData>);

    api.updateWebdavProfile({ id: 'ghost', name: 'X' } as never);

    expect(formData.value.webdav_profiles).toHaveLength(1);
  });

  /**
   * 「明文 HTTP 已确认」是**针对某个具体地址**给的授权，不是对 profile 的永久豁免。
   *
   * 用户确认了 `http://nas.local:5005` 是自家 NAS，三个月后改成别的地址——
   * 旧标记若还在，明文凭证会发往一个他从没确认过的目标，且全程无提示。
   * 这也是这个标记唯一的撤销路径（确认弹窗不像勾选框那样能随手取消）。
   */
  describe('地址变更作废明文 HTTP 确认', () => {
    const confirmed = {
      id: 'a',
      name: 'NAS',
      url: 'http://nas.local:5005/dav',
      publicDomain: 'http://nas.local:5005/dav',
      lanHttpConfirmed: true,
    };

    it('改 url 时重置为 false', () => {
      const { api, formData } = setup({
        webdav_profiles: [{ ...confirmed }],
      } as unknown as Partial<SettingsFormData>);

      api.updateWebdavProfile({ ...confirmed, url: 'http://other.local:5005/dav' } as never);

      expect(formData.value.webdav_profiles[0].lanHttpConfirmed).toBe(false);
    });

    it('改 publicDomain 时同样重置', () => {
      const { api, formData } = setup({
        webdav_profiles: [{ ...confirmed }],
      } as unknown as Partial<SettingsFormData>);

      api.updateWebdavProfile({ ...confirmed, publicDomain: 'http://elsewhere/dav' } as never);

      expect(formData.value.webdav_profiles[0].lanHttpConfirmed).toBe(false);
    });

    it('地址没变时保留确认（否则改个用户名就要重新确认一次）', () => {
      const { api, formData } = setup({
        webdav_profiles: [{ ...confirmed }],
      } as unknown as Partial<SettingsFormData>);

      api.updateWebdavProfile({ ...confirmed, username: 'someone-else' } as never);

      expect(formData.value.webdav_profiles[0].lanHttpConfirmed).toBe(true);
    });

    it('确认写回本身不会自我作废', () => {
      const pending = { ...confirmed, lanHttpConfirmed: undefined };
      const { api, formData } = setup({
        webdav_profiles: [{ ...pending }],
      } as unknown as Partial<SettingsFormData>);

      api.updateWebdavProfile({ ...pending, lanHttpConfirmed: true } as never);

      expect(formData.value.webdav_profiles[0].lanHttpConfirmed).toBe(true);
    });
  });
});
