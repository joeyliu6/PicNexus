import { describe, expect, it } from 'vitest';
import type { SettingsFormShape } from '@/composables/settings/settingsFormTypes';
import {
  buildCliServicesConfig,
  buildCliServicesSignature,
  buildEditorCredentialSignature,
  buildServiceConfig,
  buildServiceConfigJson,
  isCliCompatibleServiceConfigured,
} from '@/composables/settings/editorServiceConfig';
import { DEFAULT_CONFIG } from '@/config/defaults';
import { DEFAULT_WEBDAV_URL_TEMPLATE } from '@/config/types';
import type { WebDAVStorageProfile } from '@/config/types';

function makeWebDAVProfile(overrides: Partial<WebDAVStorageProfile> = {}): WebDAVStorageProfile {
  return {
    id: 'profile-1',
    name: '我的 OpenList',
    url: 'https://dav.example.com/dav',
    username: 'user',
    passwordEncrypted: 'PNXENC:ciphertext',
    remotePath: '/images/',
    publicDomain: 'https://cdn.example.com',
    publicUrlTemplate: '{domain}/{path}',
    ...overrides,
  };
}

function makeForm(overrides: Partial<SettingsFormShape> = {}): SettingsFormShape {
  return {
    weiboCookie: '',
    r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '' },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '' },
    custom_s3_profiles: [],
    webdav_profiles: [],
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

  it('exports a fully configured WebDAV profile under its composite service id with snake_case fields', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true },
      webdav_profiles: [makeWebDAVProfile()],
    });

    const services = buildCliServicesConfig(form, { 'webdav:profile-1': 'plaintext-pw' });

    expect(services['webdav:profile-1']).toEqual({
      type: 'webdav',
      url: 'https://dav.example.com/dav',
      username: 'user',
      password: 'plaintext-pw',
      remote_path: '/images/',
      public_domain: 'https://cdn.example.com',
      public_url_template: '{domain}/{path}',
      lan_http_confirmed: false,
      unique_file_name: true,
    });
  });

  it('defaults unique_file_name to true for profiles saved before the field existed', () => {
    // 老 profile 里没有 uniqueFileName 字段。判据必须是 `!== false`，
    // 按 falsy 处理等于给老用户默认关掉防覆盖——而沉默覆盖是会丢图的。
    const form = makeForm({ webdav_profiles: [makeWebDAVProfile()] });
    expect(makeWebDAVProfile().uniqueFileName).toBeUndefined();

    expect(buildServiceConfig('webdav:profile-1', form)).toMatchObject({ unique_file_name: true });
  });

  it('honours an explicitly disabled uniqueFileName', () => {
    const form = makeForm({ webdav_profiles: [makeWebDAVProfile({ uniqueFileName: false })] });

    expect(buildServiceConfig('webdav:profile-1', form)).toMatchObject({ unique_file_name: false });
  });

  it('changes the credential signature when uniqueFileName is toggled', () => {
    // 不进签名的话，用户关掉开关后 cli-config.json 不会重新下发，编辑器那条链路会一直用旧设置
    const on = makeForm({ webdav_profiles: [makeWebDAVProfile({ uniqueFileName: true })] });
    const off = makeForm({ webdav_profiles: [makeWebDAVProfile({ uniqueFileName: false })] });

    expect(buildEditorCredentialSignature('webdav:profile-1', on))
      .not.toBe(buildEditorCredentialSignature('webdav:profile-1', off));
  });

  it('excludes a WebDAV profile missing required fields (publicDomain)', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true },
      webdav_profiles: [makeWebDAVProfile({ publicDomain: '' })],
    });

    expect(isCliCompatibleServiceConfigured('webdav:profile-1', form)).toBe(false);
    expect(buildCliServicesConfig(form)['webdav:profile-1']).toBeUndefined();
  });

  it('builds a WebDAV service config using the plaintext password passed in, not the ciphertext', () => {
    const form = makeForm({ webdav_profiles: [makeWebDAVProfile()] });

    const config = buildServiceConfig('webdav:profile-1', form, 'decrypted-plaintext');

    expect(config).toMatchObject({ type: 'webdav', password: 'decrypted-plaintext' });
    expect(config?.password).not.toBe('PNXENC:ciphertext');
  });

  it('omits the password when no plaintext override is given (sync callers never see ciphertext leak)', () => {
    const form = makeForm({ webdav_profiles: [makeWebDAVProfile()] });

    expect(buildServiceConfig('webdav:profile-1', form)).toMatchObject({ type: 'webdav', password: '' });
  });

  it('falls back to the default URL template when the profile has an empty one', () => {
    // 设置页的「链接模板」输入框可以被清空，清空后只显示 placeholder，看上去仍然有值。
    // 主上传链路（WebDAVUploader）一直有这层兜底，编辑器/CLI 这条链路以前没有，
    // 于是 Rust 侧 render_public_url 会渲染出空链接，且是静默的。
    for (const emptyish of ['', '   ']) {
      const form = makeForm({
        editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true },
        webdav_profiles: [makeWebDAVProfile({ publicUrlTemplate: emptyish })],
      });

      expect(buildServiceConfig('webdav:profile-1', form)).toMatchObject({
        public_url_template: DEFAULT_WEBDAV_URL_TEMPLATE,
      });
      expect(buildCliServicesConfig(form)['webdav:profile-1']).toMatchObject({
        public_url_template: DEFAULT_WEBDAV_URL_TEMPLATE,
      });
    }
  });

  it('keeps a custom URL template untouched', () => {
    const form = makeForm({
      webdav_profiles: [makeWebDAVProfile({ publicUrlTemplate: '{domain}/d/pic/{path}' })],
    });

    expect(buildServiceConfig('webdav:profile-1', form)).toMatchObject({
      public_url_template: '{domain}/d/pic/{path}',
    });
  });

  it('changes the WebDAV credential signature when the stored ciphertext changes, without decrypting', () => {
    const form = makeForm({ webdav_profiles: [makeWebDAVProfile()] });
    const originalSignature = buildEditorCredentialSignature('webdav:profile-1', form);

    form.webdav_profiles = [makeWebDAVProfile({ passwordEncrypted: 'PNXENC:different-ciphertext' })];
    const changedSignature = buildEditorCredentialSignature('webdav:profile-1', form);

    expect(changedSignature).not.toBe(originalSignature);
  });

  it('returns an empty signature for an unknown WebDAV composite id', () => {
    const form = makeForm({ webdav_profiles: [] });

    expect(buildEditorCredentialSignature('webdav:missing', form)).toBe('');
  });

  it('changes the CLI signature when a CLI-only WebDAV profile password changes (regression: stale cli-config.json)', () => {
    // buildCliServicesConfigJson 的 password 字段在没传 webdavPasswords 时固定是空串，
    // 不能拿它当变更签名——这里必须用 buildCliServicesSignature（走密文比较）。
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true },
      webdav_profiles: [makeWebDAVProfile()],
    });
    const originalSignature = buildCliServicesSignature(form);

    form.webdav_profiles = [makeWebDAVProfile({ passwordEncrypted: 'PNXENC:different-ciphertext' })];
    const changedSignature = buildCliServicesSignature(form);

    expect(changedSignature).not.toBe(originalSignature);
  });

  it('CLI signature is empty when CLI export is disabled', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: false },
      webdav_profiles: [makeWebDAVProfile()],
    });

    expect(buildCliServicesSignature(form)).toBe('');
  });

  it('CLI signature excludes an incomplete WebDAV profile the same way buildCliServicesConfig does', () => {
    const form = makeForm({
      editorServer: { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true },
      webdav_profiles: [makeWebDAVProfile({ publicDomain: '' })],
    });

    expect(buildCliServicesSignature(form)).not.toContain('webdav:profile-1');
  });
});
