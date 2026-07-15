import { describe, expect, it } from 'vitest';
import type { SettingsFormShape } from '@/composables/settings/settingsFormTypes';
import {
  buildCliServicesConfig,
  buildServiceConfig,
  buildServiceConfigJson,
} from '@/composables/settings/editorServiceConfig';
import { DEFAULT_CONFIG } from '@/config/defaults';

function makeForm(overrides: Partial<SettingsFormShape> = {}): SettingsFormShape {
  return {
    weiboCookie: '',
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '' },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '' },
    custom_s3_profiles: [],
    nowcoder: { cookie: '' },
    zhihu: { cookie: '', sourceParamEnabled: true, sourceParamValue: '' },
    nami: { cookie: '', authToken: '' },
    bilibili: { cookie: '' },
    chaoxing: { cookie: '' },
    smms: { token: '' },
    github: {
      enabled: false,
      token: '',
      owner: '',
      repo: '',
      branch: 'main',
      path: 'images/',
      cdnConfig: structuredClone(DEFAULT_CONFIG.services.github?.cdnConfig),
    },
    imgur: { clientId: '', clientSecret: '' },
    editorServer: { ...DEFAULT_CONFIG.editorServer! },
    ...overrides,
  };
}

describe('editorServiceConfig', () => {
  it('exports all configured CLI-compatible services and excludes unsupported services', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true },
      smms: { token: 'smms-token' },
      r2: {
        accountId: 'account',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        bucketName: 'bucket',
        path: 'images/',
        publicDomain: 'https://cdn.example.com',
      },
      nami: { cookie: 'nami-cookie', authToken: 'nami-token' },
    });

    const services = buildCliServicesConfig(form);

    expect(services.jd).toEqual({ type: 'jd' });
    expect(services.smms).toEqual({ type: 'smms', token: 'smms-token' });
    expect(services.r2).toMatchObject({ type: 'r2', account_id: 'account' });
    expect(services.github).toBeUndefined();
    expect(services.qiyu).toBeUndefined();
    expect(services.nami).toBeUndefined();
  });

  it('exports custom S3 profiles under their composite service id', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true },
      custom_s3_profiles: [{
        id: 'profile-1',
        name: 'Prod S3',
        endpoint: 'https://s3.example.com',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'auto',
        bucket: 'bucket',
        path: 'images/',
        publicDomain: 'https://cdn.example.com',
      }],
    });

    const services = buildCliServicesConfig(form);

    expect(services['custom_s3:profile-1']).toMatchObject({
      type: 'customS3',
      endpoint: 'https://s3.example.com',
      access_key_id: 'key',
      bucket: 'bucket',
    });
  });

  it('returns an empty CLI services export when CLI is disabled', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: false },
      smms: { token: 'smms-token' },
    });

    const services = buildCliServicesConfig(form);

    expect(services).toEqual({});
  });

  it('returns an empty CLI services export when CLI is missing from old config', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: undefined },
      smms: { token: 'smms-token' },
    });

    const services = buildCliServicesConfig(form);

    expect(services).toEqual({});
  });

  it('uses customS3 as the Rust config type while keeping the external service id stable', () => {
    const form = makeForm({
      custom_s3_profiles: [{
        id: 'docs',
        name: 'Docs',
        endpoint: 'https://s3.example.com',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'auto',
        bucket: 'bucket',
        path: 'docs/',
        publicDomain: '',
      }],
    });

    expect(buildServiceConfig('custom_s3:docs', form)).toMatchObject({ type: 'customS3' });
    expect(buildServiceConfigJson('custom_s3:docs', form)).toContain('"type":"customS3"');
  });

  it('keeps Zhihu source parameter fields compatible with Rust serde names', () => {
    const form = makeForm({
      zhihu: { cookie: 'z_c0=token', sourceParamEnabled: false, sourceParamValue: 'custom-source' },
    });

    expect(buildServiceConfig('zhihu', form)).toMatchObject({
      type: 'zhihu',
      sourceParamEnabled: false,
      sourceParamValue: 'custom-source',
    });
  });
});
