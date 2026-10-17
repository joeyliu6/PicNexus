// 编辑器服务的凭证同步：图床凭证从磁盘配置拼（图床页写进去的，设置页的表单里没有）；
// 开启时补出的 authToken 写回配置，免得每次下发换一个
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const m = vi.hoisted(() => ({
  disk: null as null | UserConfig,
  saveConfig: vi.fn(),
  applyEditorServer: vi.fn(),
  source: null as null | { value: { editorServer: Record<string, unknown> } },
}));

vi.mock('@/store/instances', () => ({ readFreshConfig: async () => structuredClone(m.disk) }));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ saveConfig: m.saveConfig }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@/composables/settings/useEditorIntegration', () => ({
  useEditorIntegration: (options: { formData: { value: { editorServer: Record<string, unknown> } } }) => {
    m.source = options.formData;
    return { applyEditorServer: m.applyEditorServer };
  },
}));

import { __resetEditorSyncForTests, applyEditorConfig, editorSourceFromConfig } from '@/composables/settings/editorSync';

describe('editorSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetEditorSyncForTests();
    const config = structuredClone(DEFAULT_CONFIG);
    config.services = { ...config.services, r2: { ...config.services.r2!, accessKeyId: 'ak-from-hosts-page' }, weibo: { enabled: true, cookie: 'SUB=1' } } as UserConfig['services'];
    config.editorServer = { ...DEFAULT_CONFIG.editorServer!, enabled: true, obsidianService: 'r2', authToken: '' };
    m.disk = config;
    // 开启时补一个 token（与真实 useEditorIntegration 一样写回传进来的那份数据）
    m.applyEditorServer.mockImplementation(async () => {
      m.source!.value.editorServer = { ...m.source!.value.editorServer, authToken: 'new-token' };
      return true;
    });
  });

  it('图床凭证从配置里拼出来', () => {
    const source = editorSourceFromConfig(m.disk!);
    expect(source.r2.accessKeyId).toBe('ak-from-hosts-page');
    expect(source.weiboCookie).toBe('SUB=1');
    expect(source.r2.thumbnailProxyEnabled).toBe(true);
  });

  it('按配置下发时补出的 authToken 写回配置', async () => {
    const result = await applyEditorConfig(undefined, { force: true });
    expect(result).toEqual({ ok: true, editorServer: expect.objectContaining({ authToken: 'new-token' }) });
    expect(m.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ editorServer: expect.objectContaining({ authToken: 'new-token' }) }), true);
  });

  it('设置页传来的编辑器选项只下发、不替它保存（由设置页随表单保存）', async () => {
    const result = await applyEditorConfig({ ...DEFAULT_CONFIG.editorServer!, enabled: true, port: 40000 });
    expect(m.applyEditorServer).toHaveBeenCalledWith(expect.objectContaining({ port: 40000 }), {});
    expect(result.editorServer.authToken).toBe('new-token');
    expect(m.saveConfig).not.toHaveBeenCalled();
  });

  it('两次下发排队执行：前一次拿到的是自己那份数据，不被后一次覆盖', async () => {
    let release!: () => void;
    m.applyEditorServer.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return true;
    });
    const first = applyEditorConfig({ ...DEFAULT_CONFIG.editorServer!, port: 40001 });
    const second = applyEditorConfig({ ...DEFAULT_CONFIG.editorServer!, port: 40002 });
    await vi.waitFor(() => expect(m.applyEditorServer).toHaveBeenCalledTimes(1));
    release();
    expect((await first).editorServer.port).toBe(40001);
    expect((await second).editorServer.port).toBe(40002);
  });
});
