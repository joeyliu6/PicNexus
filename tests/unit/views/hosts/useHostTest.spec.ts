// 测试连接：后端的分步结果收成统一状态，字段名映射到各图床的配置键；已添加的写健康状态，草稿不写
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  invoke: vi.fn(),
  markVerified: vi.fn(),
  markTestFailed: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/composables/service/useServiceHealth', () => ({ useServiceHealth: () => ({ markVerified: m.markVerified, markTestFailed: m.markTestFailed }) }));
vi.mock('@/composables/service/useServiceAvailability', () => ({
  probeBuiltinServiceAvailability: vi.fn(),
  useServiceAvailability: () => ({ jdAvailable: { value: true }, qiyuAvailable: { value: false } }),
}));

import { __resetHostTestForTests, LanHttpConsentNeeded, useHostTest } from '@/views/hosts/useHostTest';
import { failSummary, okDetail } from '@/views/hosts/hostTestText';
import { describeHost } from '@/views/hosts/hostCatalog';

describe('useHostTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetHostTestForTests();
  });

  it('对象存储：签名错 → 失败在凭证、指到 Secret Access Key，原因换成这家的名字，左栏变琥珀', async () => {
    m.invoke.mockResolvedValue({ ok: false, failedStep: 'credentials', field: 'secret_key', message: '服务商拒绝了签名', steps: ['credentials', 'write', 'public'] });
    const test = useHostTest();
    const state = await test.run({ hostId: 'r2', record: { accountId: 'a' } });
    expect(m.invoke).toHaveBeenCalledWith('probe_s3_storage', { serviceId: 'r2', config: { accountId: 'a' } });
    expect(state).toEqual({ phase: 'fail', step: 'credentials', field: 'secretAccessKey', reason: 'Cloudflare 拒绝了签名', passed: [] });
    expect(m.markTestFailed).toHaveBeenCalledWith('r2', 'Cloudflare 拒绝了签名');
    expect(failSummary(describeHost('r2')!, state as never)).toEqual({ title: 'Secret Access Key 无效', detail: '请在 Cloudflare 后台重新复制后再试' });
  });

  it('公开访问失败：前两步算通过，指到公开访问域名', async () => {
    m.invoke.mockResolvedValue({ ok: false, failedStep: 'public', field: 'public_domain', message: '图片已写入，但公开链接无法访问（HTTP 404）', steps: ['credentials', 'write', 'public'] });
    const state = await useHostTest().run({ hostId: 'tencent', record: {} });
    expect(state).toMatchObject({ phase: 'fail', step: 'public', field: 'publicDomain', passed: ['credentials', 'write'] });
    expect(failSummary(describeHost('tencent')!, state as never).detail).toBe('读取与写入均通过，请检查公开访问域名');
    // WebDAV 的那一格叫「公开访问地址」：处理办法按它的叫法说
    expect(failSummary(describeHost('webdav:x')!, { ...state, field: 'publicDomain' } as never).detail).toBe('读取与写入均通过，请检查公开访问地址');
  });

  it('通过：记耗时与步骤；草稿不写健康状态', async () => {
    m.invoke.mockResolvedValue({ ok: true, failedStep: null, field: null, message: '', steps: ['credentials', 'write', 'public'] });
    const state = await useHostTest().run({ hostId: 'custom_s3:minio', record: {}, draft: true });
    expect(state).toMatchObject({ phase: 'ok', steps: ['credentials', 'write', 'public'] });
    expect(m.markVerified).not.toHaveBeenCalled();
    expect(okDetail(describeHost('custom_s3:minio')!, ['credentials', 'write', 'public'])).toBe('读取、写入、公开访问均通过');
    expect(okDetail(describeHost('weibo')!, ['credentials'])).toBe('登录有效');
  });

  it('WebDAV 判不出局域网：抛给页面弹 P12，状态不卡在检测中', async () => {
    m.invoke.mockRejectedValue({ type: 'WEBDAV_LAN_HTTP_UNCONFIRMED', data: { message: 'fake-ip' } });
    const test = useHostTest();
    await expect(test.run({ hostId: 'webdav:nas', record: { url: 'http://nas.local/dav' } })).rejects.toBeInstanceOf(LanHttpConsentNeeded);
    expect(test.stateOf('webdav:nas').phase).toBe('idle');
  });

  it('WebDAV 密码错：指到密码那一格', async () => {
    m.invoke.mockResolvedValue({ success: false, message: '用户名或密码错误', failedStep: 'credentials', field: 'password' });
    const state = await useHostTest().run({ hostId: 'webdav:nas', record: {} });
    expect(state).toMatchObject({ phase: 'fail', field: 'passwordEncrypted' });
    expect(failSummary(describeHost('webdav:nas')!, state as never)).toEqual({ title: '密码 无效', detail: '请检查用户名和密码' });
  });

  it('Cookie：登录失效指到 Cookie；正在测时再点忽略', async () => {
    let release!: () => void;
    m.invoke.mockImplementation(() => new Promise((_, reject) => { release = () => reject({ type: 'AUTH', data: { message: 'Cookie 已过期' } }); }));
    const test = useHostTest();
    const first = test.run({ hostId: 'weibo', record: { cookie: 'SUB=1' } });
    expect(test.testing.value.has('weibo')).toBe(true);
    await test.run({ hostId: 'weibo', record: { cookie: 'SUB=1' } });
    expect(m.invoke).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ phase: 'fail', field: 'cookie', reason: 'Cookie 已过期' });
  });

  it('改了标红的那一格，红框清掉', async () => {
    m.invoke.mockResolvedValue({ ok: false, failedStep: 'credentials', field: 'bucket', message: '存储桶不存在', steps: ['credentials', 'write', 'public'] });
    const test = useHostTest();
    await test.run({ hostId: 'r2', record: {} });
    test.clearField('r2', 'bucketName');
    expect(test.stateOf('r2')).toMatchObject({ phase: 'fail', field: undefined });
  });
});
