import { describe, it, expect, vi, beforeEach } from 'vitest';

const serviceAvailabilityMock = vi.hoisted(() => ({
  checkQiyuAvailability: vi.fn(),
  checkJdAvailable: vi.fn(),
}));

const storeMock = vi.hoisted(() => ({
  configGet: vi.fn(),
  readFreshConfig: vi.fn(),
}));

vi.mock('@/store/instances', () => ({
  configStore: {
    get: storeMock.configGet,
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    invalidateCache: vi.fn().mockResolvedValue(undefined),
  },
  syncStatusStore: { get: vi.fn(), set: vi.fn(), save: vi.fn() },
  readFreshConfig: storeMock.readFreshConfig,
}));

vi.mock('@/composables/useServiceAvailability', () => ({
  useServiceAvailability: () => ({
    qiyuAvailable: { value: false },
    jdAvailable: { value: true },
    isCheckingQiyu: { value: false },
    isCheckingJd: { value: false },
    checkQiyuAvailability: serviceAvailabilityMock.checkQiyuAvailability,
    checkJdAvailable: serviceAvailabilityMock.checkJdAvailable,
  }),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: vi.fn(),
  }),
}));

import { useServiceSelector } from '@/composables/useServiceSelector';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

function cloneDefault(): UserConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

describe('useServiceSelector - updateServiceConfigStatus', () => {
  beforeEach(() => {
    const api = useServiceSelector();
    api.selectedServices.value = [];
    serviceAvailabilityMock.checkQiyuAvailability.mockReset();
    serviceAvailabilityMock.checkJdAvailable.mockReset();
  });

  it('JD 始终为 true', async () => {
    const cfg = cloneDefault();
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.jd).toBe(true);
  });

  it('builtin no-config services do not trigger network checks while computing config status', async () => {
    const cfg = cloneDefault();
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.jd).toBe(true);
    expect(api.serviceConfigStatus.value.qiyu).toBe(true);
    expect(serviceAvailabilityMock.checkJdAvailable).not.toHaveBeenCalled();
    expect(serviceAvailabilityMock.checkQiyuAvailability).not.toHaveBeenCalled();
  });

  it('weibo - cookie 存在 → true', async () => {
    const cfg = cloneDefault();
    cfg.services.weibo = { cookie: 'SUB=x' } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.weibo).toBe(true);
  });

  it('weibo - cookie 空白 → false', async () => {
    const cfg = cloneDefault();
    cfg.services.weibo = { cookie: '  ' } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.weibo).toBe(false);
  });

  it('r2 - 必填字段齐全 → true', async () => {
    const cfg = cloneDefault();
    cfg.services.r2 = {
      accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucketName: 'd', publicDomain: 'https://cdn.example.com',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.r2).toBe(true);
  });

  it('r2 - 缺 publicDomain → false', async () => {
    const cfg = cloneDefault();
    cfg.services.r2 = {
      accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucketName: 'd',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.r2).toBe(false);
  });

  it('r2 - 缺 bucketName → false', async () => {
    const cfg = cloneDefault();
    cfg.services.r2 = {
      accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.r2).toBe(false);
  });

  it('github - 三字段齐全 → true', async () => {
    const cfg = cloneDefault();
    cfg.services.github = { token: 't', owner: 'o', repo: 'r' } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.github).toBe(true);
  });

  it('imgur - clientId 存在 → true', async () => {
    const cfg = cloneDefault();
    cfg.services.imgur = { clientId: 'abc' } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.imgur).toBe(true);
  });

  it('tencent - 核心字段齐全 → true', async () => {
    const cfg = cloneDefault();
    cfg.services.tencent = {
      secretId: 's', secretKey: 'k', bucket: 'b', region: 'r',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.tencent).toBe(true);
  });

  it('tencent - 缺 region → false', async () => {
    const cfg = cloneDefault();
    cfg.services.tencent = {
      secretId: 's', secretKey: 'k', bucket: 'b',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.tencent).toBe(false);
  });

  it('aliyun - 四字段齐全 → true', async () => {
    const cfg = cloneDefault();
    cfg.services.aliyun = {
      accessKeyId: 'a', accessKeySecret: 'b', bucket: 'c', region: 'd', publicDomain: 'https://oss.example.com',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.aliyun).toBe(true);
  });

  it('aliyun - 缺 publicDomain → false', async () => {
    const cfg = cloneDefault();
    cfg.services.aliyun = {
      accessKeyId: 'a', accessKeySecret: 'b', bucket: 'c', region: 'd',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.aliyun).toBe(false);
  });

  it('qiniu - publicDomain 必填', async () => {
    const cfg = cloneDefault();
    cfg.services.qiniu = {
      accessKey: 'a', secretKey: 'b', bucket: 'c', publicDomain: 'd',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.qiniu).toBe(true);
  });

  // 这里是 GUI 上传口径：又拍云的 GUI 链路走 S3 端点，只认 s3AccessKey/s3SecretKey。
  // 光有 operator/password 传不了图（实测回 ErrInvalidAccessKeyID），不能算配置完成。
  it('upyun - 只有 REST 凭证 → false（GUI 上传走 S3，缺 S3 凭证传不了）', async () => {
    const cfg = cloneDefault();
    cfg.services.upyun = {
      operator: 'o', password: 'p', bucket: 'b', publicDomain: 'd',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.upyun).toBe(false);
  });

  it('upyun - 两套凭证齐全 → true', async () => {
    const cfg = cloneDefault();
    cfg.services.upyun = {
      operator: 'o', password: 'p', bucket: 'b', publicDomain: 'd',
      s3AccessKey: 'ak', s3SecretKey: 'sk',
    } as any;
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value.upyun).toBe(true);
  });

  it('custom_s3 profiles - 合成 ID 键对应状态', async () => {
    const cfg = cloneDefault();
    cfg.custom_s3_profiles = [{
      id: 'p1', name: 'P1', endpoint: 'https://s3', accessKeyId: 'a',
      secretAccessKey: 'b', region: 'r', bucket: 'buk',
    } as any];
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg);
    expect(api.serviceConfigStatus.value['custom_s3:p1']).toBe(true);
  });

  it('config.services 为空 → 自动初始化为 {}', async () => {
    const cfg = { ...cloneDefault(), services: undefined as any };
    const api = useServiceSelector();
    await api.updateServiceConfigStatus(cfg as any);
    // 不抛错即可
    expect(api.serviceConfigStatus.value.jd).toBe(true);
  });
});

describe('useServiceSelector - toggleServiceSelection', () => {
  beforeEach(() => {
    const api = useServiceSelector();
    api.selectedServices.value = [];
    api.serviceConfigStatus.value.weibo = true;
  });

  it('加入选中列表', () => {
    const api = useServiceSelector();
    api.toggleServiceSelection('weibo');
    expect(api.selectedServices.value).toContain('weibo');
  });

  it('重复调用移除选中', () => {
    const api = useServiceSelector();
    api.toggleServiceSelection('weibo');
    api.toggleServiceSelection('weibo');
    expect(api.selectedServices.value).not.toContain('weibo');
  });
});

// 主窗口和托盘是两个 webview，各有一份 Store 缓存。托盘写配置只刷新托盘那份，
// 主窗口必须走 readFreshConfig 回盘读，否则「从托盘点勾选，主界面纹丝不动」。
describe('useServiceSelector - 跨窗口配置同步', () => {
  beforeEach(() => {
    storeMock.configGet.mockReset();
    storeMock.readFreshConfig.mockReset();
    const api = useServiceSelector();
    api.selectedServices.value = [];
  });

  it('loadServiceButtonStates 走 readFreshConfig，而不是可能陈旧的 configStore.get', async () => {
    const cfg = cloneDefault();
    cfg.availableServices = ['jd', 'qiyu'];
    cfg.enabledServices = ['jd', 'qiyu'];
    storeMock.readFreshConfig.mockResolvedValue(cfg);
    // 陈旧缓存里只有 jd：一旦代码退回 configStore.get，下面的断言就会掉到 ['jd']
    storeMock.configGet.mockResolvedValue({ ...cloneDefault(), availableServices: ['jd'], enabledServices: ['jd'] });

    const api = useServiceSelector();
    await api.loadServiceButtonStates();

    expect(storeMock.readFreshConfig).toHaveBeenCalled();
    expect(api.selectedServices.value).toEqual(['jd', 'qiyu']);
  });
});
