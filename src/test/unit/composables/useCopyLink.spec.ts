import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { DEFAULT_CONFIG, type UserConfig } from '../../../config/types';
import {
  applyLinkPrefix,
  formatLinkWithConfig,
  getLinkFormatConfig,
  useCopyLink,
} from '../../../composables/useCopyLink';

const { writeTextMock, toastSuccessMock, toastWarnMock, toastErrorMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
const configRef = ref<UserConfig>(makeConfig());

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warn: toastWarnMock,
    error: toastErrorMock,
  }),
}));

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: configRef,
  }),
}));

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    enabledServices: overrides.enabledServices ?? DEFAULT_CONFIG.enabledServices,
    availableServices: overrides.availableServices ?? DEFAULT_CONFIG.availableServices,
    services: {
      ...DEFAULT_CONFIG.services,
      ...(overrides.services || {}),
    },
    linkOutput: {
      ...DEFAULT_CONFIG.linkOutput!,
      ...(overrides.linkOutput || {}),
    },
    linkPrefixConfig: overrides.linkPrefixConfig ?? DEFAULT_CONFIG.linkPrefixConfig,
  };
}

beforeEach(() => {
  writeTextMock.mockReset();
  toastSuccessMock.mockReset();
  toastWarnMock.mockReset();
  toastErrorMock.mockReset();
  configRef.value = makeConfig();
});

describe('useCopyLink helpers', () => {
  it('applyLinkPrefix only applies for weibo', () => {
    const config = makeConfig({
      linkPrefixConfig: {
        enabled: true,
        selectedIndex: 0,
        prefixList: ['https://proxy.example.com/'],
      },
    });

    expect(applyLinkPrefix('https://example.com/a.png', 'weibo', config))
      .toBe('https://proxy.example.com/https://example.com/a.png');
    expect(applyLinkPrefix('https://example.com/a.png', 'jd', config))
      .toBe('https://example.com/a.png');
  });

  it('getLinkFormatConfig falls back to url format', () => {
    const config: UserConfig = {
      ...DEFAULT_CONFIG,
      linkOutput: undefined,
    };

    expect(getLinkFormatConfig(config)).toEqual({
      format: 'url',
      customTemplate: undefined,
    });
  });

  it('formatLinkWithConfig uses default markdown format', () => {
    const config = makeConfig({
      linkOutput: {
        defaultFormat: 'markdown',
        customTemplate: '{url}',
        autoCopy: true,
      },
    });

    const output = formatLinkWithConfig(
      {
        url: 'https://example.com/a.png',
        fileName: 'a.png',
        serviceId: 'jd',
      },
      config
    );

    expect(output).toBe('![a.png](https://example.com/a.png)');
  });

  it('formatLinkWithConfig supports bbcode override', () => {
    const config = makeConfig();

    const output = formatLinkWithConfig(
      {
        url: 'https://example.com/a.png',
        fileName: 'a.png',
        serviceId: 'jd',
      },
      config,
      'bbcode'
    );

    expect(output).toBe('[img]https://example.com/a.png[/img]');
  });

  it('formatLinkWithConfig supports custom template and dimensions', () => {
    const config = makeConfig({
      linkPrefixConfig: {
        enabled: true,
        selectedIndex: 0,
        prefixList: ['https://proxy.example.com/'],
      },
      linkOutput: {
        defaultFormat: 'custom',
        customTemplate: '[img={width}x{height}]{url}[/img]',
        autoCopy: true,
      },
    });

    const output = formatLinkWithConfig(
      {
        url: 'https://example.com/a.png',
        fileName: 'a.png',
        serviceId: 'weibo',
        width: 1200,
        height: 800,
      },
      config
    );

    expect(output).toBe('[img=1200x800]https://proxy.example.com/https://example.com/a.png[/img]');
  });
});

describe('useCopyLink composable', () => {
  it('copyLinks returns success result and supports silent success toast', async () => {
    const { copyLinks } = useCopyLink();
    const result = await copyLinks(
      [{ url: 'https://example.com/a.png', fileName: 'a.png', serviceId: 'jd' }],
      { showSuccessToast: false }
    );

    expect(result).toEqual({
      ok: true,
      copiedCount: 1,
      format: 'url',
    });
    expect(writeTextMock).toHaveBeenCalledWith('https://example.com/a.png');
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('copyLinks returns failure result and can silence error toast', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('denied'));
    const { copyLinks } = useCopyLink();
    const result = await copyLinks(
      [{ url: 'https://example.com/a.png', fileName: 'a.png', serviceId: 'jd' }],
      { showSuccessToast: false, showErrorToast: false }
    );

    expect(result.ok).toBe(false);
    expect(result.copiedCount).toBe(0);
    expect(result.error).toContain('denied');
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('copyLinks returns no-link failure when formatted output is empty', async () => {
    const { copyLinks } = useCopyLink();
    const result = await copyLinks([{ url: '', fileName: 'a.png', serviceId: 'jd' }]);

    expect(result).toEqual({
      ok: false,
      copiedCount: 0,
      format: 'url',
      error: '没有可复制的链接',
    });
    expect(toastWarnMock).toHaveBeenCalledWith('无可用链接', '没有可复制的链接');
  });

  it('showToast false disables both success and error toasts', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('copy-failed'));
    const { copyLink } = useCopyLink();
    const result = await copyLink(
      { url: 'https://example.com/a.png', fileName: 'a.png', serviceId: 'jd' },
      { showToast: false }
    );

    expect(result.ok).toBe(false);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
