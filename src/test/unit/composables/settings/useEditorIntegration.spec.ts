import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useEditorIntegration } from '../../../../composables/settings/useEditorIntegration';
import type { SettingsFormShape } from '../../../../composables/settings/settingsFormTypes';
import { DEFAULT_CONFIG } from '../../../../config/defaults';
import { getInvokeMock, resetTauriMocks, setupInvokeResponses } from '../../../helpers/tauriMock';

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    showConfig: vi.fn(),
  }),
}));

function makeForm(cliEnabled?: boolean): SettingsFormShape {
  return {
    weiboCookie: '',
    r2: {
      accountId: 'account',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucketName: 'bucket',
      path: 'images/',
      publicDomain: 'https://cdn.example.com',
    },
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
    smms: { token: 'smms-token' },
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
    editorServer: {
      ...DEFAULT_CONFIG.editorServer!,
      cliEnabled,
    },
  };
}

describe('useEditorIntegration', () => {
  beforeEach(() => {
    resetTauriMocks();
    setupInvokeResponses({
      update_server_config: undefined,
      save_cli_config: undefined,
    });
  });

  it('does not export CLI services when cliEnabled is missing', async () => {
    const formData = ref(makeForm(undefined));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    await applyEditorServer(formData.value.editorServer, { force: true });

    expect(getInvokeMock()).toHaveBeenCalledWith('save_cli_config', {
      serviceConfigJson: null,
      servicesConfigJson: null,
    });
  });

  it('exports CLI services only when cliEnabled is true', async () => {
    const formData = ref(makeForm(true));
    const { applyEditorServer } = useEditorIntegration({
      formData,
      isSettingsReady: ref(true),
      errorToString: (error) => String(error),
    });

    await applyEditorServer(formData.value.editorServer, { force: true });

    expect(getInvokeMock()).toHaveBeenCalledWith('save_cli_config', {
      serviceConfigJson: null,
      servicesConfigJson: expect.stringContaining('"smms"'),
    });
  });
});
