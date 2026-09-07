/**
 * P1-1 回归测试（docs/audits/scan-config-mirror-2026-09-07.md）。
 *
 * 缺陷曾经是：MutexStore.get() 把缓存对象本身递给调用方，不是复印件。useSettingsForm.saveSettings
 * 拿到这个原件后就地改写（config.services = ...），这一步发生在磁盘真正写入之前——所以哪怕这次
 * 保存最终因为磁盘写入失败而报错，缓存里的"原件"早就被改脏了。保存失败后 loadSettings() 想"回滚到
 * 磁盘真值"，做法是重新调用 configStore.get('config')，但因为给出去的始终是同一个对象引用，读到的
 * 还是那份被改脏的对象，回滚是空转。2026-09-07 已用 wdio + tauri-driver 真机复现坐实（见审计文档
 * "执行记录"）。
 *
 * 修复：MutexStore._performRead 现在统一 structuredClone 后再返回对象类型的值，一处改动堵住所有
 * 调用方，不用逐个改 useSettingsForm.ts / useAnalytics.ts。本文件取代此前的临时复现用例（那份断言
 * 的是"缺陷成立"，已从仓库移除），全部断言反转为"修复后应有的行为"。
 *
 * 覆盖三层：
 *  1. Store 本身：两次 get() 必须是不同引用，就地改写不影响下一次 get() 的结果
 *  2. useSettingsForm：保存失败后正确回滚到磁盘真值（而不是停在编辑值上空转）——
 *     取代 useSettingsForm.spec.ts 里那个用"configStore.get 每次返回新对象" mock 遮住别名关系、
 *     因而测不出真实缺陷的旧用例
 *  3. useConfig.loadConfig：塞进 ref 的值同样与缓存解耦（审计文档要求一并核实的第二个消费点）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { Store } from '@/store';
import { configStore } from '@/store/instances';
import { useSettingsForm } from '@/composables/settings/useSettingsForm';
import { useConfigManager } from '@/composables/useConfig';
import { createConfig } from '../factories/configFactory';
import { resetTauriMocks, setupInvokeResponses } from '../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  toastShowConfig: vi.fn(),
}));

vi.mock('@/store/instances', async () => {
  const { Store } = await import('@/store');
  return { configStore: new Store('shared-config.dat', { encrypted: false }) };
});
vi.mock('@/utils/webdav', () => ({
  WebDAVClient: {
    encryptPassword: vi.fn(async (p: string) => `encrypted:${p}`),
    decryptPassword: vi.fn(async (e: string) => `plain:${e}`),
  },
}));
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: mockState.toastShowConfig,
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/composables/useServiceHealth', () => ({
  useServiceHealth: () => ({
    loadHealthStatus: vi.fn().mockResolvedValue(undefined),
    evaluateConfig: vi.fn(),
  }),
}));
vi.mock('@/uploaders', () => ({
  syncCustomS3Uploaders: vi.fn(),
  syncWebDAVUploaders: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const files = new Map<string, string>();
/** 由每个用例按需置位，模拟"磁盘写入这一次真的失败了"（真机复现用的是文件只读，这里等价地让 writeTextFile 拒绝） */
let writeShouldFail = false;
const SHARED_DISK_PATH = '/mock/appdata/shared-config.dat';

beforeEach(async () => {
  resetTauriMocks();
  vi.clearAllMocks();
  files.clear();
  writeShouldFail = false;
  vi.mocked(exists).mockImplementation(async (p) => files.has(String(p)));
  vi.mocked(readTextFile).mockImplementation(async (p) => {
    const content = files.get(String(p));
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  });
  vi.mocked(writeTextFile).mockImplementation(async (p, c) => {
    if (writeShouldFail) {
      // 真机复现在 data/logs/PicNexus.log 里抓到的真实错误文案（EncryptedStore.wrapWriteError
      // 会再包一层"写入文件失败:"前缀，这里只模拟被包装前、操作系统抛出的那部分）
      throw new Error('failed to open file with error: 拒绝访问。 (os error 5)');
    }
    files.set(String(p), String(c));
  });
  vi.mocked(mkdir).mockResolvedValue(undefined);
  setupInvokeResponses({ 'plugin:autostart|is_enabled': false });
  // configStore 是本文件所有用例共享的单例，前一个用例读过的缓存不能带进下一个用例
  await configStore.invalidateCache();
});

describe('P1-1 回归：Store.get() 返回值与缓存解耦', () => {
  it('两次 get 返回不同引用；就地改写不影响下一次 get 的结果', async () => {
    const store = new Store('solo.dat', { encrypted: false });
    files.set('/mock/appdata/solo.dat', JSON.stringify({
      config: { services: { weibo: { cookie: 'disk' } } },
    }));

    const first = await store.get<{ services: { weibo: { cookie: string } } }>('config');
    const second = await store.get<{ services: { weibo: { cookie: string } } }>('config');
    expect(first).not.toBe(second);
    expect(first).toEqual(second);

    first!.services.weibo.cookie = 'mutated-without-set';
    const third = await store.get<{ services: { weibo: { cookie: string } } }>('config');
    expect(third!.services.weibo.cookie).toBe('disk');
    expect(JSON.parse(files.get('/mock/appdata/solo.dat')!).config.services.weibo.cookie).toBe('disk');
  });
});

describe('P1-1 回归：useSettingsForm 保存失败后正确回滚到磁盘真值', () => {
  it('磁盘写入失败时，表单与缓存都不会停留在编辑值上空转', async () => {
    const onDisk = createConfig({
      availableServices: ['jd', 'weibo'],
      services: { weibo: { enabled: true, cookie: 'SUB=on-disk' } },
    });
    files.set(SHARED_DISK_PATH, JSON.stringify({ config: onDisk }));

    const api = useSettingsForm();
    await api.loadSettings();
    expect(api.formData.value.weiboCookie).toBe('SUB=on-disk');
    expect(api.availableServices.value).toEqual(['jd', 'weibo']);

    writeShouldFail = true;
    api.formData.value.weiboCookie = 'SUB=edited';
    api.availableServices.value = ['jd'];
    await expect(api.saveSettings({ trackAdvancedStatus: true })).resolves.toBe(false);

    // 磁盘真值没变（写入根本没成功过）
    const disk = JSON.parse(files.get(SHARED_DISK_PATH)!).config;
    expect(disk.services.weibo.cookie).toBe('SUB=on-disk');

    // 失败提示确实弹出了，不是静默失败
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('error', expect.any(Object));
    expect(api.advancedSaveState.value.status).toBe('error');
    expect(api.advancedSaveState.value.message).toContain('拒绝访问');

    // 核心断言（已反转）：回滚后表单 + 可用服务列表都显示磁盘真值，不再停在编辑值上
    expect(api.formData.value.weiboCookie).toBe('SUB=on-disk');
    expect(api.availableServices.value).toEqual(['jd', 'weibo']);

    // 缓存也没有被就地改写污染：独立再读一次 configStore，拿到的同样是磁盘真值
    const cached = await configStore.get<typeof onDisk>('config');
    expect(cached!.services.weibo?.cookie).toBe('SUB=on-disk');
    expect(cached!.availableServices).toEqual(['jd', 'weibo']);

    api.clearTimers();
  });
});

describe('P1-1 回归：useConfig.loadConfig 塞进 ref 的值同样与缓存解耦', () => {
  it('loadConfig 后就地改写 config.value 不会污染 Store 缓存', async () => {
    const onDisk = createConfig({ availableServices: ['jd'] });
    files.set(SHARED_DISK_PATH, JSON.stringify({ config: onDisk }));

    const { config, loadConfig } = useConfigManager();
    await loadConfig();
    expect(config.value.availableServices).toEqual(['jd']);

    // 模拟"改了 ref 却忘记调用 saveConfig()"这种误用——不该污染 Store 缓存
    config.value.availableServices = ['jd', 'weibo'];

    const cached = await configStore.get<typeof onDisk>('config');
    expect(cached!.availableServices).toEqual(['jd']);
  });
});
