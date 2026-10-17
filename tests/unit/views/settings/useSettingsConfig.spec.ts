import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const state = vi.hoisted(() => ({
  disk: null as unknown,
  saveConfig: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/store/instances', () => ({
  readFreshConfig: vi.fn(async () => (state.disk ? structuredClone(state.disk) : null)),
}));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ saveConfig: state.saveConfig }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: state.toastError }) }));

import { SAVED_FLASH_MS, __resetSettingsConfigForTests, useSettingsConfig } from '@/views/settings/useSettingsConfig';

function disk(): UserConfig {
  return state.disk as UserConfig;
}

describe('useSettingsConfig', () => {
  beforeEach(() => {
    __resetSettingsConfigForTests();
    state.disk = structuredClone(DEFAULT_CONFIG);
    state.saveConfig.mockReset().mockImplementation(async (next: UserConfig) => { state.disk = structuredClone(next); });
    state.toastError.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('never writes host config: a patch lands on the latest disk copy, so host edits made elsewhere survive', async () => {
    const settings = useSettingsConfig();
    await settings.reload();
    // 设置页读过配置之后，图床页 / 托盘改了图床
    disk().enabledServices = ['jd', 'r2'];
    disk().availableServices = ['jd', 'r2', 'weibo'];
    disk().services = { ...disk().services, r2: { enabled: true, accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucketName: 'b', path: '', publicDomain: 'https://img.example.com' } };
    const hostsBefore = structuredClone({ e: disk().enabledServices, a: disk().availableServices, s: disk().services });

    await settings.patch('autoCopy', (c) => { c.linkOutput = { ...c.linkOutput!, autoCopy: false }; });

    expect(disk().linkOutput?.autoCopy).toBe(false);
    expect({ e: disk().enabledServices, a: disk().availableServices, s: disk().services }).toEqual(hostsBefore);
  });

  it('two quick patches both land', async () => {
    const settings = useSettingsConfig();
    const a = settings.patch('autoCopy', (c) => { c.linkOutput = { ...c.linkOutput!, autoCopy: false }; });
    const b = settings.patch('defaultFormat', (c) => { c.linkOutput = { ...c.linkOutput!, defaultFormat: 'markdown' }; });
    await Promise.all([a, b]);
    expect(disk().linkOutput).toMatchObject({ autoCopy: false, defaultFormat: 'markdown' });
    expect(settings.config.value.linkOutput).toMatchObject({ autoCopy: false, defaultFormat: 'markdown' });
  });

  it('flashes 已保存 on the changed row, then clears it', async () => {
    vi.useFakeTimers();
    const settings = useSettingsConfig();
    await settings.patch('autoCopy', (c) => { c.linkOutput = { ...c.linkOutput!, autoCopy: false }; });
    expect(settings.isSaved('autoCopy')).toBe(true);
    expect(settings.isSaved('defaultFormat')).toBe(false);
    vi.advanceTimersByTime(SAVED_FLASH_MS);
    expect(settings.isSaved('autoCopy')).toBe(false);
  });

  it('a failed save says so in red and puts the screen back to what is on disk', async () => {
    const settings = useSettingsConfig();
    await settings.reload();
    state.saveConfig.mockRejectedValueOnce(new Error('磁盘已满'));

    const ok = await settings.patch('autoCopy', (c) => { c.linkOutput = { ...c.linkOutput!, autoCopy: false }; });

    expect(ok).toBe(false);
    expect(state.toastError).toHaveBeenCalledWith('未能保存', '磁盘已满，请重试');
    expect(settings.config.value.linkOutput?.autoCopy).toBe(true);
    expect(settings.isSaved('autoCopy')).toBe(false);
  });
});
