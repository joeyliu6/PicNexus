// 图床页模型：启用走首页同一处；逐项即存并自动测试；测试并连接（缺必填标红、测不过不连）；断开带撤销；P11 / P12
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const m = vi.hoisted(() => ({
  disk: null as null | UserConfig,
  hosts: null as null | { value: Array<{ id: string; name: string; selected: boolean; warning: string | null }> },
  invoke: vi.fn(),
  confirm: vi.fn(),
  ensureAccepted: vi.fn(),
  toggleHost: vi.fn(),
  withAction: vi.fn(),
  login: vi.fn(),
}));

type Services = Record<string, Record<string, string>>;
const services = () => m.disk!.services as unknown as Services;

function recomputeHosts() {
  const c = m.disk!;
  const configured = (id: string) => id === 'jd' || id.startsWith('custom_s3:') || (id === 'r2' && !!services().r2?.secretAccessKey) || (id === 'weibo' && !!services().weibo?.cookie);
  m.hosts!.value = (c.availableServices ?? []).filter(configured)
    .map((id) => ({ id, name: id, selected: (c.enabledServices ?? []).includes(id), warning: null }));
}

vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@/store/instances', () => ({ readFreshConfig: async () => structuredClone(m.disk) }));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ saveConfig: async (c: UserConfig) => { m.disk = structuredClone(c); } }) }));
vi.mock('@/composables/useConfirm', () => ({ useConfirm: () => ({ confirm: m.confirm }) }));
vi.mock('@/composables/usePublicRiskConfirm', () => ({ usePublicRiskConfirm: () => ({ ensureAccepted: m.ensureAccepted }) }));
vi.mock('@/composables/useCookieLogin', () => ({ useCookieLogin: () => ({ login: m.login }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ withAction: m.withAction }) }));
vi.mock('@/composables/upload/useUploadController', () => ({
  useUploadController: () => ({ hosts: computed(() => m.hosts!.value), toggleHost: m.toggleHost, refreshHosts: async () => recomputeHosts() }),
}));
vi.mock('@/composables/settings/profileServiceSync', () => ({ syncProfileUploaders: vi.fn() }));
vi.mock('@/composables/service/useServiceHealth', () => ({ useServiceHealth: () => ({ markVerified: vi.fn(), markTestFailed: vi.fn() }) }));
vi.mock('@/composables/service/useServiceAvailability', () => ({ probeBuiltinServiceAvailability: vi.fn(), useServiceAvailability: () => ({ jdAvailable: { value: true }, qiyuAvailable: { value: true } }) }));
vi.mock('@/security/crypto', () => ({ secureStorage: { encrypt: async (v: string) => `enc(${v})`, decrypt: async (v: string) => v.replace(/^enc\((.*)\)$/, '$1') } }));

import { __resetHostsForTests, useHosts } from '@/views/hosts/useHosts';
import { __resetHostTestForTests } from '@/views/hosts/useHostTest';

const R2 = { enabled: true, accountId: 'a'.repeat(32), accessKeyId: 'ak', secretAccessKey: 'sk', bucketName: 'b', path: '', publicDomain: 'https://img.example.com' };
const PASS = { ok: true, failedStep: null, field: null, message: '', steps: ['credentials', 'write', 'public'] };

beforeEach(() => {
  vi.clearAllMocks();
  __resetHostsForTests();
  __resetHostTestForTests();
  const config = structuredClone(DEFAULT_CONFIG);
  config.availableServices = ['jd', 'r2'];
  config.enabledServices = ['jd', 'r2'];
  config.services = { ...config.services, r2: { ...R2 } } as UserConfig['services'];
  m.disk = config;
  m.hosts = ref([]);
  recomputeHosts();
  m.ensureAccepted.mockResolvedValue(true);
  m.confirm.mockResolvedValue(true);
});

describe('useHosts', () => {
  it('进入页面选中第一个；启用 / 停用交给首页同一处', async () => {
    const hosts = useHosts();
    await hosts.enter();
    expect(hosts.selectedId.value).toBe('jd');
    await hosts.toggleEnabled('r2');
    expect(m.toggleHost).toHaveBeenCalledWith('r2');
  });

  it('一格有改动才保存，保存后自动测一次；没改不存不测', async () => {
    m.invoke.mockResolvedValue(PASS);
    const hosts = useHosts();
    await hosts.enter();
    await hosts.saveField('r2', 'bucketName', 'b');
    expect(m.invoke).not.toHaveBeenCalled();
    await hosts.saveField('r2', 'bucketName', 'new-bucket');
    expect(services().r2.bucketName).toBe('new-bucket');
    expect(m.invoke).toHaveBeenCalledWith('probe_s3_storage', expect.objectContaining({ serviceId: 'r2' }));
    expect(hosts.tester.stateOf('r2').phase).toBe('ok');
  });

  it('测试并连接：缺必填项标红不测；测不过不连；测过了加进已添加并启用、选中它', async () => {
    const hosts = useHosts();
    await hosts.enter();
    hosts.openConnect('s3');
    const id = hosts.draft.value!.hostId;
    await hosts.connect();
    expect(hosts.tester.stateOf(id)).toMatchObject({ phase: 'fail', field: 'endpoint', reason: '请填写 Endpoint' });
    expect(m.invoke).not.toHaveBeenCalled();

    for (const [k, v] of Object.entries({ endpoint: 'https://s3.example.com', accessKeyId: 'a', secretAccessKey: 's', region: 'r', bucket: 'b' })) hosts.setDraftValue(k, v);
    m.invoke.mockResolvedValueOnce({ ok: false, failedStep: 'credentials', field: 'bucket', message: '存储桶不存在', steps: PASS.steps });
    await hosts.connect();
    expect(m.disk!.custom_s3_profiles).toEqual([]);
    expect(hosts.pane.value).toBe('connect');

    m.invoke.mockResolvedValueOnce(PASS);
    await hosts.connect();
    expect(m.disk!.custom_s3_profiles?.[0]).toMatchObject({ name: 'S3 兼容存储', endpoint: 'https://s3.example.com', bucket: 'b' });
    expect(m.disk!.availableServices).toContain(id);
    expect(m.disk!.enabledServices).toContain(id);
    expect(hosts.selectedId.value).toBe(id);
    expect(hosts.pane.value).toBe('detail');
  });

  it('公共图床连接前过 P11，取消就不连', async () => {
    m.disk!.availableServices = ['r2'];
    recomputeHosts();
    const hosts = useHosts();
    await hosts.enter();
    hosts.openConnect('jd');
    m.ensureAccepted.mockResolvedValueOnce(false);
    await hosts.connect();
    expect(m.disk!.availableServices).toEqual(['r2']);
    await hosts.connect();
    expect(m.disk!.availableServices).toContain('jd');
  });

  it('公开地址是明文 HTTP：先弹 P12（带地址），取消就不测，确认后记下这个主机名', async () => {
    services().r2.publicDomain = 'http://img.example.com';
    m.invoke.mockResolvedValue(PASS);
    const hosts = useHosts();
    await hosts.enter();
    m.confirm.mockResolvedValueOnce(false);
    expect(await hosts.test('r2')).toBeNull();
    expect(m.confirm).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ header: '允许通过 HTTP 访问此地址？', code: 'http://img.example.com', acceptLabel: '允许 HTTP' }));
    expect(m.invoke).not.toHaveBeenCalled();
    await hosts.test('r2');
    expect(services().r2.httpDomainConfirmedFor).toBe('img.example.com');
    expect(m.invoke).toHaveBeenCalledWith('probe_s3_storage', expect.objectContaining({ config: expect.objectContaining({ httpDomainConfirmedFor: 'img.example.com' }) }));
  });

  it('断开：去掉、清凭证、通知带撤销；撤销原样放回并选中它', async () => {
    const hosts = useHosts();
    await hosts.enter();
    await hosts.disconnect('r2');
    expect(m.disk!.availableServices).toEqual(['jd']);
    expect(services().r2.secretAccessKey).toBe('');
    expect(m.withAction).toHaveBeenCalledWith('success', '已断开 Cloudflare R2', '已传的图片和链接不受影响', expect.objectContaining({ label: '撤销' }), { countdown: true });
    const undo = m.withAction.mock.calls[0][3].run as () => void;
    undo();
    await vi.waitFor(() => expect(m.disk!.availableServices).toEqual(['jd', 'r2']));
    expect(services().r2.secretAccessKey).toBe('sk');
    await vi.waitFor(() => expect(hosts.selectedId.value).toBe('r2'));
  });

  it('Cookie 图床：没连上的先过 P11，登录成功后连上并自动检测', async () => {
    m.invoke.mockResolvedValue(undefined);
    const hosts = useHosts();
    await hosts.enter();
    await hosts.login('weibo');
    expect(m.ensureAccepted).toHaveBeenCalled();
    const onLoggedIn = m.login.mock.calls[0][1] as () => Promise<void>;
    services().weibo = { cookie: 'SUB=1' };
    await onLoggedIn();
    expect(m.disk!.availableServices).toContain('weibo');
    expect(m.invoke).toHaveBeenCalledWith('test_weibo_connection', { weiboCookie: 'SUB=1' });
  });
});
